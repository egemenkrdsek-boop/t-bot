import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWorkspaceRepoMap, extractFileAstOutline, rankRepoPaths } from '../src/repo-map.js';
import { estimateTokens } from '../src/token-optimizer.js';

async function fixture(action: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'tbot-map-'));
  try { await action(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('bounded inventory finds a deep monorepo query target after 85 shallow sources', async () => {
  await fixture(async directory => {
    await Promise.all(Array.from({ length: 85 }, (_, i) => writeFile(join(directory, `a${String(i).padStart(3, '0')}.ts`), `export const unrelated${i}=1;`)));
    const deep = join(directory, 'packages/deep/auth/src');
    await mkdir(deep, { recursive: true });
    await writeFile(join(deep, 'reset-password.mts'), Array.from({ length: 20 }, (_, i) => `export const helper${i}=1;`).join('\n') + '\nexport function resetPassword() {}');
    const map = await buildWorkspaceRepoMap(directory, 'resetPassword reset-password', 180);
    assert.match(map, /packages\/deep\/auth\/src\/reset-password\.mts/);
    assert.match(map, /resetPassword\[L21-21\]/);
    assert.match(map, /partial/);
    assert.ok(estimateTokens(map) <= 180);
  });
});

test('queries select later symbols rather than a cached first-ten prefix', async () => {
  await fixture(async directory => {
    await writeFile(join(directory, 'only.ts'), Array.from({ length: 20 }, (_, i) => `export function helper${i}() {}`).join('\n') + '\nexport function resetPassword() {}');
    await buildWorkspaceRepoMap(directory, 'helper0');
    const map = await buildWorkspaceRepoMap(directory, 'resetPassword', 100);
    assert.match(map, /resetPassword\[L21-21\]/);
    assert.ok(estimateTokens(map) <= 100);
  });
});

test('map cache refreshes same-size replacements with restored mtime and renders workspace-relative paths', async () => {
  await fixture(async directory => {
    const nested = join(directory, 'src');
    await mkdir(nested);
    const file = join(nested, 'only.ts');
    await writeFile(file, 'export function alphaOld() {}');
    const original = await stat(file);
    assert.match(await buildWorkspaceRepoMap(directory, 'alphaOld'), /src\/only.ts.*alphaOld/);
    await writeFile(file, 'export function alphaNew() {}');
    await utimes(file, original.atime, original.mtime);
    const map = await buildWorkspaceRepoMap(nested, 'alphaNew');
    assert.match(map, /- only.ts.*alphaNew/);
    assert.doesNotMatch(map, /src\/only.ts|alphaOld/);
    await rm(file);
    assert.equal(await buildWorkspaceRepoMap(nested, 'alphaNew'), '');
  });
});

test('root and nested ignore rules, negations, anchored names and static ignored directories are respected', async () => {
  await fixture(async directory => {
    await writeFile(join(directory, '.gitignore'), '\uFEFF*.generated.ts\n!keep.generated.ts\n/root-only.ts\nprivate/\n');
    await writeFile(join(directory, 'skip.generated.ts'), 'export const secretSkip=1;');
    await writeFile(join(directory, 'keep.generated.ts'), 'export const keepMe=1;');
    await writeFile(join(directory, 'root-only.ts'), 'export const rootSecret=1;');
    for (const folder of ['private', 'node_modules', 'src']) await mkdir(join(directory, folder));
    await writeFile(join(directory, 'private/secret.ts'), 'export const privateSecret=1;');
    await writeFile(join(directory, 'node_modules/secret.ts'), 'export const vendorSecret=1;');
    await writeFile(join(directory, 'src/.gitignore'), 'nested-skip.ts\n');
    await writeFile(join(directory, 'src/nested-skip.ts'), 'export const nestedSecret=1;');
    await writeFile(join(directory, 'src/root-only.ts'), 'export const nestedAllowed=1;');
    const map = await buildWorkspaceRepoMap(directory, 'Secret keepMe nestedAllowed', 900);
    assert.match(map, /keepMe/);
    assert.match(map, /nestedAllowed/);
    assert.doesNotMatch(map, /secretSkip|rootSecret|privateSecret|vendorSecret|nestedSecret/);
  });
});

test('symlink/junction directories and oversized source do not contribute outside or parsed symbols', async () => {
  await fixture(async directory => {
    const outside = await mkdtemp(join(tmpdir(), 'tbot-map-outside-'));
    try {
      await writeFile(join(outside, 'outside.ts'), 'export const outsideSecret=1;');
      await symlink(outside, join(directory, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
      await writeFile(join(directory, 'oversized.ts'), `export const oversizedSymbol=1;\n${' '.repeat(512 * 1024)}`);
      await writeFile(join(directory, 'safe.ts'), 'export const safeSymbol=1;');
      const map = await buildWorkspaceRepoMap(directory, 'outsideSecret oversizedSymbol safeSymbol');
      assert.match(map, /safeSymbol/);
      assert.doesNotMatch(map, /outsideSecret|oversizedSymbol|linked/);
      assert.match(map, /oversized.ts \(not inspected\)/);
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
});

test('source extensions and uncased Unicode queries are retained, class arrow fields are indexed', async () => {
  await fixture(async directory => {
    await writeFile(join(directory, '普通.cts'), 'export function 处理请求() {}');
    await writeFile(join(directory, 'notes.markdown'), '# Usage\nText');
    const map = await buildWorkspaceRepoMap(directory, '处理请求', 180);
    assert.match(map, /处理请求\[L1-1\]/);
    assert.match(map, /notes.markdown/);
    const outline = extractFileAstOutline('client.ts', 'export class Client {\n resetPassword = async () => { return 1; };\n}');
    assert.ok(outline.symbols.some(symbol => symbol.name === 'Client.resetPassword' && symbol.startLine === 2));
  });
});

test('recursive ignore globs and character classes do not publish ignored symbols', async () => {
  await fixture(async directory => {
    await mkdir(join(directory, 'packages/deep/generated'), { recursive: true });
    await writeFile(join(directory, '.gitignore'), '**/generated/**\n[a-b].ts\na**z.ts\n');
    await writeFile(join(directory, 'a.ts'), 'export const ignoredClass=1;');
    await writeFile(join(directory, 'packages/deep/generated/secret.ts'), 'export const generatedSecret=1;');
    await writeFile(join(directory, 'keep.ts'), 'export const keepMe=1;');
    await mkdir(join(directory, 'alpha'));
    await writeFile(join(directory, 'alpha/z.ts'), 'export const nestedGlobAllowed=1;');
    await writeFile(join(directory, 'alphaz.ts'), 'export const nonSlashGlobIgnored=1;');
    const map = await buildWorkspaceRepoMap(directory, 'ignoredClass generatedSecret keepMe');
    assert.match(map, /keepMe/);
    assert.match(map, /nestedGlobAllowed/);
    assert.doesNotMatch(map, /ignoredClass|generatedSecret/);
    assert.doesNotMatch(map, /nonSlashGlobIgnored/);
  });
});

test('adversarial ignore patterns fail closed with a bounded coverage notice', async () => {
  await fixture(async directory => {
    await writeFile(join(directory, '.gitignore'), '*a'.repeat(160));
    await writeFile(join(directory, 'a.ts'), 'export const notSafelyEnumerated=1;');
    const map = await buildWorkspaceRepoMap(directory, 'notSafelyEnumerated');
    assert.match(map, /ignore limit reached/);
    assert.doesNotMatch(map, /notSafelyEnumerated/);
  });
});

test('10k-path filename ranking is deterministic, query-specific, deduplicated and bounded', () => {
  const paths = Array.from({ length: 9999 }, (_, i) => `packages/pkg${i}/src/unrelated${i}.ts`);
  paths.push('apps/account/src/reset-password.ts');
  const ranked = rankRepoPaths(paths, 'resetPassword reset-password', 8);
  assert.equal(ranked[0], 'apps/account/src/reset-password.ts');
  assert.equal(ranked.length, 8);
  assert.equal(rankRepoPaths(paths, 'reset_password', 1)[0], 'apps/account/src/reset-password.ts');
  assert.deepEqual(rankRepoPaths([...paths].reverse(), 'resetPassword reset-password', 8), ranked);
  assert.deepEqual(rankRepoPaths(['a.ts', 'a.ts'], '', 8), ['a.ts']);
  assert.deepEqual(rankRepoPaths(paths, 'query', 0), []);
});

test('unsupported languages and explicit unusual filenames remain discoverable without invented AST symbols', async () => {
  await fixture(async directory => {
    await mkdir(join(directory, 'services/payment'), { recursive: true });
    await writeFile(join(directory, 'services/payment/PaymentService.java'), 'public class PaymentService { void chargeCard() {} }');
    await writeFile(join(directory, 'engine.cpp'), 'void startEngine() {}');
    await writeFile(join(directory, 'custom.xyz'), 'export function notARealTsFile() {}');
    await writeFile(join(directory, 'types.d.ts'), 'export interface PaymentReceipt {}');
    const java = await buildWorkspaceRepoMap(directory, 'PaymentService.java', 120);
    assert.match(java, /services\/payment\/PaymentService.java \(not inspected\)/);
    assert.doesNotMatch(java, /chargeCard\[L/);
    const cpp = await buildWorkspaceRepoMap(directory, 'engine.cpp', 120);
    assert.match(cpp, /engine.cpp \(not inspected\)/);
    assert.doesNotMatch(cpp, /startEngine\[L/);
    const unusual = await buildWorkspaceRepoMap(directory, 'custom.xyz', 120);
    assert.match(unusual, /custom.xyz \(not inspected\)/);
    assert.doesNotMatch(unusual, /notARealTsFile/);
    assert.match(await buildWorkspaceRepoMap(directory, 'types.d.ts', 120), /PaymentReceipt\[L1-1\]/);
  });
});
