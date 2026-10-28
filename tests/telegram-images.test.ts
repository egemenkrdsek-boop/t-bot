/**
 * S2 focused fixture (Telegram surface): image discovery must never follow a
 * `.tbot/screenshots` junction outside the workspace and must not upload an
 * external PNG into a Telegram response.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as botModule from '../src/bot.js';

test('Telegram image collection never sends an outside PNG through a .tbot junction', async () => {
  const collect = (botModule as unknown as {
    collectGeneratedImages?: (workspace: string, startTime: number) => Promise<string[]>;
  }).collectGeneratedImages;
  assert.equal(typeof collect, 'function', 'collectGeneratedImages must stay exported for containment tests');

  const root = await mkdtemp(join(tmpdir(), 'tbot-tg-images-'));
  const workspace = join(root, 'workspace');
  const outside = join(root, 'outside');
  try {
    await mkdir(workspace);
    await mkdir(outside);
    const external = join(outside, 'screenshot-external.png');
    await writeFile(external, 'outside image bytes');
    await symlink(outside, join(workspace, '.tbot'), process.platform === 'win32' ? 'junction' : 'dir');

    const found = await collect!(workspace, Date.now() - 60_000);
    assert.deepEqual(found, []);
    assert.equal(await readFile(external, 'utf8'), 'outside image bytes');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
