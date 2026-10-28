/**
 * T1/T2 focused fixtures: desktop window references are human-friendly
 * (optional handle, hex HWND accepted) and loopback browser access is a
 * per-call opt-in rather than a sticky module-wide switch.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computerToolDefinitions } from '../src/tools/computer.js';
import { browserToolDefinitions, validateBrowserUrl } from '../src/tools/browser.js';
import * as computerModule from '../src/tools/computer.js';

test('computer focus does not require a handle and resolves a hex HWND', () => {
  const normalize = (computerModule as unknown as {
    normalizeComputerArgs?: (args: Record<string, unknown>) => Record<string, unknown>;
  }).normalizeComputerArgs;
  assert.equal(typeof normalize, 'function', 'normalizeComputerArgs must stay exported for window-contract tests');

  const focus = normalize!({ action: 'focus' });
  assert.equal(focus.action, 'focus');
  assert.equal(focus.handle, undefined);

  const hex = normalize!({ action: 'focus', handle: '0x1A2B' });
  assert.equal(hex.action, 'focus');
  assert.equal(hex.handle, String(parseInt('0x1A2B', 16)));

  const title = normalize!({ action: 'focus', handle: 'Notepad' });
  assert.equal(title.handle, 'Notepad');

  const computer = computerToolDefinitions.find(tool => tool.name === 'computer')!;
  const parameters = computer.parameters as { required?: string[]; properties: Record<string, { enum?: string[] }> };
  assert.deepEqual(parameters.required, ['action']);
  assert.ok(parameters.properties.action.enum?.includes('focus'));
  assert.ok('handle' in parameters.properties);
});

test('loopback browser navigation is an explicit per-call opt-in', async () => {
  await assert.rejects(validateBrowserUrl('http://localhost:3000/', false), /SSRF protection|allow_local/);
  assert.equal(await validateBrowserUrl('http://localhost:3000/', true), 'http://localhost:3000/');
  // A previous opt-in must not make the next call local-capable.
  await assert.rejects(validateBrowserUrl('http://127.0.0.1:3000/', false), /SSRF protection|allow_local/);

  for (const name of ['browser_navigate', 'browser_open']) {
    const tool = browserToolDefinitions.find(candidate => candidate.name === name)!;
    const allowLocal = (tool.parameters as { properties: Record<string, { type?: string }> }).properties.allow_local;
    assert.equal(allowLocal?.type, 'boolean', `${name} must expose a per-call allow_local flag`);
  }
});
