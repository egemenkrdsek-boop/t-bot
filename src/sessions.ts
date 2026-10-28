import { createHash, randomUUID } from 'node:crypto';
import { promises as fs, realpathSync } from 'node:fs';
import path from 'node:path';
import { withFileLock } from './lock.js';
import { redactSecrets } from './security/redact.js';
import type { Message } from './types.js';

export { redactSecrets } from './security/redact.js';

// Enumerable symbols survive {...session} without becoming persisted/model-visible JSON fields.
const REVISION = Symbol('sessionCheckpointRevision');
const queues = new Map<string, Promise<void>>();

export interface Session {
  [REVISION]?: string | null;
  id: string;
  workspace: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}
export interface SessionMetadata {
  id: string;
  workspace: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  messageCount: number;
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const SEGMENT_BYTES = 1024 * 1024;
const DEFAULT_LOAD_BYTES = 256 * 1024 * 1024;
const MAX_LIST = 200;
const SECRET_KEY = /(?:api[_-]?key|token|authorization|password|secret|credential|private[_-]?key)/i;

function redact(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_KEY.test(key) ? '[REDACTED]' : redact(item)]));
  }
  return value;
}
function workspaceKey(workspace: string): string {
  const resolved = path.resolve(workspace);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
function canonicalDirectory(directory: string): string {
  let ancestor = path.resolve(directory);
  const missing: string[] = [];
  for (;;) {
    try { return path.join(realpathSync.native(ancestor), ...missing.reverse()); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || path.dirname(ancestor) === ancestor) throw error;
      missing.push(path.basename(ancestor));
      ancestor = path.dirname(ancestor);
    }
  }
}
function validSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false;
  const session = value as Session;
  return typeof session.id === 'string' && ID.test(session.id) && typeof session.workspace === 'string' &&
    typeof session.createdAt === 'string' && typeof session.updatedAt === 'string' && Array.isArray(session.messages) &&
    session.messages.every(message => message && typeof message === 'object' &&
      ['system', 'user', 'assistant', 'tool'].includes(message.role) && typeof message.content === 'string');
}
export function createSession(workspace: string): Session {
  const now = new Date().toISOString();
  return { id: randomUUID(), workspace: path.resolve(workspace), createdAt: now, updatedAt: now, messages: [], [REVISION]: null };
}

interface Checkpoint extends SessionMetadata {
  format: 'tbot-session-v2';
  generation: string;
  totalBytes: number;
  segments: { name: string; bytes: number; sha256: string }[];
}
function isCheckpoint(record: Session | Checkpoint): record is Checkpoint {
  return 'format' in record && record.format === 'tbot-session-v2';
}
function revision(record: Session | Checkpoint | null): string | null {
  if (!record) return null;
  return isCheckpoint(record) ? record.generation : `legacy:${createHash('sha256').update(JSON.stringify(record)).digest('hex')}`;
}

function metadataFor(session: Session): SessionMetadata {
  const first = session.messages.find(message => message.role === 'user');
  return { id: session.id, workspace: session.workspace, createdAt: session.createdAt, updatedAt: session.updatedAt,
    title: (first ? redactSecrets(first.content).slice(0, 320).replace(/\s+/g, ' ').trim().slice(0, 80) : '') || 'Yeni Oturum', messageCount: session.messages.length };
}

