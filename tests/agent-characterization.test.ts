/**
 * Characterization tests for the current agent turn loop.
 *
 * These freeze behavior that exists in 4.1.0 before the 5.0 refactor. They are
 * not aspirational: if a 5.0 fix changes one of these outcomes (for example the
 * C5 missing tool-result or the C6 ungated synthesis), the failing assertion is
 * the signal that the characterization must be reviewed and updated knowingly.
 *
 * No network, model or GUI is involved; the provider is a plain async generator
 * and every workspace is an mkdtemp directory removed in `finally`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent } from '../src/agent.js';
import type { AgentEvent, Message, Provider, ToolDefinition } from '../src/types.js';

test('two-round tool use keeps call/result pairing, order and a final answer', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbot-char-read-'));
  try {
    await writeFile(join(dir, 'first.txt'), 'alpha\n');
    await writeFile(join(dir, 'second.txt'), 'beta\n');

    let providerCalls = 0;
    const provider: Provider = {
      id: 'unit', label: 'unit',
      async *stream() {
        providerCalls++;
        if (providerCalls === 1) {
          yield { type: 'tool_calls', calls: [{ id: 'r1', name: 'file_read', arguments: { path: 'first.txt' } }] };
        } else if (providerCalls === 2) {
          yield { type: 'tool_calls', calls: [{ id: 'r2', name: 'file_read', arguments: { path: 'second.txt' } }] };
        } else {
          yield { type: 'text', text: 'Both files were read.' };
        }
      },
    };

    const events: AgentEvent[] = [];
    const messages = await runAgent(
      { message: 'read both files and report', history: [], provider, workspace: dir, approve: async () => false, onEvent: event => events.push(event) },
      { maxRounds: 5 },
    );

    const toolMessages = messages.filter((message): message is Message => message.role === 'tool');
    assert.deepEqual(toolMessages.map(message => message.toolCallId), ['r1', 'r2']);
    assert.match(toolMessages[0]!.content, /alpha/);
    assert.match(toolMessages[1]!.content, /beta/);

    const assistantCalls = messages
      .filter(message => message.role === 'assistant' && message.toolCalls?.length)
      .map(message => message.toolCalls!.map(call => call.id));
    assert.deepEqual(assistantCalls, [['r1'], ['r2']]);
    assert.equal(messages.at(-1)?.role, 'assistant');
    assert.equal(messages.at(-1)?.content, 'Both files were read.');
    assert.equal(providerCalls, 3);

    assert.deepEqual(
      events.filter(event => event.type === 'tool_start').map(event => event.type === 'tool_start' ? event.call.id : ''),
      ['r1', 'r2'],
    );
    assert.equal(events.filter(event => event.type === 'tool_end').length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('abort raised while the first mutating tool waits for approval completes history for every call', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbot-char-abort-'));
  try {
    const controller = new AbortController();
    let providerCalls = 0;
    const provider: Provider = {
      id: 'unit', label: 'unit',
      async *stream() {
        providerCalls++;
        yield {
          type: 'tool_calls',
          calls: [
            { id: 'w1', name: 'file_write', arguments: { path: 'a.txt', content: 'a' } },
            { id: 'w2', name: 'file_write', arguments: { path: 'b.txt', content: 'b' } },
          ],
        };
      },
    };

    const messages = await runAgent(
      {
        message: 'create a.txt and b.txt',
        history: [],
        provider,
        workspace: dir,
        signal: controller.signal,
        approve: async request => {
          if (request.tool === 'file_write') controller.abort();
          return false;
        },
        onEvent: () => {},
      },
      { maxRounds: 4 },
    );

    const toolMessages = messages.filter((message): message is Message => message.role === 'tool');
    // 5.0 behavior (C5): every tool call id from the aborted round owns exactly
    // one tool message. The call that was in flight reports the denial; calls
    // that never ran report the cancellation instead of vanishing.
    assert.equal(toolMessages.length, 2);
    assert.deepEqual(toolMessages.map(message => message.toolCallId), ['w1', 'w2']);
    assert.equal(toolMessages[0]!.content, 'Tool action denied by user.');
    assert.equal(toolMessages[1]!.content, 'Araç çalıştırma iptal edildi.');
    assert.ok(
      messages.some(message => message.role === 'assistant' && /durduruldu/.test(message.content)),
      'an abort must surface a visible stop message',
    );
    assert.equal(providerCalls, 1);

    for (const file of ['a.txt', 'b.txt']) {
      await assert.rejects(readFile(join(dir, file)), { code: 'ENOENT' }, file);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('final synthesis rejects an unverified success claim and appends a notice', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbot-char-synth-'));
  try {
    let providerCalls = 0;
    let synthesisTools: ToolDefinition[] | undefined;
    const provider: Provider = {
      id: 'unit', label: 'unit',
      async *stream(_messages, tools) {
        providerCalls++;
        if (providerCalls === 1) {
          yield { type: 'tool_calls', calls: [{ id: 'w1', name: 'file_write', arguments: { path: 'notes.txt', content: 'hello\n' } }] };
        } else {
          synthesisTools = tools;
          yield { type: 'text', text: 'Tamamlandı. Tüm testler geçti.' };
        }
      },
    };

    const events: AgentEvent[] = [];
    const messages = await runAgent(
      { message: 'create notes.txt', history: [], provider, workspace: dir, approve: async () => true, onEvent: event => events.push(event) },
      { maxRounds: 1 },
    );

    assert.equal(providerCalls, 3);
    assert.deepEqual(synthesisTools, []);

    const toolMessages = messages.filter((message): message is Message => message.role === 'tool');
    assert.equal(toolMessages.length, 1);
    assert.equal(toolMessages[0]!.toolCallId, 'w1');
    assert.equal(toolMessages[0]!.content, 'File written.');
    assert.equal(await readFile(join(dir, 'notes.txt'), 'utf8'), 'hello\n');

    assert.equal(
      events.filter(event => event.type === 'status').some(event => event.type === 'status' && event.message.includes('Sentezleniyor')),
      true,
    );
    assert.equal(
      events.filter(event => event.type === 'status').some(event => event.type === 'status' && event.message.includes('kanıt kapısından geçmedi')),
      true,
    );

    // 5.0 behavior (C6): the synthesis turn is gate-checked, retried once, and
    // then forced to carry an explicit "unverified" notice. It can never be
    // stored as a clean success claim without a verification command.
    assert.equal(messages.at(-1)?.role, 'assistant');
    assert.match(messages.at(-1)!.content, /^Tamamlandı\. Tüm testler geçti\./);
    assert.match(messages.at(-1)!.content, /doğrulanmadı/);
    assert.equal(messages.filter(message => message.role === 'tool').length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejected first synthesis text is not published; only the final text reaches the user', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbot-char-publish-'));
  try {
    let providerCalls = 0;
    const provider: Provider = {
      id: 'unit', label: 'unit',
      async *stream() {
        providerCalls++;
        if (providerCalls === 1) {
          yield { type: 'tool_calls', calls: [{ id: 'w1', name: 'file_write', arguments: { path: 'publish.txt', content: 'x\n' } }] };
        } else if (providerCalls === 2) {
          yield { type: 'text', text: 'Tamamlandı. Tüm testler geçti.' };
        } else {
          yield { type: 'text', text: 'Dosya yazıldı ancak bu turda doğrulanmadı.' };
        }
      },
    };

    const events: AgentEvent[] = [];
    const messages = await runAgent(
      { message: 'create publish.txt', history: [], provider, workspace: dir, approve: async () => true, onEvent: event => events.push(event) },
      { maxRounds: 1 },
    );

    const published = events.filter(event => event.type === 'text').map(event => event.type === 'text' ? event.text : '');
    assert.equal(published.some(text => text.includes('Tüm testler geçti')), false);
    assert.equal(published.some(text => text.includes('Dosya yazıldı ancak bu turda doğrulanmadı.')), true);
    assert.equal(messages.at(-1)?.content, 'Dosya yazıldı ancak bu turda doğrulanmadı.');
    assert.equal(providerCalls, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a throw in the serial tool path still leaves a tool message for every call id', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbot-char-throw-'));
  try {
    for (const file of ['a.txt', 'b.txt', 'c.txt']) await writeFile(join(dir, file), `${file}\n`);
    const provider: Provider = {
      id: 'unit', label: 'unit',
      async *stream() {
        yield {
          type: 'tool_calls',
          calls: [
            { id: 'r1', name: 'file_read', arguments: { path: 'a.txt' } },
            { id: 'r2', name: 'file_read', arguments: { path: 'b.txt' } },
            { id: 'r3', name: 'file_read', arguments: { path: 'c.txt' } },
          ],
        };
      },
    };

    const messages = await runAgent(
      {
        message: 'read a.txt, b.txt and c.txt and report',
        history: [],
        provider,
        workspace: dir,
        approve: async () => false,
        onEvent: event => {
          if (event.type === 'tool_start' && event.call.id === 'r2') throw new Error('fake tool throw');
        },
      },
      { maxRounds: 2 },
    );

    const toolMessages = messages.filter((message): message is Message => message.role === 'tool');
    assert.deepEqual(toolMessages.map(message => message.toolCallId), ['r1', 'r2', 'r3']);
    assert.match(toolMessages[0]!.content, /a\.txt/);
    assert.match(toolMessages[1]!.content, /iptal edildi|Hatası/);
    assert.match(toolMessages[2]!.content, /iptal edildi|Hatası/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
