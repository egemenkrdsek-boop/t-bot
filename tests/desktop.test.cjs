const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = name => readFileSync(join(__dirname, '..', 'src', 'desktop', name), 'utf8');

function renderer() {
  const context = {
    window: { tbot: {}, matchMedia: () => ({ matches: false }) },
    localStorage: { getItem: () => null },
    document: { getElementById: () => null, readyState: 'loading', addEventListener() {} },
  };
  vm.createContext(context);
  vm.runInContext(source('renderer/app.js').replace('  // DOM Yüklendiğinde Başlat',
    '  window.test = { parseMarkdown, updateTelemetry, state };\n  // DOM Yüklendiğinde Başlat'), context);
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
    AbortController, resolve: path => path, statSync: () => ({ isDirectory: () => true }),
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
