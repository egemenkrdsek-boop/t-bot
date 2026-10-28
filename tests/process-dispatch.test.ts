import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleShellTool, pruneCompletedProcesses } from '../src/tools/shell.js';
import { executeTool } from '../src/tools/index.js';
import { runAgent } from '../src/agent.js';
import type { Message, Provider } from '../src/types.js';

test('dispatch uses host owner and readonly agent rotates even a spread parent identity', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tbot-process-dispatch-'));
  const spawn = mock.method(childProcess, 'spawn', (() => {
    const child = new EventEmitter() as any;
    child.pid = 123456;
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin = new Writable({ write: (_chunk, _encoding, done) => done() });
    queueMicrotask(() => { child.stdout.write('private parent output'); child.emit('close', 0); });
    return child;
  }) as typeof childProcess.spawn);
  syncBuiltinESMExports();
  try {
    const processOwner = 'desktop:parent-session';
    const started = JSON.parse(await handleShellTool('shell', { command: 'fixture only', background: true }, workspace, undefined, processOwner));
    const laterTurn = { workspace, processOwner, approve: async () => true };
    assert.match(await executeTool({ id: 'same-turn', name: 'process_output', arguments: { process_id: started.processId } }, laterTurn), /private parent output/);
    const foreign = { ...laterTurn, processOwner: 'desktop:other-session' };
    assert.equal(JSON.parse(await executeTool({ id: 'foreign-list', name: 'process_list', arguments: { processOwner, owner: processOwner } }, foreign)).count, 0);
    assert.match(await executeTool({ id: 'foreign-output', name: 'process_output', arguments: { process_id: started.processId, processOwner } }, foreign), /not found/);
    let calls = 0, observed: Message[] = [];
    const provider: Provider = { id: 'fixture', label: 'fixture', async *stream(messages) {
      observed = messages;
      if (calls++ === 0) yield { type: 'tool_calls', calls: [
        { id: 'child-list', name: 'process_list', arguments: { processOwner } },
        { id: 'child-output', name: 'process_output', arguments: { process_id: started.processId, owner: processOwner } },
      ] };
      else yield { type: 'text', text: 'Read-only inspection finished.' };
    } };
    const parentInput = { workspace, processOwner, message: 'Inspect background processes.', history: [], provider, approve: async () => true, onEvent: () => {} };
    await runAgent({ ...parentInput }, { toolPolicy: 'read-only', maxRounds: 2 });
    const results = observed.filter(message => message.role === 'tool');
    assert.equal(JSON.parse(results.find(message => message.toolCallId === 'child-list')!.content).count, 0);
    assert.match(results.find(message => message.toolCallId === 'child-output')!.content, /not found/);
    assert.equal(spawn.mock.calls.length, 1, 'only the stub background launch may spawn');
  } finally { pruneCompletedProcesses(); spawn.mock.restore(); syncBuiltinESMExports(); await rm(workspace, { recursive: true, force: true }); }
});
