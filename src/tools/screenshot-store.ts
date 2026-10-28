/**
 * Bounded local screenshot retention and workspace containment.
 *
 * GUI actions can produce many images in a long session; keeping every PNG
 * would grow disk and backup/RAM pressure. Every path is resolved through
 * `workspaceStatePath`, which rejects junctions/symlinks and escapes, so a
 * linked `.tbot/screenshots` can never make us delete or write outside the
 * workspace.
 */
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readdir, rm, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workspaceStatePath } from '../workspace-state.js';

const MAX_FILES = 40;
const MAX_BYTES = 32 * 1024 * 1024;
const SCREENSHOT_PREFIX = /^(?:browser|desktop|screen|screenshot)$/;

/** Absolute, contained screenshot directory; throws on links and escapes. */
export function screenshotDirectory(workspace: string): string {
  return workspaceStatePath(workspace, '.tbot/screenshots');
}

/**
 * Create the contained screenshot directory (mode 0700) and return a fresh
 * UUID-named PNG path. The name never collides with a previous capture.
 */
export async function createScreenshotPath(
  workspace: string,
  prefix: 'browser' | 'desktop' | 'screen' = 'browser'
): Promise<string> {
  const directory = screenshotDirectory(workspace);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await chmod(directory, 0o700).catch(() => undefined);
  const safePrefix = SCREENSHOT_PREFIX.test(prefix) ? prefix : 'screenshot';
  return join(directory, `${safePrefix}-${randomUUID()}.png`);
}

export async function pruneScreenshots(workspace: string): Promise<number> {
  let directory: string;
  try {
    directory = screenshotDirectory(workspace);
  } catch {
    // A linked or escaping state directory is never pruned (or followed).
    return 0;
  }
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return 0;
  }

  const entries: Array<{ path: string; size: number; mtime: number }> = [];
  for (const name of names) {
    if (!/\.(?:png|jpe?g|webp)$/i.test(name)) continue;
    const candidate = join(directory, name);
    try {
      const info = await stat(candidate);
      if (info.isFile()) entries.push({ path: candidate, size: info.size, mtime: info.mtimeMs });
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

const PROFILE_PREFIX = 'tbot-browser-';
const DEFAULT_PROFILE_MAX_AGE_MS = 6 * 60 * 60_000;

/**
 * Remove abandoned Chromium profile directories left in %TEMP% after a crash
 * or forced process kill. `keep` protects the profile of the current session.
 * Only old directories matching our own prefix are touched.
 */
export async function sweepStaleBrowserProfiles(
  keep?: string,
  maxAgeMs = DEFAULT_PROFILE_MAX_AGE_MS
): Promise<number> {
  const root = tmpdir();
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return 0;
  }
  let removed = 0;
  const cutoff = Date.now() - Math.max(60_000, maxAgeMs);
  for (const name of names) {
    if (!name.startsWith(PROFILE_PREFIX)) continue;
    const candidate = join(root, name);
    if (keep && candidate === keep) continue;
    try {
      const info = await stat(candidate);
      if (!info.isDirectory() || info.mtimeMs > cutoff) continue;
      await rm(candidate, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      removed++;
    } catch { /* another process may own it */ }
  }
  return removed;
}
