import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runAgent } from '../src/agent.js';
import { reclaimMemory } from '../src/memory-guard.js';
import { createSession, SessionStore } from '../src/sessions.js';
import type { Message, Provider } from '../src/types.js';

function pressure(t: test.TestContext, high: boolean): void {
  const usage = process.memoryUsage();
  t.mock.method(process, 'memoryUsage', () => ({ ...usage, heapUsed: 64 * 1024 * 1024, rss: 100 * 1024 * 1024 }));
  t.mock.method(os, 'freemem', () => (high ? 300 : 2048) * 1024 * 1024);
}

async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tbot-history-integrity-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, store: new SessionStore(root), session: createSession(root) };
}

function history(): Message[] {
  return [{ role: 'tool', toolCallId: 'old-tool', content: 'L'.repeat(2000) + 'UNIQUE_MIDDLE_DIAGNOSTIC' + 'R'.repeat(2000) },
    ...Array.from({ length: 5 }, (_, i) => ({ role: i % 2 ? 'assistant' as const : 'user' as const, content: `tail-${i}` }))];
}

test('pressure reclaim preserves saved history and shallow retry evidence through the next checkpoint', async t => {
  pressure(t, true);
  const f = await fixture(t);
  f.session.messages = history();
  const before = JSON.stringify(f.session.messages);
  const retry = [...f.session.messages];
  await f.store.save(f.session);
  const result = await reclaimMemory(f.session, false);
  assert.equal(result.pressure, 'high');
  assert.equal(result.compactedCount, 0);
  assert.equal(JSON.stringify(retry), before);
  await f.store.save(f.session);
  assert.equal(JSON.stringify((await f.store.get(f.session.id, f.root))?.messages), before);
});

test('manual reclaim preserves all text and the current user image while releasing only older images', async t => {
  pressure(t, false);
  // Exercise force without launching the Windows working-set helper.
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  t.after(() => Object.defineProperty(process, 'platform', platform));
  const f = await fixture(t);
  const image = (data: string) => [{ mimeType: 'image/png' as const, data }];
  f.session.messages = [{ role: 'user', content: 'old', images: image('old') },
    { role: 'user', content: 'current user', images: image('current') },
    { role: 'tool', content: 'a'.repeat(3000), images: image('recent-1') },
    { role: 'assistant', content: 'recent', images: image('recent-2') },
    { role: 'tool', content: 'recent', images: image('recent-3') }];
  const text = f.session.messages.map(message => message.content);
  const result = await reclaimMemory(f.session, true);
  assert.equal(result.compactedCount, 1);
  assert.deepEqual(f.session.messages.map(message => message.content), text);
  assert.equal(f.session.messages[0].images, undefined);
  assert.equal(f.session.messages[1].images?.[0].data, 'current');
  assert.equal(f.session.messages[4].images?.[0].data, 'recent-3');
  await f.store.save(f.session);
  assert.ok((await f.store.get(f.session.id, f.root))?.messages.every(message => !message.images));
});

test('actual agent finally under pressure leaves the persisted transcript and input history intact', async t => {
  pressure(t, true);
  const f = await fixture(t);
  f.session.messages = [{ role: 'user', content: 'Inspect prior diagnostics.' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'old-tool', name: 'file_read', arguments: { path: 'unit.ts' } }] },
    ...history()];
  const inputHistory = f.session.messages;
  const before = JSON.stringify(inputHistory);
  const provider: Provider = { id: 'fixture', label: 'fixture', async *stream() { yield { type: 'text', text: 'Fixture response.' }; } };
  f.session.messages = await runAgent({ message: 'Summarize the available diagnostics.', history: inputHistory,
    provider, workspace: f.root, approve: async () => false, onEvent: () => {} }, { session: f.session, maxRounds: 1 });
  assert.equal(JSON.stringify(inputHistory), before);
  assert.match(f.session.messages[2].content, /UNIQUE_MIDDLE_DIAGNOSTIC/);
  await f.store.save(f.session);
  assert.match((await f.store.get(f.session.id, f.root))!.messages[2].content, /UNIQUE_MIDDLE_DIAGNOSTIC/);
});
