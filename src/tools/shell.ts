import { spawn, type ChildProcess } from 'node:child_process';
import type { Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ToolDefinition } from '../types.js';
import { windowsSystemExecutable } from '../windows-system.js';

interface ProcessScope { workspace: string; conversation: string; deletedAlias?: string }
export interface ManagedProcess {
  processId: string;
  pid: number | undefined;
  command: string;
  cwd: string;
  owner: ProcessScope;
  startTime: number;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  exitCode: number | null;
  output: string;
  child: ChildProcess;
  stdin?: Writable | null;
}

const backgroundProcesses = new Map<string, ManagedProcess>();

const workspaceAlias = (workspace: string): string => {
  const path = resolve(workspace);
  return process.platform === 'win32' ? path.toLowerCase() : path;
};

async function processScope(workspace: string, owner?: string, allowMissing = false): Promise<ProcessScope> {
  if (typeof owner !== 'string' || !owner.trim() || owner.length > 512) {
    throw new Error('Background process ownership context is required');
  }
  try {
    const root = await realpath(resolve(workspace));
    return { workspace: workspaceAlias(root), conversation: owner };
  } catch (error) {
    if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // Keep known handles manageable after their launch directory is removed.
    // Existing/repointed aliases always take the fresh realpath branch above.
    for (const proc of backgroundProcesses.values()) {
      if (proc.owner.conversation === owner && workspaceAlias(proc.cwd) === workspaceAlias(workspace)) {
        return { ...proc.owner, deletedAlias: workspaceAlias(workspace) };
      }
    }
    throw error;
  }
}

const ownsProcess = (proc: ManagedProcess, scope: ProcessScope): boolean =>
  proc.owner.conversation === scope.conversation && (scope.deletedAlias !== undefined
    ? workspaceAlias(proc.cwd) === scope.deletedAlias : proc.owner.workspace === scope.workspace);

function ownedProcess(id: string, owner: ProcessScope): ManagedProcess {
  const proc = backgroundProcesses.get(id);
  if (!proc || !ownsProcess(proc, owner)) throw new Error(`Background process '${id}' not found`);
  return proc;
}

const POWERSHELL_SYNTAX_REGEX =
  /(?:\b(?:Get-|Set-|New-|Remove-|Invoke-|Select-|Where-|ForEach-|Out-|Test-Path|Start-Process|Stop-|Restart-|Start-|Copy-|Move-|Rename-|Clear-|Write-|Read-|Measure-|Compare-|ConvertTo-|ConvertFrom-|Resolve-|Split-|Join-)\w*|\$env:|\$PSVersionTable|\$ErrorActionPreference|\[System\.|\[Math\]::|\[Console\]::)/i;

/** Avoid implicitly giving model-launched programs provider and bridge secrets.
 * This is defense in depth; commands still run with the user's OS permissions. */
export function shellEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (/(?:^|_)(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?|PRIVATE_KEY)(?:_|$)/i.test(name)) continue;
    env[name] = value;
  }
  return { ...env, CI: 'true', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', NPM_CONFIG_YES: 'true' };
}

function spawnCommand(
  command: string,
  options: {
    cwd: string;
    stdio: ['pipe' | 'ignore', 'pipe', 'pipe'];
    detached?: boolean;
    windowsHide?: boolean;
  }
): ChildProcess {
  const isWin = process.platform === 'win32';
  const isPowerShell = isWin && POWERSHELL_SYNTAX_REGEX.test(command);
  const env = shellEnvironment();

  if (isPowerShell) {
    return spawn(windowsSystemExecutable('powershell'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      cwd: options.cwd,
      shell: false,
      windowsHide: options.windowsHide ?? true,
      detached: options.detached,
      stdio: options.stdio,
      env,
    });
  }

  return spawn(command, {
    cwd: options.cwd,
    shell: true,
    windowsHide: options.windowsHide ?? true,
    detached: options.detached,
    stdio: options.stdio,
    env,
  });
}

