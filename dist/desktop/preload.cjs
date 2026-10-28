const { contextBridge, ipcRenderer, webUtils } = require('electron');

const MAX_TEXT = 500_000;
const MAX_ID = 512;
const MAX_ARG = 2_048;
const MAX_IMAGES = 3;
const MAX_IMAGE_BASE64 = 2_000_000;

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isText = (value, max = MAX_ARG) => typeof value === 'string' && value.length <= max;
const isOptionalText = (value, max = MAX_ARG) => value === undefined || value === null || isText(value, max);

function fail(message) {
  throw new TypeError(`Geçersiz masaüstü isteği: ${message}`);
}

function assertRecord(value, label) {
  if (!isRecord(value)) fail(`${label} bir nesne olmalı.`);
  return value;
}

function assertText(value, label, max = MAX_ARG) {
  if (!isText(value, max)) fail(`${label} geçersiz veya çok uzun.`);
  return value;
}

function validateApproval(payload) {
  const value = assertRecord(payload, 'Onay yanıtı');
  assertText(value.requestId, 'İstek kimliği', MAX_ID);
  if (typeof value.approved !== 'boolean') fail('Onay kararı boolean olmalı.');
  if (value.alwaysAllowSession !== undefined && typeof value.alwaysAllowSession !== 'boolean') {
    fail('"Bu turda izin ver" boolean olmalı.');
  }
  return value;
}

function validateTurn(payload) {
  const value = assertRecord(payload, 'Tur isteği');
  assertText(value.message, 'Mesaj', MAX_TEXT);
  for (const key of ['sessionId', 'workspace', 'model', 'provider', 'plan']) {
    if (value[key] !== undefined && value[key] !== null && !isText(value[key], key === 'plan' ? MAX_TEXT : MAX_ID)) {
      fail(`${key} geçersiz veya çok uzun.`);
    }
  }
  if (value.yolo !== undefined && typeof value.yolo !== 'boolean') fail('YOLO değeri boolean olmalı.');
  if (value.mode !== undefined && !['goal', 'plan', 'plan-apply', 'ultracode', 'subagents'].includes(value.mode)) {
    fail('Bilinmeyen tur modu.');
  }
  if (value.images !== undefined) {
    if (!Array.isArray(value.images) || value.images.length > MAX_IMAGES) fail('En fazla 3 görsel eklenebilir.');
    for (const image of value.images) {
      if (!isRecord(image) || image.mimeType !== 'image/png' || typeof image.data !== 'string') {
        fail('Görsel eki PNG ve base64 olmalı.');
      }
      if (image.data.length > MAX_IMAGE_BASE64 || !/^[A-Za-z0-9+/=]+$/.test(image.data)) {
        fail('Görsel verisi çok büyük veya geçersiz.');
      }
    }
  }
  return value;
}

function invokeChecked(channel, payload, validator) {
  if (validator) validator(payload);
  return ipcRenderer.invoke(channel, payload);
}