/** Local sessions are stored under the configured data directory, never transmitted by this store. */
export class SessionStore {
  private readonly directory: string;
  private readonly maxLoadBytes: number;
  constructor(dataDir: string, options: { maxLoadBytes?: number } = {}) {
    // Resolve aliases synchronously before queueing, including when sessions/ does not yet exist.
    this.directory = canonicalDirectory(path.join(dataDir, 'sessions'));
    this.maxLoadBytes = options.maxLoadBytes ?? DEFAULT_LOAD_BYTES;
    if (!Number.isSafeInteger(this.maxLoadBytes) || this.maxLoadBytes <= 0) throw new Error('Invalid session load budget');
  }
  private file(id: string): string {
    if (!ID.test(id)) throw new Error('Invalid session ID');
    return path.join(this.directory, `${id}.json`);
  }
  private async locked<T>(id: string, action: () => Promise<T>): Promise<T> {
    this.file(id);
    // Queue before the first await, across store instances, including filesystem lock acquisition.
    const key = workspaceKey(path.join(this.directory, id));
    const previous = queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    queues.set(key, pending);
    await previous;
    try {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      return await withFileLock(path.join(this.directory, `.${id}.lock`), action);
    } finally {
      release();
      if (queues.get(key) === pending) queues.delete(key);
    }
  }
  private ownedSegment(id: string, name: string): boolean {
    return new RegExp(`^\\.${id}\\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.[0-9]+\\.seg$`, 'i').test(name);
  }
  private async readRecord(id: string): Promise<Session | Checkpoint | null> {
    const file = this.file(id);
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid session file');
      if (stat.size > Math.max(MAX_FILE_BYTES, this.maxLoadBytes)) throw new Error(`Session exceeds metadata/read budget`);
      const value: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
      if (value && typeof value === 'object' && (value as Checkpoint).format === 'tbot-session-v2') {
        const record = value as Checkpoint;
        if (stat.size > MAX_FILE_BYTES || !validSession({ ...record, messages: [] }) || record.id !== id ||
            typeof record.generation !== 'string' || !ID.test(record.generation) ||
            typeof record.title !== 'string' || !Number.isSafeInteger(record.messageCount) || record.messageCount < 0 ||
            !Number.isSafeInteger(record.totalBytes) || record.totalBytes < 0 || !Array.isArray(record.segments) ||
            record.segments.some(segment => !segment || typeof segment.name !== 'string' || !this.ownedSegment(id, segment.name) ||
              !Number.isSafeInteger(segment.bytes) || segment.bytes <= 0 || segment.bytes > SEGMENT_BYTES ||
              typeof segment.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(segment.sha256)) ||
            new Set(record.segments.map(segment => segment.name)).size !== record.segments.length ||
            record.segments.reduce((sum, segment) => sum + segment.bytes, 0) !== record.totalBytes) throw new Error('Invalid session checkpoint');
        return record;
      }
      if (stat.size > this.maxLoadBytes) throw new Error(`Session exceeds load budget (${this.maxLoadBytes} bytes)`);
      if (!validSession(value) || value.id !== id) throw new Error('Invalid session file');
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async get(id: string, workspace: string): Promise<Session | null> {
    // A reader holds the same lock as save/delete so cleanup cannot remove its checkpoint.
    return this.locked(id, async () => {
      const record = await this.readRecord(id);
      if (!record) return null;
      if (workspaceKey(record.workspace) !== workspaceKey(workspace)) throw new Error('Session belongs to a different workspace');
      if (!isCheckpoint(record)) return { ...record, [REVISION]: revision(record) };
      if (record.totalBytes > this.maxLoadBytes) throw new Error(`Session exceeds load budget (${this.maxLoadBytes} bytes); history was preserved on disk`);
      const messages: Message[] = [];
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let fragments: string[] = [];
      for (const segment of record.segments) {
        const file = path.join(this.directory, segment.name);
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== segment.bytes) throw new Error('Invalid session segment');
        const bytes = await fs.readFile(file);
        if (bytes.length !== segment.bytes || createHash('sha256').update(bytes).digest('hex') !== segment.sha256) throw new Error('Damaged session segment');
        const chunk = decoder.decode(bytes, { stream: true });
        let newline: number;
        let start = 0;
        while ((newline = chunk.indexOf('\n', start)) >= 0) {
          fragments.push(chunk.slice(start, newline));
          const message: unknown = JSON.parse(fragments.join(''));
          if (!validSession({ ...record, messages: [message] })) throw new Error('Invalid session message');
          messages.push(message as Message);
          fragments = [];
          start = newline + 1;
        }
        if (start < chunk.length) fragments.push(chunk.slice(start));
      }
      if (decoder.decode() || fragments.length || messages.length !== record.messageCount) throw new Error('Incomplete session checkpoint');
      return { id: record.id, workspace: record.workspace, createdAt: record.createdAt, updatedAt: record.updatedAt, messages, [REVISION]: revision(record) };
    });
  }
  async list(workspace?: string): Promise<SessionMetadata[]> {
    let entries: string[];
    try { entries = await fs.readdir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const metadata: SessionMetadata[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json') || !ID.test(entry.slice(0, -5))) continue;
      try {
        const session = await this.readRecord(entry.slice(0, -5));
        if (!session || (workspace && workspaceKey(session.workspace) !== workspaceKey(workspace))) continue;
        metadata.push(isCheckpoint(session) ? { id: session.id, workspace: session.workspace, createdAt: session.createdAt,
          updatedAt: session.updatedAt, title: session.title, messageCount: session.messageCount } : metadataFor(session));
      } catch { /* A damaged session must not prevent listing the rest. */ }
    }
    return metadata.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, MAX_LIST);
  }
  async save(session: Session): Promise<void> {
    if (!validSession(session)) throw new Error('Invalid session');
    const caller = session;
    const revisionProperty = Object.getOwnPropertyDescriptor(caller, REVISION);
    if (revisionProperty ? revisionProperty.writable !== true : !Object.isExtensible(caller)) {
      throw new Error('Session must allow checkpoint revision updates');
    }
    // Capture message records before any await; a caller may append a new turn while this save runs.
    session = { ...session, messages: session.messages.map(({ images: _images, ...message }) => message) };
    await this.locked(session.id, async () => {
      const file = this.file(session.id);
      const existing = await this.readRecord(session.id);
      if (existing && workspaceKey(existing.workspace) !== workspaceKey(session.workspace)) throw new Error('Session belongs to a different workspace');
      if ((caller[REVISION] ?? null) !== revision(existing)) throw new Error('Session checkpoint conflict; reload the session before saving');
      const generation = randomUUID();
      const record: Checkpoint = { ...metadataFor(session), workspace: path.resolve(session.workspace),
        updatedAt: new Date().toISOString(),
        format: 'tbot-session-v2', generation, totalBytes: 0, segments: [] };
      const temporary = path.join(this.directory, `.${session.id}.${randomUUID()}.tmp`);
      const written: string[] = [];
      let committed = false;
      try {
        const buffer = Buffer.allocUnsafe(SEGMENT_BYTES);
        let used = 0;
        const flush = async () => {
          if (!used) return;
          const name = `.${session.id}.${generation}.${record.segments.length}.seg`;
          const segment = path.join(this.directory, name);
          await this.writeSynced(segment, buffer.subarray(0, used));
          written.push(segment);
          record.segments.push({ name, bytes: used, sha256: createHash('sha256').update(buffer.subarray(0, used)).digest('hex') });
          record.totalBytes += used;
          used = 0;
        };
        for (const message of session.messages) {
          // Redact/serialize only one message at a time, never the complete history.
          const bytes = Buffer.from(JSON.stringify(redact(message)) + '\n', 'utf8');
          for (let offset = 0; offset < bytes.length;) {
            const size = Math.min(SEGMENT_BYTES - used, bytes.length - offset);
            bytes.copy(buffer, used, offset, offset + size);
            used += size;
            offset += size;
            if (used === SEGMENT_BYTES) await flush();
          }
        }
        await flush();
        const data = JSON.stringify(record);
        if (Buffer.byteLength(data) > MAX_FILE_BYTES) throw new Error('Session checkpoint metadata is too large to save');
        await this.writeSynced(temporary, data);
        await fs.rename(temporary, file);
        committed = true;
        caller[REVISION] = generation;
      } finally {
        await fs.unlink(temporary).catch(() => undefined);
        if (!committed) await Promise.all(written.map(segment => fs.unlink(segment).catch(() => undefined)));
      }
      // Post-commit housekeeping is best effort; a cleanup failure must not report a failed save.
      await this.cleanup(session.id, new Set(record.segments.map(segment => segment.name))).catch(() => undefined);
    });
  }
  private async writeSynced(file: string, data: string | Uint8Array): Promise<void> {
    const handle = await fs.open(file, 'wx', 0o600);
    try {
      try { await handle.writeFile(data); await handle.sync(); }
      finally { await handle.close(); }
    } catch (error) {
      // Only unlink after our exclusive open succeeded; never remove a colliding existing file.
      await fs.unlink(file).catch(() => undefined);
      throw error;
    }
  }
  private async cleanup(id: string, keep: Set<string>): Promise<void> {
    for (const name of await fs.readdir(this.directory)) {
      // Only exact generated basenames for this session are eligible; never recurse.
      if (this.ownedSegment(id, name) && !keep.has(name)) await fs.unlink(path.join(this.directory, name)).catch(() => undefined);
    }
  }
  async delete(id: string, workspace: string): Promise<boolean> {
    return this.locked(id, async () => {
      const session = await this.readRecord(id);
      if (!session) return false;
      if (workspaceKey(session.workspace) !== workspaceKey(workspace)) throw new Error('Session belongs to a different workspace');
      try { await fs.unlink(this.file(id)); await this.cleanup(id, new Set()).catch(() => undefined); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
    });
  }
}
