import { spawn } from 'node:child_process';
import type { ToolDefinition } from '../types.js';

export const shellToolDefinitions: ToolDefinition[] = [{ name: 'shell', description: 'Run a shell command from the workspace. Commands have the user’s full permissions and can access or modify files outside the workspace. Requires approval.', parameters: { type: 'object', properties: { command: { type: 'string' }, timeout_ms: { type: 'integer', minimum: 1000, maximum: 120000 } }, required: ['command'], additionalProperties: false } }];
export async function handleShellTool(args: Record<string, unknown>, workspace: string, signal?: AbortSignal): Promise<string> {
  if (typeof args.command !== 'string' || !args.command.trim()) throw new Error('command must be a non-empty string');
  signal?.throwIfAborted();
  const timeout = typeof args.timeout_ms === 'number' && Number.isFinite(args.timeout_ms) ? Math.min(120000, Math.max(1000, args.timeout_ms)) : 30000;
  return new Promise((resolve, reject) => {
    const child = spawn(args.command as string, { cwd: workspace, shell: true, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let truncated = false; let settled = false; let stopping = false;
    const add = (data: Buffer) => { const chunk = data.toString('utf8'); if (output.length < 100000) output += chunk.slice(0, 100000 - output.length); if (output.length >= 100000) truncated = true; };
    const finish = (status: string) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(`${output}${truncated ? '\n[output truncated]' : ''}\n${status}`); };
    const stop = (why: string) => {
      if (stopping || settled) return;
      stopping = true;
      child.stdout.destroy(); child.stderr.destroy();
      const done = () => finish(`${why}; process tree termination attempted (detached descendants may continue)`);
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
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
    child.stdout.on('data', add); child.stderr.on('data', add);
    child.on('error', error => { if (!settled) { settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error); } });
    child.on('close', (code, killedBy) => { if (!stopping) finish(`Exit code: ${code ?? `signal ${killedBy}`}`); });
  });
}
