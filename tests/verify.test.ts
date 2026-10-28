import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectVerificationCommands, handleVerifyTool } from '../src/tools/verify.js';

test('verification commands are detected from package.json and lockfile only', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tbot-verify-'));
  try {
    await writeFile(join(workspace, 'package.json'), JSON.stringify({
      scripts: {
        typecheck: 'tsc --noEmit',
        test: 'node --test',
        lint: 'eslint .',
        deploy: 'do-not-run',
      },
    }));
    await writeFile(join(workspace, 'pnpm-lock.yaml'), '');
    const commands = await detectVerificationCommands(workspace);
    assert.deepEqual(commands.map(item => item.script), ['typecheck', 'lint', 'test']);
    assert.ok(commands.every(item => item.command.startsWith('pnpm run ')));
    assert.ok(!commands.some(item => item.command.includes('deploy')));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verification refuses undeclared scripts without spawning a shell', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tbot-verify-safe-'));
  try {
    await writeFile(join(workspace, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
    const result = JSON.parse(await handleVerifyTool('project_verify', { commands: ['deploy'] }, workspace));
    assert.equal(result.ok, false);
    assert.equal(result.outcome, 'denied');
    assert.deepEqual(result.allowed, ['test']);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('verification reports an explicit unavailable state when no scripts exist', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tbot-verify-empty-'));
  try {
    const result = JSON.parse(await handleVerifyTool('project_verify', {}, workspace));
    assert.equal(result.ok, false);
    assert.equal(result.outcome, 'unavailable');
    assert.deepEqual(result.commands, []);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('project_verify failure result is valid JSON with an actionable failure tail', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tbot-verify-fail-'));
  try {
    await writeFile(join(workspace, 'package.json'), JSON.stringify({
      scripts: { test: `node -e "console.error('AssertionError: expected 2 but got 1'); process.exit(1)"` },
    }));
    const raw = await handleVerifyTool('project_verify', { timeout_ms: 5000 }, workspace, undefined, 'verify-failure-test');
    const result = JSON.parse(raw) as { ok: boolean; outcome?: string; failure?: string; failureTail?: string };
    assert.equal(result.ok, false);
    assert.equal(result.outcome, 'error');
    const failure = result.failureTail ?? result.failure ?? '';
    assert.match(failure, /AssertionError: expected 2 but got 1/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('project_verify success result has no failure fields', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tbot-verify-ok-'));
  try {
    await writeFile(join(workspace, 'package.json'), JSON.stringify({
      scripts: { test: `node -e "console.log('all-good')"` },
    }));
    const raw = await handleVerifyTool('project_verify', { timeout_ms: 5000 }, workspace, undefined, 'verify-success-test');
    const result = JSON.parse(raw) as { ok: boolean; outcome?: string; failure?: unknown; failureTail?: unknown };
    assert.equal(result.ok, true);
    assert.equal(result.outcome, 'ok');
    assert.equal(result.failure, undefined);
    assert.equal(result.failureTail, undefined);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
