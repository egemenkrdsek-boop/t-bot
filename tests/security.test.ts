import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import dns from 'node:dns';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, link, copyFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter, isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveGitExecutable, handleGitTool } from '../src/tools/git.js';
import { handleSkillTool, loadCustomSkills, buildSkillPrompt, autoDistillSkillFromTurn } from '../src/skills.js';
import { fetchPublicText, isPrivateOrLocalHost, publicLookup, validatePublicUrl } from '../src/tools/public-network.js';
import { fetchUrlContent } from '../src/tools/web.js';
import { executeTool, APPROVAL_REQUIRED_TOOLS } from '../src/tools/index.js';
import { shellEnvironment } from '../src/tools/shell.js';
import { createApprovalNonce, parseApprovalCallback, formatApprovalArguments, createPairingChallenge, acceptPairingCode } from '../src/telegram-security.js';

test('public URL policy rejects alternate local representations and credentials', () => {
  for (const host of ['localhost.', 'a.localhost', '10.0.0.1', '127.1', '2130706433', '0x7f000001',
    '[::1]', '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[fd12::1]', '[fc12::1]', '[fe90::1]',
    '169.254.169.254', '100.64.0.1', '[2002:7f00:1::]']) {
    assert.throws(() => validatePublicUrl(`http://${host}/`), undefined, host);
  }
  assert.throws(() => validatePublicUrl('https://user:secret@example.com/'));
  assert.equal(validatePublicUrl('https://example.com/a').href, 'https://example.com/a');
  assert.equal(isPrivateOrLocalHost('2606:4700:4700::1111'), false);
});

test('socket DNS validation rejects private answers and mixed public/private answers', async () => {
  for (const addresses of [[{ address: '127.0.0.1', family: 4 }],
    [{ address: '93.184.216.34', family: 4 }, { address: 'fd12::1', family: 6 }]]) {
    const lookup = mock.method(dns, 'lookup', (_host: unknown, _opts: unknown, callback: Function) => callback(null, addresses));
    await assert.rejects(new Promise((resolve, reject) => {
      publicLookup('attacker.example', {}, ((error: Error | null, address: unknown) => error ? reject(error) : resolve(address)) as any);
    }), /SSRF protection/);
    lookup.mock.restore();
  }
  const lookup = mock.method(dns, 'lookup', (_host: unknown, _opts: unknown, callback: Function) => callback(null, [{ address: '93.184.216.34', family: 4 }]));
  try {
    assert.equal(await new Promise((resolve, reject) => {
      publicLookup('example.com', {}, ((error: Error | null, address: unknown) => error ? reject(error) : resolve(address)) as any);
    }), '93.184.216.34');
  } finally { lookup.mock.restore(); }
});

function stubHttp(responses: Array<{ status?: number; location?: string; body?: string; contentType?: string }>) {
  let calls = 0;
  const stub = mock.method(http, 'request', (_url: unknown, options: http.RequestOptions, callback: Function) => {
    assert.equal(options.lookup, publicLookup);
    assert.equal(options.agent, false);
    const response = responses[calls++];
    assert.ok(response, 'unexpected outbound request');
    const request = new EventEmitter() as any;
    request.destroy = (error?: Error) => { if (error) queueMicrotask(() => request.emit('error', error)); };
    request.end = () => queueMicrotask(() => {
      const incoming = Readable.from([Buffer.from(response.body ?? '')]) as any;
      incoming.statusCode = response.status ?? 200;
      incoming.statusMessage = 'OK';
      incoming.headers = { location: response.location, 'content-type': response.contentType ?? 'text/plain' };
      callback(incoming);
    });
    return request;
  });
  return { restore: () => stub.mock.restore(), calls: () => calls };
}

test('redirect to metadata is rejected before any second request', async () => {
  const stub = stubHttp([{ status: 302, location: 'http://169.254.169.254/latest/meta-data' }]);
  try {
    await assert.rejects(fetchUrlContent('http://example.com/'), /SSRF protection/);
    assert.equal(stub.calls(), 1);
  } finally { stub.restore(); }
});

