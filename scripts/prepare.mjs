import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

if (fs.existsSync('src/index.ts')) {
  if (!process.env.npm_execpath) throw new Error('Run prepare through npm so its build command can be resolved.');
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', 'build'], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
for (const file of ['dist/index.js', 'dist/desktop/main.js', 'dist/desktop/preload.cjs', 'dist/desktop/renderer/index.html', 'dist/desktop/renderer/app.js', 'dist/desktop/renderer/styles.css']) {
  if (!fs.existsSync(file)) throw new Error(`Incomplete T Bot package: missing ${file}. Build from the source repository before packing.`);
}
