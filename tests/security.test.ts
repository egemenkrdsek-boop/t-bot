import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import dns from 'node:dns';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { fetchPublicText, isPrivateOrLocalHost, publicLookup, validatePublicUrl } from '../src/tools/public-network.js';
import { fetchUrlContent } from '../src/tools/web.js';
import { executeTool, APPROVAL_REQUIRED_TOOLS } from '../src/tools/index.js';
import { shellEnvironment } from '../src/tools/shell.js';
import { createApprovalNonce, parseApprovalCallback } from '../src/telegram-security.js';

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
