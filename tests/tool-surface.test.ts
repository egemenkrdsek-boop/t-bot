import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getToolDefinitions } from '../src/tools/index.js';
import { pruneToolDefinitions } from '../src/token-optimizer.js';

test('canonical tool registry has no duplicate names across its 58 definitions', () => {
  const definitions = getToolDefinitions();
  const names = definitions.map(tool => tool.name);
  assert.equal(definitions.length, 58);
  assert.equal(new Set(names).size, 58);
  assert.equal(names.filter(name => name === 'todo_manage').length, 1);
  assert.equal(names.filter(name => name === 'goal_manage').length, 1);
  for (const name of ['browser_read', 'browser_wait_for', 'browser_console', 'browser_download', 'browser_upload']) {
    assert.ok(names.includes(name), `new browser tool missing: ${name}`);
  }
  // Repeated construction must not append workflow tools a second time.
  assert.deepEqual(getToolDefinitions().map(tool => tool.name), names);
});

test('browser, computer and dev-server intents keep the tools needed to finish the job', () => {
  const all = getToolDefinitions();
  const select = (query: string) => new Set(pruneToolDefinitions(all, query).tools.map(tool => tool.name));

  const browser = select('Tarayıcıyı aç ve sayfada gezin, formu doldur');
  for (const name of ['browser_open', 'browser_navigate', 'browser_inspect', 'browser_click', 'browser_type', 'browser_screenshot', 'browser_close']) {
    assert.ok(browser.has(name), `browser intent missing ${name}`);
  }

  const computer = select('Masaüstü ekranını incele, pencereyi aç ve butona tıkla');
  for (const name of ['computer', 'shell', 'file_read']) {
    assert.ok(computer.has(name), `computer intent missing ${name}`);
  }

  const process = select('npm run dev ile sunucuyu başlat ve çıktısını izle');
  for (const name of ['shell', 'process_list', 'process_output', 'process_stop', 'process_write']) {
    assert.ok(process.has(name), `process intent missing ${name}`);
  }

  const verification = select('typecheck, lint ve testleri çalıştır');
  for (const name of ['project_verify', 'artifact_read', 'file_read', 'shell']) {
    assert.ok(verification.has(name), `verification intent missing ${name}`);
  }
});
