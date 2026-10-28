const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = name => readFileSync(join(__dirname, '..', 'src', 'desktop', name), 'utf8');

function renderer(bridge = {}, elements = {}, documentMethods = {}) {
  const context = {
    window: { tbot: bridge, matchMedia: () => ({ matches: false }) },
    setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: { getItem: () => null },
    document: { getElementById: id => elements[id] || null, readyState: 'loading', addEventListener() {}, ...documentMethods },
  };
  vm.createContext(context);
  vm.runInContext(source('renderer/app.js').replace('  // DOM Yüklendiğinde Başlat',
    '  window.test = { parseMarkdown, updateTelemetry, state, isToolError, setToolExpanded, switchSession, submitUserMessage, loadSessionsList, startThinking, stopThinking, updateModelDropdown, openConfigModal, renderApprovalRequest, respondApproval };\n  // DOM Yüklendiğinde Başlat'), context);
  return context.window.test;
}

test('assistant markdown treats HTML and dangerous URLs as inert text', () => {
  const { parseMarkdown } = renderer();
  for (const input of [
    '<img src=x onerror="window.tbot.startTurn({message:\'oops\'})">',
    '<svg onload=alert(1)>',
    '[run](javascript:alert(1))',
    '<a href="file:///C:/secret">open</a>',
  ]) {
    const html = parseMarkdown(input);
    assert.doesNotMatch(html, /<(?:img|svg|a)\b/i);
  }
  const formatted = parseMarkdown('**bold**\n`<unsafe>`\n```js\n<script>alert(1)</script>\n```');
  assert.match(formatted, /<strong>bold<\/strong>/);
  assert.match(formatted, /&lt;script&gt;/);
  assert.doesNotMatch(formatted, /onclick=/);
  assert.match(formatted, /<code>&lt;unsafe&gt;<\/code>/);
});

test('RAM telemetry uses all Electron processes and preserves measured zero values', () => {
  const { state, updateTelemetry } = renderer();
  updateTelemetry({ totalWorkingSetMB: 176.2, mainMB: 40 });
  assert.equal(state.telemetry.ramMB, 176.2);
  updateTelemetry({ totalWorkingSetMB: 0, mainMB: 40 });
  assert.equal(state.telemetry.ramMB, 0);
  assert.equal(state.telemetry.savingsPercent, 0);
});

function ipcHarness(overrides = {}) {
  const handlers = new Map();
  const frame = {};
  const webContents = { mainFrame: frame };
  const context = {
    ipcMain: { handle: (channel, listener) => handlers.set(channel, listener) },
    mainWindow: { webContents }, activeTurnContext: null, turnInProgress: false, turnAbortController: null,
    desktopQuitting: false, activeMcpConnections: new Set(),
    closeDesktopMcp: async connection => { if (context.activeMcpConnections.delete(connection)) await connection.close(); },
    AbortController, setTimeout, clearTimeout, randomUUID: () => 'approval-id',
    getWorkspacePermission: () => 'ask', TOOL_TITLE_MAP: {}, formatToolTitle: value => value,
    resolve: path => path, statSync: () => ({ isDirectory: () => true }),
    getDefaultWorkspace: () => '/workspace', loadConfig: async () => ({}),
    resolveProviderConfig: async () => ({}), createProvider: () => ({}),
    configDirectory: () => '/config', SessionStore: class {}, createSession: () => ({ id: 'session', messages: [] }),
    ...overrides,
  };
  const main = source('main.ts');
  const body = main.slice(main.indexOf('function registerIpcHandlers()'), main.indexOf('\nfunction startPeriodicMemoryUpdater'));
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + '\nregisterIpcHandlers();', context);
  return { context, handlers, event: { sender: webContents, senderFrame: frame } };
}

test('IPC rejects unrelated webContents and subframes', () => {
  const { handlers, event } = ipcHarness();
  assert.throws(() => handlers.get('config:get')({ ...event, sender: {} }), /Güvenilmeyen/);
  assert.throws(() => handlers.get('config:get')({ ...event, senderFrame: {} }), /Güvenilmeyen/);
});

test('turn reservation rejects overlap and cancellation also covers asynchronous startup', async () => {
  let resolveConfig;
  const config = new Promise(resolve => { resolveConfig = resolve; });
  const { handlers, event, context } = ipcHarness({ loadConfig: () => config });
  const start = handlers.get('agent:start-turn');
  const first = start(event, { message: 'first' });
  assert.equal(context.turnInProgress, true);
  assert.equal((await start(event, { message: 'second' })).ok, false);
  assert.equal(handlers.get('agent:abort-turn')(event).aborted, true);
  resolveConfig({});
  const result = await first;
  assert.equal(result.aborted, true);
  assert.equal(context.turnInProgress, false);
  assert.equal(context.turnAbortController, null);
});

