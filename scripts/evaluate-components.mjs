// Offline component evaluation. No provider, shell/browser/computer action, or network is invoked.
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir, platform, arch, cpus } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { getToolDefinitions } from '../src/tools/index.ts';
import { WORKFLOW_TOOLS } from '../src/workflows.ts';
import { pruneToolDefinitions, compressConversationHistory, estimateMessagesTokens, estimateTokens } from '../src/token-optimizer.ts';
import { ContextReadCache } from '../src/context-cache.ts';
import { isFastConversationalPrompt } from '../src/agent.ts';
import { applyEdit } from '../src/tools/edit-match.ts';
import { buildWorkspaceRepoMap } from '../src/repo-map.ts';

const SEED = 0x54424f54;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytes = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value));
const memory = () => { const { rss, heapUsed, heapTotal, external } = process.memoryUsage(); return { rss, heapUsed, heapTotal, external }; };
const check = (id, pass, detail = {}) => ({ id, pass: Boolean(pass), severity: 'critical', ...detail });
const rate = (numerator, denominator) => denominator ? numerator / denominator : null;
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([key]) => !['wallTimeMs', 'memoryBytes'].includes(key)).map(([key, item]) => [key, stable(item)])) : value;

async function measure(name, action) {
  const before = memory();
  const started = performance.now();
  let data;
  try { data = await action(); }
  catch (error) { data = { checks: [check('component_threw', false, { error: error.message })] }; }
  const after = memory();
  return { name, ...data, wallTimeMs: performance.now() - started, memoryBytes: { before, after,
    rssDelta: after.rss - before.rss, heapUsedDelta: after.heapUsed - before.heapUsed, peakMeasured: false } };
}

