/**
 * Local, bounded file checkpoints.
 *
 * Before file_write or file_patch replaces an existing file, the previous
 * content is copied into .tbot/checkpoints. Restores are explicit, approved
 * tools; they never happen automatically. Content is stored separately from
 * metadata so listing checkpoints stays cheap on long sessions.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { ToolDefinition } from './types.js';
import { workspaceStatePath } from './workspace-state.js';
import { assertNotSensitivePath, resolveWorkspacePath } from './security/paths.js';

const CHECKPOINT_ID = /^ckpt-[a-z0-9]+-[a-f0-9]{12}$/;
const MAX_CONTENT_BYTES = 1_000_000;
const MAX_CHECKPOINTS = 40;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;

export interface CheckpointMeta {
  id: string;
  path: string;
  createdAt: string;
  tool: string;
  bytes: number;
  sha256: string;
}

function checkpointDirectory(workspace: string): string {
  return workspaceStatePath(workspace, '.tbot/checkpoints');
}

function metadataFile(workspace: string, id: string): string {
  if (!CHECKPOINT_ID.test(id)) throw new Error('Invalid checkpoint id');
  return join(checkpointDirectory(workspace), `${id}.json`);
}

function contentFile(workspace: string, id: string): string {
  if (!CHECKPOINT_ID.test(id)) throw new Error('Invalid checkpoint id');
  return join(checkpointDirectory(workspace), `${id}.content`);
}

async function prune(workspace: string): Promise<void> {
  const directory = checkpointDirectory(workspace);
  let entries: { id: string; size: number; mtime: number }[];
  try {
    entries = await Promise.all((await readdir(directory))
      .filter(name => /^ckpt-[a-z0-9]+-[a-f0-9]{12}\.json$/.test(name))
      .map(async name => {
        const info = await stat(join(directory, name));
        return { id: name.slice(0, -5), size: info.size, mtime: info.mtimeMs };
      }));
  } catch {
    return;
  }
  entries.sort((a, b) => b.mtime - a.mtime);
  let total = 0;
  for (const [index, entry] of entries.entries()) {
    let contentSize = 0;
    try { contentSize = (await stat(contentFile(workspace, entry.id))).size; } catch { /* missing content is pruned below */ }
    total += entry.size + contentSize;
    if (index < MAX_CHECKPOINTS && total <= MAX_TOTAL_BYTES) continue;
    await unlink(metadataFile(workspace, entry.id)).catch(() => undefined);
    await unlink(contentFile(workspace, entry.id)).catch(() => undefined);
  }
}

/** Best-effort snapshot of the previous file content. Never blocks a write. */
export async function saveCheckpoint(
  workspace: string,
  target: string,
  content: string,
  tool: string
): Promise<CheckpointMeta | undefined> {
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) return undefined;
  const absolute = isAbsolute(target) ? resolve(target) : resolve(workspace, target);
  const rel = relative(resolve(workspace), absolute);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return undefined;
  try {
    assertNotSensitivePath(absolute, { operation: 'write' });
  } catch {
    return undefined;
  }

  const sha256 = createHash('sha256').update(content, 'utf8').digest('hex');
  const id = `ckpt-${Date.now().toString(36)}-${sha256.slice(0, 12)}`;
  const directory = checkpointDirectory(workspace);
  await mkdir(directory, { recursive: true, mode: 0o700 });

  const meta: CheckpointMeta = {
    id,
    path: rel.replace(/\\/g, '/'),
    createdAt: new Date().toISOString(),
    tool: String(tool).slice(0, 40),
    bytes: Buffer.byteLength(content, 'utf8'),
    sha256,
  };
  const contentPath = contentFile(workspace, id);
  const metaPath = metadataFile(workspace, id);
  try {
    await writeFile(contentPath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    const temp = `${metaPath}.tmp-${randomUUID()}`;
    await writeFile(temp, JSON.stringify(meta), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temp, metaPath);
  } catch (error) {
    await unlink(contentPath).catch(() => undefined);
    await unlink(metaPath).catch(() => undefined);
    throw error;
  }
  await prune(workspace);
  return meta;
}

export async function listCheckpoints(workspace: string, limit = 20): Promise<CheckpointMeta[]> {
  const directory = checkpointDirectory(workspace);
  let names: string[];
  try { names = await readdir(directory); } catch { return []; }
  const bounded = Math.max(1, Math.min(MAX_CHECKPOINTS, Math.floor(limit) || 20));
  const metas = await Promise.all(names
    .filter(name => /^ckpt-[a-z0-9]+-[a-f0-9]{12}\.json$/.test(name))
    .map(async name => {
      try {
        const parsed = JSON.parse(await readFile(join(directory, name), 'utf8')) as CheckpointMeta;
        return CHECKPOINT_ID.test(parsed.id) && typeof parsed.path === 'string' ? parsed : undefined;
      } catch { return undefined; }
    }));
  return metas
    .filter((meta): meta is CheckpointMeta => Boolean(meta))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, bounded);
}

export async function readCheckpoint(workspace: string, id: string): Promise<{ meta: CheckpointMeta; content: string }> {
  const meta = JSON.parse(await readFile(metadataFile(workspace, id), 'utf8')) as CheckpointMeta;
  if (!CHECKPOINT_ID.test(meta.id) || meta.id !== id || typeof meta.path !== 'string') throw new Error('Invalid checkpoint metadata');
  const content = await readFile(contentFile(workspace, id), 'utf8');
  const sha256 = createHash('sha256').update(content, 'utf8').digest('hex');
  if (sha256 !== meta.sha256 || Buffer.byteLength(content, 'utf8') !== meta.bytes) {
    throw new Error('Checkpoint content failed its integrity check');
  }
  return { meta, content };
}

/** Restore one checkpoint. The dispatcher requires explicit approval first. */
export async function restoreCheckpoint(workspace: string, id: string): Promise<{ path: string; bytes: number }> {
  const { meta, content } = await readCheckpoint(workspace, id);
  const target = await resolveWorkspacePath(workspace, meta.path);
  assertNotSensitivePath(target, { operation: 'write' });
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.tbot-restore-${randomUUID()}`;
  await writeFile(temp, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await rename(temp, target);
  return { path: meta.path, bytes: Buffer.byteLength(content, 'utf8') };
}

export const checkpointToolDefinitions: ToolDefinition[] = [
  {
    name: 'checkpoint_list',
    description: 'List recent local file checkpoints created before writes and patches. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 40, description: 'Maximum checkpoints to return (default 20).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'checkpoint_restore',
    description: 'Restore a file from a local checkpoint. Replaces the current file; requires approval.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Checkpoint id from checkpoint_list, e.g. ckpt-...' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

export async function handleCheckpointTool(
  name: string,
  args: Record<string, unknown>,
  workspace: string
): Promise<string> {
  if (name === 'checkpoint_list') {
    const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.floor(args.limit) : 20;
    const checkpoints = await listCheckpoints(workspace, limit);
    return JSON.stringify({ ok: true, count: checkpoints.length, checkpoints }, null, 2);
  }
  if (name === 'checkpoint_restore') {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id) throw new Error('id must be a non-empty string');
    const restored = await restoreCheckpoint(workspace, id);
    return JSON.stringify({ ok: true, restored }, null, 2);
  }
  throw new Error(`Unknown checkpoint tool: ${name}`);
}
