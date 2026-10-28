import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// The deployment helper checks both the selected installer and installed payload.
const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const installer = `T-Bot-Setup-${version}.exe`;
async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(resolve(root, path))) hash.update(chunk);
  return hash.digest('hex');
}
const manifest = {
  version,
  installer,
  installerSha256: await sha256(`release/${installer}`),
  appAsarSha256: await sha256('release/win-unpacked/resources/app.asar'),
};
await writeFile(resolve(root, 'release/build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Recorded installer and app.asar SHA256 for T Bot ${version}.`);
