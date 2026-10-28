import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectConstraints,
  constraintPrompt,
  constraintViolation,
  extractConstraints,
} from '../src/constraints.js';
import { runAgent } from '../src/agent.js';
import type { Provider, ToolCall } from '../src/types.js';

const workspace = process.cwd();

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: 'call-1', name, arguments: args };
}

test('explicit path boundaries are extracted in English and Turkish', () => {
  assert.deepEqual(extractConstraints("Don't touch README.md").filter(item => item.kind === 'forbid-path').map(item => item.value), ['README.md']);
  assert.deepEqual(extractConstraints('src/app.ts dosyasını değiştirme').filter(item => item.kind === 'forbid-path').map(item => item.value), ['src/app.ts']);
  assert.deepEqual(extractConstraints('Only edit src/allowed.ts').filter(item => item.kind === 'only-path').map(item => item.value), ['src/allowed.ts']);
});

test('negated reminders are not mistaken for blocked commands', () => {
  assert.equal(extractConstraints("Don't forget to run the tests").some(item => item.kind === 'forbid-command'), false);
  assert.equal(extractConstraints('Testleri unutma, çalıştır').some(item => item.kind === 'no-command'), false);
});

test('command, tool and all-write boundaries are extracted', () => {
  const english = extractConstraints('Do not run `npm test`; do not use the browser.');
  assert.ok(english.some(item => item.kind === 'forbid-command' && item.value === 'npm test'));
  assert.ok(english.some(item => item.kind === 'forbid-tool' && item.value === 'browser'));

  const turkish = extractConstraints('Tarayıcıyı kullanma. Hiçbir dosyayı değiştirme.');
  assert.ok(turkish.some(item => item.kind === 'forbid-tool' && item.value === 'browser'));
  assert.ok(turkish.some(item => item.kind === 'no-write'));
});

test('constraints persist and can be explicitly released', () => {
  const persisted = collectConstraints(["Don't touch README.md", 'Only edit src/allowed.ts']);
  assert.ok(persisted.some(item => item.kind === 'forbid-path'));
  assert.ok(persisted.some(item => item.kind === 'only-path'));

  const released = collectConstraints(["Don't touch README.md", 'Ignore previous constraints']);
  assert.equal(released.length, 0);

  const reallowed = collectConstraints(["Don't touch README.md", 'You can now edit README.md']);
  assert.equal(reallowed.some(item => item.kind === 'forbid-path'), false);
});

test('the prompt section is compact and only lists effective boundaries', () => {
  const prompt = constraintPrompt(collectConstraints(["Don't touch README.md", 'Do not run `npm test`']));
  assert.match(prompt, /USER CONSTRAINTS/);
  assert.match(prompt, /README\.md/);
  assert.match(prompt, /npm test/);
  assert.equal(constraintPrompt([]), '');
});

test('no-write and no-command boundaries cover checkpoint, git and delegation tools', () => {
  const noWrite = collectConstraints(["Don't change anything; just review."]);
  assert.match(constraintViolation(call('checkpoint_restore', { id: 'ckpt-1' }), noWrite, workspace) ?? '', /blocks file writes/);
  assert.match(constraintViolation(call('git_commit', { message: 'x' }), noWrite, workspace) ?? '', /blocks file writes/);
  assert.match(constraintViolation(call('skill_create', { name: 'x' }), noWrite, workspace) ?? '', /blocks file writes/);

  const noCommand = collectConstraints(['Do not run any commands.']);
  assert.match(constraintViolation(call('delegate_task', {}), noCommand, workspace) ?? '', /blocks command execution/);
  assert.match(constraintViolation(call('process_write', { id: 'p1', input: 'x' }), noCommand, workspace) ?? '', /blocks command execution/);
});

