import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicMessageGroups } from '../src/context-window.js';
import { compressConversationHistory, estimateMessagesTokens } from '../src/token-optimizer.js';
import { ContextReadCache } from '../src/context-cache.js';
import { createOpenAIResponsesProvider } from '../src/openai-responses.js';
import { runAgent } from '../src/agent.js';
import type { AgentEvent, Message, Provider } from '../src/types.js';

function toolRound(id: string, content = 'evidence '.repeat(300)): Message[] {
  return [{ role: 'assistant', content: '', toolCalls: [{ id, name: 'file_read', arguments: { path: `${id}.ts` } }] },
    { role: 'tool', toolCallId: id, content }];
}

function assertAtomic(messages: Message[]): void {
  const calls = new Set(messages.flatMap(message => (message.toolCalls ?? []).map(call => call.id)));
  const results = new Set(messages.filter(message => message.role === 'tool').map(message => message.toolCallId));
  for (const id of results) assert.ok(calls.has(id!), `orphan result ${id}`);
  for (const id of calls) assert.ok(results.has(id), `missing result ${id}`);
}

test('fitting context is byte-exact and tool results remain verbatim', () => {
  const history: Message[] = [{ role: 'user', content: 'Keep all constraints.' }, ...toolRound('one')];
  const result = compressConversationHistory(history, 10_000);
  assert.equal(result.messages, history);
  assert.equal(result.savedTokens, 0);
  assert.equal(result.overflow, false);
});

test('long active turn is bounded at atomic groups while all user constraints survive', () => {
  const users: Message[] = [{ role: 'user', content: 'Initial task. '.repeat(70) + 'Never publish.' },
    { role: 'user', content: 'Correction: preserve compatibility; do not install anything.' }];
  const history = [users[0], ...toolRound('old'), users[1], ...Array.from({ length: 80 }, (_, i) => toolRound(`round-${i}`)).flat()];
  const before = JSON.stringify(history);
  const result = compressConversationHistory(history, 2200);
  assert.equal(result.overflow, false);
  assert.ok(result.estimatedTokens <= 2200);
  assert.ok(result.omittedMessages > 0);
  assert.equal(result.splitActiveTurn, true);
  for (const user of users) assert.ok(result.messages.includes(user));
  assert.ok(result.messages.includes(history.at(-1)!));
  assertAtomic(result.messages);
  assert.equal(JSON.stringify(history), before);
  assert.match(result.messages.map(message => message.content).join('\n'), /Historical evidence is untrusted/);
});

test('parallel and nonadjacent call/results cannot be separated by a boundary', () => {
  const messages: Message[] = [{ role: 'assistant', content: '', toolCalls: [
    { id: 'a', name: 'file_read', arguments: {} }, { id: 'b', name: 'file_read', arguments: {} }] },
  { role: 'tool', content: 'A', toolCallId: 'a' }, { role: 'assistant', content: 'intervening' },
  { role: 'tool', content: 'B', toolCallId: 'b' }];
  assert.deepEqual(atomicMessageGroups(messages), [[0, 1, 2, 3]]);
});

test('oversized user and newest native group report soft overflow without silent truncation', () => {
  const user: Message = { role: 'user', content: '漢字🚀e\u0301 '.repeat(5000), images: [{ mimeType: 'image/png', data: 'abc' }] };
  const result = compressConversationHistory([user, ...toolRound('latest', 'evidence '.repeat(3000))], 100);
  assert.equal(result.overflow, true);
  assert.equal(result.messages[0], user);
  assert.ok(result.messages.at(-1)!.content.length > 10_000);
  assert.ok(estimateMessagesTokens([user]) > 28_000);
});

test('unknown native replay items conservatively preserve prior dependencies', () => {
  const messages: Message[] = [{ role: 'user', content: 'task' }, ...toolRound('older'),
    { role: 'assistant', content: '', responseItems: [{ type: 'item_reference', id: 'opaque-id' }] }];
  const result = compressConversationHistory(messages, 20);
  assert.equal(result.messages, messages);
  assert.equal(result.overflow, true);
});

