import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const computerToolDefinitions = [{
        name: 'computer',
        description: 'Control the local desktop GUI with semantic UI Automation, pinpoint target resolution, on-screen live HUD, and automatic visual verification. Coordinates are absolute physical desktop pixels.',
        parameters: {
            type: 'object',
            required: ['action'],
            properties: {
                action: {
                    type: 'string',
                    enum: ['windows', 'inspect', 'screenshot', 'focus', 'click', 'type', 'key', 'scroll', 'move', 'drag', 'open', 'wait'],
                    description: 'Action to perform on the desktop.'
                },
                handle: {
                    type: 'string',
                    description: 'Decimal or hex handle from windows, or window title.'
                },
                target: {
                    type: 'string',
                    description: 'UI element ID (e.g. u1, u2), button/text label (e.g. Save, Search), landmark (e.g. bottom_input_bar, bottom_send_button, left_search_box), or application/window title. Always prefer target over raw coordinates.'
                },
                auto_screenshot: {
                    type: 'boolean',
                    description: 'Return marked screenshot and UI element list after action (default: true).'
                },
                press_enter: {
                    type: 'boolean',
                    description: 'Metni yazdıktan sonra otomatik olarak Enter tuşuna bas (mesaj gönderme ve arama için).'
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
                text: { type: 'string', description: 'Text to type into the foreground window.' },
                key: {
                    type: 'string',
                    description: 'Key or key combination to press (e.g. ENTER, ESC, TAB, CTRL+C, CTRL+V, ALT+F4, WIN+R).'
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
        const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', script, '-Action', 'daemon'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
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
                            req.resolve(JSON.stringify(parsed.data !== undefined ? parsed.data : parsed));
                        }
                        else {
                            // Daemon süreci sağlamdır; uygulama/işlem uyarısı döndürüldü
                            req.resolve(JSON.stringify({
                                ok: false,
                                warning: parsed.error || parsed.warning || 'Desktop action reported a warning.',
                                ...(parsed.data && typeof parsed.data === 'object' ? parsed.data : {}),
                                ...parsed
                            }));
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
        const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', script], {
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
            const out = stdout.trim();
            if (out) {
                try {
                    const parsed = JSON.parse(out);
                    if (parsed && typeof parsed === 'object') {
                        resolve(out);
                        return;
                    }
                }
                catch { }
            }
            if (code === 0) {
                resolve(out);
            }
            else {
                const errDetail = stderr.trim() || out || `exit code ${code}`;
                resolve(JSON.stringify({
                    ok: true,
                    warning: `Computer action completed with notice (${code}): ${errDetail}`
                }));
            }
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
            const keyMap = { ENTER: 36, TAB: 48, ESC: 53, BACKSPACE: 51, DELETE: 117, UP: 126, DOWN: 125, LEFT: 123, RIGHT: 124 };
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
function isKillSwitchError(err) {
    if (!err)
        return false;
    const msg = err instanceof Error ? err.message : String(err);
    return (msg.includes('KULLANICI ACİL DURDURMA') ||
        msg.includes('KILL-SWITCH') ||
        msg.includes('ACİL DURDURMA'));
}
function formatElementsSummary(elements) {
    if (!Array.isArray(elements) || elements.length === 0) {
        return 'Görünür etkileşimli öğe bulunamadı.';
    }
    return elements.slice(0, 40).map((el) => {
        const label = el.name ? ` "${el.name}"` : '';
        return `[${el.id}] ${el.type}${label} (${el.x}, ${el.y})`;
    }).join('\n');
}
/**
 * Flexible normalizer for model arguments.
 * Eliminates strict errors and accommodates all LLM variations.
 */
function normalizeComputerArgs(rawArgs) {
    const rawAction = String(rawArgs.action || 'screenshot').toLowerCase().trim();
    let action = rawAction;
    let button = typeof rawArgs.button === 'string' ? rawArgs.button.toLowerCase().trim() : undefined;
    let key = undefined;
    // Shortcut key conversions
    if (['enter', 'return'].includes(rawAction)) {
        action = 'key';
        key = 'ENTER';
    }
    else if (['escape', 'esc'].includes(rawAction)) {
        action = 'key';
        key = 'ESC';
    }
    else if (['tab'].includes(rawAction)) {
        action = 'key';
        key = 'TAB';
    }
    else if (['backspace', 'bs'].includes(rawAction)) {
        action = 'key';
        key = 'BACKSPACE';
    }
    else if (['space', 'spacebar'].includes(rawAction)) {
        action = 'key';
        key = 'SPACE';
    }
    else if (['paste'].includes(rawAction)) {
        action = 'key';
        key = 'CTRL+V';
    }
    else if (['copy'].includes(rawAction)) {
        action = 'key';
        key = 'CTRL+C';
    }
    else if (['drag', 'drag_and_drop'].includes(rawAction)) {
        action = 'drag';
    }
    else if (['left_click', 'click_element'].includes(rawAction)) {
        action = 'click';
        button = 'left';
    }
    else if (['right_click', 'context_click'].includes(rawAction)) {
        action = 'click';
        button = 'right';
    }
    else if (['double_click', 'dblclick'].includes(rawAction)) {
        action = 'click';
        button = 'double';
    }
    else if (['middle_click'].includes(rawAction)) {
        action = 'click';
        button = 'middle';
    }
    else if (['move', 'mouse_move', 'hover'].includes(rawAction)) {
        action = 'move';
    }
    else if (['press', 'keypress', 'hotkey', 'shortcut'].includes(rawAction)) {
        action = 'key';
    }
    else if (['write', 'input', 'fill'].includes(rawAction)) {
        action = 'type';
    }
    else if (['open', 'launch', 'start', 'run'].includes(rawAction)) {
        action = 'open';
    }
    else if (['wait', 'sleep'].includes(rawAction)) {
        action = 'wait';
    }
    else if (['get_windows', 'list_windows'].includes(rawAction)) {
        action = 'windows';
    }
    else if (['get_elements', 'ui_tree', 'elements'].includes(rawAction)) {
        action = 'inspect';
    }
    else if (['capture', 'screen', 'take_screenshot'].includes(rawAction)) {
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
    let x;
    let y;
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
        if (!Number.isNaN(numX))
            x = Math.round(numX);
    }
    if (y === undefined && rawArgs.y !== undefined && rawArgs.y !== null) {
        const numY = Number(rawArgs.y);
        if (!Number.isNaN(numY))
            y = Math.round(numY);
    }
    // destination coordinates resolution for drag
    let to_x;
    let to_y;
    const rawToX = rawArgs.to_x ?? rawArgs.end_x ?? rawArgs.x2 ?? rawArgs.dest_x;
    const rawToY = rawArgs.to_y ?? rawArgs.end_y ?? rawArgs.y2 ?? rawArgs.dest_y;
    if (rawToX !== undefined && rawToX !== null) {
        const numToX = Number(rawToX);
        if (!Number.isNaN(numToX))
            to_x = Math.round(numToX);
    }
    if (rawToY !== undefined && rawToY !== null) {
        const numToY = Number(rawToY);
        if (!Number.isNaN(numToY))
            to_y = Math.round(numToY);
    }
    // handle resolution
    let handle;
    if (rawArgs.handle !== undefined && rawArgs.handle !== null) {
        const hStr = String(rawArgs.handle).trim();
        if (/^0x[0-9a-fA-F]+$/.test(hStr)) {
            handle = String(parseInt(hStr, 16));
        }
        else if (/^\d+$/.test(hStr)) {
            handle = hStr;
        }
        else {
            if (!target) {
                target = hStr;
            }
        }
    }
    // delta resolution
    let delta;
    if (rawArgs.delta !== undefined && rawArgs.delta !== null) {
        const numDelta = Number(rawArgs.delta);
        if (!Number.isNaN(numDelta))
            delta = Math.round(numDelta);
    }
    const autoScreenshot = rawArgs.auto_screenshot !== false;
    const press_enter = Boolean(rawArgs.press_enter ?? rawArgs.enter ?? rawArgs.submit);
    const waitDurationMs = action === 'wait'
        ? Math.min(Math.max(100, Number(rawArgs.duration ?? rawArgs.ms ?? 1000) || 1000), 10000)
        : undefined;
    return {
        action,
        handle,
        target,
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
export async function executeComputerTool(name, args, workspace = process.cwd()) {
    return handleComputerTool(name, args, { workspace });
}
export async function handleComputerTool(name, args, context) {
    if (name !== 'computer')
        throw new Error(`Unknown computer tool: ${name}`);
    const normalized = normalizeComputerArgs(args);
    if (process.platform !== 'win32') {
        return await handleUnixComputer(normalized, context);
    }
    const action = normalized.action;
    // Handle 'wait' directly in Node.js
    if (action === 'wait') {
        const duration = normalized.waitDurationMs || 1000;
        await new Promise(r => setTimeout(r, duration));
        if (normalized.auto_screenshot === false) {
            return JSON.stringify({ attempted: true, action: 'wait', duration });
        }
    }
    const request = {
        action,
        handle: normalized.handle,
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
    if (action === 'screenshot' || (action === 'wait' && normalized.auto_screenshot !== false)) {
        request.action = 'screenshot';
        const directory = join(context.workspace, '.tbot', 'screenshots');
        await mkdir(directory, { recursive: true });
        request.screenshotPath = join(directory, `screenshot-${randomUUID()}.png`);
    }
    // Warm daemon execution for low latency; fallback to standalone PS if daemon fails
    let rawRes;
    try {
        rawRes = await sendDaemonRequest(request, context.signal);
    }
    catch (daemonError) {
        if (isKillSwitchError(daemonError)) {
            await closeIdleDesktopDaemon();
            throw new Error(`[ACİL DURDURMA - KULLANICI TARAFINDAN DURDURULDU] ${daemonError.message}`);
        }
        // Daemon'ı SADECE süreç gerçekten kapandığında (!desktopDaemon || desktopDaemon.killed) veya zaman aşımı (timed out) olduğunda kapat!
        const isDead = !desktopDaemon || desktopDaemon.killed;
        const isTimeout = daemonError?.message?.includes('timed out');
        if (isDead || isTimeout) {
            try {
                await closeIdleDesktopDaemon();
            }
            catch { }
        }
        try {
            rawRes = await runStandalonePs(request, context.signal);
        }
        catch (standaloneError) {
            if (isKillSwitchError(standaloneError)) {
                throw new Error(`[ACİL DURDURMA - KULLANICI TARAFINDAN DURDURULDU] ${standaloneError.message}`);
            }
            rawRes = JSON.stringify({
                ok: true,
                warning: `Desktop action notice: ${standaloneError?.message || String(standaloneError)}`
            });
        }
    }
    let data = {};
    try {
        data = JSON.parse(rawRes);
    }
    catch {
        data = { raw: rawRes };
    }
    if (action === 'inspect') {
        const elements = data.elements || [];
        const elementsSummary = formatElementsSummary(elements);
        return JSON.stringify({
            ...data,
            summary: `Active Window: "${data.windowTitle || ''}" (Handle: ${data.handle})\n\n[Etkileşimli UI Öğeleri]:\n${elementsSummary}`,
        });
    }
    if (action === 'screenshot' || (action === 'wait' && normalized.auto_screenshot !== false)) {
        const shotPath = request.screenshotPath;
        const elements = data.elements || [];
        const elementsSummary = formatElementsSummary(elements);
        return JSON.stringify({
            ...data,
            path: shotPath,
            screenshotPath: shotPath,
            message: `Screenshot saved: ${shotPath}\n\n[Aktif Pencere Etkileşimli Öğeleri (Set-of-Marks)]:\n${elementsSummary}`,
            elements,
        });
    }
    // Otomatik Gözlem -> Eylem -> Görsel Doğrulama Döngüsü
    const shouldAutoScreenshot = normalized.auto_screenshot !== false && ['focus', 'click', 'type', 'key', 'scroll', 'open', 'move', 'drag'].includes(action);
    if (shouldAutoScreenshot) {
        try {
            await new Promise(r => setTimeout(r, 220));
            const directory = join(context.workspace, '.tbot', 'screenshots');
            await mkdir(directory, { recursive: true });
            const shotPath = join(directory, `screenshot-${randomUUID()}.png`);
            let shotRaw;
            try {
                shotRaw = await sendDaemonRequest({ action: 'screenshot', screenshotPath: shotPath }, context.signal);
            }
            catch (shotDaemonError) {
                if (isKillSwitchError(shotDaemonError)) {
                    await closeIdleDesktopDaemon();
                    throw new Error(`[ACİL DURDURMA - KULLANICI TARAFINDAN DURDURULDU] ${shotDaemonError.message}`);
                }
                const isDead = !desktopDaemon || desktopDaemon.killed;
                const isTimeout = shotDaemonError?.message?.includes('timed out');
                if (isDead || isTimeout) {
                    try {
                        await closeIdleDesktopDaemon();
                    }
                    catch { }
                }
                shotRaw = await runStandalonePs({ action: 'screenshot', screenshotPath: shotPath }, context.signal);
            }
            let shotData = {};
            try {
                shotData = JSON.parse(shotRaw);
            }
            catch { }
            const elements = shotData.elements || [];
            const elementsSummary = formatElementsSummary(elements);
            return JSON.stringify({
                ...data,
                path: shotPath,
                screenshotPath: shotPath,
                message: `Screenshot saved: ${shotPath}\n\n[Aktif Pencere Etkileşimli Öğeleri (Set-of-Marks)]:\n${elementsSummary}`,
                elements,
            });
        }
        catch (shotErr) {
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
//# sourceMappingURL=computer.js.map