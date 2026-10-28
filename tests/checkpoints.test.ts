import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listCheckpoints,
  restoreCheckpoint,
  saveCheckpoint,
} from '../src/checkpoints.js';

async function workspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'tbot-checkpoint-'));
}

test('identical content in the same millisecond still gets distinct checkpoints', async () => {
  const root = await workspace();
  try {
    await writeFile(join(root, 'a.txt'), 'same content', 'utf8');
    await writeFile(join(root, 'b.txt'), 'same content', 'utf8');
    const first = await saveCheckpoint(root, 'a.txt', 'same content', 'file_write');
    const second = await saveCheckpoint(root, 'b.txt', 'same content', 'file_write');

    assert.ok(first);
    assert.ok(second);
    assert.notEqual(first.id, second.id);
    const listed = await listCheckpoints(root, 10);
    assert.equal(listed.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('restore writes the recorded content and makes the restore undoable', async () => {
  const root = await workspace();
  try {
    await writeFile(join(root, 'app.ts'), 'before', 'utf8');
    const checkpoint = await saveCheckpoint(root, 'app.ts', 'before', 'file_write');
    assert.ok(checkpoint);

    await writeFile(join(root, 'app.ts'), 'after', 'utf8');
    const restored = await restoreCheckpoint(root, checkpoint.id);
    assert.equal(restored.path, 'app.ts');
    assert.equal(await readFile(join(root, 'app.ts'), 'utf8'), 'before');

    const listed = await listCheckpoints(root, 10);
    assert.ok(listed.some(item => item.tool === 'checkpoint_restore'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('checkpoint ids outside the workspace or with invalid syntax are rejected', async () => {
  const root = await workspace();
  try {
    await assert.rejects(restoreCheckpoint(root, '../../package.json'), /Invalid checkpoint id/);
    await assert.rejects(restoreCheckpoint(root, 'ckpt-bad'), /Invalid checkpoint id/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
