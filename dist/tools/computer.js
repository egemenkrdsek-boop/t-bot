import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const computerToolDefinitions = [{
        name: 'computer',
        description: 'Control the local desktop GUI. List windows and obtain handles before focusing or interacting. Coordinates are absolute physical desktop pixels; screenshot returns a local PNG path, not image content.',
        parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['action'],
            properties: {
                action: {
                    type: 'string',
                    enum: ['windows', 'screenshot', 'focus', 'click', 'type', 'key', 'scroll'],
                    description: 'Action to perform on the desktop.'
                },
                handle: {
                    type: 'string',
                    description: 'Decimal or hex handle from windows; required for focus and input on target window.'
                },
                x: { type: 'integer', description: 'Absolute desktop x coordinate.' },
                y: { type: 'integer', description: 'Absolute desktop y coordinate.' },
                button: {
                    type: 'string',
                    enum: ['left', 'right', 'double', 'middle'],
                    description: 'Mouse button to click or action type (left, right, double, middle).'
                },
                text: { type: 'string', description: 'Text to type into the foreground window.' },
                key: {
                    type: 'string',
                    enum: ['ENTER', 'TAB', 'ESC', 'BACKSPACE', 'DELETE', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'HOME', 'END', 'PAGEUP', 'PAGEDOWN'],
                    description: 'Special key to press.'
                },
                delta: { type: 'integer', description: 'Mouse wheel delta, typically 120 (up) or -120 (down).' }
            }
        }
    }];
let desktopDaemon = null;
let daemonLaunching = null;
const pendingRequests = new Map();
let lineBuffer = '';
let desktopIdleTimer = null;
const DESKTOP_IDLE_TIMEOUT_MS = 90_000;
let lastDesktopActivityAt = 0;
export function resetDesktopIdleTimer() {
    lastDesktopActivityAt = Date.now();
    if (desktopIdleTimer) {
        clearTimeout(desktopIdleTimer);
        desktopIdleTimer = null;
    }
    if (desktopDaemon || daemonLaunching) {
        desktopIdleTimer = setTimeout(() => {
            if (pendingRequests.size === 0) {
                void closeIdleDesktopDaemon().catch(() => { });
            }
        }, DESKTOP_IDLE_TIMEOUT_MS);
        desktopIdleTimer.unref();
    }
}
/**
 * Shuts down the idle desktop daemon process to reclaim system RAM.
 * Can be invoked by memory-guard or during idle timeouts.
 */
