import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { windowsSystemExecutable } from '../windows-system.js';
import { childEnvironment } from '../security/env.js';
import { assertShellAllowed, sandboxWrap } from '../security/sandbox.js';
/** Unique, parseable marker carrying the real exit code of a finished command. */
export const SHELL_EXIT_MARKER = 'TBOT_EXIT';
const backgroundProcesses = new Map();
const workspaceAlias = (workspace) => {
    const path = resolve(workspace);
    return process.platform === 'win32' ? path.toLowerCase() : path;
};
async function processScope(workspace, owner, allowMissing = false) {
    if (typeof owner !== 'string' || !owner.trim() || owner.length > 512) {
        throw new Error('Background process ownership context is required');
    }
    try {
        const root = await realpath(resolve(workspace));
        return { workspace: workspaceAlias(root), conversation: owner };
    }
    catch (error) {
        if (!allowMissing || error.code !== 'ENOENT')
            throw error;
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
const ownsProcess = (proc, scope) => proc.owner.conversation === scope.conversation && (scope.deletedAlias !== undefined
    ? workspaceAlias(proc.cwd) === scope.deletedAlias : proc.owner.workspace === scope.workspace);
function ownedProcess(id, owner) {
    const proc = backgroundProcesses.get(id);
    if (!proc || !ownsProcess(proc, owner))
        throw new Error(`Background process '${id}' not found`);
    return proc;
}
const POWERSHELL_SYNTAX_REGEX = /(?:\b(?:Get-|Set-|New-|Remove-|Invoke-|Select-|Where-|ForEach-|Out-|Test-Path|Start-Process|Stop-|Restart-|Start-|Copy-|Move-|Rename-|Clear-|Write-|Read-|Measure-|Compare-|ConvertTo-|ConvertFrom-|Resolve-|Split-|Join-)\w*|\$env:|\$PSVersionTable|\$ErrorActionPreference|\[System\.|\[Math\]::|\[Console\]::)/i;
/** Avoid implicitly giving model-launched programs provider and bridge secrets.
 * This is defense in depth; commands still run with the user's OS permissions. */
export function shellEnvironment(source = process.env) {
    const env = childEnvironment({}, source);
    if (process.platform !== 'win32')
        return env;
    // cmd.exe resolves `timeout`, `where`, `find`, `sort` and friends relative to
    // PATH. Git/MSYS ships same-named POSIX tools; putting System32 first keeps
    // Windows built-ins authoritative while preserving the rest of the PATH.
    const root = source.SystemRoot || source.SYSTEMROOT || env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows';
    if (!/^(?:[a-z]:[\\/]|\\\\)/i.test(root))
        throw new Error('Windows SystemRoot must be an absolute path.');
    const system32 = join(root, 'System32');
    const system32Key = system32.replace(/[\\/]+$/u, '').toLowerCase();
    const pathName = Object.keys(env).find(name => name.toUpperCase() === 'PATH') ?? 'PATH';
    const seen = new Set();
    const entries = [];
    for (const raw of (env[pathName] ?? '').split(';')) {
        const value = raw.trim();
        if (!value)
            continue;
        const key = value.replace(/[\\/]+$/u, '').toLowerCase();
        if (key === system32Key || seen.has(key))
            continue;
        seen.add(key);
        entries.push(value);
    }
    env[pathName] = [system32, ...entries].join(';');
    return env;
}
/** Resolve an absolute cmd.exe. Never search the untrusted launch directory or PATH. */
function resolveCommandInterpreter(env) {
    const comspec = env.ComSpec || env.COMSPEC;
    if (typeof comspec === 'string' && /^(?:[a-z]:[\\/]|\\\\)/i.test(comspec))
        return comspec;
    const root = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows';
    if (!/^(?:[a-z]:[\\/]|\\\\)/i.test(root))
        throw new Error('Windows SystemRoot must be an absolute path.');
    return join(root, 'System32', 'cmd.exe');
}
function spawnCommand(command, options) {
    // Approval prompts answer "may this run?". The optional sandbox adapter adds
    // an OS boundary on platforms where one is actually available. TBOT_SANDBOX=
    // required fails closed instead of silently falling back to an unsandboxed run.
    assertShellAllowed();
    const isWin = process.platform === 'win32';
    const isPowerShell = isWin && POWERSHELL_SYNTAX_REGEX.test(command);
    const env = shellEnvironment();
    if (!isWin) {
        const wrapped = sandboxWrap(command, options.cwd);
        if (wrapped) {
            return spawn(wrapped.file, wrapped.args, {
                cwd: options.cwd,
                shell: false,
                windowsHide: options.windowsHide ?? true,
                detached: options.detached,
                stdio: options.stdio,
                env,
            });
        }
    }
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
    if (isWin) {
        // Run through an absolute cmd.exe with /d /s /c and
        // NoDefaultCurrentDirectoryInExePath=1 so git.cmd/npm.cmd/*.exe planted in
        // the workspace cwd are never resolved.
        return spawn(resolveCommandInterpreter(env), ['/d', '/s', '/c', command], {
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
/** Terminate a background process tree. Returns true only when the kill succeeded. */
async function killProcessTree(proc) {
    if (!proc.pid)
        return false;
    if (process.platform === 'win32') {
        const killer = spawn(windowsSystemExecutable('taskkill'), ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        return await new Promise(resolvePromise => {
            const timeout = setTimeout(() => { try {
                killer.kill();
            }
            catch { /* ignore */ } resolvePromise(false); }, 5000);
            killer.on('error', () => { clearTimeout(timeout); resolvePromise(false); });
            killer.on('close', code => { clearTimeout(timeout); resolvePromise(code === 0); });
        });
    }
    try {
        process.kill(-proc.pid, 'SIGKILL');
        return true;
    }
    catch {
        try {
            return proc.child.kill('SIGKILL');
        }
        catch {
            return false;
        }
    }
}
export function stopAllBackgroundProcesses() {
    for (const proc of backgroundProcesses.values()) {
        if (proc.status === 'running' && proc.pid) {
            proc.status = 'stopped';
            try {
                if (process.platform === 'win32') {
                    spawn(windowsSystemExecutable('taskkill'), ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
                }
                else {
                    try {
                        process.kill(-proc.pid, 'SIGKILL');
                    }
                    catch {
                        proc.child.kill('SIGKILL');
                    }
                }
            }
            catch {
                /* ignore */
            }
        }
    }
}
export function pruneCompletedProcesses() {
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
function enforceProcessLimit() {
    if (backgroundProcesses.size > MAX_TOTAL_PROCESSES) {
        const completed = Array.from(backgroundProcesses.entries())
            .filter(([_, p]) => p.status !== 'running')
            .sort((a, b) => a[1].startTime - b[1].startTime);
        for (const [id, proc] of completed) {
            proc.output = '';
            backgroundProcesses.delete(id);
            if (backgroundProcesses.size <= MAX_TOTAL_PROCESSES)
                break;
        }
    }
}
function tailLinesFromBuffer(text, maxLines) {
    if (!text || maxLines <= 0)
        return '';
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
export const shellToolDefinitions = [
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
export const SHELL_TOOLS = shellToolDefinitions;
export const executeShellTool = handleShellTool;
export async function handleShellTool(toolNameOrArgs, argsOrWorkspace, workspaceOrSignal, maybeSignal, processOwner) {
    let name = 'shell';
    let args = {};
    let workspace = '.';
    let signal;
    if (typeof toolNameOrArgs === 'string') {
        name = toolNameOrArgs;
        args = (argsOrWorkspace && typeof argsOrWorkspace === 'object') ? argsOrWorkspace : {};
        workspace = typeof workspaceOrSignal === 'string' ? workspaceOrSignal : '.';
        signal = maybeSignal;
    }
    else {
        args = toolNameOrArgs || {};
        if (typeof args.tool === 'string')
            name = args.tool;
        else if (typeof args.action === 'string')
            name = args.action;
        else if (typeof args.process_id === 'string' && !args.command)
            name = 'process_output';
        workspace = typeof argsOrWorkspace === 'string' ? argsOrWorkspace : '.';
        signal = workspaceOrSignal instanceof AbortSignal ? workspaceOrSignal : undefined;
    }
    signal?.throwIfAborted();
    const owner = name.startsWith('process_') || args.background === true
        ? await processScope(workspace, processOwner, name.startsWith('process_')) : undefined;
    signal?.throwIfAborted();
    if (name === 'process_list') {
        const list = Array.from(backgroundProcesses.values()).filter(p => ownsProcess(p, owner)).map(p => ({
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
        if (!processId)
            throw new Error('process_id must be a non-empty string');
        const proc = ownedProcess(processId, owner);
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
        if (!processId)
            throw new Error('process_id must be a non-empty string');
        const proc = ownedProcess(processId, owner);
        if (proc.status === 'running' && proc.pid) {
            proc.child.stdout?.destroy();
            proc.child.stderr?.destroy();
            // Only report "stopped" when the tree was actually terminated.
            if (await killProcessTree(proc)) {
                proc.status = 'stopped';
            }
        }
        enforceProcessLimit();
        const stopped = proc.status === 'stopped';
        return JSON.stringify({
            processId: proc.processId,
            status: proc.status,
            message: stopped ? `Process ${processId} stopped.` : `Process ${processId} could not be terminated and is still ${proc.status}.`,
        }, null, 2);
    }
    if (name === 'process_write') {
        const rawId = args.process_id ?? args.id;
        if (rawId === undefined || rawId === null || String(rawId).trim() === '') {
            throw new Error('process_id (veya id) parametresi belirtilmelidir.');
        }
        const procKey = String(rawId).trim();
        const proc = ownedProcess(procKey, owner);
        if (proc.status !== 'running' || !proc.child.stdin || proc.child.stdin.destroyed) {
            throw new Error(`Süreç '${procKey}' çalışır durumda değil veya stdin kapalı (Durum: ${proc.status}).`);
        }
        const input = typeof args.input === 'string' ? args.input : String(args.input ?? '');
        const appendNewline = args.append_newline !== false;
        const toWrite = appendNewline ? (input.endsWith('\n') ? input : `${input}\n`) : input;
        await new Promise((resolve, reject) => {
            proc.child.stdin.write(toWrite, 'utf8', (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
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
    if (typeof args.command !== 'string' || !args.command.trim())
        throw new Error('command must be a non-empty string');
    // Background execution mode
    if (args.background === true) {
        // A new owner must never evict another owner's running child to obtain a slot.
        if (Array.from(backgroundProcesses.values()).filter(p => p.status === 'running').length >= MAX_RUNNING_PROCESSES) {
            throw new Error('Background process capacity reached; stop an owned process before starting another');
        }
        const processId = 'proc_' + randomUUID();
        const child = spawnCommand(args.command, {
            cwd: resolve(workspace),
            windowsHide: true,
            detached: process.platform !== 'win32',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const managed = {
            processId,
            pid: child.pid,
            command: args.command,
            cwd: resolve(workspace),
            owner: owner,
            startTime: Date.now(),
            status: 'running',
            exitCode: null,
            output: '',
            child,
            stdin: child.stdin,
        };
        backgroundProcesses.set(processId, managed);
        enforceProcessLimit();
        const append = (data) => {
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
        await new Promise(resolve => {
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
        // Detached on Windows gives the hidden child its own console. Native
        // `timeout.exe` (and other console-aware built-ins) refuse redirected stdin,
        // so without this they fail even when System32 is first on PATH.
        const child = spawnCommand(args.command, { cwd: workspace, windowsHide: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        let truncated = false;
        let settled = false;
        let stopping = false;
        const add = (data) => { const chunk = data.toString('utf8'); if (output.length < 100000)
            output += chunk.slice(0, 100000 - output.length); if (output.length >= 100000)
            truncated = true; };
        const finish = (status, code) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            const marker = code === null ? 'signal' : String(code);
            // The marker precedes the status line so legacy `$`-anchored readers
            // (desktop renderer) still see "Exit code: N" last.
            resolve(`${output}${truncated ? '\n[output truncated]' : ''}\n[${SHELL_EXIT_MARKER}: ${marker}]\n${status}`);
        };
        const stop = (why) => {
            if (stopping || settled)
                return;
            stopping = true;
            child.stdout?.destroy();
            child.stderr?.destroy();
            const done = () => finish(`${why}; process tree termination attempted (detached descendants may continue)`, null);
            if (process.platform === 'win32' && child.pid) {
                const killer = spawn(windowsSystemExecutable('taskkill'), ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
                const limit = setTimeout(() => { killer.kill(); child.kill(); done(); }, 3000);
                killer.on('error', () => { clearTimeout(limit); child.kill(); done(); });
                killer.on('close', () => { clearTimeout(limit); done(); });
            }
            else {
                try {
                    if (child.pid)
                        process.kill(-child.pid, 'SIGKILL');
                    else
                        child.kill();
                }
                catch {
                    child.kill();
                }
                done();
            }
        };
        const timer = setTimeout(() => stop('Timed out'), timeout);
        const abort = () => stop('Aborted');
        signal?.addEventListener('abort', abort, { once: true });
        child.stdout?.on('data', add);
        child.stderr?.on('data', add);
        child.on('error', error => { if (!settled) {
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            reject(error);
        } });
        child.on('close', (code, killedBy) => { if (!stopping)
            finish(`Exit code: ${code ?? `signal ${killedBy}`}`, code); });
    });
}
//# sourceMappingURL=shell.js.map