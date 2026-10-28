import { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, globalShortcut } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
// V8 and Chromium low-RAM switches (must be appended before app.whenReady())
app.commandLine.appendSwitch('js-flags', '--expose-gc');
app.commandLine.appendSwitch('disable-features', 'Translate,AutofillServerCommunication,CalculateNativeWinOcclusion,SpareRendererForSitePerProcess,MediaRouter,AudioServiceOutOfProcess');
app.commandLine.appendSwitch('disable-spell-checking');
app.commandLine.appendSwitch('disable-dev-shm-usage');
// Core T Bot 3.0 modules
import { runTurnMode } from '../turn-runner.js';
import { loadConfig, saveConfig, resolveProviderConfig, getWorkspacePermission, configDirectory, } from '../config.js';
import { getCustomSecret, prepareApiKey, setCustomSecret } from '../secrets.js';
import { listProviderModels, resolveImageProviderConfig, storeProviderApiKey } from '../host-services.js';
import { SessionStore, createSession } from '../sessions.js';
import { getGoal, getTodos, getActiveFocusSummary, executeWorkflowTool } from '../workflows.js';
import { BUILTIN_SKILLS, loadCustomSkills } from '../skills.js';
import { loadConnections, getMcpToken, saveConnection, setMcpToken, removeConnection } from '../mcp-config.js';
import { getTelegramBotStatus, startTelegramBotBridge, stopTelegramBotBridge } from '../bot.js';
import { connectMcp } from '../mcp.js';
import { listCheckpoints, restoreCheckpoint } from '../checkpoints.js';
import { sandboxStatus } from '../security/sandbox.js';
import { MCP_PRESETS } from '../mcp-presets.js';
import { PROVIDER_CATALOG, createProvider } from '../providers.js';
import { TOOL_TITLE_MAP, formatToolTitle } from '../theme.js';
import { commandCatalog, commandsFor, helpFor } from '../commands.js';
import { globalTokenTracker } from '../token-optimizer.js';
import { recallFacts, rememberFact, forgetFact } from '../memory.js';
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
let mainWindow = null;
let tray = null;
let memoryInterval = null;
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
registerDesktopQuitCleanup(app, () => {
    desktopQuitting = true;
    turnAbortController?.abort();
    for (const resolver of activeTurnContext?.pendingApprovals.values() || [])
        resolver(false);
    activeTurnContext?.pendingApprovals.clear();
    stopAllBackgroundProcesses();
    stopTelegramBotBridge();
}, async () => {
    await Promise.allSettled([
        Promise.resolve().then(closeBrowser),
        Promise.resolve().then(closeIdleDesktopDaemon),
        ...Array.from(activeMcpConnections, closeDesktopMcp),
    ]);
});
/** Installed launches start in the user's home, never an installation directory. */
export function getDefaultWorkspace() {
    const cwd = process.cwd();
    const lowerCwd = cwd.toLowerCase();
    if (app.isPackaged || lowerCwd.includes('appdata') || lowerCwd.includes('programs')) {
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
            sandbox: true,
            spellcheck: false,
            backgroundThrottling: true,
        },
    });
    // The bridge belongs exclusively to the bundled local document.
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', event => event.preventDefault());
    mainWindow.webContents.on('render-process-gone', () => {
        turnAbortController?.abort();
        for (const resolver of activeTurnContext?.pendingApprovals.values() || [])
            resolver(false);
        activeTurnContext?.pendingApprovals.clear();
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
          body { margin:0; background:#F8FAF7; color:#111A14; font-family:system-ui,-apple-system,sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; flex-direction:column; gap:16px; user-select:none; }
          .spinner { width:36px; height:36px; border:3px solid #DCE6D9; border-top-color:#4D9A0F; border-radius:50%; animation:spin 0.9s linear infinite; }
          @keyframes spin { to { transform:rotate(360deg); } }
          .title { font-weight:600; font-size:18px; color:#4D9A0F; }
          .sub { font-size:13px; color:#6C8074; }
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
    mainWindow.on('closed', () => {
        turnAbortController?.abort();
        for (const resolver of activeTurnContext?.pendingApprovals.values() || [])
            resolver(false);
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
    // Reject subframes and documents other than our own renderer for every handler.
    const handle = (channel, listener) => {
        ipcMain.handle(channel, (event, ...args) => {
            if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
                throw new Error('Güvenilmeyen arayüz isteği.');
            }
            return listener(event, ...args);
        });
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
        return result.filePaths[0];
    });
    handle('workspace:open-path', async (_event, targetPath) => {
        if (!targetPath)
            return false;
        return (await shell.openPath(targetPath)) === '';
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
        await store.save(session);
        return session;
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
        await store.save(session);
        return { ok: true, session: { id: session.id, workspace: session.workspace, createdAt: session.createdAt, updatedAt: session.updatedAt, messages: [] } };
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
            sandbox: sandboxStatus(),
            memoryStats,
            uptimeSeconds: Math.round(process.uptime()),
        };
    });
    handle('sys:mem-stats', () => {
        return getDesktopMemoryStats(mainWindow || undefined);
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
        const stats = getDesktopMemoryStats(mainWindow || undefined);
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
    handle('agent:abort-turn', () => {
        turnAbortController?.abort();
        if (activeTurnContext) {
            activeTurnContext.abortController.abort();
            for (const [, resolver] of activeTurnContext.pendingApprovals) {
                resolver(false);
            }
            activeTurnContext.pendingApprovals.clear();
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
        try {
            const targetWorkspace = resolve(payload.workspace || getDefaultWorkspace());
            if (!statSync(targetWorkspace).isDirectory())
                return { ok: false, error: 'Çalışma alanı bir klasör olmalıdır.' };
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
            const pendingApprovals = new Map();
            activeTurnContext = {
                abortController,
                workspace: targetWorkspace,
                sessionId: session.id,
                session,
                pendingApprovals,
                alwaysAllowSession: false,
                yolo: payload.yolo === true,
            };
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
                const history = [...session.messages];
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
                const updatedMessages = await runTurnMode(input, {
                    mode: payload.mode,
                    plan: payload.plan,
                    workerProvider: provider,
                    session,
                    workspace: targetWorkspace,
                    onEvent,
                });
                session.messages = updatedMessages;
                await store.save(session);
                const lastAssistant = [...session.messages].reverse().find(m => m.role === 'assistant');
                const lastAssistantText = lastAssistant?.content || '';
                // Measure actual memory. Working-set trimming is an explicit user action.
                const memStats = getDesktopMemoryStats(mainWindow || undefined);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('sys:memory-update', memStats);
                }
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
                return {
                    ok: false,
                    aborted: isAborted,
                    error: err?.message || String(err),
                    sessionId: session.id,
                };
            }
            finally {
                await Promise.allSettled(mcpTools.map(closeDesktopMcp));
                for (const resolver of pendingApprovals.values())
                    resolver(false);
                pendingApprovals.clear();
                clearApprovalIndicators();
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
                    v8Flags: '--expose-gc',
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