/**
 * file_search ReDoS containment: a catastrophic but not syntactically-unsafe
 * pattern runs in the regex worker; the parent keeps its event loop and stops
 * the search after the 2.5 s budget.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleFileTool } from '../src/tools/files.js';

test('file_search stops a catastrophic regex at the worker budget without blocking the caller', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbot-redos-'));
  try {
    await writeFile(join(dir, 'evil.txt'), `${'a'.repeat(60)}\n`);

    let timerFired = false;
    const timer = setTimeout(() => { timerFired = true; }, 100);
    const started = Date.now();
    try {
      await assert.rejects(
        handleFileTool('file_search', { query: '(a{1,}){1,}b', regex: true }, dir),
        /exceeded the 2\.5 second budget|budget/i,
      );
    } finally {
      clearTimeout(timer);
    }
    assert.equal(timerFired, true, 'the agent event loop must stay responsive during the worker search');
    assert.ok(Date.now() - started < 15_000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
