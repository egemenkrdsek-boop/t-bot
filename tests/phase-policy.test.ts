import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createPhaseState,
  finalAnswerViolation,
  recordPhaseToolResult,
} from '../src/core/phase-policy.js';
import type { TaskContract } from '../src/core/task-contract.js';
import type { ToolCall } from '../src/types.js';

function call(name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id: 'call-1', name, arguments: args };
}

const editContract: TaskContract = {
  objective: 'Fix the parser',
  kind: 'edit',
  risk: 'medium',
  requiresWrite: true,
  requiresVerification: true,
  weakMode: false,
  acceptance: [],
};

test('a successful verification followed by another write is rejected', () => {
  const state = createPhaseState();
  recordPhaseToolResult(state, call('file_patch', { path: 'a.ts' }), true);
  recordPhaseToolResult(state, call('project_verify', {}), true);
  recordPhaseToolResult(state, call('file_patch', { path: 'a.ts' }), true);

  assert.match(finalAnswerViolation(state, editContract, 'Done, tests passed.') ?? '', /verification ran before the last file change/);
});

test('the latest failed verification cannot be hidden by an earlier pass', () => {
  const state = createPhaseState();
  recordPhaseToolResult(state, call('file_patch', { path: 'a.ts' }), true);
  recordPhaseToolResult(state, call('project_verify', {}), true);
  recordPhaseToolResult(state, call('project_verify', {}), false);

  assert.match(finalAnswerViolation(state, editContract, 'Fixed and verified.') ?? '', /latest verification did not pass/);
  assert.equal(finalAnswerViolation(state, editContract, 'The change is not verified; tests still fail.'), undefined);
});

test('verification after the final write satisfies the completion gate', () => {
  const state = createPhaseState();
  recordPhaseToolResult(state, call('file_patch', { path: 'a.ts' }), true);
  recordPhaseToolResult(state, call('project_verify', {}), true);

  assert.equal(finalAnswerViolation(state, editContract, 'Done, tests passed.'), undefined);
});

test('an edit task without a write cannot be reported as complete', () => {
  const state = createPhaseState();
  assert.match(finalAnswerViolation(state, editContract, 'All set.') ?? '', /no file was changed/);
});
