import { mkdir, open, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getApiKey } from './secrets.js';
export const configDirectory = () => join(process.env.APPDATA || join(homedir(), '.config'), 'TBot');
const revisions = new WeakMap();
const remember = (config, revision) => { revisions.set(config, revision); return config; };
const defaultConfig = () => ({ provider: 'openai', model: 'gpt-4o-mini', workspacePermissions: {} });
export async function loadConfig() {
    let raw;
    try {
        raw = await readFile(join(configDirectory(), 'config.json'), 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return remember(defaultConfig(), null);
        throw error;
    }
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid T Bot config');
    const input = value;
    const defaults = defaultConfig();
    if (input.provider !== undefined && typeof input.provider !== 'string')
        throw new Error('Invalid provider in config');
    if (input.model !== undefined && typeof input.model !== 'string')
        throw new Error('Invalid model in config');
    if (input.baseUrl !== undefined && typeof input.baseUrl !== 'string')
        throw new Error('Invalid base URL in config');
    if (input.workspacePermissions !== undefined && (!input.workspacePermissions || typeof input.workspacePermissions !== 'object' || Array.isArray(input.workspacePermissions)))
        throw new Error('Invalid workspace permissions in config');
    const permissions = {};
    for (const [key, permission] of Object.entries((input.workspacePermissions || {}))) {
        if (permission !== 'ask' && permission !== 'allow')
            throw new Error('Invalid workspace permission in config');
        permissions[key] = permission;
    }
    return remember({ provider: input.provider ?? defaults.provider, model: input.model ?? defaults.model, ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}), workspacePermissions: permissions }, raw);
}
export async function saveConfig(config) {
    const dir = configDirectory();
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, 'config.json');
    const lockPath = join(dir, 'config.lock');
    if (!revisions.has(config))
        throw new Error('Load configuration before saving it');
    let lock;
    try {
        lock = await open(lockPath, 'wx', 0o600);
    }
    catch (error) {
        if (error.code === 'EEXIST')
            throw new Error(`Configuration is being saved; retry. If a previous process crashed, remove ${lockPath} first.`);
        throw error;
    }
    const temp = join(dir, `.config-${randomUUID()}.tmp`);
    try {
        let current;
        try {
            current = await readFile(path, 'utf8');
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
            current = null;
        }
        if (current !== revisions.get(config))
            throw new Error('Configuration changed since it was loaded; reload before saving');
        // Persist only known non-secret fields.
        const value = { provider: config.provider, model: config.model, ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}), workspacePermissions: config.workspacePermissions };
        const contents = JSON.stringify(value, null, 2) + '\n';
        await writeFile(temp, contents, { mode: 0o600, flag: 'wx' });
        await rename(temp, path);
        revisions.set(config, contents);
    }
    finally {
        await unlink(temp).catch(() => undefined);
        try {
            await lock.close();
        }
        finally {
            await unlink(lockPath);
        }
    }
}
function workspaceKey(workspace) { const path = resolve(workspace); return process.platform === 'win32' ? path.toLowerCase() : path; }
export function getWorkspacePermission(config, workspace) { return config.workspacePermissions[workspaceKey(workspace)] ?? 'ask'; }
export function setWorkspacePermission(config, workspace, permission) { config.workspacePermissions[workspaceKey(workspace)] = permission; }
export async function resolveProviderConfig(config, _workspace) {
    const apiKey = await getApiKey(config.provider);
    return { id: config.provider, model: config.model, ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}), ...(apiKey ? { apiKey } : {}) };
}
//# sourceMappingURL=config.js.map