import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createSession, SessionStore, type Session } from '../src/sessions.js';
import * as telegramSecurity from '../src/telegram-security.js';
import type { AgentInput, Message } from '../src/types.js';

const require = createRequire(import.meta.url);
const token = 'unit-telegram-token-DO_NOT_LOG';
const privateError = new Error(`API https://api.telegram.org/bot${token}/sendMessage secret-value-DO_NOT_LOG`);
const source = await fs.readFile(new URL('../src/bot.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(`${source}\nexport const persistenceTest = { executeAgentTurn, handleIncomingMessage };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'tbot-gateway-unit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace'); await fs.mkdir(workspace);
  const store = new SessionStore(root), session = createSession(workspace);
  session.messages = [{ role: 'user', content: 'Durable original history.' }]; await store.save(session);
  const messages: string[] = [], logs: string[] = [], inputs: AgentInput[] = [];
  const state = { saveFails: false, constructorFails: false, reclaimFails: false, agentFails: false, emptyAnswer: false, saves: 0, reclaims: 0, clears: 0 };
  class GatewayStore extends SessionStore {
    constructor(directory: string) { super(directory); if (state.constructorFails) throw privateError; }
    async save(value: Session) { state.saves++; if (state.saveFails) throw privateError; await super.save(value); }
  }
  const run = async (input: AgentInput): Promise<Message[]> => {
    inputs.push(input);
    if (state.agentFails) throw privateError;
    input.onEvent({ type: 'tool_end', call: { id: 'fixture-tool', name: 'shell', arguments: {} }, result: 'Exit code: 0' });
    return [...input.history, { role: 'user', content: input.message }, { role: 'assistant', content: state.emptyAnswer ? '' : 'Generated answer; fixture tool outcome.' }];
  };
  const context: any = {
    exports: {}, Buffer, AbortController, AbortSignal, Date, Set, Map, console,
    process: { env: {} }, setTimeout, clearTimeout,
    setInterval: () => ({ unref() {} }), clearInterval: () => {},
    fetch: async (url: string, init?: RequestInit) => {
      assert.ok(url.startsWith(`https://api.telegram.org/bot${token}/`));
      if (url.endsWith('/sendMessage')) messages.push(JSON.parse(String(init?.body)).text);
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
    require: (name: string) => {
      if (name.startsWith('node:')) return require(name);
      if (name === './sessions.js') return { SessionStore: GatewayStore };
      if (name === './config.js') return { configDirectory: () => root, resolveProviderConfig: async () => ({ id: 'fixture', model: 'fixture' }) };
      if (name === './secrets.js') return { getCustomSecret: async () => token, getApiKey: async () => undefined };
      if (name === './providers.js') return { createProvider: () => ({ id: 'fixture' }) };
      if (name === './agent.js') return { runAgent: run };
      if (name === './ultracode.js') return { runUltracode: run };
      if (name === './workflows.js') return { runGoal: run };
      if (name === './memory-guard.js') return { reclaimMemory: async () => { state.reclaims++; if (state.reclaimFails) throw privateError; return { beforeMB: 10, afterMB: 8, freedMB: 2 }; } };
      if (name === './grounding.js') return { globalGroundingLedger: { clear: () => { state.clears++; } } };
      if (name === './token-optimizer.js') return {};
      if (name === './memory.js') return {};
      if (name === './tools/computer.js') return {};
      if (name === './telegram-security.js') return telegramSecurity;
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.createContext(context); vm.runInContext(code, context);
  const options = { config: { provider: 'fixture', model: 'fixture', workspacePermissions: {}, telegramAllowedChatIds: ['123'] },
    session, workspace, getYolo: () => false, activeSkills: [], onLog: (text: string) => logs.push(text) };
  const signal = new AbortController().signal;
  const turn = () => context.exports.persistenceTest.executeAgentTurn('A fixture request.', '123', token, options, signal);
  const clear = (chatId = 123) => context.exports.persistenceTest.handleIncomingMessage({ chat: { id: chatId, type: 'private' }, text: '/clear' }, token, signal, options);
  const assertPrivate = () => { assert.ok(!messages.join('\n').includes(token)); assert.ok(!logs.join('\n').includes(token)); assert.ok(![...messages, ...logs].join('\n').includes('secret-value-DO_NOT_LOG')); };
  return { root, workspace, store, session, state, messages, logs, inputs, turn, clear, assertPrivate, context };
}

test('generated answer survives a failed checkpoint with an explicit durability warning', async t => {
  const f = await fixture(t as any); f.state.saveFails = true;
  await f.turn();
  assert.ok(f.messages.some(text => text.includes('Generated answer')));
  assert.ok(f.messages.some(text => /kaydedilemedi|saklanamadı/i.test(text)));
  assert.ok(f.logs.some(text => /kaydedilemedi|saklanamadı/i.test(text)));
  assert.equal((await f.store.get(f.session.id, f.workspace))?.messages.length, 1);
  assert.equal(f.session.messages.length, 3);
  assert.equal(f.inputs[0].processOwner, `telegram:123:${f.session.id}`);
  f.assertPrivate();
});

test('checkpoint construction failures are also reported after generation without trapping the busy flag', async t => {
  const f = await fixture(t as any); f.state.constructorFails = true;
  await f.turn();
  assert.ok(f.messages.some(text => /kaydedilemedi|saklanamadı/i.test(text)));
  f.state.constructorFails = false; f.state.emptyAnswer = true;
  await f.turn();
  assert.ok(!f.messages.some(text => text.includes('[TAMAMLANDI]')));
  f.assertPrivate();
});

test('failed clear preserves live history and revision, without cleanup or success claims', async t => {
  const f = await fixture(t as any); const original = f.session.messages; f.state.saveFails = true;
  await f.clear();
  assert.equal(f.session.messages, original);
  assert.equal(f.state.clears, 0); assert.equal(f.state.reclaims, 0);
  assert.ok(!f.messages.some(text => text.includes('[TEMİZLENDİ]')));
  assert.ok(f.messages.some(text => /temizlenemedi|uygulanmadı/i.test(text)));
  assert.equal((await f.store.get(f.session.id, f.workspace))?.messages.length, 1);
  f.session.messages.push({ role: 'assistant', content: 'Still a current revision.' });
  await f.store.save(f.session);
  assert.equal((await f.store.get(f.session.id, f.workspace))?.messages.length, 2);
  f.assertPrivate();
});

test('successful clear commits first and transfers the new revision to the same live session', async t => {
  const f = await fixture(t as any); const originalSession = f.session;
  await f.clear();
  assert.equal(f.session, originalSession); assert.equal(f.session.messages.length, 0);
  assert.equal((await f.store.get(f.session.id, f.workspace))?.messages.length, 0);
  assert.ok(f.messages.some(text => text.includes('[TEMİZLENDİ]')));
  assert.equal(f.state.clears, 1); assert.equal(f.state.reclaims, 1);
  f.session.messages.push({ role: 'user', content: 'New turn after clear.' }); await f.store.save(f.session);
  assert.equal((await f.store.get(f.session.id, f.workspace))?.messages.length, 1);
});

test('a post-commit memory cleanup failure never rolls back the durable clear or invents RAM savings', async t => {
  const f = await fixture(t as any); f.state.reclaimFails = true;
  await f.clear();
  assert.equal(f.session.messages.length, 0);
  assert.equal((await f.store.get(f.session.id, f.workspace))?.messages.length, 0);
  assert.ok(f.messages.some(text => text.includes('[TEMİZLENDİ]')));
  assert.ok(!f.messages.some(text => /Geri Kazanılan|bellek boşaltıldı/i.test(text)));
  f.assertPrivate();
});

test('unauthorized clear never reaches session persistence', async t => {
  const f = await fixture(t as any); await f.clear(999);
  assert.equal(f.state.saves, 0); assert.equal(f.session.messages.length, 1);
  assert.ok(!f.messages.some(text => text.includes('[TEMİZLENDİ]')));
});

test('agent and Telegram API exceptions expose no raw token-bearing details', async t => {
  const f = await fixture(t as any); f.state.agentFails = true;
  await f.turn(); f.assertPrivate();
  f.context.fetch = async () => { throw privateError; };
  const result = await f.context.exports.startTelegramBotBridge({ config: { provider: 'fixture', model: 'fixture', workspacePermissions: {}, telegramAllowedChatIds: ['123'] },
    session: f.session, workspace: f.workspace, getYolo: () => false, activeSkills: [], onLog: (text: string) => f.logs.push(text) });
  assert.equal(result.ok, false);
  assert.ok(!result.error.includes(token)); f.assertPrivate();
});
