import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pruneScreenshots } from '../src/tools/screenshot-store.js';

test('old screenshots are pruned to a bounded local set', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tbot-shots-'));
  try {
    const directory = join(workspace, '.tbot', 'screenshots');
    await mkdir(directory, { recursive: true });
    for (let index = 0; index < 50; index++) {
      await writeFile(join(directory, `shot-${String(index).padStart(2, '0')}.png`), 'x');
    }
    const removed = await pruneScreenshots(workspace);
    const remaining = await readdir(directory);
    assert.ok(removed >= 10);
    assert.ok(remaining.filter(name => name.endsWith('.png')).length <= 40);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
