import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ToolDefinition } from './types.js';

export interface MemoryEntry {
  key: string;
  value: string;
  scope: 'project' | 'global';
  updatedAt: string;
}

export interface ToolExecutionContext {
  workspace: string;
  signal?: AbortSignal;
}

export type ToolResult = string;

function getProjectMemoryPath(workspace: string): string {
  return join(resolve(workspace), '.tbot', 'memory.json');
}

function getGlobalMemoryPath(): string {
  const base = process.env.APPDATA || (process.platform === 'win32'
    ? join(homedir(), 'AppData', 'Roaming')
    : join(homedir(), '.config'));
  return join(base, 'TBot', 'memory.json');
}

async function readMemoryFile(filePath: string): Promise<MemoryEntry[]> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(item =>
        item &&
        typeof item.key === 'string' &&
        typeof item.value === 'string' &&
        (item.scope === 'project' || item.scope === 'global') &&
        typeof item.updatedAt === 'string'
      );
    }
    return [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    return [];
  }
}

async function writeMemoryFile(filePath: string, entries: MemoryEntry[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  const data = JSON.stringify(entries, null, 2);
  try {
    await writeFile(tmpPath, data, 'utf8');
    await rename(tmpPath, filePath);
  } catch {
    // Fallback for Windows if rename fails due to file locking/concurrency
    await writeFile(filePath, data, 'utf8');
    await unlink(tmpPath).catch(() => {});
  }
}

/**
 * Persists a key-value fact into project or global memory.
 */
export async function rememberFact(
  workspace: string,
  key: string,
  value: string,
  scope?: 'project' | 'global'
): Promise<string> {
  const cleanKey = key.trim();
  const cleanVal = value.trim();
  if (!cleanKey) throw new Error('Memory key cannot be empty.');
  if (!cleanVal) throw new Error('Memory value cannot be empty.');

  const targetScope: 'project' | 'global' = scope === 'global' ? 'global' : 'project';
  const filePath = targetScope === 'global' ? getGlobalMemoryPath() : getProjectMemoryPath(workspace);

  const entries = await readMemoryFile(filePath);
  const existingIdx = entries.findIndex(e => e.key.toLowerCase() === cleanKey.toLowerCase());

  const entry: MemoryEntry = {
    key: cleanKey,
    value: cleanVal,
    scope: targetScope,
    updatedAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    entries[existingIdx] = entry;
  } else {
    entries.push(entry);
  }

  await writeMemoryFile(filePath, entries);
  return `Saved to ${targetScope} memory: ${cleanKey}`;
}

/**
 * Recalls facts from project and global memory, with optional query search.
 * Project entries take precedence over global entries with identical keys.
 */
export async function recallFacts(workspace: string, query?: string): Promise<MemoryEntry[]> {
  const [projectEntries, globalEntries] = await Promise.all([
    readMemoryFile(getProjectMemoryPath(workspace)),
    readMemoryFile(getGlobalMemoryPath()),
  ]);

  const map = new Map<string, MemoryEntry>();
  for (const entry of globalEntries) {
    map.set(entry.key.toLowerCase(), entry);
  }
  for (const entry of projectEntries) {
    map.set(entry.key.toLowerCase(), entry);
  }

  let all = Array.from(map.values());

  if (query && query.trim()) {
    const q = query.trim().toLowerCase();
    all = all.filter(e =>
      e.key.toLowerCase().includes(q) ||
      e.value.toLowerCase().includes(q)
    );
  }

  all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return all;
}

/**
 * Removes a fact by key from project and global memory.
 */
export async function forgetFact(workspace: string, key: string): Promise<boolean> {
  const cleanKey = key.trim().toLowerCase();
  if (!cleanKey) return false;

  const projectPath = getProjectMemoryPath(workspace);
  const globalPath = getGlobalMemoryPath();

  const [projectEntries, globalEntries] = await Promise.all([
    readMemoryFile(projectPath),
    readMemoryFile(globalPath),
  ]);

  let removed = false;

  const newProject = projectEntries.filter(e => {
    if (e.key.toLowerCase() === cleanKey) {
      removed = true;
      return false;
    }
    return true;
  });

  const newGlobal = globalEntries.filter(e => {
    if (e.key.toLowerCase() === cleanKey) {
      removed = true;
      return false;
    }
    return true;
  });

  if (newProject.length !== projectEntries.length) {
    await writeMemoryFile(projectPath, newProject);
  }
  if (newGlobal.length !== globalEntries.length) {
    await writeMemoryFile(globalPath, newGlobal);
  }

  return removed;
}

/**
 * Builds a concise memory context (max 600 chars) for prompt injection.
 * Returns empty string "" if no facts exist.
 */
export async function buildMemoryContext(workspace: string, userQuery?: string): Promise<string> {
  let facts = await recallFacts(workspace, userQuery);
  if (!facts.length && userQuery) {
    facts = await recallFacts(workspace);
  }
  if (!facts.length) return '';

  const header = '[Memory Context]';
  const lines: string[] = [header];
  let currentLength = header.length;

  for (const f of facts) {
    const line = `- ${f.key}: ${f.value}`;
    if (currentLength + 1 + line.length > 600) {
      const remaining = 600 - (currentLength + 1);
      if (remaining > 15) {
        lines.push(`${line.slice(0, remaining - 3)}...`);
      }
      break;
    }
    lines.push(line);
    currentLength += 1 + line.length;
  }

  if (lines.length <= 1) return '';
  const result = lines.join('\n');
  return result.length > 600 ? result.slice(0, 600) : result;
}

export const memoryToolDefinitions: ToolDefinition[] = [
  {
    name: 'memory_save',
    description: 'Save a persistent key-value fact or user preference to memory (project or global scope).',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Identifier or topic for the fact' },
        value: { type: 'string', description: 'Fact or instruction to remember' },
        scope: { type: 'string', enum: ['project', 'global'], description: 'Storage scope: "project" (current workspace) or "global" (all projects). Defaults to "project".' },
      },
      required: ['key', 'value'],
      additionalProperties: false,
    },
  },
  {
    name: 'memory_recall',
    description: 'Recall saved persistent facts and preferences matching an optional search query.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional keyword or topic to search for' },
      },
      additionalProperties: false,
    },
  },
];

export async function handleMemoryTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<ToolResult> {
  if (ctx.signal?.aborted) throw new Error('Operation cancelled');

  if (name === 'memory_save') {
    const key = typeof args.key === 'string' ? args.key.trim() : '';
    const value = typeof args.value === 'string' ? args.value.trim() : '';
    const scope = args.scope === 'global' ? 'global' : 'project';

    if (!key) throw new Error('Parameter "key" is required.');
    if (!value) throw new Error('Parameter "value" is required.');

    return await rememberFact(ctx.workspace, key, value, scope);
  }

  if (name === 'memory_recall') {
    const query = typeof args.query === 'string' ? args.query.trim() : undefined;
    const facts = await recallFacts(ctx.workspace, query);
    if (!facts.length) {
      return query ? `No memories found matching "${query}".` : 'No saved memories found.';
    }
    return facts.map(f => `[${f.scope}] ${f.key}: ${f.value}`).join('\n');
  }

  throw new Error(`Unknown memory tool: ${name}`);
}
