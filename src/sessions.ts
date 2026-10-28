import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { withFileLock } from './lock.js';
import type { Message } from './types.js';

export interface Session {
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
const MAX_LIST = 200;
const SECRET_KEY = /(?:api[_-]?key|token|authorization|password|secret|credential|private[_-]?key)/i;

/** Redact common credentials before persistence. This cannot recognize every possible secret. */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, '$1 [REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,})\b/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|token|password|secret|credential|authorization)["']?\s*[=:]\s*["']?)[^\s"',;]+/gi, '$1[REDACTED]')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]');
}
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
  return { id: randomUUID(), workspace: path.resolve(workspace), createdAt: now, updatedAt: now, messages: [] };
}

/** Local sessions are stored under the configured data directory, never transmitted by this store. */
export class SessionStore {
  private readonly directory: string;
  constructor(dataDir: string) { this.directory = path.join(dataDir, 'sessions'); }
  private file(id: string): string {
    if (!ID.test(id)) throw new Error('Invalid session ID');
    return path.join(this.directory, `${id}.json`);
  }
  private async locked<T>(id: string, action: () => Promise<T>): Promise<T> {
    this.file(id);
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lock = path.join(this.directory, `.${id}.lock`);
    return withFileLock(lock, action);
  }
  private async read(id: string): Promise<Session | null> {
    const file = this.file(id);
    try {
      const stat = await fs.stat(file);
      if (stat.size > MAX_FILE_BYTES) throw new Error('Session file is too large');
      const value: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!validSession(value) || value.id !== id) throw new Error('Invalid session file');
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async get(id: string, workspace: string): Promise<Session | null> {
    const session = await this.read(id);
    if (session && workspaceKey(session.workspace) !== workspaceKey(workspace)) throw new Error('Session belongs to a different workspace');
    return session;
  }
  async list(workspace?: string): Promise<SessionMetadata[]> {
    let entries: string[];
    try { entries = await fs.readdir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const metadata: SessionMetadata[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json') || !ID.test(entry.slice(0, -5))) continue;
      try {
        const session = await this.read(entry.slice(0, -5));
        if (!session || (workspace && workspaceKey(session.workspace) !== workspaceKey(workspace))) continue;
        const first = session.messages.find(message => message.role === 'user' && typeof message.content === 'string');
        metadata.push({ id: session.id, workspace: session.workspace, createdAt: session.createdAt, updatedAt: session.updatedAt,
          title: (first?.content.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Yeni Oturum'), messageCount: session.messages.length });
      } catch { /* A damaged session must not prevent listing the rest. */ }
    }
    return metadata.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, MAX_LIST);
  }
  async save(session: Session): Promise<void> {
    if (!validSession(session)) throw new Error('Invalid session');
    await this.locked(session.id, async () => {
      const file = this.file(session.id);
      const existing = await this.read(session.id);
      if (existing && workspaceKey(existing.workspace) !== workspaceKey(session.workspace)) throw new Error('Session belongs to a different workspace');
      const messages = session.messages.map(({ images: _images, ...message }) => message);
      const clean = redact({ ...session, messages, workspace: path.resolve(session.workspace), updatedAt: new Date().toISOString() }) as Session;
      let data = JSON.stringify(clean);
      while (Buffer.byteLength(data, 'utf8') > MAX_FILE_BYTES && clean.messages.length) {
        // Remove a complete oldest user turn, including its tool calls and results.
        const next = clean.messages.findIndex((message, index) => index > 0 && message.role === 'user');
        clean.messages.splice(0, next < 0 ? clean.messages.length : next);
        data = JSON.stringify(clean);
      }
      if (Buffer.byteLength(data, 'utf8') > MAX_FILE_BYTES) throw new Error('Session metadata is too large to save');
      const temporary = path.join(this.directory, `.${session.id}.${randomUUID()}.tmp`);
      try {
        await fs.writeFile(temporary, data, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await fs.rename(temporary, file);
      } finally {
        await fs.unlink(temporary).catch(() => undefined);
      }
    });
  }
  async delete(id: string, workspace: string): Promise<boolean> {
    return this.locked(id, async () => {
      const session = await this.get(id, workspace);
      if (!session) return false;
      try { await fs.unlink(this.file(id)); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
    });
  }
}