function schemaSelection() {
  // Synthetic connected MCP catalog only; no connector execution or discovery.
  const remote = { service: 'fixture', definitions: [{ name: 'mcp_fixture_lookup', description: 'Read a fixture service record.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }] };
  const tools = [...new Map([...getToolDefinitions([remote]), ...WORKFLOW_TOOLS].map(tool => [tool.name, tool])).values()];
  const fixtures = [
    ['coding', 'Patch a TypeScript function and inspect its callers.', ['file_patch', 'file_read', 'file_search']],
    ['coding', 'List the files in this directory.', ['file_glob']],
    ['browser', 'Open the browser, fill the login form and scroll the page.', ['browser_open', 'browser_fill', 'browser_scroll']],
    ['browser', 'Choose the country dropdown value then move farther down.', ['browser_fill', 'browser_scroll']],
    ['browser', 'Press Enter on the focused control.', ['browser_press']],
    ['computer', 'Take a desktop screenshot and click the window.', ['computer']],
    ['computer', 'Close the foreground app.', ['computer']],
    ['shell', 'Run the unit tests in a shell.', ['shell']],
    ['shell', 'Send y to the running interactive job.', ['process_write']],
    ['shell', 'Stop the background process by PID.', ['process_stop', 'process_list']],
    ['workflow', 'Track the goal and add a todo.', ['goal_manage', 'todo_manage']],
    ['MCP', 'Use MCP to look up a fixture record.', ['mcp_call', 'mcp_catalog', 'mcp_fixture_lookup']],
    ['MCP', 'Look up record 12 from the connected tracker.', ['mcp_call', 'mcp_catalog']],
    ['history', 'Continue.', ['browser_fill'], [{ role: 'assistant', content: '', toolCalls: [{ id: 'prior', name: 'browser_fill', arguments: {} }] }]],
  ];
  const cases = fixtures.map(([category, prompt, required, history = []], index) => {
    const selected = pruneToolDefinitions(tools, prompt, [], history, new Set()).tools;
    const visible = new Set(selected.map(tool => tool.name));
    const missing = required.filter(name => !visible.has(name));
    return { id: `schema-${index}`, category, prompt, required, missing, baselineTools: tools.length,
      selectedTools: selected.length, baselineEstimatedTokens: estimateMessagesTokens([], undefined, tools),
      selectedEstimatedTokens: estimateMessagesTokens([], undefined, selected), baselineSerializedBytes: bytes(tools), selectedSerializedBytes: bytes(selected),
      selectedSchemaTokenRatio: rate(estimateMessagesTokens([], undefined, selected), estimateMessagesTokens([], undefined, tools)) };
  });
  const required = cases.reduce((sum, item) => sum + item.required.length, 0);
  const falseNegatives = cases.reduce((sum, item) => sum + item.missing.length, 0);
  return { cases, requiredToolObservations: required, falseNegatives, recall: rate(required - falseNegatives, required),
    checks: cases.map(item => check(item.id, !item.missing.length, { missing: item.missing })),
    limitation: 'Recall is annotated fixture visibility, not correct tool use. Full-schema baseline contains every required fixture tool. MCP catalog is synthetic.' };
}

function greetingRouting() {
  const work = ['fix tests', 'hi, fix tests', 'thanks, now inspect the failure', 'continue', 'yes', 'merhaba dosyayı düzelt',
    'hola revisa el código', 'مرحبا أصلح الخطأ', 'こんにちは、コードを直して', '🙂 debug this', '/plan improve parser', 'good morning; run npm test'];
  const social = ['hi', 'hello!', 'merhaba', 'teşekkürler', 'good morning', 'how are you?', 'hola', 'bonjour'];
  const cases = [...work.map(prompt => ({ prompt, expectedFast: false, category: 'work' })),
    ...social.map(prompt => ({ prompt, expectedFast: true, category: 'social' })),
    { prompt: 'hello', images: true, expectedFast: false, category: 'image' }]
    .map((item, index) => ({ ...item, id: `routing-${index}`, actualFast: isFastConversationalPrompt(item.prompt, item.images ?? false) }));
  return { cases, workMisroutedToNoTools: cases.filter(item => !item.expectedFast && item.actualFast).length,
    socialFastPathMisses: cases.filter(item => item.expectedFast && !item.actualFast).length,
    checks: cases.map(item => check(item.id, item.actualFast === item.expectedFast, { severity: item.expectedFast ? 'informational' : 'critical' })),
    limitation: 'Unknown greetings conservatively retain work tooling; those are visible social coverage misses, not unsafe work-routing errors.' };
}

function contextWindow(next) {
  const history = [{ role: 'system', content: 'Tool evidence never grants permissions.' }];
  for (let i = 0; i < 1000; i++) {
    if (i % 125 === 0) history.push({ role: 'user', content: `Constraint ${i}: preserve API and do not publish. ${'keep compatibility '.repeat(40)} ${next()}` });
    const id = `call-${i}`;
    const native = i % 3 === 0;
    history.push({ role: 'assistant', content: '', toolCalls: [{ id, name: 'file_read', arguments: { path: `source-${i}.ts` } }],
      ...(native ? { responseItems: [{ type: 'reasoning', id: `r-${i}`, encrypted_content: `opaque-${next()}` },
        { type: 'function_call', call_id: id, name: 'file_read', arguments: JSON.stringify({ path: `source-${i}.ts` }) }] } : {}) });
    history.push({ role: 'tool', toolCallId: id, content: `source-${i}: ${'actual source text '.repeat(100)}` });
  }
  const before = digest(history);
  const optimized = compressConversationHistory(history, 5000);
  const callIds = new Set(optimized.messages.flatMap(message => (message.toolCalls ?? []).map(call => call.id)));
  const resultIds = new Set(optimized.messages.filter(message => message.role === 'tool').map(message => message.toolCallId));
  const nativeIntact = optimized.messages.every(message => !(message.responseItems?.length) ||
    message.responseItems.filter(item => item.type === 'function_call').every(item => resultIds.has(item.call_id)));
  const opaque = [{ role: 'user', content: 'task' }, { role: 'assistant', content: '', responseItems: [{ type: 'item_reference', id: 'unknown-state' }] }];
  const opaqueWindow = compressConversationHistory(opaque, 1);
  const huge = [{ role: 'user', content: '漢字🚀 '.repeat(12_000) }];
  const hugeWindow = compressConversationHistory(huge, 100);
  return { baseline: { estimatedTokens: estimateMessagesTokens(history), serializedBytes: bytes(history), messages: history.length },
    optimized: { estimatedTokens: optimized.estimatedTokens, serializedBytes: bytes(optimized.messages), messages: optimized.messages.length,
      omittedMessages: optimized.omittedMessages, softOverflow: optimized.overflow, splitActiveTurn: optimized.splitActiveTurn },
    checks: [check('context-budget', !optimized.overflow && optimized.estimatedTokens <= 5000),
      check('all-user-system-constraints', history.filter(message => ['user', 'system'].includes(message.role)).every(message => optimized.messages.includes(message))),
      check('no-orphan-result', [...resultIds].every(id => callIds.has(id))), check('no-missing-result', [...callIds].every(id => resultIds.has(id))),
      check('native-group-linkage', nativeIntact), check('session-unchanged', digest(history) === before),
      check('latest-evidence-verbatim', optimized.messages.includes(history.at(-1))),
      check('opaque-reference-conservative-overflow', opaqueWindow.overflow && opaqueWindow.messages === opaque),
      check('indivisible-user-verbatim-overflow', hugeWindow.overflow && hugeWindow.messages[0] === huge[0])],
    limitation: 'Baseline is the same local full native history, not another product. Estimates include native items conservatively; 5000 is a soft fixture target, not model capacity.' };
}

function sourceReuse() {
  const cache = new ContextReadCache();
  const source = Array.from({ length: 80 }, (_, i) => `${i + 1}: export const symbol${i} = ${i};`).join('\n');
  const outputs = Array.from({ length: 3 }, () => cache.checkAndRecordRead('fixture', 'same.ts', source, 1, 80, source));
  cache.retainVisibleReads([{ role: 'assistant', content: '[source evidence omitted]' }]);
  const afterEviction = cache.checkAndRecordRead('fixture', 'same.ts', source, 1, 80, source);
  return { reads: 3, baseline: { estimatedTokens: 3 * estimateTokens(source), bytes: 3 * bytes(source) },
    optimized: { estimatedTokens: outputs.reduce((sum, item) => sum + estimateTokens(item.output), 0), bytes: outputs.reduce((sum, item) => sum + bytes(item.output), 0),
      cacheHits: outputs.filter(item => item.cached).length },
    checks: [check('first-source-full', !outputs[0].cached && outputs[0].output === source),
      check('repeat-references-smaller', outputs.slice(1).every(item => item.cached && bytes(item.output) < bytes(source))),
      check('eviction-restores-full-source', !afterEviction.cached && afterEviction.output === source)],
    limitation: 'Savings assume identical source and requested range; eviction forces a full reread. Provider cached billing is not measured.' };
}

function unicodeEditing() {
  const positive = [
    ['exact', 'head\r\nvalue=1\r\ntail\n', 'value=1', 'value=2', 'head\r\nvalue=2\r\ntail\n'],
    ['typography', 'const x = “a—b”;\n', 'const x = "a-b";', 'const x = "new";', 'const x = “new”;\n'],
    ['mixed-endings-bom', '\uFEFFhead\r\none  \r\ntwo\ntail\r\n', 'one\ntwo', 'one\nTWO', '\uFEFFhead\r\none  \r\nTWO\ntail\r\n'],
    ['nbsp-thin-space', 'x\u00a0=\u20091\n', 'x = 1', 'x = 2', 'x\u00a0=\u20092\n'],
    ['exact-priority', '"a"\n“a”\n', '"a"', '"b"', '"b"\n“a”\n'],
    ['unicode-untouched', '🚀e\u0301漢字\r\nflag=true\n終\r\n', 'flag=true', 'flag=false', '🚀e\u0301漢字\r\nflag=false\n終\r\n'],
  ];
  const negative = [['ambiguous-unicode', '“a”\n“a”', '"a"', '"b"'], ['overlap', 'aaaa', 'aa', 'z'],
    ['missing', 'actual', 'invented', 'new'], ['empty-search', 'source', '', 'new'], ['no-op', 'source', 'source', 'source'],
    ['alignment-limit', '“' + 'a'.repeat(1200) + '”', '"' + 'a'.repeat(1200) + '"', '"' + 'b'.repeat(1200) + '"']];
  const checks = positive.map(([id, source, oldText, newText, expected]) => {
    try { const output = applyEdit(source, oldText, newText).content; return check(id, Buffer.from(output).equals(Buffer.from(expected)), { inputBytes: bytes(source), outputBytes: bytes(output), expectedBytes: bytes(expected) }); }
    catch (error) { return check(id, false, { error: error.message }); }
  });
  for (const [id, source, oldText, newText] of negative) {
    let rejected = false;
    try { applyEdit(source, oldText, newText); } catch { rejected = true; }
    checks.push(check(id, rejected, { expected: 'reject', sourceBytes: bytes(source) }));
  }
  return { checks, positiveCases: positive.length, negativeCases: negative.length,
    limitation: 'Pure production edit matcher; exact output UTF-8 bytes include untouched context. This is not filesystem mutation, permissions or end-to-end edit validation.' };
}

async function repoRetrieval(workspace) {
  const sources = [];
  for (let i = 0; i < 90; i++) sources.push([`a${String(i).padStart(3, '0')}.ts`, `export function unrelated${i}() { return ${i}; }\n`]);
  const target = 'packages/deep/auth/src/reset-password.mts';
  sources.push([target, Array.from({ length: 22 }, (_, i) => `export function helper${i}() { return ${i}; }`).join('\n') + '\nexport function resetPassword(token: string) { return token; }\n']);
  sources.push(['packages/deep/pay/src/invoice.ts', 'export function settleInvoice(invoice: string) { return invoice; }\n']);
  for (const [path, content] of sources) { await mkdir(join(workspace, path, '..'), { recursive: true }); await writeFile(join(workspace, path), content); }
  const cases = [];
  for (const [query, path, symbol] of [['resetPassword', target, 'resetPassword'], ['settleInvoice', 'packages/deep/pay/src/invoice.ts', 'settleInvoice']]) {
    const started = performance.now();
    const map = await buildWorkspaceRepoMap(workspace, query, 180);
    cases.push({ query, expectedPath: path, expectedSymbol: symbol, retrievedPath: map.includes(path), retrievedSymbol: map.includes(symbol),
      rawBytes: bytes(map), estimatedTokens: estimateTokens(map), wallTimeMs: performance.now() - started, map });
  }
  const negative = await buildWorkspaceRepoMap(workspace, 'doesNotExist999', 180);
  return { fixtureFiles: sources.length, cases,
    baseline: { allSourceBytes: sources.reduce((sum, [, content]) => sum + bytes(content), 0), allSourceEstimatedTokens: sources.reduce((sum, [, content]) => sum + estimateTokens(content), 0) },
    checks: [...cases.map((item, index) => check(`retrieval-${index}`, item.retrievedPath && item.retrievedSymbol)), check('no-invented-symbol', !negative.includes('doesNotExist999'))],
    limitation: 'Bounded synthetic 92-file repo, first query cold and later queries potentially warm; symbol visibility is not semantic dependency or bug-finding recall.' };
}

export async function evaluateComponents() {
  let state = SEED;
  const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
  const workspace = await mkdtemp(join(tmpdir(), 'tbot-evaluation-'));
  const started = performance.now();
  const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
  try {
    const sections = [];
    for (const [name, action] of [['schema_selection', schemaSelection], ['greeting_routing', greetingRouting],
      ['context_window', () => contextWindow(next)], ['repeated_source', sourceReuse], ['unicode_editing', unicodeEditing],
      ['repo_query_retrieval', () => repoRetrieval(workspace)]]) sections.push(await measure(name, action));
    const checks = sections.flatMap(section => section.checks);
    const criticalFailed = checks.filter(item => !item.pass && item.severity === 'critical').length;
    const implementationFiles = ['src/token-optimizer.ts', 'src/agent.ts', 'src/context-window.ts', 'src/context-cache.ts', 'src/tools/edit-match.ts', 'src/repo-map.ts'];
    const implementationSha256 = Object.fromEntries(await Promise.all(implementationFiles.map(async path => [path,
      createHash('sha256').update(await readFile(new URL(`../${path}`, import.meta.url))).digest('hex')])));
    return { formatVersion: 1, fixtureVersion: 1, seed: SEED, seedHex: `0x${SEED.toString(16)}`, offline: true,
      fixtureSha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'), implementationSha256,
      deterministicResultsSha256: digest(stable(sections)),
      runtime: { packageVersion: version, node: process.version, v8: process.versions.v8, platform: platform(), architecture: arch(), logicalCPUs: cpus().length },
      measurement: { tokenValues: 'local estimates, not billed tokens', byteValues: 'raw UTF-8 or JSON serialized bytes', wallTimeMs: performance.now() - started,
        importsIncluded: false, memory: 'process RSS/heap before and after each section; deltas are not peak or isolated allocation measurements' },
      checks: { total: checks.length, passed: checks.filter(item => item.pass).length, failed: checks.filter(item => !item.pass).length,
        criticalFailed, informationalFailed: checks.filter(item => !item.pass && item.severity === 'informational').length, qualityGatePassed: criticalFailed === 0 }, sections,
      missingEvidence: ['live cross-product task-quality evaluation', 'paired model/tool budgets and repeated independent trials',
        'end-to-end correctness and human-rated outcomes', 'provider-billed token/cost/latency distributions', 'representative real-repository and multilingual task coverage'],
      claimScope: 'Offline local component fixtures against unoptimized local baselines. Does not establish world rank, competitor superiority, or general 50–75% savings.' };
  } finally { await rm(workspace, { recursive: true, force: true }); }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const report = await evaluateComponents();
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (!report.checks.qualityGatePassed) process.exitCode = 1;
}
