import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { ToolDefinition } from '../types.js';
import { executeDesktopRequest } from './desktop-request.js';
import { windowsSystemExecutable } from '../windows-system.js';
import { GUI_WARM_IDLE_MS, guiObservation, MAX_BATCH_STEPS, validateBatchSteps } from './gui-policy.js';
import { createScreenshotPath } from './screenshot-store.js';

export const computerToolDefinitions: ToolDefinition[] = [{
  name: 'computer',
  description: 'Control the local desktop GUI. Windows get stable session ids (w1, w2) that can be used as "handle" in later calls; a title or process-name substring also works. With no handle, the active/foreground window is used. Returns compact window state; screenshots and UIA trees require an explicit observation.',
  parameters: {
    type: 'object',
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: ['windows', 'inspect', 'screenshot', 'focus', 'click', 'click_text', 'type', 'key', 'scroll', 'move', 'drag', 'open', 'wait', 'wait_for_window'],
        description: 'Action to perform. windows lists session window ids; click_text clicks a visible UI label; wait_for_window waits for a new window.'
      },
      handle: {
        type: 'string',
        description: 'Session window id from windows (e.g. "w1"), a decimal/hex HWND, or a window title/process substring (e.g. "Notepad", "chrome"). Optional: the active window is used when omitted.'
      },
      target: {
        type: 'string',
        description: 'UI element ID (e.g. u1), button/text label (e.g. Save, Search), or window title. Prefer target over coordinates.'
      },
      title: {
        type: 'string',
        description: 'For wait_for_window: window title substring to wait for.'
      },
      process: {
        type: 'string',
        description: 'For wait_for_window: process name substring to wait for (e.g. "notepad").'
      },
      timeout_ms: {
        type: 'integer',
        minimum: 500,
        maximum: 30000,
        description: 'For wait_for_window: maximum wait in milliseconds; defaults to 10000.'
      },
      auto_screenshot: {
        type: 'boolean',
        description: 'Deprecated compatibility alias: true requests a visual screenshot after the action. Default is lightweight window state.'
      },
      observe: {
        type: 'string',
        enum: ['none', 'state', 'visual'],
        description: 'Post-action observation: state (default) returns window state; visual adds a screenshot; none returns the action result only.'
      },
      press_enter: {
        type: 'boolean',
        description: 'Press Enter after typing (send a message or submit a search).'
      },
      x: { type: 'integer', description: 'Absolute desktop x coordinate.' },
      y: { type: 'integer', description: 'Absolute desktop y coordinate.' },
      to_x: { type: 'integer', description: 'Destination desktop x coordinate for drag actions.' },
      to_y: { type: 'integer', description: 'Destination desktop y coordinate for drag actions.' },
      button: {
        type: 'string',
        enum: ['left', 'right', 'double', 'middle'],
        description: 'Mouse button to click (left, right, double, middle).'
      },
      text: { type: 'string', description: 'Text to type into the focused field, or the visible label for click_text.' },
      key: {
        type: 'string',
        description: 'Key or key combination to press (e.g. ENTER, ESC, TAB, CTRL+C, CTRL+V, ALT+F4, WIN+R).'
      },
      delta: { type: 'integer', description: 'Mouse wheel delta, typically 120 (up) or -120 (down).' }
    }
  }
}, {
  name: 'computer_batch',
  description: 'Run up to 12 desktop steps (focus, click, click_text, type, key, scroll, wait, move) under one approval, then return one final observation. Stops at the first failed step.',
  parameters: {
    type: 'object',
    required: ['steps'],
    properties: {
      observe: {
        type: 'string',
        enum: ['none', 'state', 'visual'],
        description: 'Final observation: state (default) returns window state; visual adds a screenshot; none returns step results only.'
      },
      steps: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_BATCH_STEPS,
        description: 'Ordered desktop actions. Each needs an action; use target/text/key as appropriate.',
        items: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['focus', 'click', 'click_text', 'type', 'key', 'scroll', 'wait', 'move'] },
            target: { type: 'string' },
            handle: { type: 'string' },
            text: { type: 'string' },
            key: { type: 'string' },
            x: { type: 'integer' },
            y: { type: 'integer' },
            delta: { type: 'integer' },
            press_enter: { type: 'boolean' },
            ms: { type: 'integer', minimum: 50, maximum: 5000 },
          },
          required: ['action'],
          additionalProperties: false,
        },
      },
    }
  }
}];

