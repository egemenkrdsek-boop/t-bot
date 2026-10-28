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

test('sentence table maps real requests to the write and verification contract', () => {
  const cases: Array<[string, string, boolean, boolean]> = [
    ['review the parser and fix the bug', 'mixed', true, true],
    ['review this code', 'inspect', false, false],
    ['improve performance', 'edit', true, true],
    ['make the tests pass', 'edit', true, true],
    ['continue', 'mixed', true, true],
    ['How do I improve performance?', 'conversation', false, false],
    ['basit HTTP sunucusu başlat', 'mixed', false, false],
    ['run the tests', 'inspect', false, true],
    ['explain the authentication flow', 'inspect', false, false],
    ['add a unit test for parseTutar', 'edit', true, true],
    ['fix the failing test', 'edit', true, true],
    ['refactor authentication', 'edit', true, true],
    ['read package.json', 'inspect', false, false],
    ['what does src/agent.ts do?', 'conversation', false, false],
    ['delete the obsolete file', 'edit', true, true],
    ['rename foo.ts to bar.ts', 'edit', true, true],
    ['create a README', 'edit', true, true],
    ['summarize the changes', 'inspect', false, false],
    ['please fix the parser', 'edit', true, true],
    ["don't change anything, just review the code", 'inspect', false, false],
    ['devam et', 'mixed', true, true],
    ['test et', 'inspect', false, true],
    ['uygula', 'edit', true, true],
    ['show me git status', 'inspect', false, false],
    ['kodu gözden geçir', 'inspect', false, false],
    ['kodun kalitesini değerlendir', 'inspect', false, false],
    ['ok', 'conversation', false, false],
    ['tamam', 'conversation', false, false],
    ['anladım', 'conversation', false, false],
    ['projeyi derle', 'mixed', false, false],
    ['deploy', 'mixed', true, true],
  ];
  for (const [sentence, kind, requiresWrite, requiresVerification] of cases) {
    const contract = buildTaskContract(sentence);
    assert.deepEqual(
      { kind: contract.kind, requiresWrite: contract.requiresWrite, requiresVerification: contract.requiresVerification },
      { kind, requiresWrite, requiresVerification },
      sentence,
    );
  }
});

test('continue inherits the previous edit contract instead of starting over', () => {
  const previous = buildTaskContract('improve performance');
  const inherited = buildTaskContract('continue', { previousContract: previous });
  assert.equal(inherited.kind, 'edit');
  assert.equal(inherited.requiresWrite, true);
  assert.equal(inherited.requiresVerification, true);
});

test('a browser form task never promises a workspace write', () => {
  const contract = buildTaskContract('Fill the form at http://localhost:3000 and submit it');
  assert.equal(contract.kind, 'browser');
  assert.equal(contract.requiresWrite, false);
  assert.equal(contract.requiresVerification, false);
});

test('a question restricted to file tools is inspection without a write contract', () => {
  const contract = buildTaskContract('Bu projede kaç TypeScript dosyası var? Yalnız dosya araçlarını kullan.');
  assert.equal(contract.kind, 'inspect');
  assert.equal(contract.requiresWrite, false);
});

test('a start/verify/stop server operation is mixed but never a file write', () => {
  const contract = buildTaskContract('basit HTTP sunucusu başlat, çalıştığını doğrula ve durdur');
  assert.equal(contract.kind, 'mixed');
  assert.equal(contract.requiresWrite, false);
});
