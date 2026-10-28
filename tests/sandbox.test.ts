import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertShellAllowed, sandboxStatus, sandboxWrap } from '../src/security/sandbox.js';

test('sandbox mode is explicit and never silently pretends to be active', () => {
  const off = sandboxStatus({ TBOT_SANDBOX: 'off' });
  assert.equal(off.mode, 'off');
  assert.equal(off.kind, 'none');
  assert.equal(off.available, false);

  const required = sandboxStatus({ TBOT_SANDBOX: 'required' });
  assert.equal(required.mode, 'required');
  if (!required.available) assert.match(required.reason, /sandbox|adapter|available/i);
});

test('no adapter means no wrapper and no false isolation claim', () => {
  assert.equal(sandboxWrap('echo hello', process.cwd(), { TBOT_SANDBOX: 'off' }), undefined);
});

test('an explicitly requested adapter fails closed when unavailable', () => {
  const explicit = process.platform === 'win32' ? 'bwrap' : 'sandbox-exec';
  const status = sandboxStatus({ TBOT_SANDBOX: explicit });
  if (!status.available) {
    assert.throws(() => assertShellAllowed({ TBOT_SANDBOX: explicit }), /requested but unavailable/);
  }
});
