/**
 * Bounded local screenshot retention. GUI actions can produce many images in a
 * long session; keeping every PNG would grow disk and backup/RAM pressure.
 */
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_FILES = 40;
const MAX_BYTES = 32 * 1024 * 1024;

export async function pruneScreenshots(workspace: string): Promise<number> {
  const directory = join(workspace, '.tbot', 'screenshots');
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return 0;
  }

  const entries: Array<{ path: string; size: number; mtime: number }> = [];
  for (const name of names) {
    if (!/\.(?:png|jpe?g|webp)$/i.test(name)) continue;
    try {
      const info = await stat(join(directory, name));
      if (info.isFile()) entries.push({ path: join(directory, name), size: info.size, mtime: info.mtimeMs });
    } catch { /* ignore disappearing files */ }
  }
  entries.sort((a, b) => b.mtime - a.mtime);

  let total = 0;
  let removed = 0;
  for (const [index, entry] of entries.entries()) {
    total += entry.size;
    if (index < MAX_FILES && total <= MAX_BYTES) continue;
    await unlink(entry.path).catch(() => undefined);
    removed++;
  }
  return removed;
}
