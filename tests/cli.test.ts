import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCli } from '../src/cli.js';
import { createEventPrinter, renderHudBar } from '../src/tui.js';
import { supportsNodeVersion } from '../src/version.js';
import { validateCodeAstAndGrounding } from '../src/ast-validator.js';

test('CLI separates literal prompts, command arguments and valued options', () => {
  assert.equal(parseCli(['--', '--help', 'literal']).message, '--help literal');
  assert.equal(parseCli(['--', 'config']).message, 'config');
  assert.equal(parseCli(['--provider', 'custom', '--', 'sessions']).message, 'sessions');
  assert.deepEqual(parseCli(['config', 'openai']).args, ['openai']);
  const result = parseCli(['--provider=custom', '-m', 'local-model', '--effort', 'HIGH', 'fix', 'it']);
  assert.equal(result.provider, 'custom');
  assert.equal(result.model, 'local-model');
  assert.equal(result.effort, 'high');
  assert.equal(result.message, 'fix it');
  for (const argv of [['--model'], ['--model', '--help'], ['--effort=nope'], ['--unknown']]) {
    assert.throws(() => parseCli(argv));
  }
});

test('minimum Node version agrees with package engines', () => {
  for (const version of ['22.11.0', '20.20.0', 'invalid']) assert.equal(supportsNodeVersion(version), false);
  for (const version of ['v22.12.0', '22.13.0', '24.0.0']) assert.equal(supportsNodeVersion(version), true);
});

test('AST validation rejects invented node builtins and accepts prefix-only builtins', async () => {
  assert.equal((await validateCodeAstAndGrounding('sample.ts', "import value from 'node:imaginary-module';", process.cwd())).valid, false);
  assert.equal((await validateCodeAstAndGrounding('sample.ts', "import { test } from 'node:test';", process.cwd())).valid, true);
});

test('TUI tool lifecycle strips terminal controls from every external display field', () => {
  let output = '';
  const printer = createEventPrinter({ interactive: false, getHudConfig: () => ({}), write: text => { output += text; } });
  const call = { id: 'one', name: 'file_read\x1b[2J', arguments: { path: 'test\x1b]0;spoof\x07.ts' } };
  printer.emit({ type: 'tool_start', call });
  printer.emit({ type: 'tool_end', call, result: 'Tool error: failed\x1b[2J\x07' });
  printer.finishStream();
  assert.ok(output.includes('test'));
  assert.ok(output.includes('failed'));
  assert.doesNotMatch(output, /[\x00-\x08\x0b-\x1f\x7f-\x9f]/);
});

test('TUI handles primitive JSON tool arguments without crashing', () => {
  const printer = createEventPrinter({ interactive: false, getHudConfig: () => ({}), write: () => {} });
  for (const argumentsValue of ['null', '12', '"text"', '[]']) {
    assert.doesNotThrow(() => printer.emit({ type: 'tool_start', call: { id: 'one', name: 'custom', arguments: argumentsValue } }));
  }
  printer.finishStream();
});

test('TUI keeps cancellation state independently of animation and sanitizes the HUD', () => {
  const previous = process.env.TBOT_NO_ANIMATION;
  process.env.TBOT_NO_ANIMATION = '1';
  try {
    const printer = createEventPrinter({ interactive: true, getHudConfig: () => ({}), write: () => {} });
    printer.startThinking('work');
    assert.equal(printer.isThinking(), true);
    printer.stopThinking();
    assert.equal(printer.isThinking(), false);
    assert.doesNotMatch(renderHudBar({ model: 'model\x1b]0;spoof\x07', effort: 'high\r' }), /[\x00-\x08\x0b-\x1f\x7f-\x9f]/);
  } finally {
    if (previous === undefined) delete process.env.TBOT_NO_ANIMATION;
    else process.env.TBOT_NO_ANIMATION = previous;
  }
});
