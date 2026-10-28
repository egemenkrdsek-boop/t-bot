const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = name => readFileSync(join(__dirname, '..', 'src', 'desktop', name), 'utf8');

function renderer(bridge = {}, elements = {}, documentMethods = {}) {
  const clipboardWrites = [];
  const context = {
    window: { tbot: bridge, matchMedia: () => ({ matches: false }), renderMetrics: { markdownCalls: 0, markdownChars: 0, maxMarkdownChars: 0 } },
    setTimeout, clearTimeout, setInterval, clearInterval,
    navigator: { clipboard: { writeText: async text => { clipboardWrites.push(text); } } },
    localStorage: { getItem: () => null },
    document: { getElementById: id => elements[id] || null, readyState: 'loading', addEventListener() {}, ...documentMethods },
  };
  vm.createContext(context);
  vm.runInContext(source('renderer/app.js').replace('  function parseMarkdown(mdText) {', '  function parseMarkdown(mdText) { window.renderMetrics.markdownCalls++; window.renderMetrics.markdownChars += (mdText || \'\').length; window.renderMetrics.maxMarkdownChars = Math.max(window.renderMetrics.maxMarkdownChars, (mdText || \'\').length);').replace('  // DOM Yüklendiğinde Başlat',
    '  window.test = { parseMarkdown, updateTelemetry, state, isToolError, setToolExpanded, switchSession, submitUserMessage, loadSessionsList, startThinking, stopThinking, updateModelDropdown, openConfigModal, renderApprovalRequest, respondApproval, applyAppVersion, transcriptEntries, renderedTranscriptEntries, pinnedTranscriptEntries, loadTranscriptMessages, transcriptPage, appendUserMessage, appendAssistantTextChunk, renderAssistantBuffer, finalizeAssistantMessage, handleToolStart, handleToolEnd, changeTextPage, clearChatTerminal, handleAgentEvent, copyTranscriptText, closeLightbox };\n  // DOM Yüklendiğinde Başlat'), context);
  return { ...context.window.test, document: context.document, renderMetrics: context.window.renderMetrics, clipboardWrites };
}

