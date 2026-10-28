import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TokenSessionTracker, estimateMessagesTokens } from '../src/token-optimizer.js';
import { ContextReadCache, globalContextCache, withContextReadCache } from '../src/context-cache.js';
import { rememberFact, forgetFact } from '../src/memory.js';
import { GroundingLedger, auditAssistantClaims, globalGroundingLedger, withGroundingLedger } from '../src/grounding.js';
import { getPendingCrossFileExports, withPendingExportScope } from '../src/ast-validator.js';
import { acquireFileLock } from '../src/lock.js';
import { reclaimMemory } from '../src/memory-guard.js';
import { runAgent, reconcileResponseItems } from '../src/agent.js';
import { getGoal, runGoal, startGoal } from '../src/workflows.js';
import { APP_VERSION, supportsNodeVersion } from '../src/version.js';
import type { Message, Provider } from '../src/types.js';

test('token savings reflect actual removed tokens and keep cache hits separate', () => {
  const tracker = new TokenSessionTracker();
  let report = tracker.recordTurn({ rawTokens: 100, sentInputTokens: 100, outputTokens: 0, cachedTokens: 100 });
  assert.equal(report.savingsPercent, 0);
  assert.equal(report.totalSavedTokens, 0);
  assert.equal(report.totalCachedTokens, 100);
  report = tracker.recordTurn({ rawTokens: 200, sentInputTokens: 100, outputTokens: 0, prunedSchemaTokens: 100 });
  report = tracker.recordTurn({ rawTokens: 200, sentInputTokens: 100, outputTokens: 0, prunedSchemaTokens: 100 });
  assert.equal(report.totalPrunedSchemaTokens, 200);
  assert.equal(report.savingsPercent, 40);
  assert.equal(report.cachedTokens, 0);
  const empty = new TokenSessionTracker().recordTurn({ rawTokens: 0, sentInputTokens: 0, outputTokens: 0, cachedTokens: 999 });
  assert.equal(empty.totalCachedTokens, 0);
});

test('message token estimate follows mutable attachments and tool arguments', () => {
  const message: Message = { role: 'assistant', content: 'same' };
  const plain = estimateMessagesTokens([message]);
  message.images = [{ mimeType: 'image/png', data: 'abc' }];
  assert.equal(estimateMessagesTokens([message]), plain + 256);
  delete message.images;
  assert.equal(estimateMessagesTokens([message]), plain);
  message.toolCalls = [{ id: 'call', name: 'file_read', arguments: { path: 'a' } }];
  const short = estimateMessagesTokens([message]);
  message.toolCalls[0].arguments.path = 'long/path/'.repeat(50);
  assert.ok(estimateMessagesTokens([message]) > short);
});

test('changed-file differential read never hides a newly requested range', () => {
  const cache = new ContextReadCache();
  const original = Array.from({ length: 100 }, (_, i) => `line-${i}`).join('\n');
  cache.checkAndRecordRead('workspace', 'a.ts', original, 1, 2, '1: line-0\n2: line-1');
  const changed = original.replace('line-0', 'edited-0');
  const full = `1: ${changed.replaceAll('\n', '\nline: ')}`;
  const result = cache.checkAndRecordRead('workspace', 'a.ts', changed, 1, 100, full);
  assert.equal(result.cached, false);
  assert.ok(result.output.includes('line-99'));
});

test('oversized file reads are not retained by differential cache', () => {
  const cache = new ContextReadCache();
  const huge = 'large line\n'.repeat(20_000);
  cache.checkAndRecordRead('workspace', 'large.ts', huge, 1, 20_000, huge);
  assert.equal(cache.checkAndRecordRead('workspace', 'large.ts', huge, 1, 20_000, huge).cached, false);
});

