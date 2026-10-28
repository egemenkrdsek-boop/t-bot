import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { syncBuiltinESMExports } from 'node:module';
import { createSession, SessionStore } from '../src/sessions.js';

async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tbot-sessions-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  const store = new SessionStore(root);
  const session = createSession(workspace);
  const directory = path.join(root, 'sessions');
  const file = path.join(directory, `${session.id}.json`);
  const checkpoint = async () => JSON.parse(await fs.readFile(file, 'utf8'));
  return { root, workspace, store, session, directory, file, checkpoint };
}

test('segmented checkpoints preserve Unicode, tool linkage, redact secrets and omit images', async t => {
  const f = await fixture(t);
  const content = '🙂 Türkçe漢字 '.repeat(100_000);
  f.session.messages = [
    { role: 'user', content, images: [{ mimeType: 'image/png', data: 'IMAGE_MUST_NOT_PERSIST' }] },
    { role: 'assistant', content: 'Bearer abcdefghijklmnop', toolCalls: [{ id: 'call-1', name: 'test', arguments: { apiKey: 'DO_NOT_PERSIST', normal: 'ok' } }] },
    { role: 'tool', content: 'result', toolCallId: 'call-1' },
  ];
  await f.store.save(f.session);
  const loaded = await f.store.get(f.session.id, f.workspace);
  assert.equal(loaded?.messages[0].content, content);
  assert.equal(loaded?.messages[0].images, undefined);
  assert.equal(loaded?.messages[1].content, 'Bearer [REDACTED]');
  assert.deepEqual(loaded?.messages[1].toolCalls?.[0].arguments, { apiKey: '[REDACTED]', normal: 'ok' });
  assert.equal(loaded?.messages[2].toolCallId, 'call-1');
  const record = await f.checkpoint();
  assert.ok(record.segments.length > 1);
  assert.ok(record.segments.every((segment: { bytes: number }) => segment.bytes <= 1024 * 1024));
  assert.equal(f.session.messages[1].content, 'Bearer abcdefghijklmnop');
  assert.equal(f.session.messages[0].images?.[0].data, 'IMAGE_MUST_NOT_PERSIST');
});

test('a single message over the old 10 MiB cap survives save and reload', async t => {
  const f = await fixture(t);
  const content = 'x'.repeat(11 * 1024 * 1024);
  f.session.messages = [{ role: 'user', content }, { role: 'assistant', content: 'tail' }];
  await f.store.save(f.session);
  const loaded = await f.store.get(f.session.id, f.workspace);
  assert.equal(loaded?.messages.length, 2);
  assert.equal(loaded?.messages[0].content, content);
  assert.equal(loaded?.messages[1].content, 'tail');
});