export function stopAllBackgroundProcesses(): void {
  for (const proc of backgroundProcesses.values()) {
    if (proc.status === 'running' && proc.pid) {
      proc.status = 'stopped';
      try {
        if (process.platform === 'win32') {
          spawn(windowsSystemExecutable('taskkill'), ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        } else {
          try { process.kill(-proc.pid, 'SIGKILL'); } catch { proc.child.kill('SIGKILL'); }
        }
      } catch {
        /* ignore */
      }
    }
  }
}

export function pruneCompletedProcesses(): number {
  let count = 0;
  for (const [id, proc] of backgroundProcesses.entries()) {
    if (proc.status !== 'running') {
      proc.output = '';
      backgroundProcesses.delete(id);
      count++;
    }
  }
  return count;
}

const MAX_TOTAL_PROCESSES = 20;
const MAX_RUNNING_PROCESSES = 12;

function enforceProcessLimit(): void {
  if (backgroundProcesses.size > MAX_TOTAL_PROCESSES) {
    const completed = Array.from(backgroundProcesses.entries())
      .filter(([_, p]) => p.status !== 'running')
      .sort((a, b) => a[1].startTime - b[1].startTime);
    for (const [id, proc] of completed) {
      proc.output = '';
      backgroundProcesses.delete(id);
      if (backgroundProcesses.size <= MAX_TOTAL_PROCESSES) break;
    }
  }
}

function tailLinesFromBuffer(text: string, maxLines: number): string {
  if (!text || maxLines <= 0) return '';
  let pos = text.length;
  let linesFound = 0;
  while (pos > 0) {
    const idx = text.lastIndexOf('\n', pos - 1);
    if (idx === -1) {
      return text.replace(/\r\n/g, '\n');
    }
    linesFound++;
    if (linesFound >= maxLines) {
      return text.slice(idx + 1).replace(/\r\n/g, '\n');
    }
    pos = idx;
  }
  return text.replace(/\r\n/g, '\n');
}

// Ensure cleanup on normal process exit
process.on('exit', () => stopAllBackgroundProcesses());

export const shellToolDefinitions: ToolDefinition[] = [
  {
    name: 'shell',
    description: 'Run a shell command from the workspace. Commands have the user’s full permissions and can access or modify files outside the workspace. Requires approval.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command line to execute.' },
        timeout_ms: { type: 'integer', minimum: 1000, maximum: 120000, description: 'Timeout in milliseconds (1000-120000).' },
        background: { type: 'boolean', description: 'If true, launches the process in the background and returns its ID and initial output.' },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
  {
    name: 'process_list',
    description: 'List background processes belonging to this chat and workspace.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'process_output',
    description: 'Get accumulated standard output and error from a background process.',
    parameters: {
      type: 'object',
      properties: {
        process_id: { type: 'string', description: 'The process ID returned when the process was started.' },
        tail_lines: { type: 'integer', minimum: 1, maximum: 1000, description: 'Optional number of trailing lines to return.' },
      },
      required: ['process_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'process_stop',
    description: 'Terminate a running background process.',
    parameters: {
      type: 'object',
      properties: {
        process_id: { type: 'string', description: 'The process ID of the background process to terminate.' },
      },
      required: ['process_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'process_write',
    description: 'Send input text to a running background process standard input (stdin). Requires approval because input can execute commands.',
    parameters: {
      type: 'object',
      properties: {
        process_id: { type: 'string', description: 'The process ID of the background process.' },
        id: { type: 'string', description: 'Alternative process ID alias.' },
        input: { type: 'string', description: 'The input text string to send to standard input.' },
        append_newline: { type: 'boolean', description: 'Whether to append a trailing newline (default true).' },
      },
      required: ['input'],
      additionalProperties: false,
    },
  },
];

export const SHELL_TOOLS: ToolDefinition[] = shellToolDefinitions;
export const executeShellTool = handleShellTool;

export async function handleShellTool(
  toolNameOrArgs: string | Record<string, unknown>,
  argsOrWorkspace?: Record<string, unknown> | string,
  workspaceOrSignal?: string | AbortSignal,
  maybeSignal?: AbortSignal,
  processOwner?: string
): Promise<string> {
  let name = 'shell';
  let args: Record<string, unknown> = {};
  let workspace = '.';
  let signal: AbortSignal | undefined;

  if (typeof toolNameOrArgs === 'string') {
    name = toolNameOrArgs;
    args = (argsOrWorkspace && typeof argsOrWorkspace === 'object') ? argsOrWorkspace : {};
    workspace = typeof workspaceOrSignal === 'string' ? workspaceOrSignal : '.';
    signal = maybeSignal;
  } else {
    args = toolNameOrArgs || {};
    if (typeof args.tool === 'string') name = args.tool;
    else if (typeof args.action === 'string') name = args.action;
    else if (typeof args.process_id === 'string' && !args.command) name = 'process_output';
    workspace = typeof argsOrWorkspace === 'string' ? argsOrWorkspace : '.';
    signal = workspaceOrSignal instanceof AbortSignal ? workspaceOrSignal : undefined;
  }

  signal?.throwIfAborted();
  const owner = name.startsWith('process_') || args.background === true
    ? await processScope(workspace, processOwner, name.startsWith('process_')) : undefined;
  signal?.throwIfAborted();

  if (name === 'process_list') {
    const list = Array.from(backgroundProcesses.values()).filter(p => ownsProcess(p, owner!)).map(p => ({
      processId: p.processId,
      pid: p.pid,
      command: p.command.length > 80 ? p.command.slice(0, 77) + '...' : p.command,
      status: p.status,
      exitCode: p.exitCode,
      uptimeSeconds: Math.round((Date.now() - p.startTime) / 1000),
      outputLength: p.output.length,
    }));
    return JSON.stringify({ count: list.length, processes: list }, null, 2);
  }

  if (name === 'process_output') {
    const processId = typeof args.process_id === 'string' ? args.process_id.trim() : '';
    if (!processId) throw new Error('process_id must be a non-empty string');
    const proc = ownedProcess(processId, owner!);

    let output = proc.output;
    if (typeof args.tail_lines === 'number' && args.tail_lines > 0) {
      output = tailLinesFromBuffer(output, args.tail_lines);
    }
    return JSON.stringify({
      processId: proc.processId,
      pid: proc.pid,
      status: proc.status,
      exitCode: proc.exitCode,
      output: output || '(no output yet)',
    }, null, 2);
  }

  if (name === 'process_stop') {
    const processId = typeof args.process_id === 'string' ? args.process_id.trim() : '';
    if (!processId) throw new Error('process_id must be a non-empty string');
    const proc = ownedProcess(processId, owner!);

    if (proc.status === 'running' && proc.pid) {
      proc.status = 'stopped';
      proc.child.stdout?.destroy();
      proc.child.stderr?.destroy();
      if (process.platform === 'win32') {
        const killer = spawn(windowsSystemExecutable('taskkill'), ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        await new Promise<void>(resolve => {
          const timeout = setTimeout(resolve, 2000);
          killer.on('close', () => { clearTimeout(timeout); resolve(); });
          killer.on('error', () => { clearTimeout(timeout); resolve(); });
        });
      } else {
        try { process.kill(-proc.pid, 'SIGKILL'); } catch { proc.child.kill('SIGKILL'); }
      }
    }
    enforceProcessLimit();
    return JSON.stringify({ processId: proc.processId, status: proc.status, message: `Process ${processId} stopped.` }, null, 2);
  }

  if (name === 'process_write') {
    const rawId = args.process_id ?? args.id;
    if (rawId === undefined || rawId === null || String(rawId).trim() === '') {
      throw new Error('process_id (veya id) parametresi belirtilmelidir.');
    }
    const procKey = String(rawId).trim();
    const proc = ownedProcess(procKey, owner!);
    if (proc.status !== 'running' || !proc.child.stdin || proc.child.stdin.destroyed) {
      throw new Error(`Süreç '${procKey}' çalışır durumda değil veya stdin kapalı (Durum: ${proc.status}).`);
    }

    const input = typeof args.input === 'string' ? args.input : String(args.input ?? '');
    const appendNewline = args.append_newline !== false;
    const toWrite = appendNewline ? (input.endsWith('\n') ? input : `${input}\n`) : input;

    await new Promise<void>((resolve, reject) => {
      proc!.child.stdin!.write(toWrite, 'utf8', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    return JSON.stringify({
      processId: proc.processId,
      pid: proc.pid,
      status: proc.status,
      bytesWritten: Buffer.byteLength(toWrite, 'utf8'),
      message: `Girdi başarıyla sürecin stdin akışına gönderildi.`,
    }, null, 2);
  }

  // Handle standard 'shell' command
  if (typeof args.command !== 'string' || !args.command.trim()) throw new Error('command must be a non-empty string');

  // Background execution mode
  if (args.background === true) {
    // A new owner must never evict another owner's running child to obtain a slot.
    if (Array.from(backgroundProcesses.values()).filter(p => p.status === 'running').length >= MAX_RUNNING_PROCESSES) {
      throw new Error('Background process capacity reached; stop an owned process before starting another');
    }
    const processId = 'proc_' + randomUUID();
    const child = spawnCommand(args.command as string, {
      cwd: resolve(workspace),
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const managed: ManagedProcess = {
      processId,
      pid: child.pid,
      command: args.command as string,
      cwd: resolve(workspace),
      owner: owner!,
      startTime: Date.now(),
      status: 'running',
      exitCode: null,
      output: '',
      child,
      stdin: child.stdin,
    };
    backgroundProcesses.set(processId, managed);
    enforceProcessLimit();

    const append = (data: Buffer) => {
      const chunk = data.toString('utf8');
      if (managed.output.length < 200000) {
        managed.output += chunk.slice(0, 200000 - managed.output.length);
      }
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('error', error => {
      managed.status = 'failed';
      managed.output += `\nProcess error: ${error.message}`;
      enforceProcessLimit();
    });
    child.on('close', code => {
      if (managed.status === 'running') {
        managed.status = code === 0 ? 'completed' : 'failed';
        managed.exitCode = code;
      }
      enforceProcessLimit();
    });

    // Collect first 1.5 seconds of initial output
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 1500);
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    return JSON.stringify({
      processId: managed.processId,
      pid: managed.pid,
      status: managed.status,
      initialOutput: managed.output.trim() || '(no output yet)',
    }, null, 2);
  }

  // Synchronous execution mode
  const timeout = typeof args.timeout_ms === 'number' && Number.isFinite(args.timeout_ms) ? Math.min(120000, Math.max(1000, args.timeout_ms)) : 30000;
  return new Promise((resolve, reject) => {
    const child = spawnCommand(args.command as string, { cwd: workspace, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let truncated = false; let settled = false; let stopping = false;
    const add = (data: Buffer) => { const chunk = data.toString('utf8'); if (output.length < 100000) output += chunk.slice(0, 100000 - output.length); if (output.length >= 100000) truncated = true; };
    const finish = (status: string) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(`${output}${truncated ? '\n[output truncated]' : ''}\n${status}`); };
    const stop = (why: string) => {
      if (stopping || settled) return;
      stopping = true;
      child.stdout?.destroy(); child.stderr?.destroy();
      const done = () => finish(`${why}; process tree termination attempted (detached descendants may continue)`);
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn(windowsSystemExecutable('taskkill'), ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        const limit = setTimeout(() => { killer.kill(); child.kill(); done(); }, 3000);
        killer.on('error', () => { clearTimeout(limit); child.kill(); done(); });
        killer.on('close', () => { clearTimeout(limit); done(); });
      } else {
        try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill(); } catch { child.kill(); }
        done();
      }
    };
    const timer = setTimeout(() => stop('Timed out'), timeout);
    const abort = () => stop('Aborted'); signal?.addEventListener('abort', abort, { once: true });
    child.stdout?.on('data', add); child.stderr?.on('data', add);
    child.on('error', error => { if (!settled) { settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error); } });
    child.on('close', (code, killedBy) => { if (!stopping) finish(`Exit code: ${code ?? `signal ${killedBy}`}`); });
  });
}