// --- Windows Persistent Daemon Architecture ---
interface PendingRequest {
  resolve: (value: string) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

let desktopDaemon: ChildProcess | null = null;
let daemonLaunching: Promise<ChildProcess> | null = null;
const pendingRequests = new Map<string, PendingRequest>();
let lineBuffer = '';
let desktopIdleTimer: NodeJS.Timeout | null = null;
const DESKTOP_IDLE_TIMEOUT_MS = GUI_WARM_IDLE_MS;
let lastDesktopActivityAt = 0;

export function resetDesktopIdleTimer(): void {
  lastDesktopActivityAt = Date.now();
  if (desktopIdleTimer) {
    clearTimeout(desktopIdleTimer);
    desktopIdleTimer = null;
  }
  if (desktopDaemon || daemonLaunching) {
    desktopIdleTimer = setTimeout(() => {
      if (pendingRequests.size === 0) {
        void closeIdleDesktopDaemon().catch(() => {});
      }
    }, DESKTOP_IDLE_TIMEOUT_MS);
    desktopIdleTimer.unref();
  }
}

/**
 * Shuts down the idle desktop daemon process to reclaim system RAM.
 * Can be invoked by memory-guard or during idle timeouts.
 */
export async function closeIdleDesktopDaemon(): Promise<void> {
  if (desktopIdleTimer) {
    clearTimeout(desktopIdleTimer);
    desktopIdleTimer = null;
  }
  if (daemonLaunching) {
    try { await daemonLaunching; } catch {}
  }
  const proc = desktopDaemon;
  desktopDaemon = null;
  if (proc) {
    try {
      proc.stdin?.end();
      proc.kill();
    } catch {}
  }
  for (const [id, req] of pendingRequests) {
    clearTimeout(req.timer);
    req.reject(new Error('Desktop daemon closed.'));
  }
  pendingRequests.clear();
  lineBuffer = '';
}

/** Native PowerShell cannot read Electron's virtual ASAR filesystem. */
export function resolveComputerScriptPath(defaultPath: string, resPath: string, cwd: string, exists: (path: string) => boolean = existsSync): string {
  const packaged = /\.asar[\\/]/i.test(defaultPath);
  const candidates: string[] = [
    ...(packaged ? [defaultPath.replace(/\.asar([\\/])/i, '.asar.unpacked$1')] : [defaultPath]),
    ...(resPath ? [join(resPath, 'app.asar.unpacked', 'scripts', 'computer.ps1'),
      join(resPath, 'app', 'scripts', 'computer.ps1'), join(resPath, 'scripts', 'computer.ps1')] : []),
    ...(!packaged ? [join(cwd, 'scripts', 'computer.ps1')] : []),
  ];
  for (const candidate of candidates) {
    if (candidate && exists(candidate)) {
      return candidate;
    }
  }
  throw new Error('Desktop PowerShell script is unavailable outside the application archive. Reinstall T Bot.');
}

export function getScriptPath(): string {
  return resolveComputerScriptPath(fileURLToPath(new URL('../../scripts/computer.ps1', import.meta.url)),
    (process as any).resourcesPath || '', process.cwd());
}

async function getDesktopDaemon(): Promise<ChildProcess> {
  if (desktopDaemon && !desktopDaemon.killed) return desktopDaemon;
  if (daemonLaunching) return daemonLaunching;

  daemonLaunching = (async () => {
    const script = getScriptPath();
    const child = spawn(
      windowsSystemExecutable('powershell'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', script, '-Action', 'daemon'],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      lineBuffer += chunk;
      let newlineIdx: number;
      while ((newlineIdx = lineBuffer.indexOf('\n')) !== -1) {
        const line = lineBuffer.slice(0, newlineIdx).trim();
        lineBuffer = lineBuffer.slice(newlineIdx + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          const req = pendingRequests.get(parsed.id);
          if (req) {
            clearTimeout(req.timer);
            pendingRequests.delete(parsed.id);
            if (parsed.ok) {
              req.resolve(JSON.stringify(parsed.data !== undefined ? parsed.data : parsed));
            } else {
              // Daemon süreci sağlamdır; uygulama/işlem uyarısı döndürüldü
              req.resolve(JSON.stringify({
                ok: false,
                warning: parsed.error || parsed.warning || 'Desktop action reported a warning.',
                ...(parsed.data && typeof parsed.data === 'object' ? parsed.data : {}),
                ...parsed
              }));
            }
          }
        } catch {
          // ignore malformed buffer lines
        }
      }
    });

    child.stderr.on('data', () => {
      // PowerShell warnings/debug output ignored
    });

    child.on('close', () => {
      desktopDaemon = null;
      for (const [id, req] of pendingRequests) {
        clearTimeout(req.timer);
        req.reject(new Error('Desktop daemon process closed unexpectedly.'));
      }
      pendingRequests.clear();
      lineBuffer = '';
    });

    child.on('error', (err) => {
      desktopDaemon = null;
      for (const [id, req] of pendingRequests) {
        clearTimeout(req.timer);
        req.reject(err);
      }
      pendingRequests.clear();
    });

    desktopDaemon = child;
    resetDesktopIdleTimer();
    return child;
  })();

  try {
    return await daemonLaunching;
  } finally {
    daemonLaunching = null;
  }
}

async function sendDaemonRequest(payload: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const daemon = await getDesktopDaemon();
  signal?.throwIfAborted();
  const id = randomUUID();
  const reqPayload = { ...payload, id };

  return new Promise<string>((resolve, reject) => {
    let abortListener: (() => void) | undefined;
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      if (abortListener && signal) signal.removeEventListener('abort', abortListener);
      reject(new Error('Desktop action timed out (15s).'));
    }, 15_000);

    if (signal) {
      abortListener = () => {
        clearTimeout(timer);
        pendingRequests.delete(id);
        reject(new Error('Operation cancelled'));
      };
      signal.addEventListener('abort', abortListener, { once: true });
    }

    pendingRequests.set(id, {
      resolve: (val) => {
        if (abortListener && signal) signal.removeEventListener('abort', abortListener);
        resolve(val);
      },
      reject: (err) => {
        if (abortListener && signal) signal.removeEventListener('abort', abortListener);
        reject(err);
      },
      timer
    });

    try {
      if (!daemon.stdin) throw new Error('Desktop daemon stdin unavailable');
      daemon.stdin.write(JSON.stringify(reqPayload) + '\n');
    } catch (err) {
      clearTimeout(timer);
      pendingRequests.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
    resetDesktopIdleTimer();
  });
}

