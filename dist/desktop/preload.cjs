const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('tbot', {
  getFilePath: (file) => webUtils.getPathForFile(file),
  startTurn: (payload) => ipcRenderer.invoke('agent:start-turn', payload),
  abortTurn: () => ipcRenderer.invoke('agent:abort-turn'),
  respondApproval: (requestId, approved, alwaysAllowSession) =>
    ipcRenderer.invoke('agent:approval-response', { requestId, approved, alwaysAllowSession }),
  getApprovalPolicy: (workspace, yolo) => ipcRenderer.invoke('agent:approval-policy', { workspace, yolo }),
  setTurnPolicy: (yolo) => ipcRenderer.invoke('agent:set-turn-policy', { yolo }),
  onAgentEvent: (callback) => {
    const listener = (_e, data) => callback(data);
    ipcRenderer.on('agent:event', listener);
    return () => ipcRenderer.removeListener('agent:event', listener);
  },
  onApprovalRequest: (callback) => {
    const listener = (_e, data) => callback(data);
    ipcRenderer.on('agent:approval-request', listener);
    return () => ipcRenderer.removeListener('agent:approval-request', listener);
  },
  onApprovalExpired: (callback) => {
    const listener = (_e, data) => callback(data);
    ipcRenderer.on('agent:approval-expired', listener);
    return () => ipcRenderer.removeListener('agent:approval-expired', listener);
  },
  onMemoryUpdate: (callback) => {
    const listener = (_e, data) => callback(data);
    ipcRenderer.on('sys:memory-update', listener);
    return () => ipcRenderer.removeListener('sys:memory-update', listener);
  },
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (partialConfig) => ipcRenderer.invoke('config:save', partialConfig),
  setApiKey: (provider, apiKey) => ipcRenderer.invoke('config:set-api-key', { provider, apiKey }),
  getModelCatalog: (provider) => ipcRenderer.invoke('config:model-catalog', provider),
  selectWorkspace: () => ipcRenderer.invoke('workspace:select-dialog'),
  getDefaultWorkspace: () => ipcRenderer.invoke('workspace:default'),
  openExternalPath: (targetPath) => ipcRenderer.invoke('workspace:open-path', targetPath),
  listSessions: (workspace) => ipcRenderer.invoke('sessions:list', workspace),
  loadSession: (sessionId, workspace) => ipcRenderer.invoke('sessions:load', { sessionId, workspace }),
  loadSessionMessages: (sessionId, workspace, options) =>
    ipcRenderer.invoke('sessions:messages', { sessionId, workspace, ...(options || {}) }),
  clearSession: (sessionId, workspace) => ipcRenderer.invoke('sessions:clear', { sessionId, workspace }),
  deleteSession: (sessionId, workspace) => ipcRenderer.invoke('sessions:delete', { sessionId, workspace }),
  createSession: (workspace, title) => ipcRenderer.invoke('sessions:create', { workspace, title }),
  getWorkflowState: (workspace) => ipcRenderer.invoke('workflows:get-state', workspace),
  manageWorkflow: (toolName, args, workspace) => ipcRenderer.invoke('workflows:manage', { toolName, args, workspace }),
  getSkillsAndMcp: (workspace) => ipcRenderer.invoke('sys:skills-mcp', workspace),
  runDoctor: (workspace) => ipcRenderer.invoke('sys:doctor', workspace),
  getMemoryStats: () => ipcRenderer.invoke('sys:mem-stats'),
  listCheckpoints: (workspace) => ipcRenderer.invoke('checkpoints:list', workspace),
  restoreCheckpoint: (workspace, id, confirmed) => ipcRenderer.invoke('checkpoints:restore', { workspace, id, confirmed }),
  trimMemory: () => ipcRenderer.invoke('sys:trim-memory'),
  setGuiMode: (mode) => ipcRenderer.invoke('gui:set-mode', mode),
  getBotStatus: () => ipcRenderer.invoke('bot:status'),
  startBot: (workspace) => ipcRenderer.invoke('bot:start', workspace),
  stopBot: () => ipcRenderer.invoke('bot:stop'),
  setBotToken: (token, workspace) => ipcRenderer.invoke('bot:set-token', { token, workspace }),
  allowBotChat: (chatId) => ipcRenderer.invoke('bot:allow', { chatId }),
  listMcp: () => ipcRenderer.invoke('mcp:list'),
  connectMcp: (service, token, workspace) => ipcRenderer.invoke('mcp:connect', { service, token, workspace }),
  removeMcp: (service) => ipcRenderer.invoke('mcp:remove', { service }),
  getCommands: () => ipcRenderer.invoke('commands:list'),
  getCommandsHelp: () => ipcRenderer.invoke('commands:help'),
  getToolTitles: () => ipcRenderer.invoke('sys:tool-titles'),
  getTokenReport: () => ipcRenderer.invoke('sys:token-report'),
  getMemoryFacts: (workspace) => ipcRenderer.invoke('sys:memory-facts', workspace),
  rememberFact: (workspace, key, value) => ipcRenderer.invoke('sys:remember-fact', { workspace, key, value }),
  forgetFact: (workspace, key) => ipcRenderer.invoke('sys:forget-fact', { workspace, key }),
  windowControl: (action) => ipcRenderer.invoke('window:control', action),
});
