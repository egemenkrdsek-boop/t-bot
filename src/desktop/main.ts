import { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, globalShortcut } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

// V8 and Chromium low-RAM switches (must be appended before app.whenReady())
app.commandLine.appendSwitch('js-flags', '--expose-gc');
app.commandLine.appendSwitch(
  'disable-features',
  'Translate,AutofillServerCommunication,CalculateNativeWinOcclusion,SpareRendererForSitePerProcess,MediaRouter,AudioServiceOutOfProcess'
);
app.commandLine.appendSwitch('disable-spell-checking');
app.commandLine.appendSwitch('disable-dev-shm-usage');

// Core T Bot 2.0 modules
import { runAgent } from '../agent.js';
import {
  loadConfig,
  saveConfig,
  resolveProviderConfig,
  getWorkspacePermission,
  configDirectory,
  type AppConfig,
} from '../config.js';
import { setApiKey, getApiKey } from '../secrets.js';
import { SessionStore, createSession, type Session } from '../sessions.js';
import { getGoal, getTodos, getActiveFocusSummary, executeWorkflowTool, runGoal } from '../workflows.js';
import { BUILTIN_SKILLS, loadCustomSkills } from '../skills.js';
import { loadConnections, getMcpToken } from '../mcp-config.js';
import { connectMcp, type McpConnection } from '../mcp.js';
import { MCP_PRESETS } from '../mcp-presets.js';
import { PROVIDER_CATALOG, createProvider } from '../providers.js';
import { discoverModels, fallbackModels } from '../models.js';
import { TOOL_TITLE_MAP, formatToolTitle } from '../theme.js';
import { trimDesktopMemory, trimDesktopMemoryUnderPressure, getDesktopMemoryStats } from './memory-trimmer.js';
import { registerDesktopQuitCleanup } from './quit-cleanup.js';
import { closeBrowser } from '../tools/browser.js';
import { closeIdleDesktopDaemon } from '../tools/computer.js';
import { stopAllBackgroundProcesses } from '../tools/shell.js';
import type { AgentEvent, AgentInput, ApprovalRequest, ImageAttachment } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Single instance lock
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let memoryInterval: NodeJS.Timeout | null = null;

const isHeadlessVerify = process.argv.includes('--headless-verify');

interface ActiveTurnContext {
  abortController: AbortController;
  workspace: string;
  sessionId: string;
  session: Session;
  pendingApprovals: Map<string, (approved: boolean) => void>;
  alwaysAllowSession: boolean;
}
let activeTurnContext: ActiveTurnContext | null = null;
let turnInProgress = false;
let turnAbortController: AbortController | null = null;
let desktopQuitting = false;
const activeMcpConnections = new Set<McpConnection>();

async function closeDesktopMcp(connection: McpConnection): Promise<void> {
  if (!activeMcpConnections.delete(connection)) return;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(() => connection.close()),
      new Promise<void>(resolve => { deadline = setTimeout(resolve, 5_000); }),
    ]);
  } finally {
    clearTimeout(deadline);
  }
}

registerDesktopQuitCleanup(app, () => {
  desktopQuitting = true;
  turnAbortController?.abort();
  for (const resolver of activeTurnContext?.pendingApprovals.values() || []) resolver(false);
  activeTurnContext?.pendingApprovals.clear();
  stopAllBackgroundProcesses();
}, async () => {
  await Promise.allSettled([
    Promise.resolve().then(closeBrowser),
    Promise.resolve().then(closeIdleDesktopDaemon),
    ...Array.from(activeMcpConnections, closeDesktopMcp),
  ]);
});

/** Installed launches start in the user's home, never an installation directory. */
export function getDefaultWorkspace(): string {
  const cwd = process.cwd();
  const lowerCwd = cwd.toLowerCase();
  if (app.isPackaged || lowerCwd.includes('appdata') || lowerCwd.includes('programs')) {
    return homedir();
  }
  return cwd;
}

