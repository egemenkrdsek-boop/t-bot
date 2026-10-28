import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GUI_WARM_IDLE_MS,
  guiObservation,
  isComputerObservationAction,
  MAX_BATCH_STEPS,
  validateBatchSteps,
} from '../src/tools/gui-policy.js';

test('GUI actions default to cheap state observation', () => {
  assert.equal(guiObservation({}), 'state');
  assert.equal(guiObservation({ observe: 'none' }), 'none');
  assert.equal(guiObservation({ observe: 'visual' }), 'visual');
  assert.equal(guiObservation({ auto_screenshot: true }), 'visual');
  assert.equal(guiObservation({ observe: 'none', auto_screenshot: true }), 'none');
});

test('warm GUI sessions survive normal model and approval latency', () => {
  assert.ok(GUI_WARM_IDLE_MS >= 5 * 60_000);
});

test('computer observations are classified separately from mutations', () => {
  assert.equal(isComputerObservationAction('inspect'), true);
  assert.equal(isComputerObservationAction('windows'), true);
  assert.equal(isComputerObservationAction('screenshot'), true);
  assert.equal(isComputerObservationAction('click'), false);
  assert.equal(isComputerObservationAction('type'), false);
});

test('batch steps are bounded and validated before any approval', () => {
  const steps = validateBatchSteps([{ action: 'click', ref: 'e1' }], ['click', 'type']);
  assert.equal(steps.length, 1);
  assert.throws(() => validateBatchSteps([], ['click']), /non-empty/);
  assert.throws(() => validateBatchSteps(Array.from({ length: MAX_BATCH_STEPS + 1 }, () => ({ action: 'click' })), ['click']), /limited/);
  assert.throws(() => validateBatchSteps([{ action: 'shell' }], ['click']), /unsupported/);
});
