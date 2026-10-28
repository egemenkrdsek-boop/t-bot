import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { mkdtemp, readFile, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeDesktopRequest } from '../src/tools/desktop-request.js';
import { handleImageTool } from '../src/tools/image.js';
import { handleFileTool } from '../src/tools/files.js';
import { resolveComputerScriptPath } from '../src/tools/computer.js';

test('lost desktop action reply never replays a potentially completed mutation', async () => {
  for (const action of ['click', 'type', 'key', 'open', 'drag', 'scroll']) {
    let daemonCalls = 0, standaloneCalls = 0, closes = 0;
    await assert.rejects(executeDesktopRequest({ action }, {
      daemon: async () => { daemonCalls++; throw new Error('Desktop action timed out'); },
      standalone: async () => { standaloneCalls++; return 'replayed'; },
      close: async () => { closes++; },
    }), /not retried/);
    assert.equal(daemonCalls, 1);
    assert.equal(standaloneCalls, 0);
    assert.equal(closes, 1);
  }
});

test('packaged desktop script resolves to unpacked OS path even when virtual archive member exists', () => {
  const archive = join('resources', 'app.asar', 'scripts', 'computer.ps1');
  const unpacked = join('resources', 'app.asar.unpacked', 'scripts', 'computer.ps1');
  const exists = (path: string) => [archive, unpacked].includes(path);
  assert.equal(resolveComputerScriptPath(archive, 'resources', 'workspace', exists), unpacked);
  assert.throws(() => resolveComputerScriptPath(archive, 'resources', 'workspace', path => path === archive), /unavailable outside/);
  const source = join('repo', 'scripts', 'computer.ps1');
  assert.equal(resolveComputerScriptPath(source, '', 'repo', path => path === source), source);
});

test('desktop observation can fall back while abort and kill-switch never fall back', async () => {
  let standaloneCalls = 0;
  const transports = {
    daemon: async () => { throw new Error('daemon unavailable'); },
    standalone: async () => { standaloneCalls++; return 'observation'; },
    close: async () => {},
  };
  assert.equal(await executeDesktopRequest({ action: 'screenshot' }, transports), 'observation');
  assert.equal(standaloneCalls, 1);
  const abort = new AbortController();
  await assert.rejects(executeDesktopRequest({ action: 'screenshot' }, {
    ...transports, daemon: async () => { abort.abort(); throw new Error('interrupted'); },
  }, abort.signal));
  await assert.rejects(executeDesktopRequest({ action: 'screenshot' }, {
    ...transports, daemon: async () => { throw new Error('KILL-SWITCH'); },
  }), /KILL-SWITCH/);
  assert.equal(standaloneCalls, 1);
});

test('image generation rejects unsupported reference edits before approval and billing', async () => {
  let approvals = 0, fetches = 0;
  const fetch = mock.method(globalThis, 'fetch', async () => { fetches++; throw new Error('must not call'); });
  try {
    await assert.rejects(handleImageTool('image_generate', { prompt: 'edit', source_image: 'source.png' }, {
      workspace: process.cwd(), approve: async () => { approvals++; return true; },
      imageProvider: { provider: 'openai', apiKey: 'test' },
    }), /reference-image editing is not supported/);
    await assert.rejects(handleImageTool('image_generate', { prompt: 'edit', source_image: 'missing-image.png' }, {
      workspace: process.cwd(), approve: async () => { approvals++; return true; },
      imageProvider: { provider: 'gemini', apiKey: 'test' },
    }), /ENOENT/);
    assert.equal(approvals, 0);
    assert.equal(fetches, 0);
  } finally { fetch.mock.restore(); }
});

test('OpenAI remote image URLs are rejected without a second request', async () => {
  let fetches = 0;
  const fetch = mock.method(globalThis, 'fetch', async () => {
    fetches++;
    return Response.json({ data: [{ url: 'http://169.254.169.254/latest/meta-data/' }] });
  });
  try {
    await assert.rejects(handleImageTool('image_generate', { prompt: 'draw' }, {
      workspace: process.cwd(), approve: async () => true,
      imageProvider: { provider: 'openai', apiKey: 'test' },
    }), /Remote image URLs are not fetched/);
    assert.equal(fetches, 1);
  } finally { fetch.mock.restore(); }
});

test('valid inline image generation still saves the returned bytes inside workspace', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbot-image-unit-'));
  const png = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.write('IHDR', 12);
  png.writeUInt32BE(1, 16); png.writeUInt32BE(1, 20);
  const fetch = mock.method(globalThis, 'fetch', async () => Response.json({ data: [{ b64_json: png.toString('base64') }] }));
  try {
    const result = await handleImageTool('image_generate', { prompt: 'draw' }, {
      workspace: dir, approve: async () => true,
      imageProvider: { provider: 'openai', apiKey: 'test' },
    });
    const output = result.replace('Generated image saved: ', '');
    assert.ok(output.startsWith(join(dir, 'generated-images')));
    assert.deepEqual(await readFile(output), png);
  } finally { fetch.mock.restore(); await rm(dir, { recursive: true, force: true }); }
});

test('oversized outline and overwrite reads are rejected before loading existing content', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbot-files-unit-'));
  const file = await open(join(dir, 'large.txt'), 'w');
  try {
    await file.truncate(11 * 1024 * 1024);
    await assert.rejects(handleFileTool('file_outline', { path: 'large.txt' }, dir), /10 MB outline limit/);
    await assert.rejects(handleFileTool('file_write', { path: 'large.txt', content: 'small' }, dir), /10 MB read limit/);
  } finally { await file.close(); await rm(dir, { recursive: true, force: true }); }
});
