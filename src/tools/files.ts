import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import type { ToolDefinition } from '../types.js';

const string = (args: Record<string, unknown>, key: string): string => {
  const value = args[key];
  if (typeof value !== 'string' || !value) throw new Error(`${key} must be a non-empty string`);
  return value;
};
const schema = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });
const p = { type: 'string', description: 'Path relative to the workspace' };
const offsetParam = { type: 'integer', minimum: 0, description: 'Continuation offset from the previous result' };
const limitParam = { type: 'integer', minimum: 1, description: 'Maximum items to return' };
const numberArg = (value: unknown, fallback: number, max: number): number => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? Math.min(value, max) : fallback;
export const fileToolDefinitions: ToolDefinition[] = [
  { name: 'file_read', description: 'Read a UTF-8 workspace file (bounded output).', parameters: schema({ path: p, offset: offsetParam, max_bytes: { type: 'integer', minimum: 1, maximum: 100000 } }, ['path']) },
  { name: 'file_list', description: 'List a workspace directory.', parameters: schema({ path: p, offset: offsetParam, limit: limitParam }, []) },
  { name: 'file_search', description: 'Search UTF-8 workspace files for literal text.', parameters: schema({ path: p, query: { type: 'string' }, offset: offsetParam, limit: limitParam }, ['query']) },
  { name: 'file_write', description: 'Write a UTF-8 workspace file; overwrites existing content and requires approval.', parameters: schema({ path: p, content: { type: 'string' } }, ['path', 'content']) },
  { name: 'file_patch', description: 'Replace one exact occurrence in a workspace file; requires approval.', parameters: schema({ path: p, old_text: { type: 'string' }, new_text: { type: 'string' } }, ['path', 'old_text', 'new_text']) },
];
const LIMIT = 100_000;
function inside(root: string, target: string): boolean { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); }
/** Reject symlinks, including existing ancestors. These checks are not atomic against a concurrent filesystem actor. */
async function resolveSafe(workspace: string, input: string): Promise<string> {
  if (path.isAbsolute(input) || /^[a-zA-Z]:/.test(input) || input.includes('\0')) throw new Error('Path must be relative to workspace');
  const root = await fs.realpath(workspace);
  const target = path.resolve(root, input);
  if (!inside(root, target)) throw new Error('Path escapes workspace');
  let current = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Symbolic links are not allowed'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') break; throw e; }
  }
  return target;
}
function bounded(text: string): string { return text.length > LIMIT ? `${text.slice(0, LIMIT)}\n[output truncated]` : text; }
async function atomicWrite(target: string, content: string, workspace: string, input: string, signal?: AbortSignal, expected?: string): Promise<void> {
  const temp = path.join(path.dirname(target), `.tbot-${randomUUID()}.tmp`);
  let mode: number | undefined;
  try { mode = (await fs.stat(target)).mode & 0o777; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  try {
    await fs.writeFile(temp, content, { encoding: 'utf8', flag: 'wx', mode, signal });
    signal?.throwIfAborted();
    await resolveSafe(workspace, input);
    if (expected !== undefined && await fs.readFile(target, { encoding: 'utf8', signal }) !== expected) throw new Error('File changed since patch was read; patch not applied');
    signal?.throwIfAborted();
    await fs.rename(temp, target);
  } finally { await fs.unlink(temp).catch(() => {}); }
}
export async function handleFileTool(name: string, args: Record<string, unknown>, workspace: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const input = typeof args.path === 'string' ? args.path : '.';
  const target = await resolveSafe(workspace, input);
  if (name === 'file_read') {
    const stat = await fs.stat(target); if (!stat.isFile()) throw new Error('Not a regular file');
    const handle = await fs.open(target, 'r');
    try {
      const offset = numberArg(args.offset, 0, Number.MAX_SAFE_INTEGER);
      const maxBytes = Math.max(1, numberArg(args.max_bytes, 12000, LIMIT));
      const buffer = Buffer.alloc(maxBytes + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      let consumed = Math.min(bytesRead, maxBytes);
      // Avoid splitting a UTF-8 character between pages.
      if (bytesRead > maxBytes) {
        while (consumed > 0 && (buffer[consumed] & 0xc0) === 0x80) consumed--;
        if (!consumed) consumed = maxBytes;
      }
      const decoder = new StringDecoder('utf8');
      const text = decoder.write(buffer.subarray(0, consumed)) + decoder.end();
      return JSON.stringify({ content: text, offset, next_offset: bytesRead > consumed ? offset + consumed : null });
    } finally { await handle.close(); }
  }
  if (name === 'file_list') {
    const entries = await fs.readdir(target, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const offset = numberArg(args.offset, 0, Number.MAX_SAFE_INTEGER);
    const limit = Math.max(1, numberArg(args.limit, 80, 500));
    return JSON.stringify({ entries: entries.slice(offset, offset + limit).map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : e.isSymbolicLink() ? 'symlink' : 'file' })), next_offset: offset + limit < entries.length ? offset + limit : null });
  }
  if (name === 'file_write') { if (typeof args.content !== 'string') throw new Error('content must be a string'); if (Buffer.byteLength(args.content) > 1_000_000) throw new Error('Content exceeds 1 MB'); await atomicWrite(target, args.content, workspace, input, signal); return 'File written.'; }
  if (name === 'file_patch') { const old = string(args, 'old_text'); if (typeof args.new_text !== 'string') throw new Error('new_text must be a string'); const stat = await fs.stat(target); if (stat.size > 1_000_000) throw new Error('File exceeds 1 MB'); const content = await fs.readFile(target, { encoding: 'utf8', signal }); const at = content.indexOf(old); if (at < 0 || content.indexOf(old, at + 1) >= 0) throw new Error('old_text must occur exactly once'); const next = content.slice(0, at) + args.new_text + content.slice(at + old.length); if (Buffer.byteLength(next) > 1_000_000) throw new Error('Result exceeds 1 MB'); await atomicWrite(target, next, workspace, input, signal, content); return 'File patched.'; }
  if (name === 'file_search') {
    const query = string(args, 'query'); const root = await fs.realpath(workspace); const found: string[] = []; const offset = numberArg(args.offset, 0, 100000); const limit = Math.max(1, numberArg(args.limit, 30, 200)); let matches = 0; let visited = 0; let stopped = false; let capped = false;
    async function walk(dir: string): Promise<void> { signal?.throwIfAborted(); if (stopped) return; const entries = await fs.readdir(dir, { withFileTypes: true }); entries.sort((a, b) => a.name.localeCompare(b.name)); for (const entry of entries) { signal?.throwIfAborted(); if (++visited > 10000) { stopped = true; capped = true; return; } if (entry.isSymbolicLink() || ['.git', 'node_modules'].includes(entry.name)) continue; const full = path.join(dir, entry.name); if (entry.isDirectory()) await walk(full); else if (entry.isFile()) { const stat = await fs.stat(full); if (stat.size > 1_000_000) continue; const content = await fs.readFile(full, 'utf8'); if (content.includes('\0')) continue; for (const [i, line] of content.split(/\r?\n/).entries()) { if (line.includes(query)) { if (matches++ >= offset) { const start = Math.max(0, line.indexOf(query) - 100); found.push(`${path.relative(root, full)}:${i + 1}: ${start ? '…' : ''}${line.slice(start, start + Math.max(300, query.length))}${line.length > start + Math.max(300, query.length) ? '…' : ''}`); }; if (found.length > limit) { stopped = true; return; } } } } } }
    const stat = await fs.stat(target); if (stat.isDirectory()) await walk(target); else throw new Error('Search path must be a directory'); return JSON.stringify({ matches: found.slice(0, limit), next_offset: found.length > limit ? offset + limit : null, scan_limit_reached: capped });
  }
  throw new Error(`Unknown file tool: ${name}`);
}
