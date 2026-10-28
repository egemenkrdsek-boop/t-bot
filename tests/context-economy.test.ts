import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateTokens, smartTruncateToolOutput } from '../src/token-optimizer.js';

test('large tool output is reduced by more than half before it enters context', () => {
  const raw = Array.from({ length: 4_000 }, (_, index) =>
    `2026-10-28T12:00:${String(index % 60).padStart(2, '0')}Z INFO worker-${index % 8} processed item ${index} with status ok`).join('\n');

  const truncated = smartTruncateToolOutput('shell', raw);
  const rawTokens = estimateTokens(raw);
  const keptTokens = estimateTokens(truncated.text);

  assert.ok(rawTokens > 10_000);
  assert.ok(truncated.savedTokens > 0);
  assert.ok(keptTokens < rawTokens * 0.5, `expected <50% context tokens, kept ${keptTokens}/${rawTokens}`);
});