function subscribe(channel, callback) {
  if (typeof callback !== 'function') fail('Olay dinleyicisi bir fonksiyon olmalı.');
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('tbot', {
  getFilePath: (file) => webUtils.getPathForFile(file),

  // Agent turns and approvals
  startTurn: (payload) => invokeChecked('agent:start-turn', payload, validateTurn),
  abortTurn: () => ipcRenderer.invoke('agent:abort-turn'),
  respondApproval: (requestId, approved, alwaysAllowSession) =>
    invokeChecked('agent:approval-response', { requestId, approved, alwaysAllowSession }, validateApproval),
  getApprovalPolicy: (workspace, yolo) => {
    if (!isOptionalText(workspace, MAX_ID) || typeof yolo !== 'boolean') fail('Onay politikası argümanları geçersiz.');
    return ipcRenderer.invoke('agent:approval-policy', { workspace, yolo });
  },
  setTurnPolicy: (yolo) => {
    if (typeof yolo !== 'boolean') fail('Tur politikası boolean olmalı.');
    return ipcRenderer.invoke('agent:set-turn-policy', { yolo });
  },
  setWorkspacePermission: (workspace, permission) => {
    if (!isOptionalText(workspace, MAX_ID) || (permission !== 'allow' && permission !== 'ask')) {
      fail('Çalışma alanı izni "allow" veya "ask" olmalı.');
    }
    return ipcRenderer.invoke('agent:set-workspace-permission', { workspace, permission });
  },

  onAgentEvent: (callback) => subscribe('agent:event', callback),
  onApprovalRequest: (callback) => subscribe('agent:approval-request', callback),
  onApprovalExpired: (callback) => subscribe('agent:approval-expired', callback),
  onMemoryUpdate: (callback) => subscribe('sys:memory-update', callback),
  onGroundingUpdate: (callback) => subscribe('sys:grounding', callback),

  // Configuration
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (partialConfig) => invokeChecked('config:save', partialConfig, value => assertRecord(value, 'Ayar nesnesi')),
  setApiKey: (provider, apiKey) => {
    assertText(provider, 'Sağlayıcı', MAX_ID);
    assertText(apiKey, 'API anahtarı', 16_384);
    return ipcRenderer.invoke('config:set-api-key', { provider, apiKey });
  },
  getModelCatalog: (provider) => {
    if (!isOptionalText(provider, MAX_ID)) fail('Sağlayıcı geçersiz.');
    return ipcRenderer.invoke('config:model-catalog', provider);
  },

  // Workspace and links
  selectWorkspace: () => ipcRenderer.invoke('workspace:select-dialog'),
  getDefaultWorkspace: () => ipcRenderer.invoke('workspace:default'),
  openExternalUrl: (url) => {
    assertText(url, 'Bağlantı', MAX_ARG);
    return ipcRenderer.invoke('shell:open-external', url);
  },

  // Sessions (paged; the full history never travels in one payload)
  listSessions: (workspace) => {
    if (!isOptionalText(workspace, MAX_ID)) fail('Çalışma alanı geçersiz.');
    return ipcRenderer.invoke('sessions:list', workspace);
  },
  loadSession: (sessionId, workspace) => {
    assertText(sessionId, 'Oturum kimliği', MAX_ID);
    if (!isOptionalText(workspace, MAX_ID)) fail('Çalışma alanı geçersiz.');
    return ipcRenderer.invoke('sessions:load', { sessionId, workspace });
  },
  loadSessionMessages: (sessionId, workspace, options) => {
    assertText(sessionId, 'Oturum kimliği', MAX_ID);
    if (!isOptionalText(workspace, MAX_ID)) fail('Çalışma alanı geçersiz.');
    const opts = options === undefined ? {} : assertRecord(options, 'Sayfa seçenekleri');
    for (const key of ['offset', 'limit']) {
      if (opts[key] !== undefined && (!Number.isFinite(opts[key]) || Math.abs(opts[key]) > 1_000_000)) {
        fail(`${key} sayı olmalı.`);
      }
    }
    return ipcRenderer.invoke('sessions:messages', { sessionId, workspace, ...opts });
  },
  clearSession: (sessionId, workspace) => {
    if (!isOptionalText(sessionId, MAX_ID) || !isOptionalText(workspace, MAX_ID)) fail('Oturum bilgisi geçersiz.');
    return ipcRenderer.invoke('sessions:clear', { sessionId, workspace });
  },
  deleteSession: (sessionId, workspace) => {
    assertText(sessionId, 'Oturum kimliği', MAX_ID);
    if (!isOptionalText(workspace, MAX_ID)) fail('Çalışma alanı geçersiz.');
    return ipcRenderer.invoke('sessions:delete', { sessionId, workspace });
  },
  createSession: (workspace, title) => {
    if (!isOptionalText(workspace, MAX_ID) || !isOptionalText(title, 320)) fail('Oturum bilgisi geçersiz.');
    return ipcRenderer.invoke('sessions:create', { workspace, title });
  },

  // Workflows, skills and telemetry
  getWorkflowState: (workspace) => {
    if (!isOptionalText(workspace, MAX_ID)) fail('Çalışma alanı geçersiz.');
    return ipcRenderer.invoke('workflows:get-state', workspace);
  },
  manageWorkflow: (toolName, args, workspace) => {
    assertText(toolName, 'İş akışı aracı', MAX_ID);
    assertRecord(args, 'İş akışı argümanları');
    if (!isOptionalText(workspace, MAX_ID)) fail('Çalışma alanı geçersiz.');
    return ipcRenderer.invoke('workflows:manage', { toolName, args, workspace });
  },
  getSkillsAndMcp: (workspace) => {
    if (!isOptionalText(workspace, MAX_ID)) fail('Çalışma alanı geçersiz.');
    return ipcRenderer.invoke('sys:skills-mcp', workspace);
  },
  runDoctor: (workspace) => {
    if (!isOptionalText(workspace, MAX_ID)) fail('Çalışma alanı geçersiz.');
    return ipcRenderer.invoke('sys:doctor', workspace);
  },
  getMemoryStats: () => ipcRenderer.invoke('sys:mem-stats'),
  getGrounding: () => ipcRenderer.invoke('sys:grounding'),
  listCheckpoints: (workspace) => {
    if (!isOptionalText(workspace, MAX_ID)) fail('Çalışma alanı geçersiz.');
    return ipcRenderer.invoke('checkpoints:list', workspace);
  },
  restoreCheckpoint: (workspace, id, confirmed) => {
    if (!isOptionalText(workspace, MAX_ID) || !isText(id, MAX_ID)) fail('Checkpoint bilgisi geçersiz.');
    return ipcRenderer.invoke('checkpoints:restore', { workspace, id, confirmed: confirmed === true });
  },
  trimMemory: () => ipcRenderer.invoke('sys:trim-memory'),

  // GUI, bot and MCP
  setGuiMode: (mode) => {
    if (!isText(mode, 32)) fail('GUI modu geçersiz.');
    return ipcRenderer.invoke('gui:set-mode', mode);
  },
  getBotStatus: () => ipcRenderer.invoke('bot:status'),
  startBot: (workspace) => {
    if (!isOptionalText(workspace, MAX_ID)) fail('Çalışma alanı geçersiz.');
    return ipcRenderer.invoke('bot:start', workspace);
  },
  stopBot: () => ipcRenderer.invoke('bot:stop'),
  setBotToken: (token, workspace) => {
    assertText(token, 'Bot tokenı', 16_384);
    if (!isOptionalText(workspace, MAX_ID)) fail('Çalışma alanı geçersiz.');
    return ipcRenderer.invoke('bot:set-token', { token, workspace });
  },
  allowBotChat: (chatId) => {
    assertText(chatId, 'Sohbet kimliği', MAX_ID);
    return ipcRenderer.invoke('bot:allow', { chatId });
  },
  listMcp: () => ipcRenderer.invoke('mcp:list'),
  connectMcp: (service, token, workspace) => {
    assertText(service, 'MCP servisi', MAX_ID);
    if (!isOptionalText(token, 16_384) || !isOptionalText(workspace, MAX_ID)) fail('MCP bağlantı bilgisi geçersiz.');
    return ipcRenderer.invoke('mcp:connect', { service, token, workspace });
  },
  removeMcp: (service) => {
    assertText(service, 'MCP servisi', MAX_ID);
    return ipcRenderer.invoke('mcp:remove', { service });
  },

  // Command catalog and memory facts
  getCommands: () => ipcRenderer.invoke('commands:list'),
  getCommandsHelp: () => ipcRenderer.invoke('commands:help'),
  getToolTitles: () => ipcRenderer.invoke('sys:tool-titles'),
  getTokenReport: () => ipcRenderer.invoke('sys:token-report'),
  getMemoryFacts: (workspace) => {
    if (!isOptionalText(workspace, MAX_ID)) fail('Çalışma alanı geçersiz.');
    return ipcRenderer.invoke('sys:memory-facts', workspace);
  },
  rememberFact: (workspace, key, value) => {
    if (!isOptionalText(workspace, MAX_ID)) fail('Çalışma alanı geçersiz.');
    if (!isText(key, 200) || !isText(value, 10_000)) fail('Bellek maddesi geçersiz veya çok uzun.');
    return ipcRenderer.invoke('sys:remember-fact', { workspace, key, value });
  },
  forgetFact: (workspace, key) => {
    if (!isOptionalText(workspace, MAX_ID) || !isText(key, 200)) fail('Bellek anahtarı geçersiz.');
    return ipcRenderer.invoke('sys:forget-fact', { workspace, key });
  },

  windowControl: (action) => {
    if (!['minimize', 'maximize', 'close', 'toggle-pin', 'isMaximized'].includes(action)) fail('Pencere eylemi geçersiz.');
    return ipcRenderer.invoke('window:control', action);
  },
});