test('invalid attachments are rejected before provider or workspace work', async () => {
  const { handlers, event } = ipcHarness({ loadConfig: () => { throw new Error('must not run'); } });
  const result = await handlers.get('agent:start-turn')(event, { message: 'image', images: [{ mimeType: 'image/png', data: '<script>' }] });
  assert.equal(result.ok, false);
  assert.match(result.error, /görsel/);
});

test('settings save preserves the loaded config revision identity and other model efforts', async () => {
  const config = { provider: 'openai', model: 'old', efforts: { 'openai:old': 'low' } };
  let saved;
  const { handlers, event } = ipcHarness({ loadConfig: async () => config, saveConfig: async value => { saved = value; } });
  await handlers.get('config:save')(event, { model: 'new', efforts: { 'openai:new': 'high' }, workspacePermissions: { '/': 'allow' } });
  assert.equal(saved, config);
  assert.equal(saved.model, 'new');
  assert.equal(saved.efforts['openai:old'], 'low');
  assert.equal(saved.efforts['openai:new'], 'high');
  assert.equal(saved.workspacePermissions, undefined);
});

test('enabled MCP tools reach the agent and close after success or failure', async () => {
  for (const fail of [false, true]) {
    let closed = 0;
    const connection = { definitions: [{ name: 'mcp_tool' }], close: async () => { closed++; } };
    // Keep sender identity from the actual harness, while stubbing host services.
    const h = ipcHarness({
      loadConnections: async () => ({ service: { enabled: true }, disabled: { enabled: false } }),
      getMcpToken: async () => 'token', connectMcp: async () => connection,
      SessionStore: class { async save() {} }, getDesktopMemoryStats: () => ({}),
      runAgent: async input => {
        assert.equal(input.mcpTools.length, 1);
        assert.equal(input.mcpTools[0], connection);
        if (fail) throw new Error('provider failure');
        return [];
      },
    });
    h.context.mainWindow.isDestroyed = () => false;
    h.context.mainWindow.webContents.send = () => {};
    const result = await h.handlers.get('agent:start-turn')(h.event, { message: 'hello' });
    assert.equal(result.ok, !fail);
    assert.equal(closed, 1);
  }
});

test('renderer policy blocks remote scripts, connections, objects and inline event handlers', () => {
  const html = source('renderer/index.html');
  assert.match(html, /script-src 'self'/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /object-src 'none'/);
  assert.doesNotMatch(html + source('renderer/app.js'), /\son(?:click|error|load)=/);
});

