import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleDiagnosticsTool } from '../src/tools/diagnostics.js';

test('the TypeScript compiler is loaded lazily, not at module startup', async () => {
  const source = await readFile(new URL('../src/tools/diagnostics.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^import\s+\*\s+as\s+ts\s+from\s+'typescript'/m);
  assert.match(source, /await import\('typescript'\)/);
});

test('diagnostics reports a real type error and supports a directory target', async () => {
  // CI temp paths may be short 8.3 aliases; diagnostics receives the canonical
  // path (the product also realpaths its input).
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'tbot-diagnostics-')));
  try {
    await writeFile(join(workspace, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext' },
      include: ['*.ts'],
    }));
    await writeFile(join(workspace, 'bad.ts'), 'const value: string = 42;\nexport { value };\n');

    const fileResult = JSON.parse(await handleDiagnosticsTool('diagnostics', { path: 'bad.ts' }, workspace));
    assert.equal(fileResult.ok, false);
    assert.ok(fileResult.diagnostics.some((item: { code: number }) => item.code === 2322));

    const directoryResult = JSON.parse(await handleDiagnosticsTool('diagnostics', { path: '.' }, workspace));
    assert.equal(directoryResult.ok, false);
    assert.ok(directoryResult.filesChecked >= 1);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
