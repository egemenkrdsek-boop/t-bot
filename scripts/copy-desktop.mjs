import fs from 'node:fs';
for (const file of ['src/desktop/preload.cjs', 'src/desktop/renderer/index.html', 'src/desktop/renderer/app.js', 'src/desktop/renderer/styles.css']) {
  if (!fs.existsSync(file)) throw new Error(`Missing desktop asset: ${file}`);
}
fs.mkdirSync('dist/desktop', { recursive: true });
fs.copyFileSync('src/desktop/preload.cjs', 'dist/desktop/preload.cjs');
fs.rmSync('dist/desktop/renderer', { recursive: true, force: true });
fs.cpSync('src/desktop/renderer', 'dist/desktop/renderer', { recursive: true });
