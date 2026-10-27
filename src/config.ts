import { mkdir, open, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getApiKey } from './secrets.js';

export type WorkspacePermission = 'ask' | 'allow';
export interface AppConfig {
  provider: string;
  model: string;
  baseUrl?: string;
  workspacePermissions: Record<string, WorkspacePermission>;
}
export interface ResolvedProviderConfig { id: string; model: string; apiKey?: string; baseUrl?: string }
export const configDirectory = (): string => join(process.env.APPDATA || join(homedir(), '.config'), 'TBot');
const revisions = new WeakMap<AppConfig, string | null>();
const remember = (config: AppConfig, revision: string | null): AppConfig => { revisions.set(config, revision); return config; };
const defaultConfig = (): AppConfig => ({ provider: 'openai', model: 'gpt-4o-mini', workspacePermissions: {} });

export async function loadConfig(): Promise<AppConfig> {
  let raw: string;
  try { raw = await readFile(join(configDirectory(), 'config.json'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return remember(defaultConfig(), null); throw error; }
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid T Bot config');
  const input = value as Record<string, unknown>;
  const defaults = defaultConfig();
  if (input.provider !== undefined && typeof input.provider !== 'string') throw new Error('Invalid provider in config');
  if (input.model !== undefined && typeof input.model !== 'string') throw new Error('Invalid model in config');
  if (input.baseUrl !== undefined && typeof input.baseUrl !== 'string') throw new Error('Invalid base URL in config');
  if (input.workspacePermissions !== undefined && (!input.workspacePermissions || typeof input.workspacePermissions !== 'object' || Array.isArray(input.workspacePermissions))) throw new Error('Invalid workspace permissions in config');
  const permissions: Record<string, WorkspacePermission> = {};
  for (const [key, permission] of Object.entries((input.workspacePermissions || {}) as Record<string, unknown>)) {
    if (permission !== 'ask' && permission !== 'allow') throw new Error('Invalid workspace permission in config');
    permissions[key] = permission;
  }
  return remember({ provider: (input.provider as string | undefined) ?? defaults.provider, model: (input.model as string | undefined) ?? defaults.model, ...(input.baseUrl ? { baseUrl: input.baseUrl as string } : {}), workspacePermissions: permissions }, raw);
}

export async function saveConfig(config: AppConfig): Promise<void> {
  const dir = configDirectory();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, 'config.json');
  const lockPath = join(dir, 'config.lock');
  if (!revisions.has(config)) throw new Error('Load configuration before saving it');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Configuration is being saved; retry. If a previous process crashed, remove ${lockPath} first.`);
    throw error;
  }
  const temp = join(dir, `.config-${randomUUID()}.tmp`);
  try {
    let current: string | null;
    try { current = await readFile(path, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; current = null; }
    if (current !== revisions.get(config)) throw new Error('Configuration changed since it was loaded; reload before saving');
    // Persist only known non-secret fields.
    const value = { provider: config.provider, model: config.model, ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}), workspacePermissions: config.workspacePermissions };
    const contents = JSON.stringify(value, null, 2) + '\n';
    await writeFile(temp, contents, { mode: 0o600, flag: 'wx' });
    await rename(temp, path);
    revisions.set(config, contents);
  } finally {
    await unlink(temp).catch(() => undefined);
    try { await lock.close(); } finally { await unlink(lockPath); }
  }
}
function workspaceKey(workspace: string): string { const path = resolve(workspace); return process.platform === 'win32' ? path.toLowerCase() : path; }
export function getWorkspacePermission(config: AppConfig, workspace: string): WorkspacePermission { return config.workspacePermissions[workspaceKey(workspace)] ?? 'ask'; }
export function setWorkspacePermission(config: AppConfig, workspace: string, permission: WorkspacePermission): void { config.workspacePermissions[workspaceKey(workspace)] = permission; }
export async function resolveProviderConfig(config: AppConfig, _workspace?: string): Promise<ResolvedProviderConfig> {
  const apiKey = await getApiKey(config.provider);
  return { id: config.provider, model: config.model, ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}), ...(apiKey ? { apiKey } : {}) };
}
