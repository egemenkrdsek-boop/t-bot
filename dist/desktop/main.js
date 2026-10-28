import { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, globalShortcut, protocol, net } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { lstat, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { freemem, homedir, tmpdir, totalmem } from 'node:os';
import { randomUUID } from 'node:crypto';
// V8 and Chromium low-RAM switches (must be appended before app.whenReady())
app.commandLine.appendSwitch('js-flags', '--expose-gc');
app.commandLine.appendSwitch('disable-features', 'Translate,AutofillServerCommunication,CalculateNativeWinOcclusion,SpareRendererForSitePerProcess,MediaRouter,AudioServiceOutOfProcess');
app.commandLine.appendSwitch('disable-spell-checking');
app.commandLine.appendSwitch('disable-dev-shm-usage');
// Core T Bot 3.0 modules
import { runTurnMode } from '../turn-runner.js';
import { loadConfig, saveConfig, resolveProviderConfig, getWorkspacePermission, setWorkspacePermission, configDirectory, } from '../config.js';
import { getCustomSecret, prepareApiKey, setCustomSecret } from '../secrets.js';
import { listProviderModels, resolveImageProviderConfig, storeProviderApiKey } from '../host-services.js';
import { SessionStore, createSession } from '../sessions.js';
import { getGoal, getTodos, getActiveFocusSummary, executeWorkflowTool } from '../workflows.js';
import { BUILTIN_SKILLS, loadCustomSkills } from '../skills.js';
import { loadConnections, getMcpToken, saveConnection, setMcpToken, removeConnection, approveStdioConnection } from '../mcp-config.js';
import { getTelegramBotStatus, startTelegramBotBridge, stopTelegramBotBridge } from '../bot.js';
import { connectMcp, registerMcpStdioApproval } from '../mcp.js';
import { listCheckpoints, restoreCheckpoint } from '../checkpoints.js';
import { sandboxStatus } from '../security/sandbox.js';
import { MCP_PRESETS } from '../mcp-presets.js';
import { PROVIDER_CATALOG, createProvider } from '../providers.js';
import { TOOL_TITLE_MAP, formatToolTitle } from '../theme.js';
import { commandCatalog, commandsFor, helpFor } from '../commands.js';
import { globalTokenTracker } from '../token-optimizer.js';
import { recallFacts, rememberFact, forgetFact } from '../memory.js';
import { getStatus as getGroundingStatus } from '../grounding.js';
import { trimDesktopMemory, trimDesktopMemoryUnderPressure, getDesktopMemoryStats } from './memory-trimmer.js';
import { registerDesktopQuitCleanup } from './quit-cleanup.js';
import { closeBrowser } from '../tools/browser.js';
import { closeIdleDesktopDaemon } from '../tools/computer.js';
import { stopAllBackgroundProcesses } from '../tools/shell.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Single instance lock
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
    process.exit(0);
}
// The renderer loads screenshots through a dedicated, read-only scheme. The
// registration itself must happen before `app.whenReady()`.
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'tbot-file',
        privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
]);
const SCREENSHOT_MIME = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
};
// Workspaces the renderer is allowed to reference. Session/workspace switching
// adds entries; the oldest entry is evicted so the set stays tiny.
const viewableWorkspaces = new Set();
const VIEWABLE_WORKSPACE_LIMIT = 8;
function workspaceKey(workspace) {
    const absolute = resolve(workspace);
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}
function rememberWorkspace(workspace) {
    if (!workspace)
        return;
    try {
        viewableWorkspaces.add(workspaceKey(workspace));
        if (viewableWorkspaces.size > VIEWABLE_WORKSPACE_LIMIT) {
            const oldest = viewableWorkspaces.values().next().value;
            if (oldest)
                viewableWorkspaces.delete(oldest);
        }
    }
    catch {
        // An unusable path is simply not registered.
    }
}
/**
 * Resolve a requested screenshot path to a readable file inside the canonical
 * `workspace/.tbot/screenshots` directory. Rejects unknown workspaces, lexical
 * or canonical escapes, symbolic links and non-image files.
 */
export async function resolveScreenshotFile(workspace, requestedPath) {
    if (!workspace || !requestedPath)
        throw new Error('Screenshot path is required.');
    if (requestedPath.length > 4096 || workspace.length > 4096)
        throw new Error('Screenshot path is too long.');
    const lexicalWorkspace = resolve(workspace);
    if (!viewableWorkspaces.has(workspaceKey(lexicalWorkspace)))
        throw new Error('Workspace is not viewable.');
    const target = resolve(requestedPath);
    const lexicalRelative = relative(lexicalWorkspace, target);
    if (!lexicalRelative || lexicalRelative === '..' || lexicalRelative.startsWith(`..${sep}`) || isAbsolute(lexicalRelative)) {
        throw new Error('Screenshot must stay inside the workspace.');
    }
    const segments = lexicalRelative.split(sep);
    if (segments.length !== 3 || segments[0].toLowerCase() !== '.tbot' || segments[1].toLowerCase() !== 'screenshots') {
        throw new Error('Screenshot must live in .tbot/screenshots.');
    }
    const contentType = SCREENSHOT_MIME[extname(target).toLowerCase()];
    if (!contentType)
        throw new Error('Unsupported screenshot type.');
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile())
        throw new Error('Screenshot must be a regular file.');
    const canonicalRoot = await realpath(lexicalWorkspace);
    const stateDirectory = join(lexicalWorkspace, '.tbot');
    const screenshotDirectory = join(stateDirectory, 'screenshots');
    for (const directory of [stateDirectory, screenshotDirectory]) {
        const directoryInfo = await lstat(directory);
        if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
            throw new Error('Screenshot directory cannot use symbolic links or junctions.');
        }
    }
    const canonicalDirectory = await realpath(screenshotDirectory);
    const directoryRelative = relative(canonicalRoot, canonicalDirectory);
    if (!directoryRelative || directoryRelative === '..' || directoryRelative.startsWith(`..${sep}`) || isAbsolute(directoryRelative)) {
        throw new Error('Screenshot directory must stay inside the workspace.');
    }
    const canonicalTarget = await realpath(target);
    const canonicalRelative = relative(canonicalDirectory, canonicalTarget);
    if (!canonicalRelative || canonicalRelative === '..' || canonicalRelative.startsWith(`..${sep}`)
        || isAbsolute(canonicalRelative) || canonicalRelative.includes(sep)) {
        throw new Error('Screenshot must stay inside the workspace.');
    }
    return { path: canonicalTarget, contentType };
}
function registerScreenshotProtocol() {
    protocol.handle('tbot-file', async (request) => {
        try {
            const url = new URL(request.url);
            if (url.hostname !== 'shot')
                return new Response('Not found', { status: 404 });
            const file = await resolveScreenshotFile(url.searchParams.get('workspace') || '', url.searchParams.get('path') || '');
            const data = await readFile(file.path);
            return new Response(data, {
                status: 200,
                headers: {
                    'content-type': file.contentType,
                    'cache-control': 'no-store',
                    'x-content-type-options': 'nosniff',
                },
            });
        }
        catch (error) {
            const forbidden = error instanceof Error && /viewable/i.test(error.message);
            return new Response(forbidden ? 'Forbidden' : 'Not found', { status: forbidden ? 403 : 404 });
        }
    });
}
/** Real-file smoke check for the screenshot protocol, used by --headless-verify. */
async function smokeScreenshotProtocol() {
    const root = join(tmpdir(), `tbot-protocol-smoke-${randomUUID()}`);
    const directory = join(root, '.tbot', 'screenshots');
    try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
        const allowedPath = join(directory, 'smoke.png');
        const outsidePath = join(root, 'outside.png');
        await writeFile(allowedPath, png);
        await writeFile(outsidePath, png);
        rememberWorkspace(root);
        const allowed = await net.fetch(`tbot-file://shot/?workspace=${encodeURIComponent(root)}&path=${encodeURIComponent(allowedPath)}`);
        const allowedBytes = (await allowed.arrayBuffer()).byteLength;
        const outside = await net.fetch(`tbot-file://shot/?workspace=${encodeURIComponent(root)}&path=${encodeURIComponent(outsidePath)}`);
        const unknownWorkspace = await net.fetch(`tbot-file://shot/?workspace=${encodeURIComponent(join(root, 'other'))}&path=${encodeURIComponent(allowedPath)}`);
        let symlinkStatus = 'skipped';
        try {
            const linkPath = join(directory, 'link.png');
            await symlink(outsidePath, linkPath, 'file');
            const linked = await net.fetch(`tbot-file://shot/?workspace=${encodeURIComponent(root)}&path=${encodeURIComponent(linkPath)}`);
            symlinkStatus = linked.status;
        }
        catch {
            symlinkStatus = 'unavailable';
        }
        return {
            allowedStatus: allowed.status,
            allowedContentType: allowed.headers.get('content-type'),
            allowedBytes,
            outsideWorkspaceStatus: outside.status,
            unregisteredWorkspaceStatus: unknownWorkspace.status,
            symlinkEscapeStatus: symlinkStatus,
        };
    }
    finally {
        await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
}
let mainWindow = null;
let tray = null;
let memoryInterval = null;
let trayHintShownThisRun = false;
const isHeadlessVerify = process.argv.includes('--headless-verify');
let activeTurnContext = null;
let turnInProgress = false;
let turnAbortController = null;
let desktopQuitting = false;
const activeMcpConnections = new Set();
async function closeDesktopMcp(connection) {
    if (!activeMcpConnections.delete(connection))
        return;
    let deadline;
    try {
        await Promise.race([
            Promise.resolve().then(() => connection.close()),
            new Promise(resolve => { deadline = setTimeout(resolve, 5_000); }),
        ]);
    }
    finally {
        clearTimeout(deadline);
    }
}
// Local stdio MCP servers spawn a child process. They are never auto-approved
// by YOLO; the user sees the exact command and cwd. The "always" action records
// a per-service stdio approval that is the only path to silent startup.
const pendingStdioApprovals = new Map();
function settleStdioApprovals(approved = false) {
    for (const resolve of pendingStdioApprovals.values())
        resolve(approved, false);
    pendingStdioApprovals.clear();
}
async function approveMcpStdio(request) {
    if (!mainWindow || mainWindow.isDestroyed())
        return false;
    const requestId = randomUUID();
    return new Promise(resolveApproval => {
        const timer = setTimeout(() => {
            pendingStdioApprovals.delete(requestId);
            resolveApproval(false);
            try {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('agent:approval-expired', { requestId, reason: 'timeout', timeoutMs: 120_000 });
                }
            }
            catch {
                // The request has already failed closed.
            }
        }, 120_000);
        pendingStdioApprovals.set(requestId, (approved, always) => {
            clearTimeout(timer);
            pendingStdioApprovals.delete(requestId);
            if (approved && always) {
                void approveStdioConnection(request.service, true).catch(() => undefined);
            }
            resolveApproval(approved);
        });
        const commandLine = [request.command, ...request.args].join(' ');
        try {
            mainWindow.webContents.send('agent:approval-request', {
                requestId,
                tool: 'mcp_stdio',
                toolTitle: 'MCP Sunucusu (stdio)',
                description: `${request.service} sunucusu yerel bir komut çalıştıracak.\n\nKomut: ${commandLine}\nÇalışma dizini: ${request.cwd}\n\nYalnızca güvendiğiniz sunucuları onaylayın.`,
                arguments: { service: request.service, command: request.command, args: request.args, cwd: request.cwd },
            });
        }
        catch {
            clearTimeout(timer);
            pendingStdioApprovals.delete(requestId);
            resolveApproval(false);
        }
    });
}
if (typeof registerMcpStdioApproval === 'function')
    registerMcpStdioApproval(approveMcpStdio);
