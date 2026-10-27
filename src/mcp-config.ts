import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { configDirectory } from './config.js';
import { acquireFileLock } from './lock.js';
import { deleteApiKey, normalizeKey, readSavedKey, setApiKey, type SecretStorageStatus } from './secrets.js';

export type McpService = 'vercel' | 'supabase' | 'github' | (string & {});

export interface McpServiceConfig {
  enabled: boolean;
  readOnly: boolean;
  project?: string;
  team?: string;
  url?: string;
  command?: string;
  args?: string[];
}

export type ConnectionConfig = McpServiceConfig;

export type McpConnections = Record<string, McpServiceConfig> & {
  vercel: McpServiceConfig;
  supabase: McpServiceConfig;
  github: McpServiceConfig;
};

export interface McpConfigFile {
  version: 2;
  services: Record<string, McpServiceConfig>;
  vercel: McpServiceConfig;
  supabase: McpServiceConfig;
  github: McpServiceConfig;
}

export type McpTokenSource = 'saved' | 'env' | 'missing';

const SERVICE_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,40}$/;

const defaultConnections = (): McpConnections => ({
  vercel: { enabled: false, readOnly: false },
  supabase: { enabled: false, readOnly: false },
  github: { enabled: false, readOnly: false },
});

export function validateService(service: string): void {
  if (typeof service !== 'string' || !SERVICE_NAME_PATTERN.test(service)) {
    throw new Error('Unknown MCP service');
  }
}

function parseConnection(value: unknown): McpServiceConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid MCP connection configuration');
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.enabled !== 'boolean' ||
    typeof record.readOnly !== 'boolean' ||
    (record.project !== undefined && typeof record.project !== 'string') ||
    (record.team !== undefined && typeof record.team !== 'string') ||
    (record.url !== undefined && typeof record.url !== 'string') ||
    (record.command !== undefined && typeof record.command !== 'string') ||
    (record.args !== undefined && (!Array.isArray(record.args) || !record.args.every((item) => typeof item === 'string')))
  ) {
    throw new Error('Invalid MCP connection configuration');
  }
  return {
    enabled: record.enabled,
    readOnly: record.readOnly,
    ...(record.project ? { project: record.project } : {}),
    ...(record.team ? { team: record.team } : {}),
    ...(record.url ? { url: record.url } : {}),
    ...(record.command ? { command: record.command } : {}),
    ...(Array.isArray(record.args) && record.args.length ? { args: record.args as string[] } : {}),
  };
}

async function readConnections(): Promise<{ connections: McpConnections; legacy: boolean }> {
  let raw: string;
  try {
    raw = await readFile(join(configDirectory(), 'mcp.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { connections: defaultConnections(), legacy: false };
    }
    throw error;
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('Invalid MCP connection configuration');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid MCP connection configuration');
  }

  const input = data as Record<string, unknown>;
  if (input.version !== undefined && input.version !== 2) {
    throw new Error('Unsupported MCP connection configuration version');
  }
  const legacy = input.version === undefined;
  const connections: McpConnections = defaultConnections();

  if (input.services && typeof input.services === 'object' && !Array.isArray(input.services)) {
    for (const [key, val] of Object.entries(input.services as Record<string, unknown>)) {
      if (SERVICE_NAME_PATTERN.test(key) && val !== undefined) {
        connections[key] = parseConnection(val);
      }
    }
  }

  for (const [key, val] of Object.entries(input)) {
    if (key === 'version' || key === 'services' || val === undefined) continue;
    if (SERVICE_NAME_PATTERN.test(key)) {
      connections[key] = parseConnection(val);
    }
  }

  if (legacy) {
    connections.vercel.readOnly = false;
    connections.supabase.readOnly = false;
  }

  return { connections, legacy };
}

async function updateConnections(update: (connections: McpConnections) => void): Promise<McpConnections> {
  const dir = configDirectory();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const lockPath = join(dir, 'mcp.lock');
  let releaseLock: (() => Promise<void>) | undefined;
  try {
    releaseLock = await acquireFileLock(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`MCP configuration is being updated; retry. If a process crashed, remove ${lockPath} first.`);
    }
    throw error;
  }

  const temp = join(dir, `.mcp-${randomUUID()}.tmp`);
  try {
    const { connections } = await readConnections();
    update(connections);
    const payload: McpConfigFile = {
      version: 2,
      ...connections,
      services: { ...connections },
    };
    await writeFile(temp, JSON.stringify(payload, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temp, join(dir, 'mcp.json'));
    return connections;
  } finally {
    await unlink(temp).catch(() => undefined);
    if (releaseLock) await releaseLock();
  }
}

export async function loadConnections(): Promise<McpConnections> {
  const result = await readConnections();
  return result.legacy ? updateConnections(() => undefined) : result.connections;
}

export async function saveConnection(service: McpService, patch: Partial<McpServiceConfig>): Promise<void> {
  validateService(service);
  await updateConnections((connections) => {
    const previous = connections[service] ?? { enabled: false, readOnly: false };
    // Whitelist fields: tokens and other unexpected values never enter metadata.
    connections[service] = parseConnection({
      enabled: patch.enabled ?? previous.enabled,
      readOnly: patch.readOnly ?? previous.readOnly,
      project: patch.project === undefined ? previous.project : patch.project,
      team: patch.team === undefined ? previous.team : patch.team,
      url: patch.url === undefined ? previous.url : patch.url,
      command: patch.command === undefined ? previous.command : patch.command,
      args: patch.args === undefined ? previous.args : patch.args,
    });
  });
}

async function resolveToken(service: McpService): Promise<{ token?: string; source: McpTokenSource }> {
  validateService(service);
  const saved = await readSavedKey(`mcp-${service}`);
  if (saved) return { token: saved, source: 'saved' };
  const rawEnv =
    service === 'vercel'
      ? process.env.VERCEL_TOKEN || ''
      : service === 'supabase'
        ? process.env.SUPABASE_ACCESS_TOKEN || ''
        : service === 'github'
          ? process.env.GITHUB_PERSONAL_ACCESS_TOKEN || process.env.GITHUB_TOKEN || ''
          : process.env[`MCP_${service.toUpperCase().replace(/-/g, '_')}_TOKEN`] || '';
  const env = normalizeKey(rawEnv);
  return env ? { token: env, source: 'env' } : { source: 'missing' };
}

export async function getMcpToken(service: McpService): Promise<string | undefined> {
  return (await resolveToken(service)).token;
}

export async function getMcpTokenSource(service: McpService): Promise<McpTokenSource> {
  return (await resolveToken(service)).source;
}

export async function setMcpToken(service: McpService, token: string): Promise<SecretStorageStatus> {
  validateService(service);
  return setApiKey(`mcp-${service}`, token);
}

export async function removeConnection(service: McpService): Promise<void> {
  validateService(service);
  await saveConnection(service, { enabled: false, readOnly: false, project: '', team: '', url: '', command: '', args: [] });
  await deleteApiKey(`mcp-${service}`);
}
