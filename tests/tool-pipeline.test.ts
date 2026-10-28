/**
 * C2/C3 focused fixture: alias canonicalization happens before every gate, and
 * a read-only phase rejects shell writes while allowing shell reads.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent } from '../src/agent.js';
import { buildTaskContract } from '../src/core/task-contract.js';
import { createPhaseState, finalAnswerViolation, phaseViolation, recordPhaseToolResult } from '../src/core/phase-policy.js';
import { classifyToolEffect, shellWrites } from '../src/core/tool-effect.js';
import type { AgentEvent, Message, Provider, ToolCall } from '../src/types.js';

test('no-write boundary blocks write_file, edit_file and bash aliases before execution', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbot-c2-alias-'));
  try {
    await writeFile(join(dir, 'seed.txt'), 'seed\n');
    let providerCalls = 0;
    const provider: Provider = {
      id: 'unit', label: 'unit',
      async *stream() {
        providerCalls++;
        if (providerCalls === 1) {
          yield {
            type: 'tool_calls',
            calls: [
              { id: 'w1', name: 'write_file', arguments: { path: 'alias-a.txt', content: 'a' } },
              { id: 'w2', name: 'edit_file', arguments: { path: 'alias-b.txt', old_text: 'a', new_text: 'b' } },
              { id: 'w3', name: 'bash', arguments: { command: 'echo x > alias-c.txt' } },
            ],
          };
        } else {
          yield { type: 'text', text: 'Sınır korundu.' };
        }
      },
    };

    const events: AgentEvent[] = [];
    const messages = await runAgent(
      { message: 'Do not edit any files; just review the workspace.', history: [], provider, workspace: dir, approve: async () => false, onEvent: event => events.push(event) },
      { maxRounds: 3 },
    );

    const toolMessages = messages.filter((message): message is Message => message.role === 'tool');
    assert.equal(toolMessages.length, 3);
    for (const message of toolMessages) {
      assert.match(message.content, /Tool denied: this is an inspection-only task/);
    }

    // The user-visible events keep the alias the model emitted; the gates saw
    // the canonical names, which is why all three were denied.
    assert.deepEqual(
      events.filter(event => event.type === 'tool_start').map(event => event.type === 'tool_start' ? event.call.name : ''),
      ['write_file', 'edit_file', 'bash'],
    );

    for (const file of ['alias-a.txt', 'alias-b.txt', 'alias-c.txt']) {
      await assert.rejects(readFile(join(dir, file)), { code: 'ENOENT' }, file);
    }
    assert.equal(await readFile(join(dir, 'seed.txt'), 'utf8'), 'seed\n');
    assert.equal(providerCalls, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('inspect phase rejects a shell write but allows a shell read', () => {
  const contract = buildTaskContract('Review the workspace and report findings.');
  assert.equal(contract.kind, 'inspect');
  const state = createPhaseState();
  const call = (id: string, command: string): ToolCall => ({ id, name: 'shell', arguments: { command } });

  assert.match(phaseViolation(state, call('write', 'echo x > a.txt'), contract, false)!, /inspection-only/);
  assert.equal(phaseViolation(state, call('read', 'git status'), contract, false), undefined);
  assert.equal(phaseViolation(state, { id: 'file', name: 'file_read', arguments: { path: 'a.txt' } }, contract, false), undefined);
});

test('a NUL redirect stays a shell read while a file redirect is a shell write', () => {
  const timeoutCommand = 'timeout /t 1 /nobreak >nul && echo ok';
  assert.equal(shellWrites(timeoutCommand), false);
  assert.equal(classifyToolEffect('shell', { command: timeoutCommand }), 'shell-read');
  assert.equal(shellWrites('echo x > a.txt'), true);
  assert.equal(classifyToolEffect('shell', { command: 'echo x > a.txt' }), 'shell-write');

  const contract = buildTaskContract('Review the workspace and report findings.');
  const state = createPhaseState();
  assert.equal(phaseViolation(state, { id: 't', name: 'shell', arguments: { command: timeoutCommand } }, contract, false), undefined);
  assert.match(phaseViolation(state, { id: 'w', name: 'shell', arguments: { command: 'echo x > a.txt' } }, contract, false)!, /inspection-only/);
});

test('server process tools are allowed in an operation turn and never demand a file write', () => {
  const contract = buildTaskContract('basit HTTP sunucusu başlat, çalıştığını doğrula ve durdur');
  const state = createPhaseState();

  assert.equal(phaseViolation(state, { id: 'p1', name: 'process_start', arguments: { command: 'node server.js', background: true } }, contract, false), undefined);
  assert.equal(phaseViolation(state, { id: 'p2', name: 'process_stop', arguments: { id: 'p1' } }, contract, false), undefined);

  recordPhaseToolResult(state, { id: 'p1', name: 'process_start', arguments: {} }, true);
  recordPhaseToolResult(state, { id: 'p2', name: 'process_stop', arguments: {} }, true);
  assert.equal(state.writes, 0);
  assert.equal(finalAnswerViolation(state, contract, 'Sunucu çalıştı ve durduruldu.'), undefined);

  const question = buildTaskContract('Bu projede kaç TypeScript dosyası var? Yalnız dosya araçlarını kullan.');
  assert.equal(finalAnswerViolation(createPhaseState(), question, 'Bu projede 12 TypeScript dosyası var.'), undefined);
});