test('path boundaries block writes but not reads', () => {
  const constraints = collectConstraints(["Don't touch README.md"]);
  assert.ok(constraintViolation(call('file_write', { path: 'README.md', content: 'x' }), constraints, workspace));
  assert.ok(constraintViolation(call('file_patch', { path: './README.md', old_text: 'x', new_text: 'y' }), constraints, workspace));
  assert.equal(constraintViolation(call('file_read', { path: 'README.md' }), constraints, workspace), undefined);
  assert.equal(constraintViolation(call('file_write', { path: 'src/other.ts', content: 'x' }), constraints, workspace), undefined);
  assert.ok(constraintViolation(call('shell', { command: 'echo changed > README.md' }), constraints, workspace));
  assert.equal(constraintViolation(call('shell', { command: 'cat README.md' }), constraints, workspace), undefined);
});

test('only-path is a real allowlist and includes nested files', () => {
  const constraints = collectConstraints(['Only edit src/allowed.ts']);
  assert.equal(constraintViolation(call('file_patch', { path: 'src/allowed.ts' }), constraints, workspace), undefined);
  assert.ok(constraintViolation(call('file_patch', { path: 'src/other.ts' }), constraints, workspace));
  assert.ok(constraintViolation(call('file_patch', { path: 'README.md' }), constraints, workspace));
  assert.ok(constraintViolation(call('shell', { command: 'echo changed > src/other.ts' }), constraints, workspace));
});

test('the agent blocks a violating tool call before approval and persists the boundary in the prompt', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tbot-constraint-agent-'));
  try {
    await writeFile(join(workspace, 'README.md'), 'original\n', 'utf8');
    let round = 0;
    let approvals = 0;
    const systemPrompts: string[] = [];
    const userPrompts: string[] = [];
    const provider: Provider = {
      id: 'unit',
      label: 'unit',
      async *stream(messages) {
        systemPrompts.push(messages[0]?.content || '');
        userPrompts.push(messages.findLast(message => message.role === 'user')?.content || '');
        if (round++ === 0) {
          yield { type: 'tool_calls', calls: [{ id: 'write-1', name: 'file_write', arguments: { path: 'README.md', content: 'changed' } }] };
        } else {
          yield { type: 'text', text: 'The write was blocked by the user constraint.' };
        }
      },
    };
    const history = await runAgent({
      message: "Don't touch README.md, but change it.",
      history: [],
      provider,
      workspace,
      approve: async () => { approvals++; return true; },
      onEvent: () => {},
    }, { maxRounds: 2 });
    assert.equal(await readFile(join(workspace, 'README.md'), 'utf8'), 'original\n');
    assert.equal(approvals, 0);
    // C9: the volatile constraint block rides on the current user message so
    // the system prefix stays cache-stable.
    assert.doesNotMatch(systemPrompts[0] || '', /USER CONSTRAINTS/);
    assert.match(userPrompts[0] || '', /USER CONSTRAINTS/);
    assert.match(userPrompts[0] || '', /README\.md/);
    assert.ok(history.some(message => message.role === 'tool' && /constraint blocks changes/.test(message.content)));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('command, tool and no-write boundaries are enforced before execution', () => {
  const command = collectConstraints(['Do not run `npm test`']);
  assert.ok(constraintViolation(call('shell', { command: 'npm test -- --runInBand' }), command, workspace));
  assert.ok(constraintViolation(call('project_verify', { commands: ['test'] }), command, workspace));
  assert.equal(constraintViolation(call('shell', { command: 'npm run typecheck' }), command, workspace), undefined);

  const browser = collectConstraints(['Do not use the browser']);
  assert.ok(constraintViolation(call('browser_open', { url: 'https://example.com' }), browser, workspace));
  assert.equal(constraintViolation(call('file_read', { path: 'README.md' }), browser, workspace), undefined);

  const write = collectConstraints(['Do not modify any files']);
  assert.ok(constraintViolation(call('file_write', { path: 'src/a.ts' }), write, workspace));
  assert.equal(constraintViolation(call('file_read', { path: 'src/a.ts' }), write, workspace), undefined);
  assert.ok(constraintViolation(call('shell', { command: 'echo changed > src/a.ts' }), write, workspace));
});
