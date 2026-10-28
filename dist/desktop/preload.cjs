const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tbot', {
  startTurn: (payload) => ipcRenderer.invoke('agent:start-turn', payload),
  abortTurn: () => ipcRenderer.invoke('agent:abort-turn'),
  respondApproval: (requestId, approved, alwaysAllowSession) =>
    ipcRenderer.invoke('agent:approval-response', { requestId, approved, alwaysAllowSession }),
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
  onMemoryUpdate: (callback) => {
    const listener = (_e, data) => callback(data);
    ipcRenderer.on('sys:memory-update', listener);
    return () => ipcRenderer.removeListener('sys:memory-update', listener);
  },
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (partialConfig) => ipcRenderer.invoke('config:save', partialConfig),
  setApiKey: (provider, apiKey) => ipcRenderer.invoke('config:set-api-key', { provider, apiKey }),
  getModelCatalog: () => ipcRenderer.invoke('config:model-catalog'),
  selectWorkspace: () => ipcRenderer.invoke('workspace:select-dialog'),
  openExternalPath: (targetPath) => ipcRenderer.invoke('workspace:open-path', targetPath),
  listSessions: (workspace) => ipcRenderer.invoke('sessions:list', workspace),
  loadSession: (sessionId, workspace) => ipcRenderer.invoke('sessions:load', { sessionId, workspace }),
  deleteSession: (sessionId, workspace) => ipcRenderer.invoke('sessions:delete', { sessionId, workspace }),
  createSession: (workspace, title) => ipcRenderer.invoke('sessions:create', { workspace, title }),
  getWorkflowState: (workspace) => ipcRenderer.invoke('workflows:get-state', workspace),
  manageWorkflow: (toolName, args, workspace) => ipcRenderer.invoke('workflows:manage', { toolName, args, workspace }),
  getSkillsAndMcp: (workspace) => ipcRenderer.invoke('sys:skills-mcp', workspace),
  runDoctor: (workspace) => ipcRenderer.invoke('sys:doctor', workspace),
  getMemoryStats: () => ipcRenderer.invoke('sys:mem-stats'),
  trimMemory: () => ipcRenderer.invoke('sys:trim-memory'),
  windowControl: (action) => ipcRenderer.invoke('window:control', action),
});