test('aggregate history over 10 MiB preserves first and last complete turns', async t => {
  const f = await fixture(t);
  f.session.messages = Array.from({ length: 120 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${i}:` + 'a'.repeat(96 * 1024) }));
  await f.store.save(f.session);
  const loaded = await f.store.get(f.session.id, f.workspace);
  assert.deepEqual(loaded?.messages, f.session.messages);
});

test('legacy JSON migrates on save; metadata listing never opens history segments', async t => {
  const f = await fixture(t);
  f.session.messages = [{ role: 'user', content: 'Old session' }];
  await fs.mkdir(f.directory);
  await fs.writeFile(f.file, JSON.stringify(f.session));
  const loaded = await f.store.get(f.session.id, f.workspace);
  assert.equal(JSON.stringify(loaded), JSON.stringify(f.session));
  await f.store.save(loaded!);
  const record = await f.checkpoint();
  assert.equal(record.format, 'tbot-session-v2');
  await fs.unlink(path.join(f.directory, record.segments[0].name));
  assert.equal((await f.store.list(f.workspace))[0].messageCount, 1);
  await assert.rejects(f.store.get(f.session.id, f.workspace), /ENOENT/);
});

test('failed manifest commit preserves previous checkpoint and cleans partial segments', async t => {
  const f = await fixture(t);
  f.session.messages = [{ role: 'user', content: 'before' }];
  await f.store.save(f.session);
  const before = await fs.readFile(f.file, 'utf8');
  const entries = (await fs.readdir(f.directory)).sort();
  f.session.messages.push({ role: 'assistant', content: 'after' });
  const rename = t.mock.method(fs, 'rename', async () => { throw new Error('injected commit failure'); });
  await assert.rejects(f.store.save(f.session), /injected commit failure/);
  rename.mock.restore();
  assert.equal(await fs.readFile(f.file, 'utf8'), before);
  assert.equal((await f.store.get(f.session.id, f.workspace))?.messages.length, 1);
  assert.deepEqual((await fs.readdir(f.directory)).sort(), entries);
});

test('failed segment write preserves previous checkpoint and removes the unfinished generation', async t => {
  const f = await fixture(t);
  f.session.messages = [{ role: 'user', content: 'before' }];
  await f.store.save(f.session);
  const entries = (await fs.readdir(f.directory)).sort();
  f.session.messages.push({ role: 'assistant', content: 'z'.repeat(2 * 1024 * 1024) });
  const originalOpen = fs.open;
  const open = t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    if (String(args[0]).endsWith('.1.seg')) throw new Error('injected segment failure');
    return originalOpen(...args);
  });
  await assert.rejects(f.store.save(f.session), /injected segment failure/);
  open.mock.restore();
  assert.deepEqual((await fs.readdir(f.directory)).sort(), entries);
  assert.equal((await f.store.get(f.session.id, f.workspace))?.messages[0].content, 'before');
});

test('a reader retains its checkpoint while a concurrent save waits for its lock', async t => {
  const f = await fixture(t);
  f.session.messages = [{ role: 'user', content: 'before' }];
  await f.store.save(f.session);
  let entered!: () => void;
  let release!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const originalRead = fs.readFile;
  const read = t.mock.method(fs, 'readFile', async (...args: Parameters<typeof fs.readFile>) => {
    if (String(args[0]).endsWith('.seg')) { entered(); await gate; }
    return originalRead(...args);
  });
  const oldRead = f.store.get(f.session.id, f.workspace);
  await reading;
  f.session.messages.push({ role: 'assistant', content: 'after' });
  const save = f.store.save(f.session);
  release();
  assert.equal((await oldRead)?.messages.length, 1);
  await save;
  read.mock.restore();
  assert.equal((await f.store.get(f.session.id, f.workspace))?.messages.length, 2);
});

test('shared FIFO preserves save order across directory aliases when the first file lock open is delayed', async t => {
  const f = await fixture(t);
  const alias = path.join(f.root, 'alias');
  await fs.symlink(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const other = new SessionStore(alias);
  f.session.messages = [{ role: 'user', content: 'first' }];
  let entered!: () => void;
  let release!: () => void;
  let first = true;
  let waiting = true;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const originalOpen = fs.open;
  const open = t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    if (String(args[0]).endsWith('.lock')) {
      if (first) { first = false; entered(); await gate; waiting = false; }
      else if (waiting) throw new Error('newer save overtook first lock acquisition');
    }
    return originalOpen(...args);
  });
  syncBuiltinESMExports();
  try {
    const older = f.store.save(f.session);
    await started;
    f.session.messages.push({ role: 'assistant', content: 'newer' });
    const newer = other.save(f.session);
    let settled = false;
    void newer.then(() => { settled = true; }, () => { settled = true; });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(settled, false);
    release();
    await Promise.all([older, newer]);
  } finally {
    release();
    open.mock.restore();
    syncBuiltinESMExports();
  }
  assert.equal((await f.store.get(f.session.id, f.workspace))?.messages.length, 2);
});

test('revision survives host object spreads and stale independent snapshots fail without overwriting', async t => {
  const f = await fixture(t);
  let session = { ...f.session, messages: [{ role: 'user' as const, content: 'first' }] };
  await f.store.save(session);
  session = { ...session, messages: [...session.messages, { role: 'user', content: 'second' }] };
  await f.store.save(session);
  const other = new SessionStore(f.root);
  const a = (await f.store.get(session.id, f.workspace))!;
  const stale = (await other.get(session.id, f.workspace))!;
  const next = { ...a, messages: [...a.messages, { role: 'assistant' as const, content: 'third' }] };
  await f.store.save(next);
  const checkpoint = await fs.readFile(f.file, 'utf8');
  await assert.rejects(other.save({ ...stale, messages: [...stale.messages, { role: 'user', content: 'stale replacement' }] }), /checkpoint conflict.*reload/);
  assert.equal(await fs.readFile(f.file, 'utf8'), checkpoint);
  assert.deepEqual((await other.get(session.id, f.workspace))?.messages.map(message => message.content), ['first', 'second', 'third']);
  assert.ok(!JSON.stringify(next).includes('sessionCheckpointRevision'));
});

test('load budgets fail explicitly while metadata and delete remain available', async t => {
  const f = await fixture(t);
  f.session.messages = [{ role: 'user', content: 'a'.repeat(8192) }];
  await f.store.save(f.session);
  const limited = new SessionStore(f.root, { maxLoadBytes: 256 });
  await assert.rejects(limited.get(f.session.id, f.workspace), /load budget.*preserved/);
  assert.equal((await limited.list(f.workspace))[0].messageCount, 1);
  assert.equal(await limited.delete(f.session.id, f.workspace), true);
  assert.deepEqual(await fs.readdir(f.directory), []);
});

test('workspace ownership, IDs, segment traversal and same-size corruption are rejected', async t => {
  const f = await fixture(t);
  f.session.messages = [{ role: 'user', content: 'original' }];
  await f.store.save(f.session);
  await assert.rejects(f.store.get('../escape', f.workspace), /Invalid session ID/);
  await assert.rejects(f.store.get(f.session.id, f.root), /different workspace/);
  await assert.rejects(f.store.save({ ...f.session, workspace: f.root }), /different workspace/);
  await assert.rejects(f.store.delete(f.session.id, f.root), /different workspace/);
  const record = await f.checkpoint();
  const original = JSON.stringify(record);
  record.segments[0].name = '../outside';
  await fs.writeFile(f.file, JSON.stringify(record));
  await assert.rejects(f.store.get(f.session.id, f.workspace), /Invalid session checkpoint/);
  await fs.writeFile(f.file, original);
  const segment = path.join(f.directory, JSON.parse(original).segments[0].name);
  await fs.writeFile(segment, (await fs.readFile(segment, 'utf8')).replace('original', 'tampered'));
  await assert.rejects(f.store.get(f.session.id, f.workspace), /Damaged session segment/);
});

test('save removes old and orphan owned segments, preserving unrelated paths', async t => {
  const f = await fixture(t);
  f.session.messages = [{ role: 'user', content: 'first' }];
  await f.store.save(f.session);
  const old = (await f.checkpoint()).segments[0].name;
  const orphan = `.${f.session.id}.${randomUUID()}.90.seg`;
  const unrelated = `.${randomUUID()}.${randomUUID()}.0.seg`;
  await fs.writeFile(path.join(f.directory, orphan), 'orphan');
  await fs.writeFile(path.join(f.directory, unrelated), 'keep');
  await fs.mkdir(path.join(f.directory, `.${f.session.id}.${randomUUID()}.99.seg`));
  f.session.messages.push({ role: 'assistant', content: 'second' });
  await f.store.save(f.session);
  const entries = await fs.readdir(f.directory);
  assert.ok(!entries.includes(old));
  assert.ok(!entries.includes(orphan));
  assert.ok(entries.includes(unrelated));
  assert.equal((await f.store.get(f.session.id, f.workspace))?.messages.length, 2);
});
