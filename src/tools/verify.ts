import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ToolDefinition } from '../types.js';
import { handleShellTool } from './shell.js';
import { redactSecrets } from '../security/redact.js';

const SCRIPT_NAME = /^[A-Za-z0-9:_-]{1,80}$/;
const MAX_COMMANDS = 3;
const DEFAULT_TIMEOUT_MS = 120_000;
const OUTPUT_LIMIT = 20_000;
const FAILURE_TAIL_CHARS = 8_000;
const ERROR_LINE = /(?:AssertionError|\bError\b|FAIL(?:ED|URES?)?|\bExpected\b|\bReceived\b|\berror\b)/iu;

/** Last 4-8 KB, starting at a line boundary so stack traces stay readable. */
function failureTail(output: string): string {
  if (output.length <= FAILURE_TAIL_CHARS) return output;
  let start = output.length - FAILURE_TAIL_CHARS;
  const newline = output.indexOf('\n', start);
  if (newline >= 0 && newline < output.length - 1) start = newline + 1;
  return output.slice(start);
}

/** Last meaningful failure line, skipping the exit-code markers added by the shell. */
function lastFailureLine(output: string): string | undefined {
  const lines = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\[TBOT_EXIT:|^Exit code:/iu.test(lines[i])) continue;
    if (ERROR_LINE.test(lines[i])) return lines[i].slice(0, 500);
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!/^\[TBOT_EXIT:|^Exit code:/iu.test(lines[i])) return lines[i].slice(0, 500);
  }
  return undefined;
}

export interface VerificationCommand {
  script: string;
  command: string;
}

export const verifyToolDefinitions: ToolDefinition[] = [
  {
    name: 'project_verify',
    description: 'Run the project\'s declared verification scripts (typecheck, lint, test, check) and return their real output. Use after edits. Requires approval; only scripts declared in package.json are allowed.',
    parameters: {
      type: 'object',
      properties: {
        commands: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional subset of declared script names. Defaults to the first available typecheck/check/lint/test scripts.',
        },
        timeout_ms: { type: 'integer', minimum: 5_000, maximum: 120_000, description: 'Per-command timeout (default 120000).' },
      },
      additionalProperties: false,
    },
  },
];

async function packageScripts(workspace: string): Promise<Record<string, string> | null> {
  try {
    const raw = await readFile(join(workspace, 'package.json'), 'utf8');
    if (raw.length > 1_000_000) return null;
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    if (!parsed?.scripts || typeof parsed.scripts !== 'object' || Array.isArray(parsed.scripts)) return null;
    return Object.fromEntries(Object.entries(parsed.scripts)
      .filter(([name, value]) => SCRIPT_NAME.test(name) && typeof value === 'string' && value.length <= 4_000)
      .map(([name, value]) => [name, value as string]));
  } catch {
    return null;
  }
}

/** Detect only project-declared scripts; never invent a command or run a shell string from model input. */
export async function detectVerificationCommands(workspace: string): Promise<VerificationCommand[]> {
  const scripts = await packageScripts(workspace);
  if (!scripts) return [];
  const preferred = ['typecheck', 'check', 'lint', 'test'];
  const manager = await detectPackageManager(workspace);
  const selected = preferred.filter(name => scripts[name]).slice(0, MAX_COMMANDS);
  return selected.map(name => ({ script: name, command: `${manager} run ${name}` }));
}

async function detectPackageManager(workspace: string): Promise<'npm' | 'pnpm' | 'yarn' | 'bun'> {
  for (const [file, manager] of [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lockb', 'bun'], ['bun.lock', 'bun']] as const) {
    try {
      await readFile(join(workspace, file));
      return manager;
    } catch { /* try next lockfile */ }
  }
  return 'npm';
}

export async function handleVerifyTool(
  name: string,
  args: Record<string, unknown>,
  workspace: string,
  signal?: AbortSignal,
  processOwner?: string
): Promise<string> {
  if (name !== 'project_verify') throw new Error(`Unknown verification tool: ${name}`);
  const detected = await detectVerificationCommands(workspace);
  if (!detected.length) {
    return JSON.stringify({
      ok: false,
      outcome: 'unavailable',
      summary: 'No typecheck, check, lint or test scripts were found in package.json.',
      failure: 'No typecheck, check, lint or test scripts were found in package.json.',
      commands: [],
    });
  }

  const requested = Array.isArray(args.commands)
    ? args.commands.filter((value): value is string => typeof value === 'string')
    : [];
  const allowed = new Map(detected.map(item => [item.script, item]));
  const selected = requested.length
    ? requested.map(script => allowed.get(script)).filter((item): item is VerificationCommand => Boolean(item))
    : detected;
  if (!selected.length) {
    return JSON.stringify({
      ok: false,
      outcome: 'denied',
      summary: 'The requested scripts are not declared project verification scripts.',
      failure: 'The requested scripts are not declared project verification scripts.',
      allowed: [...allowed.keys()],
    });
  }

  const timeoutMs = typeof args.timeout_ms === 'number' && Number.isFinite(args.timeout_ms)
    ? Math.max(5_000, Math.min(120_000, Math.floor(args.timeout_ms)))
    : DEFAULT_TIMEOUT_MS;
  const results: Array<{
    script: string;
    ok: boolean;
    output: string;
    outputTruncated?: boolean;
    failure?: string;
    failureTail?: string;
  }> = [];
  for (const item of selected.slice(0, MAX_COMMANDS)) {
    signal?.throwIfAborted();
    const output = await handleShellTool('shell', { command: item.command, timeout_ms: timeoutMs }, workspace, signal, processOwner);
    const ok = /\[TBOT_EXIT:\s*0\]/.test(output) || /(?:^|\n)Exit code:\s*0\s*$/.test(output);
    const tail = failureTail(output);
    results.push({
      script: item.script,
      ok,
      output: redactSecrets(output.slice(0, OUTPUT_LIMIT)),
      ...(output.length > OUTPUT_LIMIT ? { outputTruncated: true } : {}),
      ...(ok ? {} : {
        failure: redactSecrets(lastFailureLine(output) ?? 'verification failed'),
        failureTail: redactSecrets(tail),
      }),
    });
    if (!ok) break;
  }

  const allOk = results.every(result => result.ok);
  const failures = results.filter(result => !result.ok);
  const summary = [
    results.map(result => `${result.script}: ${result.ok ? 'passed' : 'failed'}`).join(', '),
    ...failures.map(result => `${result.script}: ${result.failure}`),
  ].filter(Boolean).join(' — ');

  return JSON.stringify({
    ok: allOk,
    outcome: allOk ? 'ok' : 'error',
    summary,
    ...(allOk ? {} : { failure: redactSecrets(failures.map(result => `${result.script}: ${result.failure}`).join('\n')).slice(0, 4_000) }),
    commands: selected.map(item => item.command),
    results,
  });
}
