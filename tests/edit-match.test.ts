import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyEdit } from '../src/tools/edit-match.js';
import { handleFileTool } from '../src/tools/files.js';
import { GroundingLedger, withGroundingLedger } from '../src/grounding.js';

test('pinned OpenCode Unicode tier matches typography while exact candidates take priority', () => {
  const source = 'const title = “a—b”;\nconst stable = 1;';
  assert.equal(applyEdit(source, 'const title = "a-b";', 'const title = "new";').content, 'const title = “new”;\nconst stable = 1;');
  assert.equal(applyEdit('"a"\n“a”', '"a"', '"b"').content, '"b"\n“a”');
  assert.equal(applyEdit('x\u00a0=\u20091', 'x = 1', 'x = 2').content, 'x\u00a0=\u20092');
});

test('mixed endings and untouched source bytes survive LF and trailing-space edit tiers', () => {
  const source = '\uFEFFhead\r\none  \r\ntwo\nthree\r\ntail\n';
  assert.deepEqual(applyEdit(source, 'one\ntwo\nthree', 'one\nTWO\nthree'), {
    content: '\uFEFFhead\r\none  \r\nTWO\nthree\r\ntail\n', line: 2,
  });
  assert.equal(applyEdit('head\r\nold\nlast\r\n', 'old\nlast', 'new\nlast').content, 'head\r\nnew\nlast\r\n');
  assert.equal(applyEdit('before\r\nhello 🌍 after\n', '🌍', 'world').content, 'before\r\nhello world after\n');
});

test('unchanged contextual Unicode lines retain their original characters', () => {
  const source = 'const x = "a—b";\r\nlet n=1;';
  assert.equal(applyEdit(source, 'const x = "a-b";\nlet n=1;', 'const x = "a-b";\nlet n=2;').content,
    'const x = "a—b";\r\nlet n=2;');
  assert.equal(applyEdit('const x = "a—b"; let n=1;', 'const x = "a-b"; let n=1;', 'const x = "a-b"; let n=2;').content,
    'const x = "a—b"; let n=2;');
  assert.equal(applyEdit('“a—b”; n=1; “c—d”', '"a-b"; n=1; "c-d"', '"a-b"; n=2; "c-d"').content,
    '“a—b”; n=2; “c—d”');
  assert.equal(applyEdit('const x = "a—b"; let n=1;', 'const x = "a—b"; let n=1;', 'const x = "a-b"; let n=2;').content,
    'const x = "a-b"; let n=2;');
});

test('explicit ending-only edits use exact bytes', () => {
  assert.equal(applyEdit('a\r\nb\n', 'a\r\n', 'a\n').content, 'a\nb\n');
});

test('empty, overlapping, Unicode and whitespace ambiguous edits are rejected', () => {
  assert.throws(() => applyEdit('abc', '', 'x'), /non-empty/);
  assert.throws(() => applyEdit('aaa', 'aa', 'b'), /exactly once/);
  assert.throws(() => applyEdit('“a”\n„a‟', '"a"', '"b"'), /exactly once/);
  assert.throws(() => applyEdit('a  \na\t\n', 'a\n', 'b\n'), /exactly once/);
  assert.throws(() => applyEdit('abc', 'abc', 'abc'), /identical/);
  assert.throws(() => applyEdit('abc', 'xyz', 'new'), /not found/);
});

test('adversarial input, alignment and fallback comparison work are bounded', () => {
  assert.throws(() => applyEdit('x'.repeat(1_000_001), 'x', 'y'), /million characters/);
  const lines = Array.from({ length: 1100 }, (_, i) => `line-${i}`).join('\n');
  assert.throws(() => applyEdit(lines, lines, lines.replace('line-0', 'changed')), /alignment budget/);
  const repeated = 'same \n'.repeat(3000);
  const absent = 'same\n'.repeat(1500) + 'missing';
  assert.throws(() => applyEdit(repeated, absent, 'new'), /matching budget/);
  assert.throws(() => applyEdit('\n'.repeat(50_000), 'missing', 'new'), /line budget/);
  const manyEndings = '\r\n'.repeat(400_000) + 'target';
  assert.deepEqual(applyEdit(manyEndings, 'target', 'changed'), { content: '\r\n'.repeat(400_000) + 'changed', line: 400_001 });
});

