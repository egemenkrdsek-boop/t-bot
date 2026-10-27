import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const backgroundProcesses = new Map();
export function stopAllBackgroundProcesses() {
    for (const proc of backgroundProcesses.values()) {
        if (proc.status === 'running' && proc.pid) {
            proc.status = 'stopped';
            try {
                if (process.platform === 'win32') {
                    spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
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
function enforceProcessLimit() {
    if (backgroundProcesses.size > 20) {
        const completed = Array.from(backgroundProcesses.entries())
            .filter(([_, p]) => p.status !== 'running')
            .sort((a, b) => a[1].startTime - b[1].startTime);
        for (const [id, proc] of completed) {
            proc.output = '';
            backgroundProcesses.delete(id);
            if (backgroundProcesses.size <= 20)
                break;
        }
    }
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
        description: 'List all running and recent background processes managed by T Bot.',
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
];
export async function handleShellTool(toolNameOrArgs, argsOrWorkspace, workspaceOrSignal, maybeSignal) {
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
    if (name === 'process_list') {
        const list = Array.from(backgroundProcesses.values()).map(p => ({
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
        const proc = backgroundProcesses.get(processId);
        if (!proc)
            throw new Error(`Background process '${processId}' not found`);
        let output = proc.output;
        if (typeof args.tail_lines === 'number' && args.tail_lines > 0) {
            const lines = output.split(/\r?\n/);
            output = lines.slice(-args.tail_lines).join('\n');
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
        const proc = backgroundProcesses.get(processId);
        if (!proc)
            throw new Error(`Background process '${processId}' not found`);
        if (proc.status === 'running' && proc.pid) {
            proc.status = 'stopped';
            proc.child.stdout?.destroy();
            proc.child.stderr?.destroy();
            if (process.platform === 'win32') {
                const killer = spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
                await new Promise(resolve => {
                    const timeout = setTimeout(resolve, 2000);
                    killer.on('close', () => { clearTimeout(timeout); resolve(); });
                    killer.on('error', () => { clearTimeout(timeout); resolve(); });
                });
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
        enforceProcessLimit();
        return JSON.stringify({ processId: proc.processId, status: proc.status, message: `Process ${processId} stopped.` }, null, 2);
    }
    // Handle standard 'shell' command
    if (typeof args.command !== 'string' || !args.command.trim())
        throw new Error('command must be a non-empty string');
    // Background execution mode
    if (args.background === true) {
        const processId = 'proc_' + randomUUID().slice(0, 8);
        const child = spawn(args.command, {
            cwd: workspace,
            shell: true,
            windowsHide: true,
            detached: process.platform !== 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const managed = {
            processId,
            pid: child.pid,
            command: args.command,
            cwd: workspace,
            startTime: Date.now(),
            status: 'running',
            exitCode: null,
            output: '',
            child,
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
        const child = spawn(args.command, { cwd: workspace, shell: true, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        let truncated = false;
        let settled = false;
        let stopping = false;
        const add = (data) => { const chunk = data.toString('utf8'); if (output.length < 100000)
            output += chunk.slice(0, 100000 - output.length); if (output.length >= 100000)
            truncated = true; };
        const finish = (status) => { if (settled)
            return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(`${output}${truncated ? '\n[output truncated]' : ''}\n${status}`); };
        const stop = (why) => {
            if (stopping || settled)
                return;
            stopping = true;
            child.stdout?.destroy();
            child.stderr?.destroy();
            const done = () => finish(`${why}; process tree termination attempted (detached descendants may continue)`);
            if (process.platform === 'win32' && child.pid) {
                const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
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
            finish(`Exit code: ${code ?? `signal ${killedBy}`}`); });
    });
}
//# sourceMappingURL=shell.js.map