test('read cache requires actual source to survive compression and never refreshes stubs', () => {
  const cache = new ContextReadCache();
  const content = 'source line\n'.repeat(60);
  const read = () => cache.checkAndRecordRead('workspace', 'source.ts', content, 1, 60, content);
  assert.equal(read().cached, false);
  assert.equal(read().cached, true);
  assert.equal(read().cached, true);
  assert.equal(read().cached, false);
  cache.retainVisibleReads([{ role: 'tool', content: '[compacted evidence]' }]);
  assert.equal(read().cached, false);
  cache.retainVisibleReads([{ role: 'tool', content: JSON.stringify({ content }) }]);
  assert.equal(read().cached, true);
});

test('parallel agent contexts never share file-read coverage', async () => {
  const content = 'source line\n'.repeat(60);
  const read = () => globalContextCache.checkAndRecordRead('workspace', 'source.ts', content, 1, 60, content);
  await Promise.all([0, 1].map(() => withContextReadCache(async () => {
    assert.equal(read().cached, false);
    await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(read().cached, true);
  })));
});

test('child inspection and export debt cannot authorize or pollute the parent invocation', async () => {
  await withGroundingLedger(process.cwd(), false, () => withPendingExportScope(async () => {
    globalGroundingLedger.markFileInspected('parent.ts');
    getPendingCrossFileExports().set('parent.ts', new Set(['parent']));
    await withGroundingLedger(process.cwd(), false, () => withPendingExportScope(async () => {
      assert.equal(globalGroundingLedger.inspectedFiles.size, 0);
      assert.equal(getPendingCrossFileExports().size, 0);
      globalGroundingLedger.markFileInspected('child.ts');
      getPendingCrossFileExports().set('child.ts', new Set(['child']));
    }));
    assert.equal(globalGroundingLedger.verifyCanModifyFile('child.ts', true).allowed, false);
    assert.equal(globalGroundingLedger.verifyCanModifyFile('parent.ts', true).allowed, true);
    assert.equal(getPendingCrossFileExports().has('child.ts'), false);
    globalGroundingLedger.beginTurn();
    assert.equal(globalGroundingLedger.inspectedFiles.size, 0);
  }));
});

test('native response items retain only normalized and budgeted tool calls', () => {
  const result = reconcileResponseItems([
    { type: 'reasoning', id: 'reasoning' },
    { type: 'function_call', call_id: 'old', name: 'wrong', arguments: '{}' },
    { type: 'function_call', call_id: 'excess', name: 'wrong', arguments: '{}' },
  ], [{ id: 'normalized', name: 'file_read', arguments: { path: 'actual.ts' } }]);
  assert.equal(result.length, 2);
  assert.equal(result[0].type, 'reasoning');
  assert.equal(result[1].call_id, 'normalized');
  assert.equal(result[1].arguments, '{"path":"actual.ts"}');
  assert.equal(reconcileResponseItems(result, []).length, 1);
});