async function fixture(action: (directory: string) => Promise<void>): Promise<void> {
  const directory = await fs.mkdtemp(join(tmpdir(), 'tbot-edit-'));
  try { await withGroundingLedger(directory, false, () => action(directory)); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

test('file mutation refuses stale reads even when external replacement preserves size and mtime', async () => {
  await fixture(async directory => {
    const file = join(directory, 'a.txt');
    for (const name of ['file_write', 'file_patch']) {
      await fs.writeFile(file, 'value=1');
      const original = await fs.stat(file);
      await handleFileTool('file_read', { path: 'a.txt', full: true }, directory);
      await fs.writeFile(file, 'value=2');
      await fs.utimes(file, original.atime, original.mtime);
      await assert.rejects(handleFileTool(name, { path: 'a.txt', content: 'value=3', old_text: 'value=2', new_text: 'value=3' }, directory), /changed since inspection/);
      assert.equal(await fs.readFile(file, 'utf8'), 'value=2');
    }
  });
});

test('full inspection hashes reject changed content even with the exact same revision marker', () => {
  const ledger = new GroundingLedger(process.cwd());
  ledger.markFileInspected('a.txt', undefined, 'value=1');
  ledger.recordFileRevision('a.txt', 'same-revision');
  assert.throws(() => ledger.assertFileSnapshot('a.txt', 'same-revision', 'value=2'), /changed since inspection/);
});

test('file mutations reject malformed UTF-8 and NUL input without changing source bytes, and retain valid BOM', async () => {
  await fixture(async directory => {
    const file = join(directory, 'a.txt');
    for (const bytes of [Buffer.from([0x61, 0xff, 0x62]), Buffer.from([0x61, 0, 0x62])]) {
      await fs.writeFile(file, bytes);
      await assert.rejects(handleFileTool('file_patch', { path: 'a.txt', old_text: 'a', new_text: 'A' }, directory), /valid UTF-8/);
      await assert.rejects(handleFileTool('file_write', { path: 'a.txt', content: 'new' }, directory), /valid UTF-8/);
      assert.deepEqual(await fs.readFile(file), bytes);
    }
    await fs.writeFile(file, '\uFEFFold\r\n');
    await handleFileTool('file_read', { path: 'a.txt', full: true }, directory);
    await handleFileTool('file_patch', { path: 'a.txt', old_text: 'old', new_text: 'new' }, directory);
    assert.deepEqual(await fs.readFile(file), Buffer.from('\uFEFFnew\r\n'));
    for (const content of ['bad\uD800', 'bad\0']) {
      await assert.rejects(handleFileTool('file_write', { path: 'invalid-new.txt', content }, directory), /valid UTF-8/);
      await assert.rejects(fs.stat(join(directory, 'invalid-new.txt')), { code: 'ENOENT' });
    }
  });
});

test('concurrent cooperating file edits serialize read/prepare/write and retain both changes', async () => {
  await fixture(async directory => {
    await fs.writeFile(join(directory, 'a.txt'), 'left=1\r\nright=1\n');
    await handleFileTool('file_outline', { path: 'a.txt' }, directory);
    await Promise.all([
      handleFileTool('file_patch', { path: 'a.txt', old_text: 'left=1', new_text: 'left=2' }, directory),
      handleFileTool('file_patch', { path: 'a.txt', old_text: 'right=1', new_text: 'right=2' }, directory),
    ]);
    assert.equal(await fs.readFile(join(directory, 'a.txt'), 'utf8'), 'left=2\r\nright=2\n');
  });
});

test('new-file publication never overwrites an entry created during validation', async () => {
  await fixture(async directory => {
    const link = fs.link.bind(fs);
    const intercepted = mock.method(fs, 'link', async (source, target) => {
      await fs.writeFile(target, 'external file', { flag: 'wx' });
      return link(source, target);
    });
    try {
      await assert.rejects(handleFileTool('file_write', { path: 'new.txt', content: 'agent content' }, directory), { code: 'EEXIST' });
      assert.equal(await fs.readFile(join(directory, 'new.txt'), 'utf8'), 'external file');
      assert.deepEqual((await fs.readdir(directory)).filter(name => name.startsWith('.tbot-')), []);
    } finally { intercepted.mock.restore(); }
  });
});

test('rename retries recheck external changes and never fall back to copying over a target', async () => {
  await fixture(async directory => {
    const file = join(directory, 'a.txt');
    await fs.writeFile(file, 'before');
    await handleFileTool('file_read', { path: 'a.txt', full: true }, directory);
    let renames = 0;
    const intercepted = mock.method(fs, 'rename', async () => {
      renames++;
      await fs.writeFile(file, 'external');
      throw Object.assign(new Error('locked'), { code: 'EPERM' });
    });
    try {
      await assert.rejects(handleFileTool('file_write', { path: 'a.txt', content: 'after' }, directory), /changed since mutation/);
      assert.equal(renames, 1);
      assert.equal(await fs.readFile(file, 'utf8'), 'external');
      assert.deepEqual((await fs.readdir(directory)).filter(name => name.startsWith('.tbot-')), []);
    } finally { intercepted.mock.restore(); }
  });
});

test('failed mutation releases its transaction lock and oversized batches fail before writing', async () => {
  await fixture(async directory => {
    await fs.writeFile(join(directory, 'a.txt'), 'old');
    await handleFileTool('file_read', { path: 'a.txt', full: true }, directory);
    await assert.rejects(handleFileTool('file_patch', { path: 'a.txt', old_text: 'missing', new_text: 'new' }, directory), /not found/);
    await handleFileTool('file_patch', { path: 'a.txt', old_text: 'old', new_text: 'new' }, directory);
    await assert.rejects(handleFileTool('file_patch', { path: 'a.txt', patches: Array.from({ length: 33 }, () => ({ old_text: 'new', new_text: 'next' })) }, directory), /32 hunks/);
    assert.equal(await fs.readFile(join(directory, 'a.txt'), 'utf8'), 'new');
  });
});