// A bounded DOM contract fixture, not a browser or a heap benchmark. It counts
// mounted transcript records and HTML/parser work while retaining raw fixtures.
function transcriptDom() {
  const metrics = { htmlWrites: 0, htmlChars: 0 };
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag; this.children = []; this.parentElement = null;
      this.className = ''; this.dataset = {}; this.attributes = {}; this.style = {};
      this.nodes = new Map(); this._html = ''; this.textContent = '';
      this.scrollTop = 0; this.scrollHeight = 1000; this.clientHeight = 400;
      this.classList = {
        contains: name => this.className.split(' ').includes(name),
        toggle: (name, enabled) => {
          const values = new Set(this.className.split(' ').filter(Boolean));
          const add = enabled === undefined ? !values.has(name) : enabled;
          if (add) values.add(name); else values.delete(name);
          this.className = [...values].join(' '); return add;
        },
        add: name => this.classList.toggle(name, true),
        remove: name => this.classList.toggle(name, false),
      };
    }
    set innerHTML(html) {
      this._html = html; metrics.htmlWrites++; metrics.htmlChars += html.length;
      this.children = []; this.nodes.clear();
      for (const selector of ['.assistant-message-body', '.tool-card-body', '.tool-badge', '.tool-duration', '.approval-args', '.approval-argument-pages', '[data-tool-toggle]', '[data-history-count]']) {
        const attribute = selector.startsWith('.') ? `class="${selector.slice(1)}` : selector.slice(1, -1);
        if (html.includes(attribute)) { const node = new Element(); node.parentElement = this; this.nodes.set(selector, node); }
      }
    }
    get innerHTML() { return this._html; }
    get nextSibling() { const list = this.parentElement?.children || []; return list[list.indexOf(this) + 1] || null; }
    appendChild(child) { child.remove(); child.parentElement = this; this.children.push(child); return child; }
    prepend(child) { child.remove(); child.parentElement = this; this.children.unshift(child); }
    insertBefore(child, next) { child.remove(); child.parentElement = this; const index = next ? this.children.indexOf(next) : this.children.length; this.children.splice(index, 0, child); }
    remove() { if (!this.parentElement) return; const list = this.parentElement.children; const i = list.indexOf(this); if (i >= 0) list.splice(i, 1); this.parentElement = null; }
    replaceWith(child) { const parent = this.parentElement; if (!parent) return; parent.insertBefore(child, this); this.remove(); }
    replaceChildren(...children) { this.innerHTML = ''; for (const child of children) this.appendChild(child); }
    querySelector(selector) { return this.nodes.get(selector) || null; }
    querySelectorAll() { return []; }
    setAttribute(name, value) { this.attributes[name] = value; }
    focus() { document.activeElement = this; }
    addEventListener() {}
    closest(selector) { let node = this; while (node) { if (selector.includes('.tool-card') && node.classList.contains('tool-card') || selector.includes('.message-wrapper') && node.classList.contains('message-wrapper') || selector.includes('.approval-card') && node.classList.contains('approval-card')) return node; node = node.parentElement; } return null; }
  }
  const feed = new Element();
  const input = new Element('textarea'); input.value = 'typing stays here';
  const elements = { 'chat-feed': feed, 'user-input': input };
  const findId = (root, id) => root.id === id ? root : root.children.map(child => findId(child, id)).find(Boolean);
  const document = {
    createElement: tag => new Element(tag),
    getElementById: id => elements[id] || findId(feed, id) || null,
    activeElement: input,
  };
  return { feed, input, elements, document, metrics, Element };
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
      if (name === '../windows-system.js') return {};
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
  const dom = transcriptDom();
  const sent = [];
  const ui = renderer({ respondApproval: (...args) => { sent.push(args); } }, dom.elements, dom.document);
  ui.renderApprovalRequest({ requestId: 'first', tool: 'shell', arguments: {} });
  ui.renderApprovalRequest({ requestId: 'second', tool: 'file_write', arguments: {} });
  assert.equal(dom.feed.children.filter(item => item.className === 'approval-card').length, 1);
  assert.equal(ui.state.currentApproval.requestId, 'first');
  assert.equal(ui.state.approvalQueue.length, 1);
  ui.respondApproval(false);
  assert.equal(sent[0][0], 'first');
  assert.equal(sent[0][1], false);
  assert.equal(dom.feed.children.filter(item => item.className === 'approval-card').length, 1);
  assert.equal(ui.state.currentApproval.requestId, 'second');
  ui.respondApproval(true);
  assert.equal(sent[1][0], 'second');
  assert.equal(sent[1][1], true);
  assert.equal(ui.state.currentApproval, null);
  assert.equal(ui.pinnedTranscriptEntries.size, 0);
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
      if (name === '../windows-system.js') return {};
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

test('automatic Windows trim helpers launch absolute PowerShell with no executable-search fallback', async () => {
  for (const desktop of [false, true]) {
    const calls = [];
    const expected = 'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    const context = {
      exports: {}, process: { platform: 'win32', pid: 1234, env: {}, memoryUsage: () => ({ rss: 1048576 }) },
      global: {}, setTimeout, clearTimeout,
      require: name => {
        if (name === 'electron') return { app: { getAppMetrics: () => [] } };
        if (name === 'node:os') return { default: { freemem: () => 1073741824 }, homedir: () => 'D:\\User' };
        if (name === 'node:path') return require('node:path');
        if (name === 'node:fs/promises') return { mkdir: async () => {} };
        if (name.endsWith('windows-system.js')) return { windowsSystemExecutable: name => { assert.equal(name, 'powershell'); return expected; } };
        if (name === 'node:child_process') return { execFile: (file, args, options, done) => { calls.push({ file, args, options }); done(new Error('simulated unavailable helper')); } };
        if (/tools\/(?:browser|computer|shell)\.js$/.test(name)) return {};
        throw new Error(`Unexpected dependency: ${name}`);
      },
    };
    vm.createContext(context);
    const code = desktop ? source('memory-trimmer.ts') : readFileSync(join(__dirname, '..', 'src', 'memory-guard.ts'), 'utf8');
    vm.runInContext(ts.transpileModule(code, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, context);
    if (desktop) await context.exports.trimDesktopMemory();
    else await context.exports.trimWindowsWorkingSet(true);
    assert.equal(calls.length, 1, 'failure must never retry a bare executable');
    assert.equal(calls[0].file, expected);
    assert.equal(calls[0].options.timeout, 5000);
    assert.equal(calls[0].options.windowsHide, true);
    assert.equal(calls[0].args[0], '-NoProfile');
    assert.equal(calls[0].args[1], '-NonInteractive');
    assert.ok(calls[0].args.includes('-Command'));
  }
});