registerDesktopQuitCleanup(app, () => {
    desktopQuitting = true;
    settleStdioApprovals(false);
    // Quit already flushed pending checkpoints; cancel once and let the turn
    // persist its partial conversation before resource cleanup finishes.
    const turn = activeTurnContext;
    if (!turn || !turn.abortIssued) {
        if (turn)
            turn.abortIssued = true;
        turnAbortController?.abort();
    }
    for (const resolver of activeTurnContext?.pendingApprovals.values() || [])
        resolver(false);
    activeTurnContext?.pendingApprovals.clear();
    stopAllBackgroundProcesses();
    stopTelegramBotBridge();
    return turn?.settled;
}, async () => {
    await Promise.allSettled([
        Promise.resolve().then(closeBrowser),
        Promise.resolve().then(closeIdleDesktopDaemon),
        ...Array.from(activeMcpConnections, closeDesktopMcp),
    ]);
}, 5_000, () => activeTurnContext?.flush() ?? Promise.resolve(), 3_000);
/** Installed launches start in the user's home, never an installation directory. */
export function getDefaultWorkspace() {
    const cwd = process.cwd();
    const lowerCwd = cwd.toLowerCase();
    const workspace = app.isPackaged || lowerCwd.includes('appdata') || lowerCwd.includes('programs')
        ? homedir()
        : cwd;
    rememberWorkspace(workspace);
    return workspace;
}
/** The single telemetry shape sent to every renderer surface. */
export function composeDesktopTelemetry() {
    const stats = getDesktopMemoryStats(mainWindow || undefined);
    const telemetry = { ...stats };
    try {
        if (typeof globalTokenTracker !== 'undefined' && globalTokenTracker) {
            const report = globalTokenTracker.getReport();
            telemetry.savingsPercent = Number(report?.savingsPercent || 0);
            telemetry.savedTokens = Number(report?.totalSavedTokens || 0);
        }
    }
    catch { /* Token telemetry is best effort. */ }
    try {
        if (typeof getGroundingStatus === 'function') {
            const grounding = getGroundingStatus();
            telemetry.groundedStatus = grounding?.verified
                ? 'Doğrulandı'
                : (grounding?.warnings?.length ? `${grounding.warnings.length} uyarı` : 'Kanıtsız');
            telemetry.grounding = grounding;
        }
    }
    catch { /* Grounding telemetry is best effort. */ }
    try {
        if (typeof totalmem === 'function' && typeof freemem === 'function') {
            const total = totalmem();
            if (total > 0)
                telemetry.systemUsedPercent = Math.round(((total - freemem()) / total) * 100);
        }
    }
    catch { /* System memory is optional. */ }
    return telemetry;
}
function getAppIconPath() {
    const candidates = [
        join(__dirname, '../../build/icon.ico'),
        join(__dirname, '../../assets/icon.ico'),
        join(__dirname, '../../assets/icon.png'),
        join(__dirname, '../../build/icon.png'),
        join(process.resourcesPath, 'build/icon.ico'),
        join(process.resourcesPath, 'assets/icon.ico'),
        join(process.resourcesPath, 'assets/icon.png'),
        join(app.getAppPath(), 'build/icon.ico'),
        join(app.getAppPath(), 'assets/icon.ico'),
        join(app.getAppPath(), 'assets/icon.png'),
    ];
    for (const c of candidates) {
        if (c && existsSync(c)) {
            return c;
        }
    }
    return undefined;
}
function createMainWindow() {
    const iconPath = getAppIconPath();
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 760,
        minHeight: 560,
        frame: false,
        backgroundColor: '#0a0f0b',
        show: !isHeadlessVerify,
        icon: iconPath,
        webPreferences: {
            preload: join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: false,
            backgroundThrottling: true,
        },
    });
    // The bridge belongs exclusively to the bundled local document.
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', event => event.preventDefault());
    mainWindow.webContents.on('render-process-gone', () => {
        const turn = activeTurnContext;
        if (turn && !turn.abortIssued) {
            turn.abortIssued = true;
            turnAbortController?.abort();
        }
        else if (!turn) {
            turnAbortController?.abort();
        }
        for (const resolver of activeTurnContext?.pendingApprovals.values() || [])
            resolver(false);
        activeTurnContext?.pendingApprovals.clear();
        settleStdioApprovals(false);
    });
    mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    const rendererPath = join(__dirname, 'renderer', 'index.html');
    if (existsSync(rendererPath)) {
        mainWindow.loadFile(rendererPath);
    }
    else {
        // Elegant fallback screen until renderer is compiled or copied
        mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
      <!DOCTYPE html>
      <html lang="tr">
      <head>
        <meta charset="UTF-8">
        <title>T Bot</title>
        <style>
          body { margin:0; background:#0a0f0b; color:#edf5ea; font-family:system-ui,-apple-system,sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; flex-direction:column; gap:16px; user-select:none; }
          .spinner { width:36px; height:36px; border:3px solid #223126; border-top-color:#9be33d; border-radius:50%; animation:spin 0.9s linear infinite; }
          @keyframes spin { to { transform:rotate(360deg); } }
          .title { font-weight:600; font-size:18px; color:#9be33d; }
          .sub { font-size:13px; color:#93a68d; }
        </style>
      </head>
      <body>
        <div class="spinner"></div>
        <div class="title">T Bot başlatılıyor...</div>
        <div class="sub">Arayüz bileşenleri yükleniyor</div>
      </body>
      </html>
    `)}`);
    }
    // Closing the window is a hide, not a quit: the tray keeps the agent alive.
    // A running turn still gets a bounded chance to persist its partial messages
    // and is cancelled before the window is hidden.
    let closeFlushRunning = false;
    mainWindow.on('close', event => {
        if (desktopQuitting)
            return;
        const turn = activeTurnContext;
        if (!turn) {
            if (!tray)
                return; // Without a tray an invisible window would be unreachable.
            event.preventDefault();
            hideMainWindowToTray();
            return;
        }
        event.preventDefault();
        if (closeFlushRunning)
            return;
        closeFlushRunning = true;
        void (async () => {
            let flushDeadline;
            await Promise.race([
                Promise.resolve().then(() => turn.flush()).catch(() => undefined),
                new Promise(resolve => { flushDeadline = setTimeout(resolve, 3_000); }),
            ]);
            if (flushDeadline)
                clearTimeout(flushDeadline);
            if (!turn.abortIssued) {
                turn.abortIssued = true;
                turnAbortController?.abort();
            }
            for (const resolver of turn.pendingApprovals.values())
                resolver(false);
            turn.pendingApprovals.clear();
            settleStdioApprovals(false);
            let settleDeadline;
            await Promise.race([
                turn.settled.catch(() => undefined),
                new Promise(resolve => { settleDeadline = setTimeout(resolve, 2_000); }),
            ]);
            if (settleDeadline)
                clearTimeout(settleDeadline);
            closeFlushRunning = false;
            if (mainWindow && !mainWindow.isDestroyed()) {
                if (tray)
                    hideMainWindowToTray();
                else
                    mainWindow.destroy();
            }
        })().catch(() => {
            closeFlushRunning = false;
            if (mainWindow && !mainWindow.isDestroyed()) {
                if (tray)
                    hideMainWindowToTray();
                else
                    mainWindow.destroy();
            }
        });
    });
    mainWindow.on('closed', () => {
        const turn = activeTurnContext;
        if (turn && !turn.abortIssued) {
            turn.abortIssued = true;
            turnAbortController?.abort();
        }
        else if (!turn) {
            turnAbortController?.abort();
        }
        for (const resolver of activeTurnContext?.pendingApprovals.values() || [])
            resolver(false);
        settleStdioApprovals(false);
        mainWindow = null;
    });
    return mainWindow;
}
function createTray() {
    if (tray || isHeadlessVerify)
        return;
    try {
        const iconPath = getAppIconPath();
        let trayIcon;
        if (iconPath && existsSync(iconPath)) {
            trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
        }
        else {
            trayIcon = nativeImage.createEmpty();
        }
        tray = new Tray(trayIcon);
        tray.setToolTip(`T Bot ${app.getVersion()} Desktop`);
        const contextMenu = Menu.buildFromTemplate([
            {
                label: 'T Bot Penceresini Göster / Gizle',
                click: () => toggleWindowVisibility(),
            },
            {
                label: 'Belleği Şimdi Temizle (Trim RAM)',
                click: async () => {
                    await trimDesktopMemory(mainWindow || undefined, true);
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        const stats = composeDesktopTelemetry();
                        mainWindow.webContents.send('sys:memory-update', stats);
                    }
                },
            },
            { type: 'separator' },
            {
                label: 'Çıkış (Uygulamayı Kapat)',
                click: () => {
                    app.quit();
                },
            },
        ]);
        tray.setContextMenu(contextMenu);
        tray.on('click', () => toggleWindowVisibility());
    }
    catch {
        // Tray creation error ignored
    }
}
function toggleWindowVisibility() {
    if (!mainWindow)
        return;
    if (mainWindow.isVisible()) {
        if (mainWindow.isFocused()) {
            mainWindow.hide();
        }
        else {
            mainWindow.focus();
        }
    }
    else {
        mainWindow.show();
        mainWindow.focus();
    }
}
function markTrayHintShown() {
    if (trayHintShownThisRun)
        return false;
    trayHintShownThisRun = true;
    const marker = join(configDirectory(), 'desktop-tray-hint');
    try {
        if (existsSync(marker))
            return false;
        void writeFile(marker, '1\n', { mode: 0o600 }).catch(() => undefined);
        return true;
    }
    catch {
        return true;
    }
}
/** Closing the window keeps the agent alive in the system tray. */
function hideMainWindowToTray() {
    if (!mainWindow || mainWindow.isDestroyed())
        return;
    mainWindow.hide();
    if (!markTrayHintShown())
        return;
    try {
        const notifier = tray;
        notifier?.displayBalloon?.({
            title: 'T Bot arka planda çalışıyor',
            content: 'Pencereyi kapatmak uygulamayı sonlandırmaz. Tamamen çıkmak için sistem tepsisindeki menüden “Çıkış”ı seçin.',
            iconType: 'info',
        });
    }
    catch {
        // Balloons are optional on some Windows configurations.
    }
}
function registerIpcHandlers() {
    // Reject subframes and documents other than our own renderer for every handler.
    const handle = (channel, listener) => {
        ipcMain.handle(channel, (event, ...args) => {
            if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
                throw new Error('Güvenilmeyen arayüz isteği.');
            }
            return listener(event, ...args);
        });
    };
    // One telemetry shape for every renderer surface. The typeof guard lets
    // isolated host harnesses transpile this function without module helpers.
    const readTelemetry = () => {
        if (typeof composeDesktopTelemetry === 'function')
            return composeDesktopTelemetry();
        return { ...getDesktopMemoryStats(mainWindow || undefined) };
    };
    const publishGrounding = () => {
        if (!mainWindow || mainWindow.isDestroyed())
            return;
        try {
            if (typeof getGroundingStatus !== 'function')
                return;
            mainWindow.webContents.send('sys:grounding', getGroundingStatus());
        }
        catch { /* HUD grounding is cosmetic. */ }
    };
    // Approval attention helpers: a hidden or unfocused window still needs to
    // tell the user that a tool is blocked. Fail-closed is preserved; visibility
    // is best-effort and never blocks the decision path.
    const setApprovalTaskbarIndicator = (active) => {
        try {
            if (mainWindow && !mainWindow.isDestroyed() && typeof mainWindow.setProgressBar === 'function') {
                if (active)
                    mainWindow.setProgressBar(2, { mode: 'indeterminate' });
                else
                    mainWindow.setProgressBar(-1);
            }
        }
        catch { /* Taskbar indicator is cosmetic. */ }
    };
    const signalApprovalNeeded = (title, body) => {
        try {
            if (mainWindow && !mainWindow.isDestroyed()) {
                const hidden = typeof mainWindow.isVisible === 'function' && !mainWindow.isVisible();
                const unfocused = typeof mainWindow.isFocused === 'function' && !mainWindow.isFocused();
                if ((hidden || unfocused) && typeof mainWindow.flashFrame === 'function')
                    mainWindow.flashFrame(true);
            }
        }
        catch { /* Flashing is cosmetic. */ }
        try {
            const notifier = tray;
            if (notifier && typeof notifier.displayBalloon === 'function') {
                notifier.displayBalloon({ title, content: body, iconType: 'warning' });
            }
        }
        catch { /* Tray balloons are unavailable on some platforms. */ }
        setApprovalTaskbarIndicator(true);
    };
    const clearApprovalIndicators = () => {
        try {
            if (mainWindow && !mainWindow.isDestroyed() && typeof mainWindow.flashFrame === 'function')
                mainWindow.flashFrame(false);
        }
        catch { /* Cosmetic. */ }
        setApprovalTaskbarIndicator(false);
    };
    // Window control: minimize, maximize, close, isMaximized
    handle('window:control', (_event, action) => {
        if (!mainWindow || mainWindow.isDestroyed())
            return false;
        switch (action) {
            case 'minimize':
                mainWindow.minimize();
                return true;
            case 'maximize':
                if (mainWindow.isMaximized()) {
                    mainWindow.unmaximize();
                }
                else {
                    mainWindow.maximize();
                }
                return mainWindow.isMaximized();
            case 'toggle-pin':
                mainWindow.setAlwaysOnTop(!mainWindow.isAlwaysOnTop());
                return mainWindow.isAlwaysOnTop();
            case 'close':
                mainWindow.close();
                return true;
            case 'isMaximized':
                return mainWindow.isMaximized();
            default:
                return false;
        }
    });
    // Config handlers
    handle('config:get', async () => {
        const config = await loadConfig();
        let hasApiKey = false;
        try {
            hasApiKey = Boolean((await resolveProviderConfig(config)).apiKey);
        }
        catch { /* config error is surfaced by doctor/start-turn */ }
        const requiresApiKey = Boolean(PROVIDER_CATALOG.find(provider => provider.id === config.provider)?.requiresApiKey);
        return {
            config,
            appVersion: app.getVersion(),
            hasApiKey,
            requiresApiKey,
            providerSpec: PROVIDER_CATALOG.find(provider => provider.id === config.provider),
        };
    });
    handle('config:save', async (_event, partialConfig) => {
        const current = await loadConfig();
        // Preserve the loaded object's revision token used by optimistic config writes.
        if (typeof partialConfig?.provider === 'string' && partialConfig.provider !== current.provider) {
            current.provider = partialConfig.provider;
            delete current.baseUrl;
        }
        if (typeof partialConfig?.model === 'string')
            current.model = partialConfig.model;
        if (typeof partialConfig?.baseUrl === 'string') {
            if (partialConfig.baseUrl.trim())
                current.baseUrl = partialConfig.baseUrl.trim();
            else
                delete current.baseUrl;
        }
        if (partialConfig?.guiMode === 'live' || partialConfig?.guiMode === 'headless') {
            current.guiMode = partialConfig.guiMode;
            if (partialConfig.guiMode === 'headless')
                process.env.TBOT_HEADLESS = 'true';
            else
                delete process.env.TBOT_HEADLESS;
        }
        if (Array.isArray(partialConfig?.telegramAllowedChatIds)) {
            current.telegramAllowedChatIds = partialConfig.telegramAllowedChatIds.filter(value => typeof value === 'string');
        }
        if (partialConfig?.efforts && typeof partialConfig.efforts === 'object') {
            current.efforts = { ...current.efforts, ...partialConfig.efforts };
        }
        await saveConfig(current);
        return current;
    });
    handle('config:set-api-key', async (_event, { provider, apiKey }) => {
        if (typeof provider !== 'string' || !provider.trim() || typeof apiKey !== 'string') {
            return { error: 'Geçersiz sağlayıcı veya API anahtarı.' };
        }
        return await storeProviderApiKey(provider.trim(), apiKey);
    });
    handle('config:model-catalog', async (_event, providerId) => {
        const config = await loadConfig();
        return await listProviderModels(config, typeof providerId === 'string' ? providerId : undefined);
    });
    // Workspace handlers
    handle('workspace:select-dialog', async () => {
        if (!mainWindow || mainWindow.isDestroyed())
            return null;
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory', 'createDirectory'],
            title: 'Çalışma Alanı Seç',
        });
        if (result.canceled || !result.filePaths.length)
            return null;
        rememberWorkspace(result.filePaths[0]);
        return result.filePaths[0];
    });
    // Only http(s) links from the transcript are handed to the OS browser.
    handle('shell:open-external', async (_event, targetUrl) => {
        if (typeof targetUrl !== 'string' || !targetUrl || targetUrl.length > 2048)
            return false;
        let parsed;
        try {
            parsed = new URL(targetUrl);
        }
        catch {
            return false;
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
            return false;
        if (parsed.username || parsed.password)
            return false;
        await shell.openExternal(parsed.toString());
        return true;
    });
    handle('workspace:default', () => getDefaultWorkspace());
    // Sessions handlers
    handle('sessions:list', async (_event, workspace) => {
        const store = new SessionStore(configDirectory());
        return await store.list(workspace || getDefaultWorkspace());
    });
    handle('sessions:load', async (_event, { sessionId, workspace }) => {
        const store = new SessionStore(configDirectory());
        return await store.get(sessionId, workspace || getDefaultWorkspace());
    });
    handle('sessions:delete', async (_event, { sessionId, workspace }) => {
        if (activeTurnContext?.sessionId === sessionId)
            throw new Error('Çalışan oturum silinemez.');
        const store = new SessionStore(configDirectory());
        return await store.delete(sessionId, workspace || getDefaultWorkspace());
    });
    handle('sessions:create', async (_event, { workspace, title }) => {
        const resolvedWorkspace = resolve(workspace || getDefaultWorkspace());
        const session = createSession(resolvedWorkspace);
        const store = new SessionStore(configDirectory());
        const saved = await store.save(session);
        return saved?.warning ? { ...session, warning: saved.warning } : session;
    });
    // Real conversation reset: an empty history is persisted so the next turn
    // cannot reload the previous session.messages from disk.
    handle('sessions:clear', async (_event, { sessionId, workspace }) => {
        const resolvedWorkspace = resolve(workspace || getDefaultWorkspace());
        if (sessionId && activeTurnContext?.sessionId === sessionId) {
            throw new Error('Çalışan oturum temizlenemez; önce turu durdurun.');
        }
        const store = new SessionStore(configDirectory());
        let session;
        if (sessionId) {
            const existing = await store.get(sessionId, resolvedWorkspace);
            if (!existing)
                return { ok: false, error: 'Seçili oturum bulunamadı. Oturum listesini yenileyin.' };
            session = existing;
        }
        else {
            session = createSession(resolvedWorkspace);
        }
        session.messages = [];
        session.updatedAt = new Date().toISOString();
        const saved = await store.save(session);
        return {
            ok: true,
            session: { id: session.id, workspace: session.workspace, createdAt: session.createdAt, updatedAt: session.updatedAt, messages: [] },
            ...(saved?.warning ? { warning: saved.warning } : {}),
        };
    });
    // Bounded history pages keep the full transcript out of a single IPC payload.
    handle('sessions:messages', async (_event, { sessionId, workspace, offset, limit }) => {
        const resolvedWorkspace = resolve(workspace || getDefaultWorkspace());
        if (!sessionId)
            return { messages: [], total: 0, offset: 0, limit: 0 };
        const store = new SessionStore(configDirectory());
        const session = await store.get(sessionId, resolvedWorkspace);
        if (!session)
            return { messages: [], total: 0, offset: 0, limit: 0, error: 'Oturum bulunamadı.' };
        const total = session.messages.length;
        const safeLimit = Math.max(1, Math.min(200, Number.isFinite(limit) ? Number(limit) : 40));
        const requested = Number.isFinite(offset) ? Number(offset) : -1;
        const start = requested < 0 ? Math.max(0, total - safeLimit) : Math.max(0, Math.min(total, requested));
        return { messages: session.messages.slice(start, start + safeLimit), total, offset: start, limit: safeLimit };
    });
    // Workflows handlers
    handle('workflows:get-state', async (_event, workspace) => {
        const resolvedWorkspace = resolve(workspace || getDefaultWorkspace());
        const goal = await getGoal(resolvedWorkspace).catch(() => undefined);
        const todos = await getTodos(resolvedWorkspace).catch(() => []);
        const focusSummary = getActiveFocusSummary(resolvedWorkspace);
        return { goal, todos, focusSummary };
    });
    handle('workflows:manage', async (_event, { toolName, args, workspace }) => {
        const resolvedWorkspace = resolve(workspace || getDefaultWorkspace());
        return await executeWorkflowTool(toolName, args, resolvedWorkspace);
    });
    // System & Skills & MCP
    handle('sys:skills-mcp', async (_event, workspace) => {
        const resolvedWorkspace = resolve(workspace || getDefaultWorkspace());
        const customSkills = loadCustomSkills(resolvedWorkspace);
        const mcpConnections = await loadConnections().catch(() => ({}));
        const visibleBuiltinSkills = BUILTIN_SKILLS.filter(skill => !skill.hidden);
        return {
            builtinSkills: visibleBuiltinSkills,
            customSkills,
            skills: [...visibleBuiltinSkills, ...customSkills],
            mcpPresets: MCP_PRESETS,
            mcpConnections,
        };
    });
    handle('mcp:list', async () => {
        const connections = await loadConnections().catch(() => ({}));
        const rows = await Promise.all(MCP_PRESETS.map(async (preset) => ({
            ...preset,
            enabled: Boolean(connections[preset.id]?.enabled),
            hasToken: Boolean(await getMcpToken(preset.id).catch(() => undefined)),
        })));
        return { presets: rows };
    });
    handle('mcp:connect', async (_event, { service, token, workspace } = {}) => {
        if (typeof service !== 'string' || !MCP_PRESETS.some(preset => preset.id === service)) {
            return { ok: false, error: 'Geçersiz MCP servisi.' };
        }
        const resolvedWorkspace = resolve(workspace || getDefaultWorkspace());
        const existing = (await loadConnections().catch(() => ({})))[service] || {};
        let accessToken = typeof token === 'string' && token.trim() ? token.trim() : await getMcpToken(service);
        if (!accessToken)
            return { ok: false, error: 'Bu MCP servisi için erişim tokenı gerekli.' };
        const connection = await connectMcp(service, accessToken, { ...existing, workspace: resolvedWorkspace, signal: AbortSignal.timeout(15_000) });
        let warning;
        try {
            if (typeof token === 'string' && token.trim()) {
                const stored = await setMcpToken(service, token.trim());
                warning = stored.warning;
            }
            await saveConnection(service, { enabled: true, readOnly: false });
            return { ok: true, tools: connection.definitions.length, ...(warning ? { warning } : {}) };
        }
        finally {
            await connection.close().catch(() => undefined);
        }
    });
    handle('mcp:remove', async (_event, { service } = {}) => {
        if (typeof service !== 'string' || !MCP_PRESETS.some(preset => preset.id === service)) {
            return { ok: false, error: 'Geçersiz MCP servisi.' };
        }
        await removeConnection(service);
        return { ok: true };
    });
    handle('sys:doctor', async (_event, workspace) => {
        const resolvedWorkspace = resolve(workspace || getDefaultWorkspace());
        const config = await loadConfig();
        let hasApiKey = false;
        try {
            const resolved = await resolveProviderConfig(config, resolvedWorkspace);
            hasApiKey = Boolean(resolved?.apiKey);
        }
        catch { }
        const memoryStats = readTelemetry();
        return {
            nodeVersion: process.version,
            electronVersion: process.versions.electron,
            chromeVersion: process.versions.chrome,
            v8Version: process.versions.v8,
            platform: process.platform,
            arch: process.arch,
            workspace: resolvedWorkspace,
            configDir: configDirectory(),
            provider: config.provider,
            model: config.model,
            hasApiKey,
            sandbox: sandboxStatus(),
            memoryStats,
            uptimeSeconds: Math.round(process.uptime()),
        };
    });
    handle('sys:mem-stats', () => {
        return readTelemetry();
    });
    handle('sys:grounding', () => {
        try {
            return typeof getGroundingStatus === 'function' ? getGroundingStatus() : null;
        }
        catch {
            return null;
        }
    });
    handle('checkpoints:list', async (_event, workspace) => {
        const resolvedWorkspace = resolve(workspace || getDefaultWorkspace());
        return await listCheckpoints(resolvedWorkspace, 20);
    });
    handle('checkpoints:restore', async (_event, { workspace, id, confirmed } = {}) => {
        if (confirmed !== true)
            return { ok: false, error: 'Geri yükleme kullanıcı onayı gerektirir.' };
        if (typeof id !== 'string' || !id.trim())
            return { ok: false, error: 'Checkpoint kimliği gerekli.' };
        const resolvedWorkspace = resolve(workspace || getDefaultWorkspace());
        try {
            const restored = await restoreCheckpoint(resolvedWorkspace, id.trim());
            return { ok: true, ...restored };
        }
        catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    // Shared command catalog: the renderer must not maintain a second, stale list.
    handle('bot:status', () => getTelegramBotStatus());
    handle('bot:start', async (_event, workspace) => {
        const resolvedWorkspace = resolve(workspace || getDefaultWorkspace());
        const token = await getCustomSecret('telegram_bot_token');
        if (!token?.trim()) {
            return { ok: false, error: 'Telegram bot tokenı yok. Önce /bot token <TOKEN> ile kaydedin.' };
        }
        const config = await loadConfig();
        const bridgeSession = createSession(resolvedWorkspace);
        return await startTelegramBotBridge({
            config: config,
            session: bridgeSession,
            workspace: resolvedWorkspace,
            getYolo: () => getWorkspacePermission(config, resolvedWorkspace) === 'allow',
            mcpTools: [],
            onLog: text => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('agent:event', { type: 'status', message: text });
                }
            },
        });
    });
    handle('bot:stop', () => {
        stopTelegramBotBridge();
        return { ok: true, ...getTelegramBotStatus() };
    });
    handle('bot:set-token', async (_event, { token, workspace } = {}) => {
        if (typeof token !== 'string' || !token.trim())
            return { ok: false, error: 'Bot tokenı boş olamaz.' };
        const prepared = prepareApiKey(token);
        await setCustomSecret('telegram_bot_token', prepared);
        const config = await loadConfig();
        config.telegramBotToken = true;
        await saveConfig(config);
        return { ok: true, workspace };
    });
    handle('bot:allow', async (_event, { chatId } = {}) => {
        if (typeof chatId !== 'string' || !chatId.trim())
            return { ok: false, error: 'Chat ID gerekli.' };
        const config = await loadConfig();
        const allowed = Array.isArray(config.telegramAllowedChatIds) ? [...config.telegramAllowedChatIds] : [];
        if (!allowed.includes(chatId.trim()))
            allowed.push(chatId.trim());
        config.telegramAllowedChatIds = allowed;
        await saveConfig(config);
        return { ok: true, allowed };
    });
    handle('commands:list', () => ({
        available: commandCatalog('desktop'),
        unavailable: commandsFor('cli')
            .filter(command => !command.surfaces.includes('desktop'))
            .map(command => ({ name: command.name, description: command.description })),
    }));
    handle('commands:help', () => helpFor('desktop'));
    handle('sys:tool-titles', () => TOOL_TITLE_MAP);
    handle('sys:token-report', () => globalTokenTracker.getReport());
    handle('sys:memory-facts', async (_event, workspace) => {
        const resolvedWorkspace = resolve(workspace || getDefaultWorkspace());
        return await recallFacts(resolvedWorkspace);
    });
    handle('sys:remember-fact', async (_event, { workspace, key, value } = {}) => {
        const resolvedWorkspace = resolve(workspace || getDefaultWorkspace());
        if (typeof key !== 'string' || !key.trim() || typeof value !== 'string' || !value.trim()) {
            return { ok: false, error: 'Anahtar ve değer boş olamaz.' };
        }
        if (key.length > 200 || value.length > 10_000) {
            return { ok: false, error: 'Anahtar veya değer izin verilen sınırı aşıyor.' };
        }
        await rememberFact(resolvedWorkspace, key.trim(), value.trim(), 'project');
        return { ok: true, key: key.trim() };
    });
    handle('sys:forget-fact', async (_event, { workspace, key } = {}) => {
        const resolvedWorkspace = resolve(workspace || getDefaultWorkspace());
        if (typeof key !== 'string' || !key.trim())
            return { ok: false, error: 'Silinecek anahtar gerekli.' };
        if (key.length > 200)
            return { ok: false, error: 'Anahtar izin verilen sınırı aşıyor.' };
        const removed = await forgetFact(resolvedWorkspace, key.trim());
        return { ok: removed, key: key.trim() };
    });
    handle('sys:trim-memory', async () => {
        const result = await trimDesktopMemory(mainWindow || undefined, true);
        const stats = readTelemetry();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('sys:memory-update', stats);
        }
        return { result, stats };
    });
    handle('gui:set-mode', async (_event, mode) => {
        if (mode === 'stop') {
            await closeBrowser().catch(() => undefined);
            stopAllBackgroundProcesses();
            return { ok: true, mode: 'live', message: 'Tarayıcı ve arka plan süreçleri durduruldu.' };
        }
        if (mode !== 'live' && mode !== 'headless') {
            return { ok: false, error: 'Kullanım: /gui [live|headless|stop]' };
        }
        const config = await loadConfig();
        config.guiMode = mode;
        await saveConfig(config);
        if (mode === 'headless')
            process.env.TBOT_HEADLESS = 'true';
        else
            delete process.env.TBOT_HEADLESS;
        return { ok: true, mode, message: mode === 'headless' ? 'Tarayıcı arka planda çalışacak.' : 'Tarayıcı görünür modda çalışacak.' };
    });
    // Agent turn execution & approvals
    handle('agent:approval-response', (_event, { requestId, approved, alwaysAllowSession }) => {
        // `pendingStdioApprovals` is part of the host approval registry. The typeof
        // guard keeps isolated host harnesses (which transpile this function alone)
        // working without the module's registry.
        const stdioResolver = typeof pendingStdioApprovals !== 'undefined'
            ? pendingStdioApprovals.get(requestId)
            : undefined;
        if (stdioResolver) {
            stdioResolver(approved === true, alwaysAllowSession === true);
            return { handled: true };
        }
        if (!activeTurnContext) {
            return { handled: false, error: 'Aktif bir çalışan tur bulunmuyor.' };
        }
        const resolver = activeTurnContext.pendingApprovals.get(requestId);
        if (resolver) {
            if (approved === true && alwaysAllowSession === true)
                activeTurnContext.alwaysAllowSession = true;
            activeTurnContext.pendingApprovals.delete(requestId);
            resolver(approved === true);
            return { handled: true };
        }
        return { handled: false, error: 'Onay isteği bulunamadı veya süresi doldu.' };
    });
    // Single source of truth for the effective approval mode shown in the UI.
    handle('agent:approval-policy', async (_event, { workspace, yolo } = {}) => {
        const resolvedWorkspace = resolve(workspace || getDefaultWorkspace());
        const config = await loadConfig();
        const workspacePermission = getWorkspacePermission(config, resolvedWorkspace);
        const turnActive = Boolean(activeTurnContext);
        const turnYolo = activeTurnContext?.yolo === true;
        const effectiveAuto = yolo === true || workspacePermission === 'allow' || turnYolo || activeTurnContext?.alwaysAllowSession === true;
        return { workspacePermission, turnActive, turnYolo, effectiveAuto };
    });
    // Lets the renderer change the running turn's policy; the turn reads this
    // live value for every approval, so turning YOLO off mid-turn takes effect.
    handle('agent:set-turn-policy', (_event, { yolo } = {}) => {
        if (!activeTurnContext)
            return { updated: false, reason: 'Aktif bir çalışan tur bulunmuyor.' };
        activeTurnContext.yolo = yolo === true;
        return { updated: true, yolo: activeTurnContext.yolo };
    });
    // `/yolo always|ask` persists (or clears) the workspace-wide approval. This
    // is the only renderer path that writes a workspace permission.
    handle('agent:set-workspace-permission', async (_event, { workspace, permission } = {}) => {
        if (permission !== 'allow' && permission !== 'ask') {
            return { ok: false, error: 'Geçersiz izin. "allow" veya "ask" bekleniyor.' };
        }
        const resolvedWorkspace = resolve(workspace || getDefaultWorkspace());
        const config = await loadConfig();
        setWorkspacePermission(config, resolvedWorkspace, permission);
        await saveConfig(config);
        if (activeTurnContext)
            activeTurnContext.alwaysAllowSession = permission === 'allow';
        return {
            ok: true,
            workspace: resolvedWorkspace,
            workspacePermission: permission,
            effectiveAuto: permission === 'allow',
        };
    });
    handle('agent:abort-turn', () => {
        if (typeof settleStdioApprovals === 'function')
            settleStdioApprovals(false);
        const turn = activeTurnContext;
        if (turn) {
            if (!turn.abortIssued) {
                turn.abortIssued = true;
                turn.abortController.abort();
                turnAbortController?.abort();
            }
            for (const [, resolver] of turn.pendingApprovals) {
                resolver(false);
            }
            turn.pendingApprovals.clear();
            clearApprovalIndicators();
            return { aborted: true };
        }
        clearApprovalIndicators();
        return { aborted: turnInProgress };
    });
    handle('agent:start-turn', async (_event, payload) => {
        if (desktopQuitting)
            return { ok: false, error: 'Uygulama kapanıyor.' };
        if (turnInProgress)
            return { ok: false, error: 'Önce çalışan turu durdurun veya tamamlanmasını bekleyin.' };
        if (!payload || typeof payload.message !== 'string' || payload.message.length > 500_000) {
            return { ok: false, error: 'Geçersiz veya çok uzun mesaj.' };
        }
        if (payload.images && (!Array.isArray(payload.images) || payload.images.length > 3 || payload.images.some(image => image?.mimeType !== 'image/png' || typeof image.data !== 'string' || image.data.length > 2_000_000 || !/^[A-Za-z0-9+/=]+$/.test(image.data)))) {
            return { ok: false, error: 'Geçersiz görsel eki. En fazla 3 görsel, her biri en fazla 2 MB base64 veri içerebilir.' };
        }
        turnInProgress = true;
        const abortController = new AbortController();
        turnAbortController = abortController;
        let settleTurn;
        const turnSettled = new Promise(resolve => { settleTurn = resolve; });
        try {
            const targetWorkspace = resolve(payload.workspace || getDefaultWorkspace());
            if (!statSync(targetWorkspace).isDirectory())
                return { ok: false, error: 'Çalışma alanı bir klasör olmalıdır.' };
            if (typeof rememberWorkspace === 'function')
                rememberWorkspace(targetWorkspace);
            const store = new SessionStore(configDirectory());
            let session;
            if (payload.sessionId) {
                try {
                    const existing = await store.get(payload.sessionId, targetWorkspace);
                    if (!existing)
                        return { ok: false, sessionId: payload.sessionId, error: 'Seçili oturum bulunamadı. Oturum listesini yenileyin veya yeni bir sohbet oluşturun.' };
                    session = existing;
                }
                catch (error) {
                    return { ok: false, sessionId: payload.sessionId, error: `Oturum yüklenemedi: ${error instanceof Error ? error.message : String(error)}` };
                }
            }
            else {
                session = createSession(targetWorkspace);
            }
            if (abortController.signal.aborted)
                return { ok: false, aborted: true, sessionId: session.id };
            // U0: persist the user's message before provider, MCP or workspace work.
            // A crash or a failed start must never discard a submitted turn.
            const history = [...session.messages];
            const draftUser = {
                role: 'user',
                content: payload.message,
                ...(payload.images?.length ? { images: payload.images } : {}),
            };
            session.messages = [...history, draftUser];
            let saveTarget = session;
            let updatedMessages;
            let checkpointsEnabled = false;
            let checkpointTimer = null;
            let checkpointChain = Promise.resolve();
            let streamText = '';
            // U0: completed tool exchanges are kept for the partial snapshot so an
            // aborted turn persists its user message, half reply and tool results.
            const partialTranscript = [];
            const openToolCalls = new Map();
            const PARTIAL_TOOL_LIMIT = 40;
            const PARTIAL_RESULT_CHARS = 50_000;
            const trimPartialTranscript = () => {
                // Tool exchanges are stored as (call, result) pairs; drop pairs so the
                // partial history never starts with an orphan tool result.
                while (partialTranscript.length > PARTIAL_TOOL_LIMIT * 2)
                    partialTranscript.splice(0, 2);
            };
            const logPersistence = (stage, error) => {
                // Never log message content: session text may contain secrets.
                const detail = error instanceof Error ? error.message : String(error);
                console.error(`[desktop-turn] ${stage} persistence failed: ${detail}`);
            };
            const mergePersistedMessages = (disk, ours) => {
                const key = (message) => `${message.role}\u0000${message.toolCallId || ''}\u0000${message.content}`;
                let index = 0;
                while (index < disk.length && index < ours.length && key(disk[index]) === key(ours[index]))
                    index++;
                if (index === disk.length)
                    return ours;
                if (index === ours.length)
                    return disk;
                // A divergence inside this turn is an older partial snapshot (for
                // example a shorter streamed reply); the in-memory turn is newer.
                if (index >= history.length)
                    return ours;
                return [...disk, ...ours.slice(index)];
            };
            // Session persistence never loses history silently: a budget-trimmed
            // checkpoint is surfaced as a transcript notice exactly once per turn.
            let lastSaveWarning = '';
            const publishSaveWarning = (result) => {
                const warning = result?.warning;
                if (typeof warning !== 'string' || !warning.trim() || warning === lastSaveWarning)
                    return;
                lastSaveWarning = warning;
                if (!mainWindow || mainWindow.isDestroyed())
                    return;
                try {
                    mainWindow.webContents.send('agent:event', { type: 'warning', message: warning });
                }
                catch { /* The notice is best effort. */ }
            };
            const saveTurnMessages = async (messages, stage) => {
                if (typeof store.save !== 'function')
                    return false;
                try {
                    saveTarget.messages = messages;
                    const result = await store.save(saveTarget);
                    publishSaveWarning(result);
                    return true;
                }
                catch (error) {
                    const detail = error instanceof Error ? error.message : String(error);
                    if (!/conflict/i.test(detail)) {
                        logPersistence(stage, error);
                        return false;
                    }
                    // Another writer advanced the session revision. Reload, merge this
                    // turn's newer messages in and retry exactly once.
                    try {
                        const fresh = await store.get(session.id, targetWorkspace);
                        if (!fresh) {
                            logPersistence(stage, error);
                            return false;
                        }
                        fresh.messages = mergePersistedMessages(fresh.messages, messages);
                        const result = await store.save(fresh);
                        publishSaveWarning(result);
                        saveTarget = fresh;
                        return true;
                    }
                    catch (retryError) {
                        logPersistence(`${stage} (retry)`, retryError);
                        return false;
                    }
                }
            };
            const buildPartialMessages = (base = session.messages) => {
                const messages = [...base, ...partialTranscript];
                if (!streamText)
                    return messages;
                const last = messages[messages.length - 1];
                // The agent pushes the completed round as an assistant message; only
                // keep a synthetic message for text still streaming at crash/abort.
                if (last?.role === 'assistant' && last.content === streamText)
                    return messages;
                return [...messages, { role: 'assistant', content: streamText }];
            };
            const scheduleCheckpoint = () => {
                if (!checkpointsEnabled || desktopQuitting || checkpointTimer)
                    return;
                // Coalesce bursts of streaming/tool events into one bounded write.
                checkpointTimer = setTimeout(() => {
                    checkpointTimer = null;
                    if (!checkpointsEnabled)
                        return;
                    checkpointChain = checkpointChain.then(async () => {
                        if (!checkpointsEnabled)
                            return;
                        await saveTurnMessages(buildPartialMessages(), 'checkpoint');
                    }).catch(() => undefined);
                }, 750);
                try {
                    checkpointTimer.unref?.();
                }
                catch { /* Timer cleanup is best effort. */ }
            };
            // One-shot flush (used by close/quit) does not stop checkpoints while
            // the turn is still running; `stopCheckpoints` is the terminal switch.
            const flushCheckpoints = async (stop = false) => {
                if (stop)
                    checkpointsEnabled = false;
                if (checkpointTimer) {
                    clearTimeout(checkpointTimer);
                    checkpointTimer = null;
                }
                await checkpointChain.catch(() => undefined);
                // A one-shot flush during a still-running turn leaves checkpointing
                // enabled; re-arm when text is pending so close does not pause writes.
                if (!stop && checkpointsEnabled && streamText)
                    scheduleCheckpoint();
            };
            checkpointsEnabled = true;
            const pendingApprovals = new Map();
            activeTurnContext = {
                abortController,
                workspace: targetWorkspace,
                sessionId: session.id,
                session,
                pendingApprovals,
                alwaysAllowSession: false,
                yolo: payload.yolo === true,
                abortIssued: false,
                settled: turnSettled,
                flush: () => flushCheckpoints(false),
            };
            // Deliberately awaited: the draft must exist on disk before anything else can fail.
            await saveTurnMessages(session.messages, 'draft');
            const config = await loadConfig();
            if (payload.provider && payload.provider !== config.provider) {
                config.provider = payload.provider;
                delete config.baseUrl;
            }
            if (payload.model)
                config.model = payload.model;
            let resolved;
            try {
                resolved = await resolveProviderConfig(config, targetWorkspace);
            }
            catch (err) {
                return { ok: false, error: `Sağlayıcı yapılandırma hatası: ${err.message}` };
            }
            let provider;
            try {
                provider = createProvider(resolved);
            }
            catch (err) {
                return { ok: false, error: `Sağlayıcı başlatma hatası: ${err.message}` };
            }
            if (abortController.signal.aborted)
                return { ok: false, aborted: true, sessionId: session.id };
            const approve = async (request) => {
                if (abortController.signal.aborted)
                    return false;
                // Read the live turn policy so a mid-turn YOLO toggle is honoured.
                if (activeTurnContext?.yolo === true || activeTurnContext?.alwaysAllowSession) {
                    return true;
                }
                const perm = getWorkspacePermission(config, targetWorkspace);
                if (perm === 'allow') {
                    return true;
                }
                const requestId = randomUUID();
                const toolTitle = TOOL_TITLE_MAP[request.tool] || formatToolTitle(request.tool);
                if (!mainWindow || mainWindow.isDestroyed())
                    return false;
                return new Promise((resolveApproval) => {
                    const timer = setTimeout(() => {
                        pendingApprovals.delete(requestId);
                        resolveApproval(false);
                        clearApprovalIndicators();
                        try {
                            if (mainWindow && !mainWindow.isDestroyed()) {
                                mainWindow.webContents.send('agent:approval-expired', { requestId, reason: 'timeout', timeoutMs: 120_000 });
                                signalApprovalNeeded('T Bot onay zaman aşımı', `${toolTitle} için 120 saniye içinde onay verilmedi; işlem güvenli şekilde reddedildi.`);
                            }
                        }
                        catch { /* The approval already failed closed if its renderer is gone. */ }
                    }, 120_000);
                    const settle = (approved) => {
                        clearTimeout(timer);
                        pendingApprovals.delete(requestId);
                        clearApprovalIndicators();
                        resolveApproval(approved);
                    };
                    pendingApprovals.set(requestId, settle);
                    try {
                        signalApprovalNeeded('T Bot araç onayı bekliyor', `${toolTitle} çalıştırılmak isteniyor. Pencereye dönüp onaylayın veya reddedin.`);
                        mainWindow.webContents.send('agent:approval-request', {
                            requestId,
                            tool: request.tool,
                            toolTitle,
                            description: request.description,
                            arguments: request.arguments,
                        });
                    }
                    catch {
                        settle(false);
                    }
                });
            };
            const finalizeOpenToolCalls = (reason) => {
                for (const call of openToolCalls.values()) {
                    partialTranscript.push({ role: 'assistant', content: '', toolCalls: [{ ...call }] });
                    partialTranscript.push({ role: 'tool', toolCallId: call.id, content: reason });
                }
                openToolCalls.clear();
                trimPartialTranscript();
            };
            const onEvent = (event) => {
                // Partial-turn checkpoints: tool results are already final, text is
                // buffered until the agent pushes its assistant message.
                if (event.type === 'text') {
                    streamText += event.text;
                    scheduleCheckpoint();
                }
                else if (event.type === 'tool_start') {
                    // Preserve text emitted before this tool, then remember the open call.
                    if (streamText)
                        partialTranscript.push({ role: 'assistant', content: streamText });
                    streamText = '';
                    openToolCalls.set(event.call.id, event.call);
                    trimPartialTranscript();
                }
                else if (event.type === 'tool_end') {
                    const call = openToolCalls.get(event.call.id) || event.call;
                    // A completed exchange is part of the turn's durable record: the
                    // call itself and its bounded result (never the full output).
                    partialTranscript.push({ role: 'assistant', content: '', toolCalls: [{ ...call }] });
                    partialTranscript.push({
                        role: 'tool',
                        toolCallId: call.id,
                        content: String(event.result ?? '').slice(0, PARTIAL_RESULT_CHARS),
                    });
                    openToolCalls.delete(call.id);
                    trimPartialTranscript();
                    streamText = '';
                    scheduleCheckpoint();
                    publishGrounding();
                }
                if (!mainWindow || mainWindow.isDestroyed())
                    return;
                let enrichedEvent = event;
                if (event.type === 'tool_start' || event.type === 'tool_end') {
                    const toolName = event.call.name;
                    const toolTitle = TOOL_TITLE_MAP[toolName] || formatToolTitle(toolName);
                    enrichedEvent = {
                        ...event,
                        toolTitle,
                    };
                }
                mainWindow.webContents.send('agent:event', enrichedEvent);
            };
            const mcpTools = [];
            try {
                const connections = await loadConnections();
                for (const [service, connectionConfig] of Object.entries(connections)) {
                    abortController.signal.throwIfAborted();
                    if (!connectionConfig?.enabled)
                        continue;
                    const token = await getMcpToken(service);
                    if (!token && !connectionConfig.url?.startsWith('stdio:')) {
                        onEvent({ type: 'status', message: `${service} MCP için token veya stdio URL yapılandırması gerekli; bu turda atlandı.` });
                        continue;
                    }
                    try {
                        onEvent({ type: 'status', message: `${service} MCP bağlantısı kuruluyor…` });
                        const connection = await connectMcp(service, token, { ...connectionConfig, workspace: targetWorkspace, signal: abortController.signal });
                        mcpTools.push(connection);
                        activeMcpConnections.add(connection);
                        abortController.signal.throwIfAborted();
                        onEvent({ type: 'status', message: `${service} MCP bağlı: ${connection.definitions.length} araç.` });
                    }
                    catch {
                        abortController.signal.throwIfAborted();
                        onEvent({ type: 'status', message: `${service} MCP bağlantısı kurulamadı; CLI üzerinden yapılandırmayı kontrol edin.` });
                    }
                }
                const imageProvider = await resolveImageProviderConfig(config);
                const input = {
                    processOwner: `desktop:${session.id}`,
                    message: payload.message,
                    images: payload.images,
                    history,
                    provider,
                    workspace: targetWorkspace,
                    onEvent,
                    approve,
                    signal: abortController.signal,
                    mcpTools,
                    imageProvider,
                };
                updatedMessages = await runTurnMode(input, {
                    mode: payload.mode,
                    plan: payload.plan,
                    workerProvider: provider,
                    session,
                    workspace: targetWorkspace,
                    onEvent,
                });
                // Stop background checkpoint writes before the authoritative save so a
                // stale snapshot can never land after the final conversation.
                await flushCheckpoints(true);
                session.messages = updatedMessages;
                await saveTurnMessages(updatedMessages, 'turn');
                const lastAssistant = [...session.messages].reverse().find(m => m.role === 'assistant');
                const lastAssistantText = lastAssistant?.content || '';
                // Measure actual memory. Working-set trimming is an explicit user action.
                const memStats = readTelemetry();
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('sys:memory-update', memStats);
                }
                publishGrounding();
                // The full message history stays in the session store; the renderer
                // fetches bounded pages through sessions:messages instead.
                return {
                    ok: true,
                    sessionId: session.id,
                    lastAssistantText,
                    messageCount: session.messages.length,
                    memoryStats: memStats,
                };
            }
            catch (err) {
                const isAborted = abortController.signal.aborted;
                // U0: an aborted or failed turn still persists its user message,
                // partial assistant text and completed tool results. A persistence
                // failure is logged but never masks the real turn error.
                await flushCheckpoints(true);
                finalizeOpenToolCalls(isAborted ? 'Araç çalışırken tur durduruldu.' : 'Araç çalışırken tur hata ile sona erdi.');
                const partial = updatedMessages ?? buildPartialMessages(session.messages);
                if (partial.length > history.length) {
                    await saveTurnMessages(partial, isAborted ? 'abort' : 'error');
                }
                return {
                    ok: false,
                    aborted: isAborted,
                    error: err?.message || String(err),
                    sessionId: session.id,
                };
            }
            finally {
                checkpointsEnabled = false;
                if (checkpointTimer) {
                    clearTimeout(checkpointTimer);
                    checkpointTimer = null;
                }
                openToolCalls.clear();
                partialTranscript.length = 0;
                await Promise.allSettled(mcpTools.map(closeDesktopMcp));
                for (const resolver of pendingApprovals.values())
                    resolver(false);
                pendingApprovals.clear();
                clearApprovalIndicators();
                publishGrounding();
                // ALWAYS emit turn_end to ensure the renderer UI never gets stuck in thinking state
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('agent:event', { type: 'turn_end' });
                }
                if (activeTurnContext?.sessionId === session.id) {
                    activeTurnContext = null;
                }
            }
        }
        catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
        finally {
            turnInProgress = false;
            turnAbortController = null;
            if (activeTurnContext?.abortController === abortController)
                activeTurnContext = null;
            settleTurn?.();
        }
    });
}
function startPeriodicMemoryUpdater() {
    if (memoryInterval || isHeadlessVerify)
        return;
    memoryInterval = setInterval(() => {
        if (desktopQuitting)
            return;
        const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
        const stats = getDesktopMemoryStats(window);
        void trimDesktopMemoryUnderPressure(window, stats).catch(() => undefined);
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
            mainWindow.webContents.send('sys:memory-update', composeDesktopTelemetry());
        }
    }, 15_000);
}
// App lifecycle
app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized())
            mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
});
app.whenReady().then(async () => {
    try {
        const bootConfig = await loadConfig();
        if (bootConfig.guiMode === 'headless')
            process.env.TBOT_HEADLESS = 'true';
        else
            delete process.env.TBOT_HEADLESS;
    }
    catch {
        // A damaged config must not prevent the desktop from opening.
    }
    registerScreenshotProtocol();
    registerIpcHandlers();
    createMainWindow();
    if (isHeadlessVerify) {
        try {
            const memStatsBefore = getDesktopMemoryStats(mainWindow || undefined);
            const trimRes = await trimDesktopMemory(mainWindow || undefined, true);
            const memStatsAfter = getDesktopMemoryStats(mainWindow || undefined);
            const config = await loadConfig();
            const screenshotProtocol = await smokeScreenshotProtocol().catch(error => ({ error: error instanceof Error ? error.message : String(error) }));
            const verifyReport = {
                status: 'ok',
                mode: 'headless-verify',
                process: {
                    pid: process.pid,
                    electronVersion: process.versions.electron,
                    nodeVersion: process.versions.node,
                    v8Flags: '--expose-gc',
                },
                memory: {
                    before: memStatsBefore,
                    trim: trimRes,
                    after: memStatsAfter,
                },
                ipcHandlersRegistered: true,
                singleInstanceLock: gotSingleInstanceLock,
                screenshotProtocol,
                config: {
                    provider: config.provider,
                    model: config.model,
                },
            };
            console.log('__HEADLESS_VERIFY_START__');
            console.log(JSON.stringify(verifyReport, null, 2));
            console.log('__HEADLESS_VERIFY_END__');
            setTimeout(() => {
                app.exit(0);
            }, 300);
            return;
        }
        catch (err) {
            console.error(JSON.stringify({ status: 'error', error: err?.message || String(err) }));
            app.exit(1);
            return;
        }
    }
    createTray();
    globalShortcut.register('CommandOrControl+Shift+Space', () => {
        toggleWindowVisibility();
    });
    startPeriodicMemoryUpdater();
});
app.on('window-all-closed', () => {
    // With a tray the window is only hidden; a real quit closes it while
    // desktopQuitting is set. Without a tray, preserve the normal behavior.
    if (process.platform !== 'darwin' && !tray) {
        app.quit();
    }
});
app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (memoryInterval) {
        clearInterval(memoryInterval);
        memoryInterval = null;
    }
});
//# sourceMappingURL=main.js.map