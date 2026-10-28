import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { createProvider } from '../src/providers.js';
import { createOpenAIResponsesProvider } from '../src/openai-responses.js';
import { discoverModels } from '../src/models.js';
import type { Provider, ProviderEvent } from '../src/types.js';

test('custom model discovery uses the configured safe endpoint and never redirects credentials', async () => {
  const requests: { url: string; options: RequestInit | undefined }[] = [];
  const fetch = mock.method(globalThis, 'fetch', async (url: string | URL | Request, options?: RequestInit) => {
    requests.push({ url: String(url), options });
    return Response.json({ data: [{ id: 'local-model' }] });
  });
  try {
    assert.deepEqual(await discoverModels('custom', 'local-key', undefined, 'http://localhost:9000/v1/'), [{ id: 'local-model', label: 'local-model' }]);
    assert.equal(requests[0].url, 'http://localhost:9000/v1/models');
    assert.equal(requests[0].options?.redirect, 'error');
    assert.equal((requests[0].options?.headers as Record<string, string>).authorization, 'Bearer local-key');
    for (const unsafe of ['http://remote.example/v1', 'https://user:pass@example.com/v1', 'https://example.com/v1?key=secret', 'file:///tmp/models']) {
      assert.deepEqual(await discoverModels('custom', 'secret', undefined, unsafe), []);
    }
    assert.equal(requests.length, 1);
    await discoverModels('openai', 'official-key', undefined, 'https://override.example/v1');
    assert.equal(requests[1].url, 'https://api.openai.com/v1/models');
  } finally { fetch.mock.restore(); }
});

function response(frames: unknown[]): Response {
  return new Response(frames.map(frame => `data: ${typeof frame === 'string' ? frame : JSON.stringify(frame)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function collect(provider: Provider, frames: unknown[], fallback = false): Promise<ProviderEvent[]> {
  let calls = 0;
  const fetch = mock.method(globalThis, 'fetch', async () => fallback && calls++ === 0 ? new Response('', { status: 404 }) : response(frames));
  try {
    const events: ProviderEvent[] = [];
    for await (const event of provider.stream([{ role: 'user', content: 'test' }], [])) events.push(event);
    return events;
  } finally { fetch.mock.restore(); }
}

function assertRejected(events: ProviderEvent[]) {
  assert.ok(events.some(event => event.type === 'error'), JSON.stringify(events));
  assert.equal(events.filter(event => event.type === 'tool_calls').length, 0, 'unsafe executable calls escaped');
}

const chatDelta = (args = '{"path":"a.txt","content":"complete"}') => ({
  choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'file_write', arguments: args } }] } }],
});
const chatEnd = (reason = 'tool_calls') => ({ choices: [{ delta: {}, finish_reason: reason }] });
const anthropicStart = { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call_a', name: 'file_write' } };
const anthropicDelta = (args = '{"path":"a.txt","content":"complete"}') => ({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: args } });
const anthropicEnd = (reason = 'tool_use') => ({ type: 'message_delta', delta: { stop_reason: reason } });
const geminiCall = { candidates: [{ content: { parts: [{ functionCall: { name: 'file_write', args: { path: 'a.txt', content: 'complete' } } }] } }] };

for (const variant of [
  { id: 'custom', frames: [chatDelta()], end: [chatEnd(), '[DONE]'] },
  { id: 'anthropic', frames: [anthropicStart, anthropicDelta()], end: [anthropicEnd(), { type: 'message_stop' }] },
  { id: 'gemini', frames: [geminiCall], end: [{ candidates: [{ finishReason: 'STOP' }] }] },
]) {
  test(`${variant.id}: EOF never authorizes complete tool JSON; terminal protocol preserves valid calls`, async () => {
    const provider = createProvider({ id: variant.id, apiKey: 'test-key', model: 'test-model', baseUrl: 'https://example.com/v1' });
    assertRejected(await collect(provider, variant.frames));
    const valid = await collect(provider, [...variant.frames, ...variant.end]);
    assert.equal(valid.some(event => event.type === 'error'), false, JSON.stringify(valid));
    const event = valid.find(event => event.type === 'tool_calls');
    assert.ok(event && event.type === 'tool_calls');
    assert.equal(event.calls[0].arguments.content, 'complete');
  });
}

test('chat and Anthropic never repair truncated tool arguments, even after a terminal event', async () => {
  const chat = createProvider({ id: 'custom', model: 'test', baseUrl: 'https://example.com/v1' });
  const anthropic = createProvider({ id: 'anthropic', model: 'test', apiKey: 'test-key' });
  for (const args of ['{"path":"a.txt","content":"partial', '[]', 'null']) {
    assertRejected(await collect(chat, [chatDelta(args), chatEnd(), '[DONE]']));
    assertRejected(await collect(anthropic, [anthropicStart, anthropicDelta(args), anthropicEnd(), { type: 'message_stop' }]));
  }
  assertRejected(await collect(chat, [chatDelta(), chatEnd('length'), '[DONE]']));
  assertRejected(await collect(anthropic, [anthropicStart, anthropicDelta(), anthropicEnd('max_tokens'), { type: 'message_stop' }]));
});

test('OpenAI Responses fallback requires terminal event, safe finish and strict object arguments', async () => {
  const provider = createOpenAIResponsesProvider({ model: 'test', apiKey: 'test-key' });
  for (const frames of [[chatDelta()], [chatDelta(), chatEnd()], [chatDelta(), '[DONE]'],
    [chatDelta('{"path":"partial'), chatEnd(), '[DONE]'], [chatDelta('[]'), chatEnd(), '[DONE]'],
    [chatDelta(), '{bad frame', chatEnd(), '[DONE]'],
    [chatDelta(), { error: { message: 'provider error' } }, chatEnd(), '[DONE]'],
    [chatDelta(), chatEnd('length'), '[DONE]']]) {
    assertRejected(await collect(provider, frames, true));
  }
  const valid = await collect(provider, [chatDelta(), chatEnd(), '[DONE]'], true);
  assert.equal(valid.some(event => event.type === 'error'), false);
  assert.ok(valid.some(event => event.type === 'tool_calls'));
});

test('main OpenAI Responses adapter requires response.completed and valid object arguments', async () => {
  const provider = createOpenAIResponsesProvider({ model: 'test', apiKey: 'test-key' });
  const item = { type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', name: 'file_write', call_id: 'call_a', arguments: '{"path":"a.txt"}' } };
  assertRejected(await collect(provider, [item]));
  const valid = await collect(provider, [item, { type: 'response.completed', response: { status: 'completed' } }]);
  assert.ok(valid.some(event => event.type === 'tool_calls'));
  assertRejected(await collect(provider, [item, { type: 'response.incomplete' }]));
});

test('Anthropic usage includes cache creation/read in total input without double counting delta', async () => {
  const provider = createProvider({ id: 'anthropic', model: 'test', apiKey: 'test-key' });
  const events = await collect(provider, [
    { type: 'message_start', message: { usage: { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 } } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5, cache_read_input_tokens: 100 } },
    { type: 'message_stop' },
  ]);
  const usage = events.find(event => event.type === 'usage');
  assert.ok(usage && usage.type === 'usage');
  assert.equal(usage.inputTokens, 130);
  assert.equal(usage.cachedTokens, 100);
  assert.equal(usage.outputTokens, 5);
});