test('initial config response keeps trusted package version outside persisted config', async () => {
  const config = { provider: 'openai', model: 'test' };
  let saved;
  const h = ipcHarness({ app: { getVersion: () => '2.1.0' }, loadConfig: async () => config, saveConfig: async value => { saved = value; } });
  const initial = await h.handlers.get('config:get')(h.event, { appVersion: '999.0.0' });
  assert.equal(initial.appVersion, '2.1.0');
  assert.equal(initial.config, config);
  assert.equal(config.appVersion, undefined);
  await h.handlers.get('config:save')(h.event, { appVersion: '999.0.0', config: { appVersion: '888.0.0' }, model: 'next' });
  assert.equal(saved, config);
  assert.equal(saved.model, 'next');
  assert.equal(saved.appVersion, undefined);
  assert.equal(saved.config, undefined);
  assert.equal((await h.handlers.get('config:get')(h.event)).appVersion, '2.1.0');
});

test('desktop versions share package metadata and malformed or missing values have a clear fallback', () => {
  const elements = [{}, {}];
  const ui = renderer({}, {}, { querySelectorAll: () => elements });
  ui.applyAppVersion('2.1.0');
  assert.equal(ui.state.appVersion, '2.1.0');
  for (const element of elements) assert.equal(element.textContent, '2.1.0');
  assert.equal(ui.document.title, 'T Bot 2.1.0 — Yerel Kodlama Asistanı');
  ui.applyAppVersion('2.1.0-rc.1+build.42');
  assert.equal(elements[0].textContent, '2.1.0-rc.1+build.42');
  for (const invalid of [undefined, null, {}, '<img src=x onerror=alert(1)>', '2.1.0<script>', '9'.repeat(100)]) {
    ui.applyAppVersion(invalid);
    assert.equal(ui.state.appVersion, '');
    assert.equal(ui.document.title, 'T Bot — Yerel Kodlama Asistanı');
    for (const element of elements) {
      assert.equal(element.textContent, '—');
      assert.equal(element.title, 'Sürüm bilgisi alınamadı');
      assert.equal(element.innerHTML, undefined);
    }
  }
  const html = source('renderer/index.html');
  assert.equal((html.match(/data-app-version/g) || []).length, 2);
  assert.doesNotMatch(html, /T Bot 2\.0|version">2\.0/);
});


test('large saved histories mount 40 records and paginate every original message and tool result', t => {
  const dom = transcriptDom();
  const ui = renderer({}, dom.elements, dom.document);
  const output = ('line of tool output\n').repeat(3000);
  const history = [];
  for (let i = 0; i < 1000; i++) {
    history.push({ role: 'user', content: `request ${i}` });
    history.push({ role: 'assistant', content: `answer ${i}`, toolCalls: [{ id: `tool-${i}`, name: 'shell', arguments: { command: 'test' } }] });
    history.push({ role: 'tool', toolCallId: `tool-${i}`, content: output });
  }
  ui.loadTranscriptMessages(history);
  assert.equal(history.length, 3000);
  assert.equal(ui.transcriptEntries.length, 3000);
  assert.equal(ui.renderedTranscriptEntries.size, 40);
  assert.ok(dom.feed.children.length <= 41);
  assert.equal(ui.transcriptEntries.filter(entry => entry.kind === 'tool').length, 1000);
  assert.equal(ui.transcriptEntries[2].result, output);
  assert.equal(ui.transcriptEntries[2].call.id, 'tool-0');
  // Closed tool results produce no result HTML, even across thousands of records.
  for (const entry of ui.renderedTranscriptEntries) if (entry.kind === 'tool') assert.equal(entry.element.querySelector('.tool-card-body').innerHTML, '');
  assert.ok(dom.metrics.htmlChars < 100_000, `initial HTML work was ${dom.metrics.htmlChars}`);
  t.diagnostic(`Fixture: ${history.length} messages, ${history.reduce((sum, message) => sum + message.content.length, 0)} raw content characters; initial ${dom.metrics.htmlChars} HTML characters written, ${ui.renderedTranscriptEntries.size} mounted records. Shared fixture strings; not a heap measurement.`);
  ui.transcriptPage('first');
  assert.equal(ui.transcriptEntries[0].element.transcriptEntry.text, 'request 0');
  assert.equal(ui.renderedTranscriptEntries.size, 40);
  ui.transcriptPage('latest');
  assert.equal(ui.transcriptEntries.at(-1).element.transcriptEntry.result, output);
  assert.equal(ui.transcriptEntries[0].element, null);
  assert.equal(dom.input.value, 'typing stays here');
  assert.equal(dom.document.activeElement, dom.input);
  ui.clearChatTerminal();
  assert.equal(ui.transcriptEntries.length, 0);
  assert.equal(ui.renderedTranscriptEntries.size, 0);
  assert.equal(history[2].content, output);
});

test('closed tool output stays lazy, pages on demand, and releases its body and screenshot on close', () => {
  const dom = transcriptDom();
  const ui = renderer({}, dom.elements, dom.document);
  const output = 'begin\n' + 'x'.repeat(90_000) + '\ndata:image/png;base64,YQ==\nend';
  ui.handleToolStart({ id: 'one', name: 'shell', arguments: { command: 'inspect', long: 'z'.repeat(30_000) } });
  ui.handleToolEnd({ id: 'one', name: 'shell' }, output);
  ui.stopThinking();
  const entry = ui.transcriptEntries[0];
  const card = entry.element;
  const body = card.querySelector('.tool-card-body');
  assert.equal(body.innerHTML, '');
  ui.setToolExpanded(card, true);
  assert.ok(body.innerHTML.length < 35_000);
  assert.ok(body.innerHTML.includes('begin'));
  assert.equal(body.children.length, 1);
  assert.match(body.children[0].innerHTML, /data:image\/png;base64,YQ==/);
  const button = new dom.Element('button'); button.dataset = { textSection: 'result', textPage: 'latest' }; body.appendChild(button);
  ui.changeTextPage(button);
  assert.ok(body.innerHTML.includes('end'));
  assert.equal(entry.result, output);
  ui.setToolExpanded(card, false);
  assert.equal(body.innerHTML, '');
  assert.equal(body.children.length, 0);
});

test('stream work is bounded to 16000 characters while full text stays reachable and pinned across history pages', t => {
  const dom = transcriptDom();
  const ui = renderer({}, dom.elements, dom.document);
  ui.loadTranscriptMessages(Array.from({ length: 100 }, (_, i) => ({ role: 'user', content: `old ${i}` })));
  const chunk = 'stream line\n'.repeat(500);
  for (let i = 0; i < 80; i++) { ui.appendAssistantTextChunk(chunk); ui.renderAssistantBuffer(); }
  const entry = ui.transcriptEntries.at(-1);
  assert.equal(entry.textLength, chunk.length * 80);
  assert.equal(entry.chunks.length, 80);
  assert.equal(ui.renderMetrics.maxMarkdownChars, 16_000);
  assert.ok(ui.renderMetrics.markdownChars < entry.textLength * 4);
  t.diagnostic(`80 stream updates: ${entry.textLength} final characters, ${ui.renderMetrics.markdownChars} total Markdown input characters versus ${chunk.length * 80 * 81 / 2} for full-prefix reparse; max parse input ${ui.renderMetrics.maxMarkdownChars}.`);
  ui.transcriptPage('older');
  assert.ok(entry.element);
  assert.equal(ui.renderedTranscriptEntries.size, 41);
  assert.equal(ui.pinnedTranscriptEntries.has(entry), true);
  const button = new dom.Element('button'); button.dataset = { textSection: 'assistant', textPage: 'previous' }; entry.element.appendChild(button);
  ui.changeTextPage(button);
  const calls = ui.renderMetrics.markdownCalls;
  ui.appendAssistantTextChunk('new tail'); ui.renderAssistantBuffer();
  assert.equal(ui.renderMetrics.markdownCalls, calls);
  ui.finalizeAssistantMessage();
  assert.equal(entry.text, chunk.repeat(80) + 'new tail');
  assert.equal(entry.chunks, null);
  assert.equal(entry.element, null);
  ui.transcriptPage('latest');
  assert.ok(entry.element);
  assert.equal(ui.renderMetrics.maxMarkdownChars, 16_000);
  assert.equal(ui.pinnedTranscriptEntries.size, 0);
  assert.equal(dom.input.value, 'typing stays here');
});

test('active tools and approval stay pinned while completed history is bounded and cancellation releases pins', () => {
  const dom = transcriptDom();
  const ui = renderer({ respondApproval: () => Promise.resolve({ handled: true }) }, dom.elements, dom.document);
  ui.loadTranscriptMessages(Array.from({ length: 100 }, (_, i) => ({ role: 'user', content: `old ${i}` })));
  ui.handleToolStart({ id: 'running', name: 'shell', arguments: {} });
  ui.renderApprovalRequest({ requestId: 'approval', tool: 'shell', arguments: {} });
  ui.transcriptPage('older');
  assert.equal(ui.pinnedTranscriptEntries.size, 2);
  assert.ok(dom.document.getElementById('live-approval-card'));
  const tool = ui.transcriptEntries.find(entry => entry.kind === 'tool');
  assert.ok(tool.element);
  ui.handleAgentEvent({ type: 'turn_end' });
  assert.equal(ui.pinnedTranscriptEntries.size, 0);
  assert.equal(ui.renderedTranscriptEntries.size, 40);
  assert.equal(ui.state.currentApproval, null);
  assert.equal(ui.state.thinkingTimerId, null);
  assert.equal(tool.status, 'stopped');
  assert.equal(tool.element, null);
});


test('long user text and approval details expose every part in bounded pages without losing approval identity', () => {
  const dom = transcriptDom();
  const decisions = [];
  const ui = renderer({ respondApproval: (...args) => { decisions.push(args); } }, dom.elements, dom.document);
  const text = 'a'.repeat(16_000) + 'b'.repeat(16_000) + 'c'.repeat(16_000) + 'tail';
  ui.appendUserMessage(text);
  const entry = ui.transcriptEntries[0];
  const page = (section, action, element = entry.element) => {
    const button = new dom.Element('button'); button.dataset = { textSection: section, textPage: action }; element.appendChild(button); ui.changeTextPage(button);
  };
  assert.equal(entry.textPage, undefined);
  assert.ok(entry.element.innerHTML.includes('a'.repeat(100)));
  page('user', 'next');
  assert.equal(entry.textPage, 16_000);
  assert.ok(entry.element.innerHTML.includes('b'.repeat(100)));
  page('user', 'next');
  assert.equal(entry.textPage, 32_000);
  assert.ok(entry.element.innerHTML.includes('c'.repeat(100)));
  page('user', 'next');
  assert.equal(entry.textPage, 48_000);
  assert.ok(entry.element.innerHTML.includes('tail'));
  page('user', 'latest');
  page('user', 'previous');
  assert.equal(entry.textPage, text.length - 32_000);
  assert.equal(entry.text, text);
  ui.renderApprovalRequest({ requestId: 'large-approval', tool: 'file_write', description: 'review full arguments', arguments: { content: text } });
  const approval = ui.transcriptEntries.at(-1);
  assert.equal(approval.kind, 'approval');
  assert.ok(approval.element.innerHTML.length < 18_000);
  page('approval', 'latest', approval.element);
  assert.ok(approval.element.querySelector('.approval-args').textContent.includes('tail'));
  assert.equal(ui.state.currentApproval.requestId, 'large-approval');
  ui.respondApproval(false);
  assert.equal(decisions[0][0], 'large-approval');
  assert.equal(decisions[0][1], false);
  assert.equal(approval.kind, 'notice');
  assert.equal(ui.pinnedTranscriptEntries.size, 0);
});


test('hundreds of completed live tools stay bounded while a reader remains on older history', () => {
  const dom = transcriptDom();
  const ui = renderer({}, dom.elements, dom.document);
  ui.loadTranscriptMessages(Array.from({ length: 100 }, (_, i) => ({ role: 'user', content: `saved ${i}` })));
  ui.transcriptPage('first');
  const first = ui.transcriptEntries[0].element;
  const output = 'result line\n'.repeat(5000);
  for (let i = 0; i < 200; i++) {
    const call = { id: `live-${i}`, name: 'file_read', arguments: { path: 'fixture.txt' } };
    ui.handleToolStart(call);
    assert.equal(ui.renderedTranscriptEntries.size, 41);
    ui.handleToolEnd(call, output);
    assert.equal(ui.renderedTranscriptEntries.size, 40);
    assert.equal(dom.feed.scrollTop, 0);
  }
  ui.stopThinking();
  assert.equal(ui.transcriptEntries.length, 300);
  assert.equal(ui.transcriptEntries[0].element, first);
  assert.equal(ui.transcriptEntries.at(-1).result, output);
  assert.equal(ui.pinnedTranscriptEntries.size, 0);
  assert.equal(dom.input.value, 'typing stays here');
  ui.transcriptPage('latest');
  assert.equal(ui.renderedTranscriptEntries.size, 40);
  assert.equal(ui.transcriptEntries.at(-1).element.querySelector('.tool-card-body').innerHTML, '');
});

test('history interactions use only a short opacity transition suppressed by reduced motion', () => {
  const css = source('renderer/styles.css');
  assert.match(css, /transition: opacity 120ms ease/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*transition: none !important/);
  assert.doesNotMatch(css.slice(css.indexOf('/* History is paged')), /will-change|animation:/);
});


test('full-copy actions use original raw text and tool output beyond the rendered page', async () => {
  const dom = transcriptDom();
  const ui = renderer({}, dom.elements, dom.document);
  const fullText = 'first page\n' + 'message body '.repeat(5000) + '\nlast page';
  ui.appendAssistantTextChunk(fullText);
  ui.renderAssistantBuffer();
  const entry = ui.transcriptEntries[0];
  const button = new dom.Element('button'); button.dataset.copyFullText = 'assistant'; entry.element.appendChild(button);
  await ui.copyTranscriptText(button);
  assert.equal(ui.clipboardWrites[0], fullText);
  ui.finalizeAssistantMessage();
  const call = { id: 'copy-tool', name: 'file_read', arguments: { path: 'fixture' } };
  ui.handleToolStart(call); ui.handleToolEnd(call, fullText); ui.stopThinking();
  const tool = ui.transcriptEntries.at(-1);
  const copy = new dom.Element('button'); copy.dataset.copyFullText = 'result'; tool.element.appendChild(copy);
  await ui.copyTranscriptText(copy);
  assert.equal(ui.clipboardWrites[1], fullText);
  assert.match(ui.parseMarkdown('```js\nconst x = 1;\n```'), /Görünür kodu kopyala/);
});

test('clearing history releases lightbox data and download closures alongside transcript and pins', () => {
  const dom = transcriptDom();
  const image = new dom.Element('img'); image.src = 'data:image/png;base64,YQ==';
  const download = new dom.Element('button'); download.onclick = () => image.src;
  dom.elements['lightbox-img'] = image; dom.elements['lightbox-btn-download'] = download;
  const ui = renderer({}, dom.elements, dom.document);
  ui.appendAssistantTextChunk('unfinished stream');
  assert.equal(ui.pinnedTranscriptEntries.size, 1);
  ui.clearChatTerminal();
  assert.equal(image.src, '');
  assert.equal(download.onclick, null);
  assert.equal(ui.transcriptEntries.length, 0);
  assert.equal(ui.pinnedTranscriptEntries.size, 0);
  assert.equal(ui.renderedTranscriptEntries.size, 0);
});


test('selected session load failures and missing IDs fail closed before any provider or session creation', async () => {
  for (const failure of [new Error('Session load budget exceeded'), new Error('Damaged session segment'), null]) {
    let providers = 0, runs = 0, created = 0, saved = 0;
    const h = ipcHarness({
      SessionStore: class {
        async get(id, workspace) { assert.equal(id, 'selected'); assert.equal(workspace, '/workspace'); if (failure) throw failure; return null; }
        async save() { saved++; }
      },
      createSession: () => { created++; return { id: 'replacement', messages: [] }; },
      resolveProviderConfig: async () => { providers++; return {}; },
      createProvider: () => { providers++; return {}; },
      runAgent: async () => { runs++; return []; },
    });
    const result = await h.handlers.get('agent:start-turn')(h.event, { sessionId: 'selected', message: 'continue' });
    assert.equal(result.ok, false);
    assert.equal(result.sessionId, 'selected');
    assert.match(result.error, failure ? /Oturum yüklenemedi/ : /Seçili oturum bulunamadı/);
    if (failure) assert.ok(result.error.includes(failure.message));
    assert.equal(providers, 0);
    assert.equal(runs, 0);
    assert.equal(created, 0);
    assert.equal(saved, 0);
    assert.equal(h.context.turnInProgress, false);
    assert.equal(h.context.turnAbortController, null);
    assert.equal(h.context.activeTurnContext, null);
    // The failure released the reservation: the next attempt reports its own load error.
    assert.match((await h.handlers.get('agent:start-turn')(h.event, { sessionId: 'selected', message: 'retry' })).error, failure ? /Oturum yüklenemedi/ : /Seçili oturum bulunamadı/);
  }
});

test('explicit new sessions remain supported and resumed sessions preserve host revision identity', async () => {
  const revision = Symbol('session revision');
  const existing = { id: 'selected', messages: [], [revision]: 'revision-7' };
  let created = 0, saved;
  const h = ipcHarness({
    SessionStore: class { async get() { return existing; } async save(value) { saved = value; } },
    createSession: () => { created++; return { id: 'new', messages: [] }; },
    loadConnections: async () => ({}), getDesktopMemoryStats: () => ({}),
    runAgent: async (_input, options) => { assert.equal(options.session[revision], options.session.id === 'selected' ? 'revision-7' : undefined); return []; },
  });
  h.context.mainWindow.isDestroyed = () => false; h.context.mainWindow.webContents.send = () => {};
  assert.equal((await h.handlers.get('agent:start-turn')(h.event, { sessionId: 'selected', message: 'resume' })).ok, true);
  assert.equal(saved, existing);
  assert.equal(saved[revision], 'revision-7');
  assert.equal(created, 0);
  assert.equal((await h.handlers.get('agent:start-turn')(h.event, { message: 'new conversation' })).ok, true);
  assert.equal(created, 1);
  assert.equal(saved.id, 'new');
});