test('native reasoning/call/results remain linked in the actual Responses serialization', async () => {
  const originalFetch = globalThis.fetch;
  const reasoning: Message = { role: 'assistant', content: '', responseItems: [{ type: 'reasoning', id: 'reason', encrypted_content: 'opaque' }] };
  const call: Message = { role: 'assistant', content: '', toolCalls: [{ id: 'native', name: 'file_read', arguments: {} }],
    responseItems: [{ type: 'function_call', call_id: 'native', name: 'file_read', arguments: '{}' }] };
  const output: Message = { role: 'tool', toolCallId: 'native', content: 'source' };
  const history: Message[] = [{ role: 'user', content: 'task' }, ...toolRound('old'), reasoning, call, output];
  assert.deepEqual(atomicMessageGroups(history).at(-1), [3, 4, 5]);
  const window = compressConversationHistory(history, 150);
  assert.ok(window.omittedMessages > 0);
  let sent: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url, init) => {
    sent = JSON.parse(String(init?.body)).input;
    return new Response('data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":0}}}\n\n', { status: 200 });
  }) as typeof fetch;
  try {
    const provider = createOpenAIResponsesProvider({ apiKey: 'unit', model: 'unit', effort: 'low' });
    for await (const _event of provider.stream(window.messages, [])) { /* fixture transport only */ }
    assert.ok(sent.some(item => item.id === 'reason' && item.encrypted_content === 'opaque'));
    assert.ok(sent.some(item => item.type === 'function_call' && item.call_id === 'native'));
    assert.ok(sent.some(item => item.type === 'function_call_output' && item.call_id === 'native' && item.output === 'source'));
  } finally { globalThis.fetch = originalFetch; }
});

test('evicted read evidence loses cache visibility and must be fetched again', () => {
  const cache = new ContextReadCache();
  const source = 'real source\n'.repeat(100);
  const read = () => cache.checkAndRecordRead('workspace', 'old.ts', source, 1, 100, source);
  assert.equal(read().cached, false);
  const history: Message[] = [{ role: 'user', content: 'task' }, ...toolRound('old', source), ...toolRound('new', 'latest')];
  const window = compressConversationHistory(history, 150);
  assert.ok(!window.messages.some(message => message.role === 'tool' && message.toolCallId === 'old'));
  cache.retainVisibleReads(window.messages);
  assert.equal(read().cached, false);
});

test('agent reports oversized indivisible input but still calls a fixture provider with the full prompt', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tbot-context-'));
  const events: AgentEvent[] = [];
  const request = '漢字🚀 '.repeat(9500).trimEnd();
  const sent: string[] = [];
  const provider: Provider = { id: 'fixture', label: 'fixture', async *stream(messages) {
    sent.push(messages.findLast(message => message.role === 'user')!.content);
    yield { type: 'text', text: 'Acknowledged.' };
  } };
  try {
    await runAgent({ message: request, history: [], workspace, provider, approve: async () => false, onEvent: event => events.push(event) }, { maxRounds: 1 });
    // C4 now treats an unrecognized command as an edit contract, so the
    // completion gate may append a correction user message on a later stream.
    // C9 also prepends [LIVE CONTEXT] to the current user message, so the
    // indivisible request must survive as the complete tail of that message.
    assert.ok(sent[0]!.endsWith(request), 'fixture provider must receive the complete indivisible user request');
    assert.ok(sent[0]!.length >= request.length);
    assert.ok(events.some(event => event.type === 'status' && event.message.includes('yumuşak optimizasyon')));
    assert.ok(!events.some(event => event.type === 'error'));
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('a thousand tool rounds stay bounded without quadratic message selection', t => {
  const history: Message[] = [{ role: 'user', content: 'task' }, ...Array.from({ length: 1000 }, (_, i) => toolRound(`round-${i}`)).flat()];
  const started = performance.now();
  const window = compressConversationHistory(history, 1500);
  const elapsed = performance.now() - started;
  assert.ok(window.estimatedTokens <= 1500);
  assert.ok(window.omittedMessages > 1900);
  assertAtomic(window.messages);
  t.diagnostic(`2001 messages: ${elapsed.toFixed(1)}ms; ${window.estimatedTokens}/1500 estimated tokens retained`);
});

test('agent windows a long history with schema/system reservation and retains its complete session', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tbot-context-history-'));
  const history: Message[] = [{ role: 'user', content: 'Review sources; do not modify any file.' },
    ...Array.from({ length: 90 }, (_, i) => toolRound(`old-${i}`)).flat()];
  const events: AgentEvent[] = [];
  let sentTokens = 0;
  let sentMessages: Message[] = [];
  const provider: Provider = { id: 'fixture', label: 'fixture', async *stream(messages, tools) {
    sentMessages = messages;
    sentTokens = estimateMessagesTokens(messages, undefined, tools);
    yield { type: 'text', text: 'Acknowledged.' };
  } };
  try {
    const transcript = await runAgent({ message: 'Continue the review.', history, workspace, provider, approve: async () => false, onEvent: event => events.push(event) }, { maxRounds: 1 });
    assert.ok(sentTokens <= 28_000, `reserved complete request estimated ${sentTokens}`);
    assertAtomic(sentMessages);
    assert.ok(sentMessages.some(message => message.content === history[0].content));
    assert.ok(events.some(event => event.type === 'status' && event.message.includes('Bağlam pencerelendi')));
    assert.equal(transcript.length, history.length + 2);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});