function getAppIconPath(): string | undefined {
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

function createMainWindow(): BrowserWindow {
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
    for (const resolver of activeTurnContext?.pendingApprovals.values() || []) resolver(false);
    activeTurnContext?.pendingApprovals.clear();
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));

  const rendererPath = join(__dirname, 'renderer', 'index.html');
  if (existsSync(rendererPath)) {
    mainWindow.loadFile(rendererPath);
  } else {
    // Elegant fallback screen until renderer is compiled or copied
    mainWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(`
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
        <div class="title">T Bot Cyber-Zen Desktop Başlatılıyor...</div>
        <div class="sub">Arayüz bileşenleri yükleniyor</div>
      </body>
      </html>
    `)}`
    );
  }

  mainWindow.on('closed', () => {
    turnAbortController?.abort();
    for (const resolver of activeTurnContext?.pendingApprovals.values() || []) resolver(false);
    mainWindow = null;
  });

  return mainWindow;
}

function createTray() {
  if (tray || isHeadlessVerify) return;
  try {
    const iconPath = getAppIconPath();
    let trayIcon: Electron.NativeImage;
    if (iconPath && existsSync(iconPath)) {
      trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    } else {
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
  } catch {
    // Tray creation error ignored
  }
}

function toggleWindowVisibility() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    if (mainWindow.isFocused()) {
      mainWindow.hide();
    } else {
      mainWindow.focus();
    }
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function registerIpcHandlers() {
  // Reject subframes and documents other than our own renderer for every handler.
  const handle = (channel: string, listener: Parameters<typeof ipcMain.handle>[1]) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
        throw new Error('Güvenilmeyen arayüz isteği.');
      }
      return listener(event, ...args);
    });
  };
  // Window control: minimize, maximize, close, isMaximized
  handle('window:control', (_event, action: string) => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    switch (action) {
      case 'minimize':
        mainWindow.minimize();
        return true;
      case 'maximize':
        if (mainWindow.isMaximized()) {
          mainWindow.unmaximize();
        } else {
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
    return { config: await loadConfig(), appVersion: app.getVersion() };
  });

  handle('config:save', async (_event, partialConfig: Partial<AppConfig>) => {
    const current = await loadConfig();
    // Preserve the loaded object's revision token used by optimistic config writes.
    if (typeof partialConfig?.provider === 'string' && partialConfig.provider !== current.provider) {
      current.provider = partialConfig.provider;
      delete current.baseUrl;
    }
    if (typeof partialConfig?.model === 'string') current.model = partialConfig.model;
    if (partialConfig?.efforts && typeof partialConfig.efforts === 'object') {
      current.efforts = { ...current.efforts, ...partialConfig.efforts };
    }
    await saveConfig(current);
    return current;
  });

  handle('config:set-api-key', async (_event, { provider, apiKey }: { provider: string; apiKey: string }) => {
    return await setApiKey(provider, apiKey);
  });

  handle('config:model-catalog', async (_event, providerId?: string) => {
    const config = await loadConfig();
    if (providerId && PROVIDER_CATALOG.some(provider => provider.id === providerId)) config.provider = providerId;
    const apiKey = await getApiKey(config.provider);
    let liveModels = fallbackModels(config.provider);
    try {
      liveModels = await discoverModels(config.provider, apiKey);
    } catch {
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
  handle('workspace:select-dialog', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Çalışma Alanı Seç',
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  handle('workspace:open-path', async (_event, targetPath: string) => {
    if (!targetPath) return false;
    return (await shell.openPath(targetPath)) === '';
  });

  handle('workspace:default', () => getDefaultWorkspace());

  // Sessions handlers
  handle('sessions:list', async (_event, workspace?: string) => {
    const store = new SessionStore(configDirectory());
    return await store.list(workspace || getDefaultWorkspace());
  });

  handle('sessions:load', async (_event, { sessionId, workspace }: { sessionId: string; workspace?: string }) => {
    const store = new SessionStore(configDirectory());
    return await store.get(sessionId, workspace || getDefaultWorkspace());
  });

  handle('sessions:delete', async (_event, { sessionId, workspace }: { sessionId: string; workspace?: string }) => {
    if (activeTurnContext?.sessionId === sessionId) throw new Error('Çalışan oturum silinemez.');
    const store = new SessionStore(configDirectory());
    return await store.delete(sessionId, workspace || getDefaultWorkspace());
  });

  handle('sessions:create', async (_event, { workspace, title }: { workspace?: string; title?: string }) => {
    const resolvedWorkspace = resolve(workspace || getDefaultWorkspace());
    const session = createSession(resolvedWorkspace);
    const store = new SessionStore(configDirectory());
    await store.save(session);
    return session;
  });

  // Workflows handlers
  handle('workflows:get-state', async (_event, workspace?: string) => {
    const resolvedWorkspace = resolve(workspace || getDefaultWorkspace());
    const goal = await getGoal(resolvedWorkspace).catch(() => undefined);
    const todos = await getTodos(resolvedWorkspace).catch(() => []);
    const focusSummary = getActiveFocusSummary(resolvedWorkspace);
    return { goal, todos, focusSummary };
  });

  handle(
    'workflows:manage',
    async (_event, { toolName, args, workspace }: { toolName: string; args: Record<string, unknown>; workspace?: string }) => {
      const resolvedWorkspace = resolve(workspace || getDefaultWorkspace());
      return await executeWorkflowTool(toolName, args, resolvedWorkspace);
    }
  );

  // System & Skills & MCP
  handle('sys:skills-mcp', async (_event, workspace?: string) => {
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

  handle('sys:doctor', async (_event, workspace?: string) => {
    const resolvedWorkspace = resolve(workspace || getDefaultWorkspace());
    const config = await loadConfig();
    let hasApiKey = false;
    try {
      const resolved = await resolveProviderConfig(config, resolvedWorkspace);
      hasApiKey = Boolean(resolved?.apiKey);
    } catch {}

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

  handle('sys:mem-stats', () => {
    return getDesktopMemoryStats(mainWindow || undefined);
  });

  handle('sys:trim-memory', async () => {
    const result = await trimDesktopMemory(mainWindow || undefined, true);
    const stats = getDesktopMemoryStats(mainWindow || undefined);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sys:memory-update', stats);
    }
    return { result, stats };
  });

  // Agent turn execution & approvals
  handle('agent:approval-response', (_event, { requestId, approved, alwaysAllowSession }) => {
    if (!activeTurnContext) {
      return { handled: false, error: 'Aktif bir çalışan tur bulunmuyor.' };
    }
    const resolver = activeTurnContext.pendingApprovals.get(requestId);
    if (resolver) {
      if (approved === true && alwaysAllowSession === true) activeTurnContext.alwaysAllowSession = true;
      activeTurnContext.pendingApprovals.delete(requestId);
      resolver(approved === true);
      return { handled: true };
    }
    return { handled: false, error: 'Onay isteği bulunamadı veya süresi doldu.' };
  });

  handle('agent:abort-turn', () => {
    turnAbortController?.abort();
    if (activeTurnContext) {
      activeTurnContext.abortController.abort();
      for (const [, resolver] of activeTurnContext.pendingApprovals) {
        resolver(false);
      }
      activeTurnContext.pendingApprovals.clear();
      return { aborted: true };
    }
    return { aborted: turnInProgress };
  });

  handle(
    'agent:start-turn',
    async (
      _event,
      payload: {
        message: string;
        sessionId?: string;
        workspace?: string;
        yolo?: boolean;
        model?: string;
        provider?: string;
        images?: ImageAttachment[];
        mode?: 'goal';
      }
    ) => {
      if (desktopQuitting) return { ok: false, error: 'Uygulama kapanıyor.' };
      if (turnInProgress) return { ok: false, error: 'Önce çalışan turu durdurun veya tamamlanmasını bekleyin.' };
      if (!payload || typeof payload.message !== 'string' || payload.message.length > 500_000) {
        return { ok: false, error: 'Geçersiz veya çok uzun mesaj.' };
      }
      if (payload.images && (!Array.isArray(payload.images) || payload.images.length > 3 || payload.images.some(image =>
        image?.mimeType !== 'image/png' || typeof image.data !== 'string' || image.data.length > 2_000_000 || !/^[A-Za-z0-9+/=]+$/.test(image.data)))) {
        return { ok: false, error: 'Geçersiz görsel eki. En fazla 3 görsel, her biri en fazla 2 MB base64 veri içerebilir.' };
      }
      turnInProgress = true;
      const abortController = new AbortController();
      turnAbortController = abortController;
      try {

        const targetWorkspace = resolve(payload.workspace || getDefaultWorkspace());
        if (!statSync(targetWorkspace).isDirectory()) return { ok: false, error: 'Çalışma alanı bir klasör olmalıdır.' };
        const store = new SessionStore(configDirectory());
        let session: Session;
        if (payload.sessionId) {
          try {
            const existing = await store.get(payload.sessionId, targetWorkspace);
            if (!existing) return { ok: false, sessionId: payload.sessionId, error: 'Seçili oturum bulunamadı. Oturum listesini yenileyin veya yeni bir sohbet oluşturun.' };
            session = existing;
          } catch (error) {
            return { ok: false, sessionId: payload.sessionId, error: `Oturum yüklenemedi: ${error instanceof Error ? error.message : String(error)}` };
          }
        } else {
          session = createSession(targetWorkspace);
        }
        if (abortController.signal.aborted) return { ok: false, aborted: true, sessionId: session.id };
        const config = await loadConfig();
        if (payload.provider && payload.provider !== config.provider) {
          config.provider = payload.provider;
          delete config.baseUrl;
        }
        if (payload.model) config.model = payload.model;

        let resolved;
        try {
          resolved = await resolveProviderConfig(config, targetWorkspace);
        } catch (err: any) {
          return { ok: false, error: `Sağlayıcı yapılandırma hatası: ${err.message}` };
        }

        let provider;
        try {
          provider = createProvider(resolved);
        } catch (err: any) {
          return { ok: false, error: `Sağlayıcı başlatma hatası: ${err.message}` };
        }


        if (abortController.signal.aborted) return { ok: false, aborted: true, sessionId: session.id };
        const pendingApprovals = new Map<string, (approved: boolean) => void>();
        activeTurnContext = {
          abortController,
          workspace: targetWorkspace,
          sessionId: session.id,
          session,
          pendingApprovals,
          alwaysAllowSession: false,
        };

        const approve = async (request: ApprovalRequest): Promise<boolean> => {
          if (abortController.signal.aborted) return false;
          if (payload.yolo === true || activeTurnContext?.alwaysAllowSession) {
            return true;
          }
          const perm = getWorkspacePermission(config, targetWorkspace);
          if (perm === 'allow') {
            return true;
          }

          const requestId = randomUUID();
          const toolTitle = TOOL_TITLE_MAP[request.tool] || formatToolTitle(request.tool);

          if (!mainWindow || mainWindow.isDestroyed()) return false;
          return new Promise<boolean>((resolveApproval) => {
            const timer = setTimeout(() => {
              pendingApprovals.delete(requestId);
              resolveApproval(false);
              try {
                if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('agent:approval-expired', { requestId });
              } catch { /* The approval already failed closed if its renderer is gone. */ }
            }, 120_000);
            const settle = (approved: boolean) => {
              clearTimeout(timer);
              pendingApprovals.delete(requestId);
              resolveApproval(approved);
            };
            pendingApprovals.set(requestId, settle);
            try {
              mainWindow!.webContents.send('agent:approval-request', {
                requestId,
                tool: request.tool,
                toolTitle,
                description: request.description,
                arguments: request.arguments,
              });
            } catch {
              settle(false);
            }
          });
        };

        const onEvent = (event: AgentEvent) => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          let enrichedEvent: any = event;
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

        const mcpTools: McpConnection[] = [];
        try {
          const connections = await loadConnections();
          for (const [service, connectionConfig] of Object.entries(connections)) {
            abortController.signal.throwIfAborted();
            if (!connectionConfig?.enabled) continue;
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
            } catch {
              abortController.signal.throwIfAborted();
              onEvent({ type: 'status', message: `${service} MCP bağlantısı kurulamadı; CLI üzerinden yapılandırmayı kontrol edin.` });
            }
          }
          const history = [...session.messages];
          const input: AgentInput = {
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
          };
          const runner = (step: AgentInput) => runAgent(step, { workspace: targetWorkspace, session, onEvent });
          const updatedMessages = payload.mode === 'goal' ? await runGoal(input, runner) : await runner(input);

          session.messages = updatedMessages;
          await store.save(session);

          const lastAssistant = [...session.messages].reverse().find(m => m.role === 'assistant');
          const lastAssistantText = lastAssistant?.content || '';

          // Measure actual memory. Working-set trimming is an explicit user action.
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
        } catch (err: any) {
          const isAborted = abortController.signal.aborted;
          return {
            ok: false,
            aborted: isAborted,
            error: err?.message || String(err),
            sessionId: session.id,
          };
        } finally {
          await Promise.allSettled(mcpTools.map(closeDesktopMcp));
          for (const resolver of pendingApprovals.values()) resolver(false);
          pendingApprovals.clear();
          // ALWAYS emit turn_end to ensure the renderer UI never gets stuck in thinking state
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('agent:event', { type: 'turn_end' });
          }
          if (activeTurnContext?.sessionId === session.id) {
            activeTurnContext = null;
          }
        }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      } finally {
        turnInProgress = false;
        turnAbortController = null;
      }
    }
  );
}

function startPeriodicMemoryUpdater() {
  if (memoryInterval || isHeadlessVerify) return;
  memoryInterval = setInterval(() => {
    if (desktopQuitting) return;
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
    if (mainWindow.isMinimized()) mainWindow.restore();
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
    } catch (err: any) {
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
