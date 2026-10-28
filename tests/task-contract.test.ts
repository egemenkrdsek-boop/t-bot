import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTaskContract } from '../src/core/task-contract.js';

test('casual conversation is classified as conversation, not inspection', () => {
  assert.equal(buildTaskContract('Hello, how are you?').kind, 'conversation');
});

test('an explicit review request is inspection', () => {
  assert.equal(buildTaskContract('Review the parser changes.').kind, 'inspect');
});

test('a review-only boundary cannot produce a write contract', () => {
  const contract = buildTaskContract("Don't change anything; just review the parser.", { readOnly: true });
  assert.equal(contract.requiresWrite, false);
  assert.equal(contract.requiresVerification, false);
  assert.equal(contract.kind, 'inspect');
});

test('a fix request produces an edit contract with verification', () => {
  const contract = buildTaskContract('Fix the parser bug.');
  assert.equal(contract.kind, 'edit');
  assert.equal(contract.requiresWrite, true);
  assert.equal(contract.requiresVerification, true);
});