test('relative public redirects and readable HTML extraction remain supported', async () => {
  const stub = stubHttp([{ status: 302, location: '/article' }, { body: '<html><h1>Hello</h1><p>World</p></html>', contentType: 'text/html' }]);
  try {
    assert.match(await fetchUrlContent('http://example.com/'), /# Hello\n\nWorld/);
    assert.equal(stub.calls(), 2);
  } finally { stub.restore(); }
});

test('public HTTP transport bounds bodies before parsing', async () => {
  const stub = stubHttp([{ body: 'x'.repeat(100) }]);
  try { await assert.rejects(fetchPublicText('http://example.com/', { maxBytes: 32 }), /exceeds 32 bytes/); }
  finally { stub.restore(); }
});

test('process stdin writes require explicit approval and denied writes never reach process handler', async () => {
  assert.ok(APPROVAL_REQUIRED_TOOLS.includes('process_write'));
  let approvals = 0;
  const output = await executeTool({ id: 'approval-test', name: 'process_write', arguments: { process_id: 'unknown', input: 'dangerous command' } }, {
    workspace: process.cwd(), approve: async request => { approvals++; assert.equal(request.tool, 'process_write'); return false; },
  });
  assert.equal(approvals, 1);
  assert.equal(output, 'Tool action denied by user.');
});

test('browser and desktop tools require approval by default before any GUI access', async () => {
  const before = process.env.TBOT_REQUIRE_GUI_APPROVAL;
  delete process.env.TBOT_REQUIRE_GUI_APPROVAL;
  try {
    for (const [name, args] of [
      ['browser_open', { url: 'https://example.com/' }],
      ['browser_evaluate', { expression: 'fetch("https://example.com")' }],
      ['computer', { action: 'type', text: 'execute something' }],
    ] as const) {
      let approvals = 0;
      const result = await executeTool({ id: 'gui-approval', name, arguments: args }, {
        workspace: process.cwd(), approve: async request => { approvals++; assert.equal(request.tool, name); return false; },
      });
      assert.equal(approvals, 1);
      assert.equal(result, 'Tool action denied by user.');
    }
  } finally {
    if (before === undefined) delete process.env.TBOT_REQUIRE_GUI_APPROVAL;
    else process.env.TBOT_REQUIRE_GUI_APPROVAL = before;
  }
});

test('shell environment preserves runtime paths and omits inherited credentials', () => {
  const env = shellEnvironment({ PATH: 'runtime-path', SystemRoot: 'windows', OPENAI_API_KEY: 'sensitive',
    TELEGRAM_BOT_TOKEN: 'sensitive', TBOT_API_KEY: 'sensitive', AWS_SECRET_ACCESS_KEY: 'sensitive',
    CUSTOM_PASSWORD: 'sensitive', CI: 'false' });
  assert.deepEqual(env, { PATH: 'runtime-path', SystemRoot: 'windows', CI: 'true',
    GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', NPM_CONFIG_YES: 'true' });
});

test('Telegram approval callbacks are bound to the current request', () => {
  const oldNonce = createApprovalNonce();
  const currentNonce = createApprovalNonce();
  assert.match(currentNonce, /^[a-f0-9]{32}$/);
  assert.notEqual(currentNonce, oldNonce);
  assert.equal(parseApprovalCallback(`approve_yes:${currentNonce}`, currentNonce), true);
  assert.equal(parseApprovalCallback(`approve_no:${currentNonce}`, currentNonce), false);
  assert.equal(parseApprovalCallback(`approve_yes:${oldNonce}`, currentNonce), undefined);
  assert.equal(parseApprovalCallback('approve_yes', currentNonce), undefined);
  assert.equal(parseApprovalCallback(undefined, currentNonce), undefined);
});

test('Telegram approval retains the complete payload and rejects oversized hidden tails', () => {
  const args = { title: 'benign '.repeat(120), instructions: 'visible-sensitive-suffix' };
  const text = formatApprovalArguments(args);
  assert.ok(text.indexOf('visible-sensitive-suffix') > 500);
  assert.deepEqual(JSON.parse(text), args);
  assert.throws(() => formatApprovalArguments({ command: 'x'.repeat(24_001) }), /display limit/);
});

test('Telegram pairing codes expire, share a global guess budget and are single-use', () => {
  const valid = createPairingChallenge(1000);
  assert.match(valid.code, /^[a-f0-9]{32}$/);
  assert.equal(acceptPairingCode(valid, valid.code, 1001), true);
  assert.equal(acceptPairingCode(valid, valid.code, 1002), false);
  const expired = createPairingChallenge(1000);
  assert.equal(acceptPairingCode(expired, expired.code, expired.expiresAt), false);
  const guessed = createPairingChallenge(1000);
  for (let chat = 0; chat < 10; chat++) assert.equal(acceptPairingCode(guessed, `wrong-chat-${chat}`, 1001), false);
  assert.equal(acceptPairingCode(guessed, guessed.code, 1002), false);
  const retry = createPairingChallenge(1000);
  assert.equal(acceptPairingCode(retry, 'wrong', 1001), false);
  assert.equal(acceptPairingCode(retry, retry.code, 1002), true);
});

const skillArgs = { id: 'security-unit', title: 'Unit skill', triggers: 'unit skill', instructions: 'Inspect the existing code before editing.' };

test('persistent skill creation requires approval before project or global writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbot-skill-approval-'));
  const previousAppData = process.env.APPDATA;
  process.env.APPDATA = join(dir, 'config');
  try {
    assert.ok(APPROVAL_REQUIRED_TOOLS.includes('skill_create'));
    for (const scope of ['project', 'global']) {
      let approvals = 0;
      const result = await executeTool({ id: 'skill-deny', name: 'skill_create', arguments: { ...skillArgs, scope } }, {
        workspace: dir, approve: async request => {
          approvals++;
          assert.equal(request.tool, 'skill_create');
          assert.match(request.description, /future tasks/);
          assert.equal(request.arguments.instructions, skillArgs.instructions);
          return false;
        },
      });
      assert.equal(result, 'Tool action denied by user.');
      assert.equal(approvals, 1);
    }
    await assert.rejects(readFile(join(dir, '.tbot', 'skills', 'security-unit.md')), /ENOENT/);
    const result = await executeTool({ id: 'skill-allow', name: 'skill_create', arguments: skillArgs }, {
      workspace: dir, approve: async () => true,
    });
    assert.match(result, /saved to project/);
    const loaded = loadCustomSkills(dir).find(s => s.id === 'security-unit');
    assert.equal(loaded?.guidance, skillArgs.instructions);
    assert.match(buildSkillPrompt([loaded!], dir), /Untrusted custom skill/);
    assert.match(await executeTool({ id: 'skill-global-allow', name: 'skill_create', arguments: { ...skillArgs, id: 'global-unit', scope: 'global' } }, {
      workspace: dir, approve: async () => true,
    }), /saved to global/);
    assert.equal(loadCustomSkills(dir).find(s => s.id === 'global-unit')?.scope, 'global');
  } finally {
    if (previousAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = previousAppData;
    await rm(dir, { recursive: true, force: true });
  }
});

test('project skill reads, creation and distillation reject linked state directories', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbot-skill-links-'));
  const outside = await mkdtemp(join(tmpdir(), 'tbot-skill-outside-'));
  try {
    await mkdir(join(outside, 'skills'));
    await writeFile(join(outside, 'skills', 'injected.md'), '# Injected\nUntrusted outside guidance');
    for (const level of ['.tbot', 'skills']) {
      const workspace = join(dir, level);
      await mkdir(workspace);
      const link = level === '.tbot' ? join(workspace, '.tbot') : join(workspace, '.tbot', 'skills');
      const target = level === '.tbot' ? outside : join(outside, 'skills');
      await mkdir(dirname(link), { recursive: true });
      await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
      assert.equal(loadCustomSkills(workspace).some(s => s.id === 'injected'), false);
      await assert.rejects(handleSkillTool('skill_create', skillArgs, workspace), /symbolic links or junctions/);
      await assert.rejects(autoDistillSkillFromTurn({ workspaceRoot: workspace, userPrompt: 'unit correction', finalAnswer: 'A valid engineering result with enough detailed text to create a persistent skill.', toolsUsed: ['shell', 'file_read', 'file_read', 'file_patch', 'shell'], modifiedFiles: ['a.ts'] }), /symbolic links or junctions/);
    }
    await assert.rejects(readFile(join(outside, 'skills', 'security-unit.md')), /ENOENT/);
  } finally { await rm(dir, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test('Git resolution ignores relative PATH entries and linked workspace installations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbot-git-path-'));
  const aliasRoot = await mkdtemp(join(tmpdir(), 'tbot-git-alias-'));
  try {
    const installed = await resolveGitExecutable(dir);
    assert.equal(isAbsolute(installed), true);
    await copyFile(process.execPath, join(dir, process.platform === 'win32' ? 'git.exe' : 'git'));
    const alias = join(aliasRoot, 'linked');
    await symlink(dir, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(resolveGitExecutable(dir, { PATH: ['', '.', 'relative', dir, alias].join(delimiter) }), /outside the workspace/);
    assert.equal(await resolveGitExecutable(dir, { PATH: [dir, alias, dirname(installed)].join(delimiter) }), installed);
  } finally { await rm(aliasRoot, { recursive: true, force: true }); await rm(dir, { recursive: true, force: true }); }
});

test('project skill overwrite replaces a hard link without changing the outside file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbot-skill-hardlink-'));
  try {
    const workspace = join(dir, 'workspace');
    const skills = join(workspace, '.tbot', 'skills');
    await mkdir(skills, { recursive: true });
    const outside = join(dir, 'outside.md');
    await writeFile(outside, 'outside sentinel');
    await link(outside, join(skills, 'security-unit.md'));
    assert.match(await handleSkillTool('skill_create', skillArgs, workspace), /saved to project/);
    assert.equal(await readFile(outside, 'utf8'), 'outside sentinel');
    assert.match(await readFile(join(skills, 'security-unit.md'), 'utf8'), /Inspect the existing code/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('read-only Git operations use installed Git despite a planted Windows git.exe', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbot-git-read-'));
  const run = promisify(execFile);
  try {
    const executable = await resolveGitExecutable(dir);
    await run(executable, ['init', dir], { windowsHide: true });
    if (process.platform === 'win32') {
      // Trusted Node --version safely demonstrates the original cwd lookup.
      await copyFile(process.execPath, join(dir, 'git.exe'));
      const original = await run('git', ['--version'], { cwd: dir, windowsHide: true });
      assert.equal(original.stdout.trim(), process.version);
    }
    await writeFile(join(dir, 'sample.txt'), 'sample\n');
    assert.match(await handleGitTool('git_status', {}, { workspace: dir }), /sample.txt/);
    assert.equal(await handleGitTool('git_diff', {}, { workspace: dir }), '(no output)');
    await run(executable, ['-C', dir, 'add', '--', 'sample.txt'], { windowsHide: true });
    await run(executable, ['-C', dir, '-c', 'user.name=Unit Test', '-c', 'user.email=unit@example.invalid', '-c', 'core.hooksPath=', 'commit', '-m', 'fixture'], { windowsHide: true });
    assert.match(await handleGitTool('git_log', {}, { workspace: dir }), /fixture/);
    await writeFile(join(dir, 'sample.txt'), 'changed\n');
    assert.match(await handleGitTool('git_diff', {}, { workspace: dir }), /changed/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(handleGitTool('git_status', {}, { workspace: dir, signal: controller.signal }));
    assert.equal(await realpath(executable), executable);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
