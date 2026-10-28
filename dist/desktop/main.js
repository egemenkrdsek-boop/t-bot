import { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, globalShortcut } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
// V8 and Chromium low-RAM switches (must be appended before app.whenReady())
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128 --expose-gc');
app.commandLine.appendSwitch('disable-features', 'Translate,AutofillServerCommunication,CalculateNativeWinOcclusion,SpareRendererForSitePerProcess,MediaRouter,AudioServiceOutOfProcess');
app.commandLine.appendSwitch('disable-spell-checking');
app.commandLine.appendSwitch('disable-dev-shm-usage');
// Core T Bot 2.0 modules
import { runAgent } from '../agent.js';
import { loadConfig, saveConfig, resolveProviderConfig, getWorkspacePermission, configDirectory, } from '../config.js';
import { setApiKey, getApiKey } from '../secrets.js';
import { SessionStore, createSession } from '../sessions.js';
import { getGoal, getTodos, getActiveFocusSummary, executeWorkflowTool } from '../workflows.js';
import { BUILTIN_SKILLS, loadCustomSkills } from '../skills.js';
import { loadConnections } from '../mcp-config.js';
import { MCP_PRESETS } from '../mcp-presets.js';
import { PROVIDER_CATALOG, createProvider } from '../providers.js';
import { discoverModels, fallbackModels } from '../models.js';
import { TOOL_TITLE_MAP, formatToolTitle } from '../theme.js';
import { trimDesktopMemory, getDesktopMemoryStats } from './memory-trimmer.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Single instance lock
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
    process.exit(0);
}
let mainWindow = null;
let tray = null;
let memoryInterval = null;
const isHeadlessVerify = process.argv.includes('--headless-verify');
let activeTurnContext = null;
/**
 * Returns a reliable workspace directory.
 * When launched via Desktop shortcut/installed exe, process.cwd() can be
 * 'AppData/Local/Programs/T Bot'. If so, prioritizes 'Desktop/T Bot' if existing,
 * or homedir() to avoid locking onto system installation folders.
 */