async function runStandalonePs(request: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const script = getScriptPath();
  const TIMEOUT_MS = 15_000;
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const child = spawn(windowsSystemExecutable('powershell'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', script], {
      windowsHide: true,
      signal,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      reject(new Error('Desktop action timed out (15s).'));
    }, TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const out = stdout.trim();
      if (out) {
        try {
          const parsed = JSON.parse(out);
          if (parsed && typeof parsed === 'object') {
            resolve(parsed.ok === true && parsed.data !== undefined ? JSON.stringify(parsed.data) : out);
            return;
          }
        } catch {}
      }
      if (code === 0) {
        reject(new Error('Desktop process returned no valid result.'));
      } else {
        const errDetail = stderr.trim() || out || `exit code ${code}`;
        resolve(JSON.stringify({
          ok: false,
          warning: `Computer action failed (${code}): ${errDetail}`
        }));
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

// --- macOS & Linux Fallback Implementations ---
async function handleUnixComputer(args: Record<string, unknown>, context: { workspace: string; signal?: AbortSignal }): Promise<string> {
  const action = args.action as string;
  const platform = process.platform;

  if (action === 'screenshot') {
    const screenshotPath = await createScreenshotPath(context.workspace, 'desktop');

    if (platform === 'darwin') {
      await execUnix('screencapture', ['-x', screenshotPath], context.signal);
    } else {
      try {
        await execUnix('gnome-screenshot', ['-f', screenshotPath], context.signal);
      } catch {
        try {
          await execUnix('import', ['-window', 'root', screenshotPath], context.signal);
        } catch {
          await execUnix('scrot', [screenshotPath], context.signal);
        }
      }
    }
    return JSON.stringify({ path: screenshotPath, note: `Captured desktop screenshot on ${platform}` });
  }

  if (action === 'wait') {
    const ms = Math.min(Math.max(100, Number(args.duration ?? args.ms ?? 1000) || 1000), 10000);
    await new Promise(r => setTimeout(r, ms));
    return JSON.stringify({ attempted: true, action: 'wait', duration: ms });
  }

  if (platform === 'darwin') {
    if (action === 'windows') {
      const script = `
        tell application "System Events"
          set appList to every process whose backgroundOnly is false
          set winList to {}
          repeat with p in appList
            set pName to name of p
            try
              repeat with w in (windows of p)
                set end of winList to (pName & ": " & name of w)
              end repeat
            end try
          end repeat
          return winList
        end tell
      `;
      const out = await execUnix('osascript', ['-e', script], context.signal);
      return JSON.stringify({ windows: out.split(', ').map((w, idx) => ({ handle: String(idx + 1), title: w.trim() })) });
    }
    if (action === 'type') {
      const text = String(args.text || '').replace(/[\\"]/g, '\\$&');
      await execUnix('osascript', ['-e', `tell application "System Events" to keystroke "${text}"`], context.signal);
      return JSON.stringify({ attempted: true, action: 'type' });
    }
    if (action === 'key') {
      const key = String(args.key || 'ENTER').toUpperCase();
      const keyMap: Record<string, number> = { ENTER: 36, TAB: 48, ESC: 53, BACKSPACE: 51, DELETE: 117, UP: 126, DOWN: 125, LEFT: 123, RIGHT: 124 };
      const code = keyMap[key] ?? 36;
      await execUnix('osascript', ['-e', `tell application "System Events" to key code ${code}`], context.signal);
      return JSON.stringify({ attempted: true, action: 'key' });
    }
    if (action === 'open') {
      const target = String(args.target || args.text || '');
      await execUnix('open', [target], context.signal);
      return JSON.stringify({ attempted: true, action: 'open', target });
    }
  }

  if (platform === 'linux') {
    if (action === 'windows') {
      const out = await execUnix('wmctrl', ['-l'], context.signal);
      const lines = out.split('\n').filter(Boolean);
      const wins = lines.map(line => {
        const parts = line.split(/\s+/);
        return { handle: parts[0], title: parts.slice(3).join(' ') };
      });
      return JSON.stringify({ windows: wins });
    }
    if (action === 'focus' && typeof args.handle === 'string') {
      await execUnix('wmctrl', ['-i', '-a', args.handle], context.signal);
      return JSON.stringify({ attempted: true, action: 'focus' });
    }
    if (action === 'click' && typeof args.x === 'number' && typeof args.y === 'number') {
      const btnMap: Record<string, string> = { left: '1', middle: '2', right: '3', double: '1 --repeat 2' };
      const btn = btnMap[(args.button as string) || 'left'] || '1';
      await execUnix('xdotool', ['mousemove', String(args.x), String(args.y), 'click', btn], context.signal);
      return JSON.stringify({ attempted: true, action: 'click' });
    }
    if (action === 'type') {
      await execUnix('xdotool', ['type', '--', String(args.text)], context.signal);
      return JSON.stringify({ attempted: true, action: 'type' });
    }
    if (action === 'key') {
      const k = String(args.key).toLowerCase();
      await execUnix('xdotool', ['key', k === 'esc' ? 'Escape' : k === 'enter' ? 'Return' : args.key as string], context.signal);
      return JSON.stringify({ attempted: true, action: 'key' });
    }
    if (action === 'open') {
      const target = String(args.target || args.text || '');
      await execUnix('xdg-open', [target], context.signal);
      return JSON.stringify({ attempted: true, action: 'open', target });
    }
  }

  if (action === 'inspect') {
    return JSON.stringify({
      elements: [],
      note: `Semantic UI Automation inspection is native to Windows. On ${platform}, window enumeration is available via windows action.`
    });
  }

  return JSON.stringify({ attempted: true, action, note: `Simulated action on ${platform}` });
}

function execUnix(cmd: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(cmd, args, { signal, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', c => { stdout += c; });
    child.stderr.on('data', c => { stderr += c; });
    child.on('error', reject);
    child.on('close', code => {
      code === 0 ? resolve(stdout.trim()) : reject(new Error(`${cmd} failed (${code}): ${stderr.trim()}`));
    });
  });
}

function isKillSwitchError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('KULLANICI ACİL DURDURMA') ||
    msg.includes('KILL-SWITCH') ||
    msg.includes('ACİL DURDURMA')
  );
}

export const MAX_INSPECT_ELEMENTS = 80;

export interface SessionWindow {
  id: string;
  handle: string;
  title: string;
  process: string;
}

// Stable session window ids: a handle keeps its id while it stays open, so the
// model can say handle: "w1" instead of inventing decimal HWNDs.
const sessionWindows = new Map<string, SessionWindow>();
let nextWindowNumber = 1;
let lastForegroundHandle: string | undefined;

function ingestWindows(rawWindows: unknown): SessionWindow[] {
  const previousByHandle = new Map<string, string>();
  for (const [id, win] of sessionWindows) previousByHandle.set(win.handle, id);
  const next = new Map<string, SessionWindow>();
  if (Array.isArray(rawWindows)) {
    for (const raw of rawWindows) {
      if (!raw || typeof raw !== 'object') continue;
      const record = raw as Record<string, unknown>;
      const handle = String(record.handle ?? record.hwnd ?? '').trim();
      if (!/^\d+$/.test(handle)) continue;
      const title = String(record.title ?? '').trim();
      const processName = String(record.process ?? record.processName ?? '').trim();
      const id = previousByHandle.get(handle) ?? `w${nextWindowNumber++}`;
      next.set(id, { id, handle, title, process: processName });
    }
  }
  sessionWindows.clear();
  for (const [id, win] of next) sessionWindows.set(id, win);
  return [...next.values()];
}

function rememberWindow(handle: unknown, title: unknown, processName: unknown): SessionWindow | undefined {
  const value = String(handle ?? '').trim();
  if (!/^\d+$/.test(value) || value === '0') return undefined;
  for (const win of sessionWindows.values()) {
    if (win.handle === value) {
      if (typeof title === 'string' && title.trim()) win.title = title.trim();
      if (typeof processName === 'string' && processName.trim()) win.process = processName.trim();
      return win;
    }
  }
  const id = `w${nextWindowNumber++}`;
  const win: SessionWindow = {
    id,
    handle: value,
    title: typeof title === 'string' ? title.trim() : '',
    process: typeof processName === 'string' ? processName.trim() : '',
  };
  sessionWindows.set(id, win);
  return win;
}

function windowLabel(win: SessionWindow | undefined): string {
  if (!win) return 'the active window';
  const title = win.title ? ` "${win.title.slice(0, 70)}"` : '';
  const processName = win.process ? ` [${win.process}]` : '';
  return `${win.id}${title}${processName}`;
}

function windowListText(): string {
  const windows = [...sessionWindows.values()];
  if (!windows.length) return 'no visible windows';
  return windows.map(win => windowLabel(win)).join('; ');
}

function sessionWindowList(): Array<Pick<SessionWindow, 'id' | 'handle' | 'title' | 'process'>> {
  return [...sessionWindows.values()].map(({ id, handle, title, process: processName }) => ({
    id, handle, title, process: processName,
  }));
}

function foregroundWindow(): SessionWindow | undefined {
  if (!lastForegroundHandle) return undefined;
  for (const win of sessionWindows.values()) {
    if (win.handle === lastForegroundHandle) return win;
  }
  return undefined;
}

function formatElementsSummary(elements: unknown): string {
  if (!Array.isArray(elements) || elements.length === 0) {
    return 'No visible interactive UI elements.';
  }
  return elements.slice(0, MAX_INSPECT_ELEMENTS).map((el: any) => {
    const label = el.name ? ` "${String(el.name).slice(0, 70)}"` : '';
    return `[${el.id}] ${el.type}${label} (${el.x}, ${el.y})`;
  }).join('\n');
}

function compactElements(elements: unknown): Array<{ id: string; role: string; name: string; bounds: unknown }> {
  if (!Array.isArray(elements)) return [];
  return elements.slice(0, MAX_INSPECT_ELEMENTS).map((el: any) => ({
    id: String(el.id ?? ''),
    role: String(el.type ?? ''),
    name: String(el.name ?? '').slice(0, 80),
    bounds: el.rect ?? { x: el.x, y: el.y },
  }));
}


/**
 * Flexible normalizer for model arguments.
 * Eliminates strict errors and accommodates all LLM variations.
 */
export function normalizeComputerArgs(rawArgs: Record<string, unknown>): {
  action: string;
  handle?: string;
  target?: string;
  windowTitle?: string;
  processName?: string;
  timeoutMs?: number;
  auto_screenshot?: boolean;
  x?: number;
  y?: number;
  to_x?: number;
  to_y?: number;
  button?: string;
  text?: string;
  key?: string;
  delta?: number;
  press_enter?: boolean;
  waitDurationMs?: number;
} {
  const rawAction = String(rawArgs.action || 'screenshot').toLowerCase().trim();
  let action = rawAction;
  let button: string | undefined = typeof rawArgs.button === 'string' ? rawArgs.button.toLowerCase().trim() : undefined;
  let key: string | undefined = undefined;

  // Shortcut key conversions
  if (['enter', 'return'].includes(rawAction)) {
    action = 'key';
    key = 'ENTER';
  } else if (['escape', 'esc'].includes(rawAction)) {
    action = 'key';
    key = 'ESC';
  } else if (['tab'].includes(rawAction)) {
    action = 'key';
    key = 'TAB';
  } else if (['backspace', 'bs'].includes(rawAction)) {
    action = 'key';
    key = 'BACKSPACE';
  } else if (['space', 'spacebar'].includes(rawAction)) {
    action = 'key';
    key = 'SPACE';
  } else if (['paste'].includes(rawAction)) {
    action = 'key';
    key = 'CTRL+V';
  } else if (['copy'].includes(rawAction)) {
    action = 'key';
    key = 'CTRL+C';
  } else if (['drag', 'drag_and_drop'].includes(rawAction)) {
    action = 'drag';
  } else if (['left_click', 'click_element'].includes(rawAction)) {
    action = 'click';
    button = 'left';
  } else if (['right_click', 'context_click'].includes(rawAction)) {
    action = 'click';
    button = 'right';
  } else if (['double_click', 'dblclick'].includes(rawAction)) {
    action = 'click';
    button = 'double';
  } else if (['middle_click'].includes(rawAction)) {
    action = 'click';
    button = 'middle';
  } else if (['move', 'mouse_move', 'hover'].includes(rawAction)) {
    action = 'move';
  } else if (['press', 'keypress', 'hotkey', 'shortcut'].includes(rawAction)) {
    action = 'key';
  } else if (['write', 'input', 'fill'].includes(rawAction)) {
    action = 'type';
  } else if (['open', 'launch', 'start', 'run'].includes(rawAction)) {
    action = 'open';
  } else if (['wait', 'sleep'].includes(rawAction)) {
    action = 'wait';
  } else if (['get_windows', 'list_windows'].includes(rawAction)) {
    action = 'windows';
  } else if (['click_text', 'click_by_text', 'click_label', 'click_name'].includes(rawAction)) {
    action = 'click_text';
  } else if (['wait_for_window', 'wait_window', 'wait_window_open'].includes(rawAction)) {
    action = 'wait_for_window';
  } else if (['get_elements', 'ui_tree', 'elements'].includes(rawAction)) {
    action = 'inspect';
  } else if (['capture', 'screen', 'take_screenshot'].includes(rawAction)) {
    action = 'screenshot';
  }

  // target resolution
  const rawTarget = rawArgs.target ?? rawArgs.ref ?? rawArgs.id ?? rawArgs.element ?? rawArgs.selector ?? rawArgs.window ?? rawArgs.title ?? rawArgs.app ?? rawArgs.command;
  let target = typeof rawTarget === 'string' && rawTarget.trim().length > 0 ? rawTarget.trim() : undefined;

  // text resolution
  const rawText = rawArgs.text ?? rawArgs.value ?? rawArgs.input ?? rawArgs.content;
  const text = rawText !== undefined && rawText !== null ? String(rawText) : undefined;

  // key resolution if not already set by shortcut action
  if (!key) {
    const rawKey = rawArgs.key ?? rawArgs.keys ?? rawArgs.shortcut;
    key = rawKey !== undefined && rawKey !== null ? String(rawKey).trim() : undefined;
  }

  // coordinates resolution
  let x: number | undefined;
  let y: number | undefined;
  const coordArr = Array.isArray(rawArgs.coordinate) ? rawArgs.coordinate : Array.isArray(rawArgs.coordinates) ? rawArgs.coordinates : null;
  if (coordArr && coordArr.length >= 2) {
    const numX = Number(coordArr[0]);
    const numY = Number(coordArr[1]);
    if (!Number.isNaN(numX) && !Number.isNaN(numY)) {
      x = Math.round(numX);
      y = Math.round(numY);
    }
  }
  if (x === undefined && rawArgs.x !== undefined && rawArgs.x !== null) {
    const numX = Number(rawArgs.x);
    if (!Number.isNaN(numX)) x = Math.round(numX);
  }
  if (y === undefined && rawArgs.y !== undefined && rawArgs.y !== null) {
    const numY = Number(rawArgs.y);
    if (!Number.isNaN(numY)) y = Math.round(numY);
  }

  // destination coordinates resolution for drag
  let to_x: number | undefined;
  let to_y: number | undefined;
  const rawToX = rawArgs.to_x ?? rawArgs.end_x ?? rawArgs.x2 ?? rawArgs.dest_x;
  const rawToY = rawArgs.to_y ?? rawArgs.end_y ?? rawArgs.y2 ?? rawArgs.dest_y;
  if (rawToX !== undefined && rawToX !== null) {
    const numToX = Number(rawToX);
    if (!Number.isNaN(numToX)) to_x = Math.round(numToX);
  }
  if (rawToY !== undefined && rawToY !== null) {
    const numToY = Number(rawToY);
    if (!Number.isNaN(numToY)) to_y = Math.round(numToY);
  }

  // handle resolution: a session id (w1), decimal/hex HWND or title/process
  // substring is kept as-is; window resolution happens against the live map.
  let handle: string | undefined;
  if (rawArgs.handle !== undefined && rawArgs.handle !== null) {
    const hStr = String(rawArgs.handle).trim();
    if (/^0x[0-9a-fA-F]+$/.test(hStr)) {
      handle = String(parseInt(hStr, 16));
    } else if (hStr) {
      handle = hStr;
    }
  }

  // wait_for_window targets
  const rawWindowTitle = rawArgs.title ?? rawArgs.window_title ?? rawArgs.windowTitle ?? (action === 'wait_for_window' ? rawArgs.target : undefined);
  const windowTitle = rawWindowTitle !== undefined && rawWindowTitle !== null
    ? String(rawWindowTitle).trim() || undefined
    : undefined;
  const rawProcess = rawArgs.process ?? rawArgs.processName ?? rawArgs.process_name;
  const processName = rawProcess !== undefined && rawProcess !== null
    ? String(rawProcess).trim() || undefined
    : undefined;
  const timeoutRaw = rawArgs.timeout_ms ?? rawArgs.timeoutMs ?? rawArgs.timeout;
  const timeoutMs = action === 'wait_for_window'
    ? Math.min(30000, Math.max(500, Number(timeoutRaw ?? 10000) || 10000))
    : undefined;

  // delta resolution
  let delta: number | undefined;
  if (rawArgs.delta !== undefined && rawArgs.delta !== null) {
    const numDelta = Number(rawArgs.delta);
    if (!Number.isNaN(numDelta)) delta = Math.round(numDelta);
  }

  const autoScreenshot = guiObservation(rawArgs) === 'visual';
  const press_enter = Boolean(rawArgs.press_enter ?? rawArgs.enter ?? rawArgs.submit);

  const waitDurationMs = action === 'wait'
    ? Math.min(Math.max(100, Number(rawArgs.duration ?? rawArgs.ms ?? 1000) || 1000), 10000)
    : undefined;

  return {
    action,
    handle,
    target,
    windowTitle,
    processName,
    timeoutMs,
    auto_screenshot: autoScreenshot,
    x,
    y,
    to_x,
    to_y,
    button: button || 'left',
    text,
    key,
    delta,
    press_enter,
    waitDurationMs,
  };
}

// --- Main Handler ---
export async function executeComputerTool(
  name: string,
  args: Record<string, unknown>,
  workspace: string = process.cwd()
): Promise<string> {
  return handleComputerTool(name, args, { workspace });
}

interface DesktopContext { workspace: string; signal?: AbortSignal }

async function desktopCall(request: Record<string, unknown>, context: DesktopContext): Promise<Record<string, unknown>> {
  const raw = await executeDesktopRequest(request, {
    daemon: sendDaemonRequest, standalone: runStandalonePs, close: closeIdleDesktopDaemon,
  }, context.signal);
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : { raw };
  } catch {
    return { raw };
  }
}

async function refreshWindows(context: DesktopContext): Promise<SessionWindow[]> {
  let data: Record<string, unknown>;
  try {
    data = await desktopCall({ action: 'windows' }, context);
  } catch (error) {
    throw new Error(`Could not list desktop windows: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (data.ok === false) {
    throw new Error(`Could not list desktop windows: ${String(data.warning ?? data.error ?? 'desktop error')}`);
  }
  const windows = ingestWindows(data.windows);
  const foreground = String(data.foreground ?? '').trim();
  if (/^\d+$/.test(foreground) && foreground !== '0') lastForegroundHandle = foreground;
  return windows;
}

function matchingWindows(reference: string): SessionWindow[] {
  const needle = reference.trim().toLowerCase();
  if (!needle) return [];
  return [...sessionWindows.values()].filter(win =>
    win.title.toLowerCase().includes(needle) || win.process.toLowerCase().includes(needle)
  );
}

function chooseWindow(matches: SessionWindow[], reference: string): SessionWindow | undefined {
  if (matches.length <= 1) return matches[0];
  const needle = reference.trim().toLowerCase();
  const exact = matches.filter(win =>
    win.title.toLowerCase() === needle || win.process.toLowerCase() === needle
  );
  if (exact.length === 1) return exact[0];
  const prefixed = matches.filter(win =>
    win.title.toLowerCase().startsWith(needle) || win.process.toLowerCase().startsWith(needle)
  );
  if (prefixed.length === 1) return prefixed[0];
  return undefined;
}

function unknownWindowError(reference: string): Error {
  const windows = windowListText();
  return new Error(
    `Window "${reference}" is not open. Open windows: ${windows}. ` +
    'Call computer with action "windows" to refresh, then pass a session id like "w1" or a title/process substring.'
  );
}

/**
 * Resolve a model-supplied window reference (session id, HWND or title/process
 * substring) against the live session map. `undefined` means "use the active
 * window", which needs no numeric handle at all.
 */
async function resolveHandle(reference: string | undefined, context: DesktopContext): Promise<{ handle?: string; window?: SessionWindow }> {
  if (!reference || !reference.trim()) return {};
  const value = reference.trim();
  const idMatch = /^w\d+$/i.test(value) ? value.toLowerCase() : undefined;
  const hexMatch = /^0x[0-9a-f]+$/i.test(value);
  const decimal = hexMatch ? String(parseInt(value, 16)) : (/^\d+$/.test(value) ? value : undefined);

  if (idMatch || decimal) {
    const locate = (): SessionWindow | undefined => {
      if (idMatch) return sessionWindows.get(idMatch);
      for (const win of sessionWindows.values()) if (win.handle === decimal) return win;
      return undefined;
    };
    let match = locate();
    if (!match) {
      await refreshWindows(context);
      match = locate();
    }
    if (match) return { handle: match.handle, window: match };
    // A literal HWND that is hidden (not in the visible list) is still valid.
    if (decimal) return { handle: decimal };
    throw unknownWindowError(value);
  }

  let candidates = matchingWindows(value);
  if (!candidates.length) {
    await refreshWindows(context);
    candidates = matchingWindows(value);
  }
  if (!candidates.length) throw unknownWindowError(value);
  const chosen = chooseWindow(candidates, value);
  if (!chosen) {
    throw new Error(
      `Window reference "${value}" matches several windows: ${candidates.map(win => windowLabel(win)).join('; ')}. ` +
      'Use the session id (e.g. handle "w1") or a longer title.'
    );
  }
  return { handle: chosen.handle, window: chosen };
}

async function actionableFailure(
  data: Record<string, unknown>,
  action: string,
  context: DesktopContext,
  extra: Record<string, unknown> = {}
): Promise<string> {
  let windows: SessionWindow[] = [];
  try {
    windows = await refreshWindows(context);
  } catch { /* keep the original failure */ }
  const error = String(data.error ?? data.warning ?? 'Desktop action failed.');
  const next = windows.length
    ? 'Call action "windows" to see live ids, then retry with handle "w1" (or a title/process substring) or action "inspect" for element ids.'
    : 'No visible windows. Call action "open" with target "notepad" (or another app) first.';
  return JSON.stringify({
    ok: false,
    action,
    error,
    windows: sessionWindowList(),
    ...(extra.available ? { available: extra.available } : {}),
    next,
  });
}

function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Operation cancelled'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Operation cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitForWindow(
  normalized: ReturnType<typeof normalizeComputerArgs>,
  context: DesktopContext
): Promise<string> {
  const title = normalized.windowTitle ?? normalized.target;
  const processName = normalized.processName;
  if (!title && !processName) {
    throw new Error(
      'wait_for_window needs "title" or "process". Example: {"action":"wait_for_window","title":"Notepad","timeout_ms":10000}. ' +
      'Call action "windows" to see what is currently open.'
    );
  }
  const timeout = normalized.timeoutMs ?? 10000;
  const started = Date.now();
  for (;;) {
    const windows = await refreshWindows(context);
    const match = windows.find(win =>
      (!title || win.title.toLowerCase().includes(title.toLowerCase())) &&
      (!processName || win.process.toLowerCase().includes(processName.toLowerCase()))
    );
    if (match) {
      lastForegroundHandle = match.handle;
      return JSON.stringify({
        ok: true,
        action: 'wait_for_window',
        waitedMs: Date.now() - started,
        window: match,
        windows: sessionWindowList(),
        next: `Call another action with handle "${match.id}" (or omit handle to use the active window).`,
      });
    }
    if (Date.now() - started >= timeout) {
      throw new Error(
        `No window matching ${title ? `title "${title}"` : ''}${title && processName ? ' and ' : ''}${processName ? `process "${processName}"` : ''} ` +
        `appeared within ${timeout}ms. Open windows: ${windowListText()}. ` +
        'Call action "open" to launch the app, or raise timeout_ms (max 30000).'
      );
    }
    await sleepWithSignal(400, context.signal);
  }
}


async function handleComputerBatch(
  args: Record<string, unknown>,
  context: { workspace: string; signal?: AbortSignal }
): Promise<string> {
  const steps = validateBatchSteps(args.steps, ['focus', 'click', 'click_text', 'type', 'key', 'scroll', 'wait', 'move']);
  const completed: string[] = [];
  for (const [index, step] of steps.entries()) {
    context.signal?.throwIfAborted();
    try {
      const result = await handleComputerTool('computer', {
        ...step,
        auto_screenshot: false,
        observe: 'none',
        ...(step.action === 'wait' ? { duration: Math.min(5000, Math.max(50, Number(step.ms ?? step.duration ?? 500) || 500)) } : {}),
      }, context);
      const parsed = (() => { try { return JSON.parse(result) as Record<string, unknown>; } catch { return {}; } })();
      if (parsed.ok === false) throw new Error(String(parsed.error || parsed.warning || 'desktop action reported a warning'));
      completed.push(`${index + 1}. ${step.action}${step.target ? ` [${String(step.target).slice(0, 80)}]` : ''} ok`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Batch stopped at step ${index + 1} (${step.action}): ${message}${completed.length ? `\nCompleted: ${completed.join(' | ')}` : ''}`);
    }
  }

  const mode = guiObservation(args);
  if (mode === 'none') return `Batch completed ${steps.length} step(s).\n${completed.join('\n')}`;
  if (mode === 'visual') {
    const shot = await handleComputerTool('computer', { action: 'screenshot', auto_screenshot: false }, context);
    return `Batch completed ${steps.length} step(s).\n${completed.join('\n')}\n${shot}`;
  }
  const windows = await handleComputerTool('computer', { action: 'windows', auto_screenshot: false }, context);
  return `Batch completed ${steps.length} step(s).\n${completed.join('\n')}\n${windows}`;
}

export async function handleComputerTool(
  name: string,
  args: Record<string, unknown>,
  context: { workspace: string; signal?: AbortSignal }
): Promise<string> {
  if (name === 'computer_batch') return await handleComputerBatch(args, context);
  if (name !== 'computer') throw new Error(`Unknown computer tool: ${name}`);

  const normalized = normalizeComputerArgs(args);

  if (process.platform !== 'win32') {
    if (normalized.action === 'click_text') {
      throw new Error('click_text uses Windows UI Automation. On this platform call action "inspect" and then action "click" with x/y coordinates.');
    }
    if (normalized.action === 'wait_for_window') {
      throw new Error('wait_for_window is Windows-only. Poll action "windows" instead; browser_wait_for handles web pages.');
    }
    return await handleUnixComputer(normalized as unknown as Record<string, unknown>, context);
  }

  const action = normalized.action;

  // 'wait' is handled in Node.js; the optional visual observation follows below.
  if (action === 'wait') {
    const duration = normalized.waitDurationMs || 1000;
    await new Promise(r => setTimeout(r, duration));
    if (normalized.auto_screenshot === false) {
      return JSON.stringify({ attempted: true, action: 'wait', duration });
    }
  }

  if (action === 'wait_for_window') return await waitForWindow(normalized, context);

  let resolved = action === 'windows' || action === 'open'
    ? {}
    : await resolveHandle(normalized.handle, context);

  // `focus` without a handle means "focus the active window". Fill the
  // foreground handle so the result carries a real window instead of failing.
  if (action === 'focus' && !normalized.handle) {
    if (!sessionWindows.size) await refreshWindows(context).catch(() => []);
    const foreground = foregroundWindow() ?? [...sessionWindows.values()][0];
    if (foreground) resolved = { handle: foreground.handle, window: foreground };
  }

  const request: Record<string, unknown> = {
    action,
    handle: resolved.handle,
    target: normalized.target,
    x: normalized.x,
    y: normalized.y,
    to_x: normalized.to_x,
    to_y: normalized.to_y,
    button: normalized.button,
    text: normalized.text,
    key: normalized.key,
    delta: normalized.delta,
    press_enter: normalized.press_enter,
  };

  const wantsScreenshot = action === 'screenshot' || (action === 'wait' && normalized.auto_screenshot === true);
  if (wantsScreenshot) {
    request.action = 'screenshot';
    request.screenshotPath = await createScreenshotPath(context.workspace, 'desktop');
  }

  // Retry only observations: a lost action response may follow a successful click/type.
  let rawRes: string;
  try {
    rawRes = await executeDesktopRequest(request, {
      daemon: sendDaemonRequest, standalone: runStandalonePs, close: closeIdleDesktopDaemon,
    }, context.signal);
  } catch (error) {
    if (isKillSwitchError(error)) throw new Error(`[ACİL DURDURMA - KULLANICI TARAFINDAN DURDURULDU] ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }

  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(rawRes);
  } catch {
    data = { raw: rawRes };
  }

  if (data.ok === false) return await actionableFailure(data, action, context);

  if (action === 'windows') {
    const windows = ingestWindows(data.windows);
    const foregroundRaw = String(data.foreground ?? '').trim();
    if (/^\d+$/.test(foregroundRaw) && foregroundRaw !== '0') lastForegroundHandle = foregroundRaw;
    const foreground = foregroundWindow();
    return JSON.stringify({
      ok: true,
      action: 'windows',
      foreground: foreground?.id,
      windows: sessionWindowList(),
      ...(data.screen ? { screen: data.screen } : {}),
      next: windows.length
        ? 'Pass handle "w1" (or a title/process substring) to focus/click/type; omit handle to use the active window.'
        : 'No visible windows. Call action "open" with target "notepad" (or another app) first.',
    });
  }

  if (action === 'inspect') {
    const win = rememberWindow(data.handle, data.windowTitle, data.processName);
    const rawElements = Array.isArray(data.elements) ? data.elements : [];
    const elements = compactElements(rawElements);
    return JSON.stringify({
      ok: true,
      action: 'inspect',
      window: win,
      elementCount: rawElements.length,
      elements,
      truncated: rawElements.length > MAX_INSPECT_ELEMENTS,
      summary: `Window ${windowLabel(win)}. Interactive elements (${rawElements.length}):\n${formatElementsSummary(rawElements)}`,
      next: elements.length
        ? 'Use target "u1" (element id) or click_text with the visible label in the next call.'
        : 'No interactive elements found. Use observe "visual" for a screenshot, or target by window title/coordinates.',
    });
  }

  if (action === 'focus') {
    const win = rememberWindow(data.handle, data.windowTitle, data.processName);
    if (data.focused === false && normalized.handle) {
      return JSON.stringify({
        ok: false,
        action: 'focus',
        error: `Windows did not allow focus to change to ${windowLabel(win)}.`,
        windows: sessionWindowList(),
        next: 'Click the window first, or retry once; Windows blocks focus changes from background processes.',
      });
    }
    return JSON.stringify({
      ok: true,
      action: 'focus',
      focused: true,
      window: win,
      windows: sessionWindowList(),
      next: win ? `Pass handle "${win.id}" to the next action (typing goes to the focused field).` : undefined,
    });
  }

  if (action === 'open') {
    if (data.attempted === false) return await actionableFailure(data, action, context);
    const win = rememberWindow(data.handle ?? data.foreground, data.windowTitle, data.processName);
    return JSON.stringify({
      ok: true,
      action: 'open',
      target: data.target,
      window: win,
      windows: sessionWindowList(),
      next: win
        ? `Use handle "${win.id}" for focus/inspect/click_text, or action "wait_for_window" with its title.`
        : 'Call action "windows" to see the new window id.',
    });
  }

  if (action === 'click_text') {
    if (data.attempted === false) {
      return await actionableFailure(data, action, context, { available: data.available });
    }
    const win = rememberWindow(data.handle, data.windowTitle, data.processName);
    return JSON.stringify({
      ok: true,
      action: 'click_text',
      window: win,
      element: data.element,
      windows: sessionWindowList(),
      next: 'Call action "inspect" or "windows" to verify the result.',
    });
  }

  if (wantsScreenshot) {
    const shotPath = request.screenshotPath as string;
    const elements = compactElements(data.elements);
    return JSON.stringify({
      ok: true,
      action: 'screenshot',
      path: shotPath,
      screenshotPath: shotPath,
      window: rememberWindow(data.handle, data.windowTitle, data.processName),
      elements,
      message: `Screenshot saved: ${shotPath}\n\n[Active window interactive elements (Set-of-Marks)]:\n${formatElementsSummary(data.elements)}`,
    });
  }

  // Optional visual verification after a mutation.
  const shouldAutoScreenshot = normalized.auto_screenshot === true &&
    ['focus', 'click', 'click_text', 'type', 'key', 'scroll', 'open', 'move', 'drag'].includes(action);
  if (shouldAutoScreenshot) {
    try {
      await new Promise(r => setTimeout(r, 220));
      const shotPath = await createScreenshotPath(context.workspace, 'desktop');
      const shotData = await desktopCall({ action: 'screenshot', screenshotPath: shotPath }, context);
      if (shotData.ok === false) throw new Error(String(shotData.warning || shotData.error || 'Desktop screenshot failed.'));
      return JSON.stringify({
        ...data,
        path: shotPath,
        screenshotPath: shotPath,
        message: `Screenshot saved: ${shotPath}\n\n[Active window interactive elements (Set-of-Marks)]:\n${formatElementsSummary(shotData.elements)}`,
        elements: compactElements(shotData.elements),
      });
    } catch (shotErr: any) {
      if (isKillSwitchError(shotErr)) {
        await closeIdleDesktopDaemon();
        throw new Error(`[ACİL DURDURMA - KULLANICI TARAFINDAN DURDURULDU] ${shotErr.message}`);
      }
      return JSON.stringify({
        ...data,
        note: `Action attempted; visual verification screenshot was skipped: ${shotErr?.message || String(shotErr)}`,
      });
    }
  }

  return rawRes;
}
