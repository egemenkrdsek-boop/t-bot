import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
// Resolve the compiler itself; npm lifecycle PATH/bin shims are not required.
const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc')], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
await import('./copy-desktop.mjs');
