const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { mkdtemp, mkdir, rm, symlink } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const vm = require('node:vm');
const ts = require('typescript');

function processHarness(afterRealpath) {
  const children = [], killed = [], input = [];
  let sequence = 0;
  const context = { exports: {}, Buffer, AbortSignal, Date, Map, Promise,
    process: { platform: 'win32', env: {}, on() {} },
    setTimeout: (callback, ms) => setTimeout(callback, ms === 1500 ? 0 : ms), clearTimeout,
    require: name => {
      if (name === 'node:crypto') return { randomUUID: () => `${String(++sequence).padStart(8, '0')}-0000-4000-8000-000000000000` };
      if (name === '../windows-system.js') return { windowsSystemExecutable: () => 'C:\\Windows\\System32\\taskkill.exe' };
      if (name === '../security/env.js') return { childEnvironment: () => ({ ComSpec: 'C:\\Windows\\System32\\cmd.exe', SystemRoot: 'C:\\Windows', PATH: 'C:\\Windows\\System32' }) };
      if (name === 'node:fs/promises') return { realpath: async path => {
        const result = await require(name).realpath(path);
        afterRealpath?.();
        return result;
      } };
      if (name === 'node:path') return require(name);
      if (name === 'node:child_process') return { spawn: (command, args) => {
        const child = new EventEmitter(); child.pid = 5000 + children.length;
        child.stdout = new PassThrough(); child.stderr = new PassThrough();
        child.stdin = new Writable({ write: (chunk, _encoding, done) => { input.push(chunk.toString()); done(); } });
        child.kill = () => { killed.push(child.pid); return true; };
        if (String(command).endsWith('taskkill.exe')) {
          killed.push(Number(args[1])); queueMicrotask(() => child.emit('close', 0));
        } else { children.push(child); queueMicrotask(() => child.stdout.write('private owner output')); }
        return child;
      } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.createContext(context);
  const source = readFileSync(join(__dirname, '..', 'src', 'tools', 'shell.ts'), 'utf8');
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { api: context.exports, children, killed, input };
}

test('background handles are private to stable owner and canonical workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tbot-process-owner-'));
  try {
    const first = join(root, 'first'), second = join(root, 'second'), alias = join(root, 'alias');
    await mkdir(first); await mkdir(second);
    await symlink(first, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const { api, input, killed } = processHarness();
    const call = (name, args, workspace = first, owner = 'chat-a') => api.handleShellTool(name, args, workspace, undefined, owner);
    const started = JSON.parse(await call('shell', { command: 'fixture only', background: true }));
    await assert.rejects(api.handleShellTool('process_list', {}, first), /ownership context/);
    await assert.rejects(api.handleShellTool('process_output', { process_id: started.processId, processOwner: 'chat-a' }, first), /ownership context/);
    await assert.rejects(api.handleShellTool('shell', { command: 'fixture only', background: true, owner: 'chat-a' }, first), /ownership context/);
    assert.equal(JSON.parse(await call('process_list', {})).count, 1);
    assert.match(await call('process_output', { process_id: started.processId }, alias), /private owner output/);
    for (const [workspace, owner] of [[first, 'chat-b'], [second, 'chat-a'], [first, 'readonly-child']]) {
      assert.equal(JSON.parse(await call('process_list', {}, workspace, owner)).count, 0);
      for (const name of ['process_output', 'process_write', 'process_stop']) {
        await assert.rejects(call(name, { process_id: started.processId, input: 'cross-owner input', owner: 'chat-a', workspace: first }, workspace, owner), /not found|bulunamad/);
      }
    }
    assert.deepEqual(input, []); assert.deepEqual(killed, []);
    await call('process_write', { process_id: started.processId, input: 'allowed' });
    assert.deepEqual(input, ['allowed\n']);
    await assert.rejects(call('process_write', { id: String(started.pid), input: 'pid alias' }), /not found|bulunamad/);
    await assert.rejects(call('process_write', { id: started.processId.slice(-8), input: 'suffix alias' }), /not found|bulunamad/);
    await call('process_stop', { process_id: started.processId });
    assert.deepEqual(killed, [started.pid]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('global capacity never evicts another owner and app quit still stops all owned children', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tbot-process-capacity-'));
  try {
    const { api, children, killed } = processHarness();
    for (let i = 0; i < 12; i++) await api.handleShellTool('shell', { command: 'fixture only', background: true }, root, undefined, i < 6 ? 'chat-a' : 'chat-b');
    assert.equal(children.length, 12);
    assert.equal(JSON.parse(await api.handleShellTool('process_list', {}, root, undefined, 'chat-c')).count, 0);
    await assert.rejects(api.handleShellTool('shell', { command: 'fixture only', background: true }, root, undefined, 'chat-c'), /capacity reached/);
    assert.deepEqual(killed, []);
    api.stopAllBackgroundProcesses();
    assert.equal(killed.length, 12);
    assert.equal(new Set(killed).size, 12);
    assert.equal(api.pruneCompletedProcesses(), 12);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('known owner handles survive a deleted launch directory, while cancellation during scope lookup cannot spawn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tbot-process-lifetime-'));
  try {
    const workspace = join(root, 'workspace'); await mkdir(workspace);
    const { api, killed } = processHarness();
    const started = JSON.parse(await api.handleShellTool('shell', { command: 'fixture only', background: true }, workspace, undefined, 'chat-a'));
    await rm(workspace, { recursive: true });
    assert.match(await api.handleShellTool('process_output', { process_id: started.processId }, workspace, undefined, 'chat-a'), /private owner output/);
    await assert.rejects(api.handleShellTool('process_output', { process_id: started.processId }, workspace, undefined, 'chat-b'), { code: 'ENOENT' });
    await assert.rejects(api.handleShellTool('process_output', { process_id: started.processId }, join(root, 'unknown-alias'), undefined, 'chat-a'), { code: 'ENOENT' });
    await assert.rejects(api.handleShellTool('shell', { command: 'fixture only', background: true }, workspace, undefined, 'chat-a'), { code: 'ENOENT' });
    await api.handleShellTool('process_stop', { process_id: started.processId }, workspace, undefined, 'chat-a');
    assert.deepEqual(killed, [started.pid]);
    const controller = new AbortController();
    const cancelled = processHarness(() => controller.abort());
    await assert.rejects(cancelled.api.handleShellTool('shell', { command: 'fixture only', background: true }, root, controller.signal, 'chat-a'));
    assert.equal(cancelled.children.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('repointed live workspace aliases cannot reach previous roots, and deleted aliases match each recorded process', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tbot-process-repoint-'));
  try {
    const first = join(root, 'first'), second = join(root, 'second'), alias = join(root, 'alias');
    await mkdir(first); await mkdir(second);
    await symlink(first, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const { api } = processHarness();
    const firstProcess = JSON.parse(await api.handleShellTool('shell', { command: 'fixture only', background: true }, alias, undefined, 'chat-a'));
    await rm(alias); await symlink(second, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(api.handleShellTool('process_output', { process_id: firstProcess.processId }, alias, undefined, 'chat-a'), /not found/);
    const secondProcess = JSON.parse(await api.handleShellTool('shell', { command: 'fixture only', background: true }, alias, undefined, 'chat-a'));
    assert.equal(JSON.parse(await api.handleShellTool('process_list', {}, alias, undefined, 'chat-a')).count, 1);
    await rm(alias);
    for (const proc of [firstProcess, secondProcess]) assert.match(await api.handleShellTool('process_output', { process_id: proc.processId }, alias, undefined, 'chat-a'), /private owner output/);
    assert.equal(JSON.parse(await api.handleShellTool('process_list', {}, alias, undefined, 'chat-a')).count, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
