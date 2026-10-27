import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { ToolDefinition } from '../types.js';

export const computerToolDefinitions: ToolDefinition[] = [{
  name: 'computer',
  description: 'Control the local Windows desktop. List windows and obtain handles before focusing or interacting. Coordinates are absolute physical desktop pixels; screenshot returns a local PNG path, not image content.',
  parameters: {
    type: 'object', additionalProperties: false, required: ['action'],
    properties: {
      action: { type: 'string', enum: ['windows', 'screenshot', 'focus', 'click', 'type', 'key', 'scroll'] },
      handle: { type: 'string', description: 'Decimal handle from windows; required for focus and input.' },
      x: { type: 'integer', description: 'Absolute desktop x coordinate.' },
      y: { type: 'integer', description: 'Absolute desktop y coordinate.' },
      button: { type: 'string', enum: ['left', 'right'] },
      text: { type: 'string', description: 'Text to type into the foreground window.' },
      key: { type: 'string', enum: ['ENTER', 'TAB', 'ESC', 'BACKSPACE', 'DELETE', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'HOME', 'END', 'PAGEUP', 'PAGEDOWN'] },
      delta: { type: 'integer', description: 'Mouse wheel delta, typically 120 or -120.' }
    }
  }
}];

export async function handleComputerTool(name: string, args: Record<string, unknown>, context: { workspace: string; signal?: AbortSignal }): Promise<string> {
  if (name !== 'computer') throw new Error(`Unknown computer tool: ${name}`);
  if (process.platform !== 'win32') throw new Error('Computer control is supported only on Windows with an interactive desktop.');
  const action = args.action;
  if (typeof action !== 'string' || !['windows', 'screenshot', 'focus', 'click', 'type', 'key', 'scroll'].includes(action)) throw new Error('Invalid computer action.');
  const permitted = new Set(['action', 'handle', 'x', 'y', 'button', 'text', 'key', 'delta']);
  if (Object.keys(args).some(k => !permitted.has(k))) throw new Error('Unexpected computer argument.');
  if (!['windows', 'screenshot'].includes(action) && (typeof args.handle !== 'string' || !/^[1-9]\d{0,18}$/.test(args.handle))) throw new Error('A decimal window handle is required.');
  if (action === 'click' || action === 'scroll') {
    if (!Number.isSafeInteger(args.x) || !Number.isSafeInteger(args.y) || Math.abs(args.x as number) > 100000 || Math.abs(args.y as number) > 100000) throw new Error('Valid integer desktop coordinates are required.');
  }
  if (action === 'click' && args.button !== undefined && args.button !== 'left' && args.button !== 'right') throw new Error('Invalid mouse button.');
  if (action === 'scroll' && (!Number.isInteger(args.delta) || Math.abs(args.delta as number) > 1200 || args.delta === 0)) throw new Error('Scroll delta must be a nonzero integer between -1200 and 1200.');
  if (action === 'type' && (typeof args.text !== 'string' || args.text.length > 4000 || /[\r\n\x00-\x1f]/.test(args.text))) throw new Error('Text must be a single line of at most 4000 characters.');
  if (action === 'key' && (typeof args.key !== 'string' || !['ENTER', 'TAB', 'ESC', 'BACKSPACE', 'DELETE', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'HOME', 'END', 'PAGEUP', 'PAGEDOWN'].includes(args.key))) throw new Error('Unsupported key.');
  let request = args;
  if (action === 'screenshot') {
    const directory = join(context.workspace, '.tbot', 'screenshots');
    await mkdir(directory, { recursive: true });
    request = { ...args, screenshotPath: join(directory, `screenshot-${randomUUID()}.png`) };
  }
  const script = fileURLToPath(new URL('../../scripts/computer.ps1', import.meta.url));
  return await new Promise<string>((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-File', script], { windowsHide: true, signal: context.signal, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(`Computer action failed: ${stderr.trim() || `exit ${code}`}`)));
    child.stdin.end(JSON.stringify(request));
  });
}