export async function closeIdleDesktopDaemon() {
    if (desktopIdleTimer) {
        clearTimeout(desktopIdleTimer);
        desktopIdleTimer = null;
    }
    if (daemonLaunching) {
        try {
            await daemonLaunching;
        }
        catch { }
    }
    const proc = desktopDaemon;
    desktopDaemon = null;
    if (proc) {
        try {
            proc.stdin?.end();
            proc.kill();
        }
        catch { }
    }
    for (const [id, req] of pendingRequests) {
        clearTimeout(req.timer);
        req.reject(new Error('Desktop daemon closed.'));
    }
    pendingRequests.clear();
    lineBuffer = '';
}
async function getDesktopDaemon() {
    if (desktopDaemon && !desktopDaemon.killed)
        return desktopDaemon;
    if (daemonLaunching)
        return daemonLaunching;
    daemonLaunching = (async () => {
        const script = fileURLToPath(new URL('../../scripts/computer.ps1', import.meta.url));
        const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-File', script, '-Action', 'daemon'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            lineBuffer += chunk;
            let newlineIdx;
            while ((newlineIdx = lineBuffer.indexOf('\n')) !== -1) {
                const line = lineBuffer.slice(0, newlineIdx).trim();
                lineBuffer = lineBuffer.slice(newlineIdx + 1);
                if (!line)
                    continue;
                try {
                    const parsed = JSON.parse(line);
                    const req = pendingRequests.get(parsed.id);
                    if (req) {
                        clearTimeout(req.timer);
                        pendingRequests.delete(parsed.id);
                        if (parsed.ok) {
                            req.resolve(JSON.stringify(parsed.data));
                        }
                        else {
                            req.reject(new Error(parsed.error || 'Desktop action failed.'));
                        }
                    }
                }
                catch {
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
    }
    finally {
        daemonLaunching = null;
    }
}
async function sendDaemonRequest(payload, signal) {
    const daemon = await getDesktopDaemon();
    const id = randomUUID();
    const reqPayload = { ...payload, id };
    return new Promise((resolve, reject) => {
        let abortListener;
        const timer = setTimeout(() => {
            pendingRequests.delete(id);
            if (abortListener && signal)
                signal.removeEventListener('abort', abortListener);
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
                if (abortListener && signal)
                    signal.removeEventListener('abort', abortListener);
                resolve(val);
            },
            reject: (err) => {
                if (abortListener && signal)
                    signal.removeEventListener('abort', abortListener);
                reject(err);
            },
            timer
        });
        try {
            if (!daemon.stdin)
                throw new Error('Desktop daemon stdin unavailable');
            daemon.stdin.write(JSON.stringify(reqPayload) + '\n');
        }
        catch (err) {
            clearTimeout(timer);
            pendingRequests.delete(id);
            reject(err instanceof Error ? err : new Error(String(err)));
        }
        resetDesktopIdleTimer();
    });
}
async function runStandalonePs(request, signal) {
    const script = fileURLToPath(new URL('../../scripts/computer.ps1', import.meta.url));
    const TIMEOUT_MS = 15_000;
    return new Promise((resolve, reject) => {
        let settled = false;
        const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-File', script], {
            windowsHide: true,
            signal,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            try {
                child.kill();
            }
            catch { }
            reject(new Error('Desktop action timed out (15s).'));
        }, TIMEOUT_MS);
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.on('error', err => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            reject(err);
        });
        child.on('close', code => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            code === 0 ? resolve(stdout.trim()) : reject(new Error(`Computer action failed: ${stderr.trim() || `exit ${code}`}`));
        });
        child.stdin.end(JSON.stringify(request));
    });
}
// --- macOS & Linux Fallback Implementations ---
async function handleUnixComputer(args, context) {
    const action = args.action;
    const platform = process.platform;
    if (action === 'screenshot') {
        const dir = join(context.workspace, '.tbot', 'screenshots');
        await mkdir(dir, { recursive: true });
        const screenshotPath = join(dir, `screenshot-${randomUUID()}.png`);
        if (platform === 'darwin') {
            await execUnix('screencapture', ['-x', screenshotPath], context.signal);
        }
        else {
            // Linux: try gnome-screenshot, then import, then scrot
            try {
                await execUnix('gnome-screenshot', ['-f', screenshotPath], context.signal);
            }
            catch {
                try {
                    await execUnix('import', ['-window', 'root', screenshotPath], context.signal);
                }
                catch {
                    await execUnix('scrot', [screenshotPath], context.signal);
                }
            }
        }
        return JSON.stringify({ path: screenshotPath, note: `Captured desktop screenshot on ${platform}` });
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
            const text = args.text.replace(/[\\"]/g, '\\$&');
            await execUnix('osascript', ['-e', `tell application "System Events" to keystroke "${text}"`], context.signal);
            return JSON.stringify({ attempted: true, action: 'type' });
        }
        if (action === 'key') {
            const key = args.key;
            const keyMap = { ENTER: 36, TAB: 48, ESC: 53, BACKSPACE: 51, DELETE: 117, UP: 126, DOWN: 125, LEFT: 123, RIGHT: 124 };
            const code = keyMap[key] ?? 36;
            await execUnix('osascript', ['-e', `tell application "System Events" to key code ${code}`], context.signal);
            return JSON.stringify({ attempted: true, action: 'key' });
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
            const btnMap = { left: '1', middle: '2', right: '3', double: '1 --repeat 2' };
            const btn = btnMap[args.button || 'left'] || '1';
            await execUnix('xdotool', ['mousemove', String(args.x), String(args.y), 'click', btn], context.signal);
            return JSON.stringify({ attempted: true, action: 'click' });
        }
        if (action === 'type') {
            await execUnix('xdotool', ['type', '--', String(args.text)], context.signal);
            return JSON.stringify({ attempted: true, action: 'type' });
        }
        if (action === 'key') {
            const k = String(args.key).toLowerCase();
            await execUnix('xdotool', ['key', k === 'esc' ? 'Escape' : k === 'enter' ? 'Return' : args.key], context.signal);
            return JSON.stringify({ attempted: true, action: 'key' });
        }
    }
    throw new Error(`Action "${action}" is not fully supported on ${platform}. Please run on Windows for complete native desktop integration.`);
}
function execUnix(cmd, args, signal) {
    return new Promise((resolve, reject) => {
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
// --- Main Handler ---
export async function handleComputerTool(name, args, context) {
    if (name !== 'computer')
        throw new Error(`Unknown computer tool: ${name}`);
    if (process.platform !== 'win32') {
        return await handleUnixComputer(args, context);
    }
    const action = args.action;
    if (typeof action !== 'string' || !['windows', 'screenshot', 'focus', 'click', 'type', 'key', 'scroll'].includes(action)) {
        throw new Error('Invalid computer action.');
    }
    const permitted = new Set(['action', 'handle', 'x', 'y', 'button', 'text', 'key', 'delta']);
    if (Object.keys(args).some(k => !permitted.has(k))) {
        throw new Error('Unexpected computer argument.');
    }
    if (!['windows', 'screenshot'].includes(action) && (typeof args.handle !== 'string' || !/^[1-9]\d{0,18}$/.test(args.handle))) {
        throw new Error('A decimal window handle is required.');
    }
    if (action === 'click' || action === 'scroll') {
        if (!Number.isSafeInteger(args.x) || !Number.isSafeInteger(args.y) || Math.abs(args.x) > 100000 || Math.abs(args.y) > 100000) {
            throw new Error('Valid integer desktop coordinates are required.');
        }
    }
    if (action === 'click' && args.button !== undefined && !['left', 'right', 'double', 'middle'].includes(args.button)) {
        throw new Error('Invalid mouse button. Allowed: left, right, double, middle.');
    }
    if (action === 'scroll' && (!Number.isInteger(args.delta) || Math.abs(args.delta) > 1200 || args.delta === 0)) {
        throw new Error('Scroll delta must be a nonzero integer between -1200 and 1200.');
    }
    if (action === 'type' && (typeof args.text !== 'string' || args.text.length > 4000 || /[\r\n\x00-\x1f]/.test(args.text))) {
        throw new Error('Text must be a single line of at most 4000 characters.');
    }
    if (action === 'key' && (typeof args.key !== 'string' || !['ENTER', 'TAB', 'ESC', 'BACKSPACE', 'DELETE', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'HOME', 'END', 'PAGEUP', 'PAGEDOWN'].includes(args.key))) {
        throw new Error('Unsupported key.');
    }
    let request = args;
    if (action === 'screenshot') {
        const directory = join(context.workspace, '.tbot', 'screenshots');
        await mkdir(directory, { recursive: true });
        request = { ...args, screenshotPath: join(directory, `screenshot-${randomUUID()}.png`) };
    }
    // Attempt warm daemon execution for ultra-low latency (2-10ms); fall back to standalone if daemon fails
    try {
        return await sendDaemonRequest(request, context.signal);
    }
    catch (daemonError) {
        // If daemon fails or was closed, fallback to one-shot standalone runner
        try {
            await closeIdleDesktopDaemon();
        }
        catch { }
        return await runStandalonePs(request, context.signal);
    }
}
//# sourceMappingURL=computer.js.map