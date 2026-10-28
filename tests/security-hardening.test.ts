import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import dns from 'node:dns';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { syncBuiltinESMExports } from 'node:module';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertPublicHttpUrl } from '../src/security/url.js';
import { childEnvironment } from '../src/security/env.js';
import { assertNotSensitivePath, defaultDesktopWorkspace, isSensitivePath, resolveWorkspacePath } from '../src/security/paths.js';
import { handleFileTool } from '../src/tools/files.js';
import { handleShellTool, pruneCompletedProcesses, stopAllBackgroundProcesses } from '../src/tools/shell.js';
import { handleGitTool, resolveGitExecutable } from '../src/tools/git.js';
import { isToolResultOk } from '../src/tools/index.js';

test('workspace containment rejects .. and symlink/junction escapes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tbot-path-escape-'));
  const workspace = join(root, 'ws');
  const outside = join(root, 'outside');
  await mkdir(workspace);
  await mkdir(outside);
  try {
    await assert.rejects(resolveWorkspacePath(workspace, '../outside/secret.txt'), /escapes workspace/);
    await assert.rejects(resolveWorkspacePath(workspace, join(outside, 'secret.txt')), /escapes workspace/);
    await assert.rejects(resolveWorkspacePath(workspace, 'a/../../outside/secret.txt'), /escapes workspace/);
    assert.equal(await resolveWorkspacePath(workspace, 'src/index.ts'), join(workspace, 'src', 'index.ts'));

    await symlink(outside, join(workspace, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(resolveWorkspacePath(workspace, 'link/secret.txt'), /Symbolic links are not allowed/);
    assert.equal(defaultDesktopWorkspace({ USERPROFILE: 'C:\\Users\\unit' }), join('C:\\Users\\unit', 'T-Bot'));
    assert.notEqual(defaultDesktopWorkspace({ HOME: '/home/unit' }), '/home/unit');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('protected file paths are refused for writes and gated for reads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tbot-sensitive-'));
  const workspace = join(root, 'ws');
  const appData = join(root, 'appdata');
  await mkdir(workspace);
  const previousAppData = process.env.APPDATA;
  process.env.APPDATA = appData;
  try {
    assert.equal(isSensitivePath(join(workspace, '.ssh', 'id_rsa')), true);
    assert.equal(isSensitivePath(join(workspace, '.env')), true);
    assert.equal(isSensitivePath(join(workspace, '.env.production')), true);
    assert.equal(isSensitivePath(join(workspace, 'server.pem')), true);
    assert.equal(isSensitivePath(join(workspace, 'credentials.json')), true);
    assert.equal(isSensitivePath(join(workspace, 'src', 'index.ts')), false);

    // T Bot config directory (config + sessions + secrets).
    const configDir = join(appData, 'TBot');
    assert.equal(isSensitivePath(join(configDir, 'config.json')), true);
    assert.equal(isSensitivePath(join(configDir, 'sessions', 'abc.json')), true);
    assert.equal(isSensitivePath(join(configDir, 'secrets', 'openai.json')), true);

    assert.throws(() => assertNotSensitivePath(join(workspace, '.env'), { operation: 'write' }), /Protected path/);
    assert.throws(() => assertNotSensitivePath(join(workspace, '.env'), { operation: 'read' }), /Protected path/);
    assert.throws(() => assertNotSensitivePath(join(configDir, 'config.json'), { operation: 'write' }), /Protected path/);
    assert.doesNotThrow(() => assertNotSensitivePath(join(workspace, 'src', 'index.ts'), { operation: 'write' }));

    // Writes to a protected path are refused by the file tool.
    await assert.rejects(handleFileTool('file_write', { path: '.env', content: 'A=1' }, workspace), /Protected path/);
    await assert.rejects(handleFileTool('file_patch', { path: '.env', old_text: 'A', new_text: 'B' }, workspace), /Protected path/);

    // Reads are allowed after approval, but secret-looking values are masked.
    await writeFile(join(workspace, '.env'), 'OPENAI_API_KEY=sk-abcdefghijklmnop\nNAME=visible\n');
    const output = await handleFileTool('file_read', { path: '.env', full: true }, workspace);
    assert.match(output, /OPENAI_API_KEY=\[REDACTED\]/);
    assert.doesNotMatch(output, /sk-abcdefghijklmnop/);
    assert.match(output, /NAME=visible/);
  } finally {
    if (previousAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = previousAppData;
    await rm(root, { recursive: true, force: true });
  }
});

test('child environment allowlist drops credentials and keeps runtime paths', () => {
  const env = childEnvironment({}, {
    PATH: 'runtime-path',
    SystemRoot: 'windows',
    OPENAI_KEY: 'sensitive',
    DATABASE_URL: 'postgres://secret',
    AWS_ACCESS_KEY_ID: 'sensitive',
    TELEGRAM_BOT_TOKEN: 'sensitive',
    TBOT_API_KEY: 'sensitive',
    HOME: '/home/unit',
  });
  assert.equal(env.PATH, 'runtime-path');
  assert.equal(env.SystemRoot, 'windows');
  assert.equal(env.HOME, '/home/unit');
  for (const name of ['OPENAI_KEY', 'DATABASE_URL', 'AWS_ACCESS_KEY_ID', 'TELEGRAM_BOT_TOKEN', 'TBOT_API_KEY']) {
    assert.equal(env[name], undefined, `${name} must not be forwarded`);
  }
  assert.equal(env.NoDefaultCurrentDirectoryInExePath, process.platform === 'win32' ? '1' : undefined);
});

test('public URL policy rejects local, metadata and non-HTTP targets', async () => {
  const lookup = mock.method(dns, 'lookup', (hostname: string, _options: unknown, callback: Function) => {
    if (hostname === 'example.com') return callback(null, [{ address: '93.184.216.34', family: 4 }]);
    if (hostname === '169.254.169.254.nip.io') return callback(null, [{ address: '169.254.169.254', family: 4 }]);
    return callback(new Error('ENOTFOUND'));
  });
  try {
    for (const url of ['http://127.0.0.1/', 'http://169.254.169.254/', 'http://169.254.169.254.nip.io/',
      'http://[fd00:ec2::254]/', 'http://[::1]/', 'file:///etc/passwd', 'ftp://example.com/',
      'https://user:secret@example.com/']) {
      await assert.rejects(assertPublicHttpUrl(url), /SSRF protection|Only public HTTP/, url);
    }
    const accepted = await assertPublicHttpUrl('https://example.com/');
    assert.equal(accepted.href, 'https://example.com/');
    await assert.rejects(assertPublicHttpUrl('http://127.0.0.1/'), /SSRF protection/);
    assert.equal((await assertPublicHttpUrl('http://127.0.0.1/', { allowLocal: true })).href, 'http://127.0.0.1/');
  } finally {
    lookup.mock.restore();
  }
});

test('workspace-planted git.cmd is not resolved by the shell', { skip: process.platform !== 'win32' }, async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tbot-shell-cwd-'));
  const marker = join(workspace, 'pwned.txt');
  try {
    await writeFile(join(workspace, 'git.cmd'), `@echo off\r\necho pwned > "${marker}"\r\ngit %*\r\n`);
    const output = await handleShellTool('shell', { command: 'git --version' }, workspace);
    assert.doesNotMatch(output, /pwned/);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(existsSync(marker), false, 'workspace git.cmd must never execute');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('shell result classification reads the last exit marker', () => {
  assert.equal(isToolResultOk('shell', 'Exit code: 0\nExit code: 1'), false);
  assert.equal(isToolResultOk('shell', 'Exit code: 1\nExit code: 0'), true);
  assert.equal(isToolResultOk('shell', 'output\nExit code: 0'), true);
  assert.equal(isToolResultOk('shell', 'output\nExit code: signal SIGTERM'), false);
  assert.equal(isToolResultOk('shell', 'a\n[TBOT_EXIT: 0]'), true);
  assert.equal(isToolResultOk('shell', 'a\n[TBOT_EXIT: 1]'), false);
  assert.equal(isToolResultOk('shell', '[TBOT_EXIT: 0]\n[TBOT_EXIT: 2]'), false);
});

test('real shell output keeps a parseable exit marker before the trailing exit code', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tbot-shell-marker-'));
  try {
    const output = await handleShellTool('shell', { command: 'tbot-nonexistent-command-9f3a' }, workspace);
    const marker = output.match(/\[TBOT_EXIT: (-?\d+)\]/);
    assert.ok(marker && marker[1] !== '0', `non-zero exit marker expected: ${output}`);
    assert.match(output.trimEnd().split(/\r?\n/).pop() ?? '', /^Exit code: \d+$/);
    assert.equal(isToolResultOk('shell', output), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('git hooks are disabled for tool-driven commits', async (t) => {
  const repo = await mkdtemp(join(tmpdir(), 'tbot-git-hooks-'));
  const run = promisify(execFile);
  try {
    let executable: string;
    try {
      executable = await resolveGitExecutable(repo);
    } catch {
      t.skip('git is not installed');
      return;
    }
    await run(executable, ['init', repo], { windowsHide: true });
    await run(executable, ['-C', repo, 'config', 'user.name', 'Unit Test'], { windowsHide: true });
    await run(executable, ['-C', repo, 'config', 'user.email', 'unit@example.invalid'], { windowsHide: true });

    const hookDir = join(repo, '.githooks');
    const marker = join(repo, 'hook-ran.txt');
    await mkdir(hookDir);
    const hook = join(hookDir, 'pre-commit');
    await writeFile(hook, `#!/bin/sh\necho ran > "${marker.replace(/\\/g, '/')}"\n`);
    await chmod(hook, 0o755).catch(() => undefined);
    await run(executable, ['-C', repo, 'config', 'core.hooksPath', hookDir]);

    await writeFile(join(repo, 'a.txt'), 'first\n');
    await run(executable, ['-C', repo, 'add', '--', 'a.txt']);
    try {
      await run(executable, ['-C', repo, 'commit', '-m', 'control'], { windowsHide: true });
    } catch { /* a failing control commit still tells us whether the hook ran */ }
    if (!existsSync(marker)) {
      t.skip('git hooks are not executable on this platform');
      return;
    }
    await rm(marker);

    await writeFile(join(repo, 'a.txt'), 'second\n');
    await run(executable, ['-C', repo, 'add', '--', 'a.txt']);
    await handleGitTool('git_commit', { message: 'tool commit' }, { workspace: repo });
    assert.equal(existsSync(marker), false, 'pre-commit hook must not run through the git tool');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('process_stop keeps a running status when the kill fails', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tbot-stop-fail-'));
  const spawn = mock.method(childProcess, 'spawn', ((command: string, args: string[]) => {
    const child = new EventEmitter() as any;
    child.pid = 4242;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new Writable({ write: (_chunk: any, _encoding: any, done: () => void) => done() });
    // The fallback kill must also fail so the test is platform-independent:
    // Linux reaches child.kill('SIGKILL') after process.kill(-pid) throws,
    // while Windows uses the taskkill close=1 path above.
    child.kill = () => false;
    if (String(command).endsWith('taskkill.exe')) {
      queueMicrotask(() => child.emit('close', 1));
    } else {
      queueMicrotask(() => child.stdout.write('background output'));
    }
    return child;
  }) as typeof childProcess.spawn);
  syncBuiltinESMExports();
  try {
    const started = JSON.parse(await handleShellTool('shell', { command: 'fixture only', background: true }, workspace, undefined, 'owner'));
    const result = JSON.parse(await handleShellTool('process_stop', { process_id: started.processId }, workspace, undefined, 'owner'));
    assert.equal(result.status, 'running');
    assert.doesNotMatch(result.message, /stopped\./);
  } finally {
    stopAllBackgroundProcesses();
    pruneCompletedProcesses();
    spawn.mock.restore();
    syncBuiltinESMExports();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('redaction masks credentials without touching ordinary code', async () => {
  const { redactSecrets } = await import('../src/secrets.js');
  const text = 'Authorization: Bearer abc.def.ghi\nurl=https://user:pass@example.com/x?token=deadbeef&y=1\ntg=123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi\n';
  const redacted = redactSecrets(text);
  assert.doesNotMatch(redacted, /abc\.def\.ghi/);
  assert.doesNotMatch(redacted, /user:pass/);
  assert.doesNotMatch(redacted, /deadbeef/);
  assert.doesNotMatch(redacted, /ABCDEFGHIJKLMNOPQRSTUVWXYZ/);
  assert.match(redactSecrets('const apiKey = "secret";'), /apiKey = "\[REDACTED\]"|apiKey = \[REDACTED\]/);
});