function quitHarness(cleanup, timeoutMs = 100) {
  const listeners = new Map();
  let aborts = 0, quits = 0;
  let finished;
  const done = new Promise(resolve => { finished = resolve; });
  const lifecycle = {
    on: (name, listener) => listeners.set(name, listener),
    quit: () => { quits++; finished(); },
  };
  const context = { exports: {}, setTimeout, clearTimeout };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(source('quit-cleanup.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  context.exports.registerDesktopQuitCleanup(lifecycle, () => { aborts++; }, cleanup, timeoutMs);
  return { done, listeners, counts: () => ({ aborts, quits }) };
}

test('actual quit aborts and cleans once; tray hide does not start cleanup', async () => {
  let cleanups = 0, finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const h = quitHarness(async () => { cleanups++; await pending; });
  assert.equal(h.listeners.has('hide'), false);
  assert.equal(h.listeners.has('close'), false);
  assert.deepEqual(h.counts(), { aborts: 0, quits: 0 });
  let prevented = 0;
  const event = { preventDefault: () => { prevented++; } };
  h.listeners.get('before-quit')(event);
  h.listeners.get('before-quit')(event);
  await Promise.resolve();
  assert.equal(cleanups, 1);
  assert.equal(prevented, 2);
  finish();
  await h.done;
  assert.deepEqual(h.counts(), { aborts: 1, quits: 1 });
  h.listeners.get('before-quit')(event);
  assert.equal(prevented, 2);
});

test('a hanging cleanup cannot block application quit indefinitely', async () => {
  const h = quitHarness(() => new Promise(() => {}), 15);
  h.listeners.get('before-quit')({ preventDefault() {} });
  await h.done;
  assert.deepEqual(h.counts(), { aborts: 1, quits: 1 });
});


test('tool status follows failure envelopes and shell exit status, not words inside output', () => {
  const { isToolError } = renderer();
  assert.equal(isToolError('0 errors, 0 failures'), false);
  assert.equal(isToolError('const error = new Error("failure")'), false);
  assert.equal(isToolError('Error: this is document content', 'file_read'), false);
  assert.equal(isToolError('Araç Hatası: access denied'), true);
  assert.equal(isToolError('Tool error: denied'), true);
  assert.equal(isToolError('error examples\nExit code: 0', 'shell'), false);
  assert.equal(isToolError('output\nExit code: 2', 'shell'), true);
  assert.equal(isToolError('output\nExit code: signal SIGTERM', 'shell'), true);
  assert.equal(isToolError('output\nTimed out; process tree termination attempted', 'shell'), true);
});

test('tool accordion changes both accessibility state and body visibility', () => {
  const { setToolExpanded } = renderer();
  const classes = new Set();
  const bodyClasses = new Set(['hidden']);
  const toggle = set => (name, enabled) => enabled ? set.add(name) : set.delete(name);
  let expanded;
  const card = {
    classList: { toggle: toggle(classes) },
    querySelector: selector => selector === '[data-tool-toggle]'
      ? { setAttribute: (_name, value) => { expanded = value; } }
      : { classList: { toggle: toggle(bodyClasses) } },
  };
  setToolExpanded(card, true);
  assert.equal(expanded, 'true');
  assert.equal(classes.has('expanded'), true);
  assert.equal(bodyClasses.has('hidden'), false);
  setToolExpanded(card, false);
  assert.equal(expanded, 'false');
  assert.equal(bodyClasses.has('hidden'), true);
});

test('session loading reserves navigation and sending until the history is ready', async () => {
  let finish, loads = 0, turns = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const send = { disabled: false };
  const ui = renderer({
    loadSession: () => { loads++; return pending; },
    startTurn: () => { turns++; },
  }, { 'btn-send': send });
  const loading = ui.switchSession('first');
  assert.equal(ui.state.sessionLoading, true);
  assert.equal(send.disabled, true);
  await ui.switchSession('second');
  await ui.submitUserMessage();
  assert.equal(loads, 1);
  assert.equal(turns, 0);
  assert.equal(ui.state.currentSessionId, 'first');
  finish({ messages: [] });
  await loading;
  assert.equal(ui.state.sessionLoading, false);
  assert.equal(send.disabled, false);
});

test('stale session list responses cannot overwrite the current workspace', async () => {
  const requests = [];
  const count = { textContent: '' };
  const ui = renderer({ listSessions: () => new Promise(resolve => requests.push(resolve)) }, { 'sessions-count': count });
  ui.state.workspace = 'first';
  const old = ui.loadSessionsList();
  ui.state.workspace = 'second';
  const latest = ui.loadSessionsList();
  requests[1]([{}, {}]);
  await latest;
  assert.equal(count.textContent, 2);
  requests[0]([{}]);
  await old;
  assert.equal(count.textContent, 2);
});

test('thinking time and timer remain continuous between tool events', () => {
  const ui = renderer();
  ui.startThinking('first');
  ui.state.thinkingStartTime = 123;
  const timer = ui.state.thinkingTimerId;
  ui.startThinking('second', 2);
  assert.equal(ui.state.thinkingStartTime, 123);
  assert.equal(ui.state.thinkingTimerId, timer);
  ui.stopThinking();
  assert.equal(ui.state.thinkingTimerId, null);
});

test('approval IPC requires literal boolean authorization', () => {
  let settled;
  const activeTurnContext = { pendingApprovals: new Map([['request', value => { settled = value; }]]), alwaysAllowSession: false };
  const h = ipcHarness({ activeTurnContext });
  h.handlers.get('agent:approval-response')(h.event, { requestId: 'request', approved: 'false', alwaysAllowSession: true });
  assert.equal(settled, false);
  assert.equal(activeTurnContext.alwaysAllowSession, false);
});

test('active desktop sessions cannot be deleted through IPC', async () => {
  const h = ipcHarness({ activeTurnContext: { sessionId: 'running' } });
  await assert.rejects(h.handlers.get('sessions:delete')(h.event, { sessionId: 'running' }), /Çalışan oturum/);
});

test('memory trim requests share one in-flight operation', async () => {
  const context = {
    exports: {}, process: { platform: 'linux', memoryUsage: () => ({ rss: 1048576 }) },
    global: {}, setTimeout, clearTimeout,
    require: name => {
      if (name === 'electron') return { app: { getAppMetrics: () => [] } };
      if (name === 'node:os') return { default: { freemem: () => 1073741824 } };
      if (name === 'node:child_process') return {};
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(source('memory-trimmer.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  const first = context.exports.trimDesktopMemory();
  const second = context.exports.trimDesktopMemory();
  assert.equal(first, second);
  assert.equal((await first).freedMB, 0);
  assert.doesNotMatch(source('memory-trimmer.ts'), /LoadFrom|OutputAssembly/);
});


test('parallel approval requests display one prompt at a time and keep request identities', () => {
  const cards = [];
  const card = () => ({ className: '', id: '', innerHTML: '', classList: { remove() {} }, style: {} });
  const sent = [];
  const ui = renderer({ respondApproval: (...args) => { sent.push(args); } }, {
    'chat-feed': { appendChild: value => cards.push(value), scrollHeight: 0, scrollTop: 0, clientHeight: 100 },
  }, { createElement: card });
  ui.renderApprovalRequest({ requestId: 'first', tool: 'shell', arguments: {} });
  ui.renderApprovalRequest({ requestId: 'second', tool: 'file_write', arguments: {} });
  assert.equal(cards.length, 1);
  assert.equal(ui.state.currentApproval.requestId, 'first');
  assert.equal(ui.state.approvalQueue.length, 1);
  ui.respondApproval(false);
  assert.equal(sent[0][0], 'first');
  assert.equal(sent[0][1], false);
  assert.equal(cards.length, 2);
  assert.equal(ui.state.currentApproval.requestId, 'second');
  ui.respondApproval(true);
  assert.equal(sent[1][0], 'second');
  assert.equal(sent[1][1], true);
  assert.equal(ui.state.currentApproval, null);
});

test('a hung MCP close has a bounded deadline and cannot retain the turn lock', async () => {
  let calls = 0;
  const connection = { close: () => { calls++; return new Promise(() => {}); } };
  const context = {
    activeMcpConnections: new Set([connection]),
    setTimeout: callback => setTimeout(callback, 10), clearTimeout,
  };
  const main = source('main.ts');
  const close = main.slice(main.indexOf('async function closeDesktopMcp'), main.indexOf('\nregisterDesktopQuitCleanup'));
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(close, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  await context.closeDesktopMcp(connection);
  await context.closeDesktopMcp(connection);
  assert.equal(calls, 1);
  assert.equal(context.activeMcpConnections.size, 0);
});


test('approval is registered before sending and a truthy YOLO string does not bypass it', async () => {
  let approved;
  const h = ipcHarness({
    loadConnections: async () => ({}),
    SessionStore: class { async save() {} }, getDesktopMemoryStats: () => ({}),
    runAgent: async input => { approved = await input.approve({ tool: 'shell', arguments: {}, description: 'command' }); return []; },
  });
  h.context.mainWindow.isDestroyed = () => false;
  h.context.mainWindow.webContents.send = (channel, request) => {
    if (channel === 'agent:approval-request') {
      const result = h.handlers.get('agent:approval-response')(h.event, { requestId: request.requestId, approved: false });
      assert.equal(result.handled, true);
    }
  };
  assert.equal((await h.handlers.get('agent:start-turn')(h.event, { message: 'hello', yolo: 'false' })).ok, true);
  assert.equal(approved, false);
});


test('hidden desktop pressure cleanup respects thresholds, single flight and a two-minute cooldown', async () => {
  let now = 1_000_000, collections = 0;
  const context = {
    exports: {}, process: { platform: 'linux', memoryUsage: () => ({ rss: 1048576 }) },
    global: { gc: () => { collections++; } }, setTimeout, clearTimeout,
    Date: { now: () => now },
    require: name => {
      if (name === 'electron') return { app: { getAppMetrics: () => [] } };
      if (name === 'node:os') return { default: { freemem: () => 1073741824 } };
      if (name === 'node:child_process') return {};
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(source('memory-trimmer.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  const trim = context.exports.trimDesktopMemoryUnderPressure;
  assert.equal(await trim(undefined, { systemFreeGB: 1, totalWorkingSetMB: 300 }), undefined);
  assert.equal(collections, 0);
  const first = trim(undefined, { systemFreeGB: 0.2, totalWorkingSetMB: 200 });
  await trim(undefined, { systemFreeGB: 0.2, totalWorkingSetMB: 200 });
  await first;
  assert.equal(collections, 1);
  now += 119_999;
  await trim(undefined, { systemFreeGB: 0.2, totalWorkingSetMB: 200 });
  assert.equal(collections, 1);
  now++;
  await trim(undefined, { systemFreeGB: 2, totalWorkingSetMB: 800 });
  assert.equal(collections, 2);
  // Even a successful explicit manual trim holds off automatic trims afterward.
  now += 120_000;
  await context.exports.trimDesktopMemory();
  await trim(undefined, { systemFreeGB: 0.1, totalWorkingSetMB: 800 });
  assert.equal(collections, 3);
  assert.doesNotMatch(source('memory-trimmer.ts'), /session\.messages|reclaimMemory/);
});
