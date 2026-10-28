import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { handleShellTool } from './shell.js';
const SCRIPT_NAME = /^[A-Za-z0-9:_-]{1,80}$/;
const MAX_COMMANDS = 3;
const DEFAULT_TIMEOUT_MS = 120_000;
export const verifyToolDefinitions = [
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
async function packageScripts(workspace) {
    try {
        const raw = await readFile(join(workspace, 'package.json'), 'utf8');
        if (raw.length > 1_000_000)
            return null;
        const parsed = JSON.parse(raw);
        if (!parsed?.scripts || typeof parsed.scripts !== 'object' || Array.isArray(parsed.scripts))
            return null;
        return Object.fromEntries(Object.entries(parsed.scripts)
            .filter(([name, value]) => SCRIPT_NAME.test(name) && typeof value === 'string' && value.length <= 4_000)
            .map(([name, value]) => [name, value]));
    }
    catch {
        return null;
    }
}
/** Detect only project-declared scripts; never invent a command or run a shell string from model input. */
export async function detectVerificationCommands(workspace) {
    const scripts = await packageScripts(workspace);
    if (!scripts)
        return [];
    const preferred = ['typecheck', 'check', 'lint', 'test'];
    const manager = await detectPackageManager(workspace);
    const selected = preferred.filter(name => scripts[name]).slice(0, MAX_COMMANDS);
    return selected.map(name => ({ script: name, command: `${manager} run ${name}` }));
}
async function detectPackageManager(workspace) {
    for (const [file, manager] of [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lockb', 'bun'], ['bun.lock', 'bun']]) {
        try {
            await readFile(join(workspace, file));
            return manager;
        }
        catch { /* try next lockfile */ }
    }
    return 'npm';
}
export async function handleVerifyTool(name, args, workspace, signal, processOwner) {
    if (name !== 'project_verify')
        throw new Error(`Unknown verification tool: ${name}`);
    const detected = await detectVerificationCommands(workspace);
    if (!detected.length) {
        return JSON.stringify({
            ok: false,
            outcome: 'unavailable',
            summary: 'No typecheck, check, lint or test scripts were found in package.json.',
            commands: [],
        });
    }
    const requested = Array.isArray(args.commands)
        ? args.commands.filter((value) => typeof value === 'string')
        : [];
    const allowed = new Map(detected.map(item => [item.script, item]));
    const selected = requested.length
        ? requested.map(script => allowed.get(script)).filter((item) => Boolean(item))
        : detected;
    if (!selected.length) {
        return JSON.stringify({
            ok: false,
            outcome: 'denied',
            summary: 'The requested scripts are not declared project verification scripts.',
            allowed: [...allowed.keys()],
        });
    }
    const timeoutMs = typeof args.timeout_ms === 'number' && Number.isFinite(args.timeout_ms)
        ? Math.max(5_000, Math.min(120_000, Math.floor(args.timeout_ms)))
        : DEFAULT_TIMEOUT_MS;
    const results = [];
    for (const item of selected.slice(0, MAX_COMMANDS)) {
        signal?.throwIfAborted();
        const output = await handleShellTool('shell', { command: item.command, timeout_ms: timeoutMs }, workspace, signal, processOwner);
        const ok = /\[TBOT_EXIT:\s*0\]/.test(output) || /(?:^|\n)Exit code:\s*0\s*$/.test(output);
        results.push({ script: item.script, ok, output: output.slice(0, 20_000) });
        if (!ok)
            break;
    }
    return JSON.stringify({
        ok: results.every(result => result.ok),
        outcome: results.every(result => result.ok) ? 'ok' : 'error',
        summary: results.map(result => `${result.script}: ${result.ok ? 'passed' : 'failed'}`).join(', '),
        commands: selected.map(item => item.command),
        results,
    });
}
//# sourceMappingURL=verify.js.map