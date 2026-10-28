/**
 * C7 focused fixture: model profiles never classify a tool-capable Flash model
 * as small, and the small profile executes exactly one tool call per round.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent } from '../src/agent.js';
import { resolveModelProfile } from '../src/core/model-profile.js';
import type { AgentEvent, Message, Provider } from '../src/types.js';

test('effort max keeps DeepSeek flash out of the small profile while 7B models stay small', () => {
  const flash = resolveModelProfile('openrouter', 'deepseek/deepseek-v4.1-flash-1017', 'max');
  assert.notEqual(flash.id, 'small');
  assert.equal(flash.id, 'reasoning');
  assert.equal(flash.maxCallsPerRound, 12);

  const flashDefault = resolveModelProfile('openrouter', 'deepseek/deepseek-v4.1-flash-1017');
  assert.equal(flashDefault.id, 'standard');
  assert.equal(flashDefault.weak, false);

  const small = resolveModelProfile('ollama', 'qwen2.5:7b');
  assert.equal(small.id, 'small');
  assert.equal(small.weak, true);
  assert.equal(small.maxCallsPerRound, 1);
});

test('small profile executes only the first of several tool calls in a round', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbot-c7-small-'));
  try {
    for (const file of ['a.txt', 'b.txt', 'c.txt']) await writeFile(join(dir, file), `${file}\n`);
    let providerCalls = 0;
    const provider: Provider = {
      id: 'ollama', label: 'unit', model: 'qwen2.5:7b',
      async *stream() {
        providerCalls++;
        if (providerCalls === 1) {
          yield {
            type: 'tool_calls',
            calls: [
              { id: 'r1', name: 'file_read', arguments: { path: 'a.txt' } },
              { id: 'r2', name: 'file_read', arguments: { path: 'b.txt' } },
              { id: 'r3', name: 'file_read', arguments: { path: 'c.txt' } },
            ],
          };
        } else {
          yield { type: 'text', text: 'Okundu.' };
        }
      },
    };

    const events: AgentEvent[] = [];
    const messages = await runAgent(
      { message: 'read a.txt, b.txt and c.txt', history: [], provider, workspace: dir, approve: async () => false, onEvent: event => events.push(event) },
      { maxRounds: 3 },
    );

    const toolMessages = messages.filter((message): message is Message => message.role === 'tool');
    assert.equal(toolMessages.length, 1);
    assert.equal(toolMessages[0]!.toolCallId, 'r1');
    const assistantCalls = messages.filter(message => message.role === 'assistant' && message.toolCalls?.length);
    assert.equal(assistantCalls.length, 1);
    assert.deepEqual(assistantCalls[0]!.toolCalls!.map(call => call.id), ['r1']);
    assert.equal(providerCalls, 2);

    const droppedNotice = events.some(event =>
      event.type === 'status' && event.message.includes('en fazla 1 araç çağrısı yürütür') && event.message.includes('2 fazla çağrı düşürüldü'));
    assert.equal(droppedNotice, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
