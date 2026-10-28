import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artifactHint, handleArtifactTool, storeArtifact } from '../src/tools/artifacts.js';
import { resolveContextBudget } from '../src/context-budget.js';

test('large tool outputs are stored with a bounded, paginated reader', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tbot-artifact-'));
  try {
    const lines = Array.from({ length: 1_200 }, (_, index) => `line ${index + 1}`);
    const stored = await storeArtifact(workspace, 'shell', lines.join('\n'));
    assert.match(stored.id, /^art-/);
    assert.ok(stored.bytes > 0);
    assert.equal(stored.truncated, false);

    const first = await handleArtifactTool('artifact_read', { id: stored.id, offset: 0, limit: 2 }, workspace);
    assert.match(first, /line 1/);
    assert.match(first, /line 2/);
    assert.doesNotMatch(first, /line 3/);
    assert.match(first, /more available/);

    const later = await handleArtifactTool('artifact_read', { id: stored.id, offset: 1_195, limit: 10 }, workspace);
    assert.match(later, /line 1200/);

    const file = join(workspace, '.tbot', 'artifacts', `${stored.id}.txt`);
    const raw = await readFile(file, 'utf8');
    assert.match(raw, /# T Bot tool artifact/);
    assert.match(raw, /# tool: shell/);
    assert.match(artifactHint(stored), new RegExp(stored.id));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('identical artifacts are content-addressed instead of duplicated', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tbot-artifact-dedupe-'));
  try {
    const body = 'same output\n'.repeat(1_000);
    const first = await storeArtifact(workspace, 'shell', body);
    const second = await storeArtifact(workspace, 'shell', body);
    assert.equal(second.id, first.id);
    const files = await readdir(join(workspace, '.tbot', 'artifacts'));
    assert.equal(files.filter(name => name.endsWith('.txt')).length, 1);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('artifact ids are validated and persisted credentials are redacted', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tbot-artifact-safe-'));
  try {
    await assert.rejects(handleArtifactTool('artifact_read', { id: '../../secret' }, workspace), /Invalid artifact id/);
    await assert.rejects(handleArtifactTool('artifact_read', {}, workspace), /id must be/);

    const stored = await storeArtifact(workspace, 'url_fetch', 'Authorization: Bearer sk-abcdefghijklmnopqrstuvwx\nnormal text');
    const output = await handleArtifactTool('artifact_read', { id: stored.id, offset: 0, limit: 20 }, workspace);
    assert.doesNotMatch(output, /sk-abcdefghijklmnopqrstuvwx/);
    assert.match(output, /\[REDACTED\]/);
    assert.match(output, /normal text/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('context budgets tighten weak models without hard-coding one provider window', () => {
  const weak = resolveContextBudget('openai', 'gpt-4o-mini');
  const strong = resolveContextBudget('anthropic', 'claude-sonnet-4');
  assert.equal(weak.weak, true);
  assert.equal(strong.weak, false);
  assert.ok(weak.historyTokens < strong.historyTokens);
  assert.ok(weak.maxRounds < strong.maxRounds);
  assert.ok(weak.maxToolCalls < strong.maxToolCalls);
  assert.ok(strong.historyTokens <= 44_000);
  assert.ok(weak.maxInputChars >= 90_000);
});