export function getDefaultWorkspace() {
    const cwd = process.cwd();
    const lowerCwd = cwd.toLowerCase();
    if (lowerCwd.includes('appdata') || lowerCwd.includes('programs')) {
        const devPath = join(homedir(), 'Desktop', 'T Bot');
        if (existsSync(devPath)) {
            return devPath;
        }
        return homedir();
    }
    return cwd;
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
        width: 1220,
        height: 820,
        minWidth: 860,
        minHeight: 600,
        frame: false,
        backgroundColor: '#F8FAF7',
        show: !isHeadlessVerify,
        icon: iconPath,
        webPreferences: {
            preload: join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            spellcheck: false,
            backgroundThrottling: true,
        },
    });
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
        <title>T Bot 2.0</title>
        <style>
          body { margin:0; background:#F8FAF7; color:#111A14; font-family:system-ui,-apple-system,sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; flex-direction:column; gap:16px; user-select:none; }
          .spinner { width:36px; height:36px; border:3px solid #DCE6D9; border-top-color:#4D9A0F; border-radius:50%; animation:spin 0.9s linear infinite; }
          @keyframes spin { to { transform:rotate(360deg); } }
          .title { font-weight:600; font-size:18px; color:#4D9A0F; }
          .sub { font-size:13px; color:#6C8074; }
        </style>
      </head>
      <body>
        <div class="spinner"></div>
        <div class="title">T Bot Cyber-Zen Desktop Başlatılıyor...</div>
        <div class="sub">Arayüz bileşenleri yükleniyor</div>
      </body>
      </html>
    `)}`);
    }
    mainWindow.on('closed', () => {
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
        tray.setToolTip('T Bot 2.0 Desktop');
        const contextMenu = Menu.buildFromTemplate([
            {
                label: 'T Bot\'u Göster / Gizle',
                click: () => toggleWindowVisibility(),
            },
            {
                label: 'Belleği Şimdi Temizle (Trim RAM)',
                click: async () => {
                    await trimDesktopMemory(mainWindow || undefined, true);
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        const stats = getDesktopMemoryStats(mainWindow);
                        mainWindow.webContents.send('sys:memory-update', stats);
                    }
                },
            },
            { type: 'separator' },
            {
                label: 'Çıkış',
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
function registerIpcHandlers() {
    // Window control: minimize, maximize, close, isMaximized
    ipcMain.handle('window:control', (_event, action) => {
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
    ipcMain.handle('config:get', async () => {
        return await loadConfig();
    });
    ipcMain.handle('config:save', async (_event, partialConfig) => {
        const current = await loadConfig();
        const merged = { ...current, ...(partialConfig || {}) };
        await saveConfig(merged);
        return merged;
    });
    ipcMain.handle('config:set-api-key', async (_event, { provider, apiKey }) => {
        return await setApiKey(provider, apiKey);
    });
    ipcMain.handle('config:model-catalog', async () => {
        const config = await loadConfig();
        const apiKey = await getApiKey(config.provider);
        let liveModels = fallbackModels(config.provider);
        try {
            liveModels = await discoverModels(config.provider, apiKey);
        }
        catch {
            // Offline fallback
        }
        return {
            providers: PROVIDER_CATALOG,
            currentProvider: config.provider,
            currentModel: config.model,
            models: liveModels,
        };
    });
    // Workspace handlers
    ipcMain.handle('workspace:select-dialog', async () => {
        if (!mainWindow || mainWindow.isDestroyed())
            return null;
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory', 'createDirectory'],
            title: 'Çalışma Alanı Seç',
        });
        if (result.canceled || !result.filePaths.length)
            return null;
        return result.filePaths[0];
    });
    ipcMain.handle('workspace:open-path', async (_event, targetPath) => {
        if (!targetPath)
            return false;
        await shell.openPath(targetPath);
        return true;
    });
    // Sessions handlers
    ipcMain.handle('sessions:list', async (_event, workspace) => {
        const store = new SessionStore(configDirectory());
        return await store.list(workspace || getDefaultWorkspace());
    });
    ipcMain.handle('sessions:load', async (_event, { sessionId, workspace }) => {
        const store = new SessionStore(configDirectory());
        return await store.get(sessionId, workspace || getDefaultWorkspace());
    });
    ipcMain.handle('sessions:delete', async (_event, { sessionId, workspace }) => {
        const store = new SessionStore(configDirectory());
        return await store.delete(sessionId, workspace || getDefaultWorkspace());
    });
    ipcMain.handle('sessions:create', async (_event, { workspace, title }) => {
        const resolvedWorkspace = resolve(workspace || getDefaultWorkspace());
        const session = createSession(resolvedWorkspace);
        if (title) {
            session.messages.push({ role: 'user', content: title });
        }
        const store = new SessionStore(configDirectory());
        await store.save(session);
        return session;
    });
    // Workflows handlers
    ipcMain.handle('workflows:get-state', async (_event, workspace) => {
        const resolvedWorkspace = resolve(workspace || getDefaultWorkspace());
        const goal = await getGoal(resolvedWorkspace).catch(() => undefined);
        const todos = await getTodos(resolvedWorkspace).catch(() => []);
        const focusSummary = getActiveFocusSummary(resolvedWorkspace);
        return { goal, todos, focusSummary };
    });
    ipcMain.handle('workflows:manage', async (_event, { toolName, args, workspace }) => {
        const resolvedWorkspace = resolve(workspace || getDefaultWorkspace());
        return await executeWorkflowTool(toolName, args, resolvedWorkspace);
    });
    // System & Skills & MCP
    ipcMain.handle('sys:skills-mcp', async (_event, workspace) => {
        const resolvedWorkspace = resolve(workspace || getDefaultWorkspace());
        const customSkills = loadCustomSkills(resolvedWorkspace);
        const mcpConnections = await loadConnections().catch(() => ({}));
        return {
            builtinSkills: BUILTIN_SKILLS,
            customSkills,
            skills: [...BUILTIN_SKILLS, ...customSkills],
            mcpPresets: MCP_PRESETS,
            mcpConnections,
        };
    });
    ipcMain.handle('sys:doctor', async (_event, workspace) => {
        const resolvedWorkspace = resolve(workspace || getDefaultWorkspace());
        const config = await loadConfig();
        let hasApiKey = false;
        try {
            const resolved = await resolveProviderConfig(config, resolvedWorkspace);
            hasApiKey = Boolean(resolved?.apiKey);
        }
        catch { }
        const memoryStats = getDesktopMemoryStats(mainWindow || undefined);
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
            memoryStats,
            uptimeSeconds: Math.round(process.uptime()),
        };
    });
    ipcMain.handle('sys:mem-stats', () => {
        return getDesktopMemoryStats(mainWindow || undefined);
    });
    ipcMain.handle('sys:trim-memory', async () => {
        const result = await trimDesktopMemory(mainWindow || undefined, true);
        const stats = getDesktopMemoryStats(mainWindow || undefined);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('sys:memory-update', stats);
        }
        return { result, stats };
    });
    // Agent turn execution & approvals
    ipcMain.handle('agent:approval-response', (_event, { requestId, approved, alwaysAllowSession }) => {
        if (!activeTurnContext) {
            return { handled: false, error: 'Aktif bir çalışan tur bulunmuyor.' };
        }
        if (alwaysAllowSession) {
            activeTurnContext.alwaysAllowSession = true;
        }
        const resolver = activeTurnContext.pendingApprovals.get(requestId);
        if (resolver) {
            activeTurnContext.pendingApprovals.delete(requestId);
            resolver(Boolean(approved));
            return { handled: true };
        }
        return { handled: false, error: 'Onay isteği bulunamadı veya süresi doldu.' };
    });
    ipcMain.handle('agent:abort-turn', () => {
        if (activeTurnContext) {
            activeTurnContext.abortController.abort();
            for (const [, resolver] of activeTurnContext.pendingApprovals) {
                resolver(false);
            }
            activeTurnContext.pendingApprovals.clear();
            return { aborted: true };
        }
        return { aborted: false };
    });
    ipcMain.handle('agent:start-turn', async (_event, payload) => {
        // Cleanly abort any existing/stuck turn so it never remains locked
        if (activeTurnContext) {
            try {
                activeTurnContext.abortController.abort();
                for (const [, resolver] of activeTurnContext.pendingApprovals) {
                    resolver(false);
                }
                activeTurnContext.pendingApprovals.clear();
            }
            catch { }
            activeTurnContext = null;
        }
        const targetWorkspace = resolve(payload.workspace || getDefaultWorkspace());
        const config = await loadConfig();
        if (payload.provider)
            config.provider = payload.provider;
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
        const store = new SessionStore(configDirectory());
        let session;
        if (payload.sessionId) {
            const existing = await store.get(payload.sessionId, targetWorkspace).catch(() => null);
            session = existing || createSession(targetWorkspace);
        }
        else {
            session = createSession(targetWorkspace);
        }
        const abortController = new AbortController();
        const pendingApprovals = new Map();
        activeTurnContext = {
            abortController,
            workspace: targetWorkspace,
            sessionId: session.id,
            session,
            pendingApprovals,
            alwaysAllowSession: false,
        };
        const approve = async (request) => {
            if (payload.yolo || activeTurnContext?.alwaysAllowSession) {
                return true;
            }
            const perm = getWorkspacePermission(config, targetWorkspace);
            if (perm === 'allow') {
                return true;
            }
            const requestId = randomUUID();
            const toolTitle = TOOL_TITLE_MAP[request.tool] || formatToolTitle(request.tool);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('agent:approval-request', {
                    requestId,
                    tool: request.tool,
                    toolTitle,
                    description: request.description,
                    arguments: request.arguments,
                });
            }
            return new Promise((resolveApproval) => {
                const timer = setTimeout(() => {
                    pendingApprovals.delete(requestId);
                    resolveApproval(false);
                }, 120_000);
                pendingApprovals.set(requestId, (res) => {
                    clearTimeout(timer);
                    resolveApproval(res);
                });
            });
        };
        const onEvent = (event) => {
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
        try {
            const history = [...session.messages];
            const updatedMessages = await runAgent({
                message: payload.message,
                history,
                provider,
                workspace: targetWorkspace,
                onEvent,
                approve,
                signal: abortController.signal,
            }, {
                workspace: targetWorkspace,
                session,
                onEvent,
            });
            session.messages = updatedMessages;
            await store.save(session);
            const lastAssistant = [...session.messages].reverse().find(m => m.role === 'assistant');
            const lastAssistantText = lastAssistant?.content || '';
            // Turn bittiğinde otomatik bellek budama & HUD güncellemesi
            await trimDesktopMemory(mainWindow || undefined, true);
            const memStats = getDesktopMemoryStats(mainWindow || undefined);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('sys:memory-update', memStats);
            }
            return {
                ok: true,
                sessionId: session.id,
                lastAssistantText,
                messages: session.messages,
                memoryStats: memStats,
            };
        }
        catch (err) {
            const isAborted = abortController.signal.aborted;
            return {
                ok: false,
                aborted: isAborted,
                error: err?.message || String(err),
                sessionId: session.id,
            };
        }
        finally {
            // ALWAYS emit turn_end to ensure the renderer UI never gets stuck in thinking state
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('agent:event', { type: 'turn_end' });
            }
            if (activeTurnContext?.sessionId === session.id) {
                activeTurnContext = null;
            }
        }
    });
}
function startPeriodicMemoryUpdater() {
    if (memoryInterval || isHeadlessVerify)
        return;
    memoryInterval = setInterval(() => {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
            const stats = getDesktopMemoryStats(mainWindow);
            mainWindow.webContents.send('sys:memory-update', stats);
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
    registerIpcHandlers();
    createMainWindow();
    if (isHeadlessVerify) {
        try {
            const memStatsBefore = getDesktopMemoryStats(mainWindow || undefined);
            const trimRes = await trimDesktopMemory(mainWindow || undefined, true);
            const memStatsAfter = getDesktopMemoryStats(mainWindow || undefined);
            const config = await loadConfig();
            const verifyReport = {
                status: 'ok',
                mode: 'headless-verify',
                process: {
                    pid: process.pid,
                    electronVersion: process.versions.electron,
                    nodeVersion: process.versions.node,
                    v8Flags: '--max-old-space-size=128 --expose-gc',
                },
                memory: {
                    before: memStatsBefore,
                    trim: trimRes,
                    after: memStatsAfter,
                },
                ipcHandlersRegistered: true,
                singleInstanceLock: gotSingleInstanceLock,
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
    if (process.platform !== 'darwin') {
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