test('read-only agent rejects workflow mutations and recursive delegation returned by model', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbot-readonly-'));
  try {
    let first = true;
    const provider: Provider = { id: 'unit', label: 'unit', async *stream() {
      if (first) {
        first = false;
        yield { type: 'tool_calls', calls: [
          { id: 'goal', name: 'goal_manage', arguments: { action: 'set', objective: 'must not persist' } },
          { id: 'delegate', name: 'delegate_task', arguments: { tasks: [{ role: 'nested', task: 'must not run' }] } },
        ] };
      } else yield { type: 'text', text: 'Read-only review ended.' };
    } };
    const result = await runAgent({ message: 'review this workspace', history: [], provider, workspace: dir, approve: async () => false, onEvent: () => {} }, { toolPolicy: 'read-only', maxRounds: 1 });
    assert.equal(await getGoal(dir), undefined);
    const results = result.filter(message => message.role === 'tool');
    assert.equal(results.length, 2);
    assert.ok(results.every(message => message.content.startsWith('Araç reddedildi')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('goal completion marker cannot complete a failed run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbot-goal-'));
  try {
    await startGoal(dir, 'remain active on failure');
    const provider: Provider = { id: 'unit', label: 'unit', async *stream() {} };
    await runGoal({ message: 'continue', history: [], provider, workspace: dir, approve: async () => false, onEvent: () => {} }, async input => {
      input.onEvent({ type: 'error', error: 'simulated provider failure' });
      return [{ role: 'user', content: input.message }, { role: 'assistant', content: '[GOAL_COMPLETE]' }];
    }, { maxAutonomousSteps: 1 });
    assert.equal((await getGoal(dir))?.status, 'active');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('CLI version follows manifest and runtime supports minimum Node', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(APP_VERSION, manifest.version);
  assert.equal(supportsNodeVersion('22.11.0'), false);
  assert.equal(supportsNodeVersion('22.12.0'), true);
  assert.equal(supportsNodeVersion('24.0.0'), true);
});

test('persistent memory concurrent writes and deletes preserve unrelated facts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbot-memory-'));
  try {
    await Promise.all(Array.from({ length: 6 }, (_, i) => rememberFact(dir, `fact-${i}`, `value-${i}`)));
    const file = join(dir, '.tbot', 'memory.json');
    assert.equal(JSON.parse(await readFile(file, 'utf8')).length, 6);
    await Promise.all([forgetFact(dir, 'fact-0', 'project'), rememberFact(dir, 'new-fact', 'new-value')]);
    const entries = JSON.parse(await readFile(file, 'utf8')) as { key: string }[];
    assert.equal(entries.length, 6);
    assert.ok(entries.some(entry => entry.key === 'new-fact'));
    assert.ok(!entries.some(entry => entry.key === 'fact-0'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('old lock owned by a live process cannot be stolen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbot-lock-'));
  try {
    const file = join(dir, 'lock');
    const release = await acquireFileLock(file);
    try {
      await utimes(file, new Date(0), new Date(0));
      await assert.rejects(acquireFileLock(file, 1, 10), /active process/);
    } finally { await release(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('releasing a lock preserves a replacement owner', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbot-lock-'));
  try {
    const file = join(dir, 'lock');
    const release = await acquireFileLock(file);
    await writeFile(file, 'replacement');
    await release();
    assert.equal(await readFile(file, 'utf8'), 'replacement');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('explicit tool failure and running background job are not successful evidence', () => {
  const ledger = new GroundingLedger();
  ledger.recordToolResult('shell', { command: 'npm test' }, 'output without error prefix', false);
  ledger.recordToolResult('shell', { command: 'npm test', background: true }, JSON.stringify({ status: 'running' }), true);
  assert.equal(ledger.getTurnCommandsRun().length, 0);
  ledger.recordToolResult('browser_open', {}, 'opened', true);
  assert.equal(auditAssistantClaims('All tests passed.', ledger).verified, false);
});

test('critical memory pressure compacts old tool outputs', async t => {
  const original = process.memoryUsage();
  t.mock.method(process, 'memoryUsage', () => ({ ...original, heapUsed: 300 * 1024 * 1024 }));
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  try {
    const messages: Message[] = [{ role: 'tool', content: 'a'.repeat(3000) }, ...Array.from({ length: 4 }, () => ({ role: 'user' as const, content: 'recent' }))];
    const result = await reclaimMemory({ id: 'unit', workspace: '', createdAt: '', updatedAt: '', messages });
    assert.equal(result.compactedCount, 1);
    assert.ok(messages[0].content.length < 3000);
  } finally { Object.defineProperty(process, 'platform', platform); }
});

test('agent sends current user image to provider and retains it in returned history', async () => {
  let received: Message[] = [];
  const provider: Provider = {
    id: 'unit', label: 'unit',
    async *stream(messages) { received = messages; yield { type: 'text', text: 'Image received.' }; },
  };
  const images = [{ mimeType: 'image/png' as const, data: 'unit' }];
  const history = await runAgent({ message: 'hello', images, history: [], provider, workspace: process.cwd(), approve: async () => false, onEvent: () => {} }, { maxRounds: 1 });
  assert.deepEqual(received.find(message => message.role === 'user')?.images, images);
  assert.deepEqual(history[0].images, images);
});
