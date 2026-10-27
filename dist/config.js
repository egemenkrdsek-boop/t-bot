import { mkdir, open, readFile, rename, writeFile, unlink, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getApiKey } from './secrets.js';
import { EFFORT_LEVELS } from './effort.js';
export const configDirectory = () => join(process.env.APPDATA || join(homedir(), '.config'), 'TBot');
const revisions = new WeakMap();
const remember = (config, revision) => { revisions.set(config, revision); return config; };
export const DEFAULT_CONFIG = { provider: 'openai', model: 'gpt-4o-mini', workspacePermissions: {} };
const defaultConfig = () => ({ ...DEFAULT_CONFIG, workspacePermissions: {} });
function isProcessAlive(pid) {
    if (!pid || isNaN(pid) || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return error.code === 'EPERM';
    }
}
async function acquireLock(lockPath) {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const handle = await open(lockPath, 'wx', 0o600);
            await handle.writeFile(String(process.pid));
            return handle;
        }
        catch (error) {
            if (error.code === 'EEXIST') {
                let isStale = false;
                try {
                    const stats = await stat(lockPath);
                    if (Date.now() - stats.mtimeMs > 30_000) {
                        isStale = true;
                    }
                    else {
                        const content = await readFile(lockPath, 'utf8').catch(() => '');
                        const pid = parseInt(content.trim(), 10);
                        if (!pid || !isProcessAlive(pid)) {
                            isStale = true;
                        }
                    }
                }
                catch {
                    isStale = true;
                }
                if (isStale) {
                    await unlink(lockPath).catch(() => undefined);
                    continue;
                }
            }
            throw error;
        }
    }
    const handle = await open(lockPath, 'wx', 0o600);
    await handle.writeFile(String(process.pid));
    return handle;
}
function validBaseUrl(value) {
    if (typeof value !== 'string' || !value.trim())
        return false;
    try {
        const url = new URL(value);
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        return (url.protocol === 'https:' || (url.protocol === 'http:' && local)) && !url.username && !url.password && !url.search && !url.hash;
    }
    catch {
        return false;
    }
}
export function normalizeConfig(input) {
    const defaults = DEFAULT_CONFIG;
    const permissions = {};
    if (input.workspacePermissions && typeof input.workspacePermissions === 'object' && !Array.isArray(input.workspacePermissions)) {
        for (const [key, permission] of Object.entries(input.workspacePermissions)) {
            if (permission === 'ask' || permission === 'allow') {
                permissions[key] = permission;
            }
        }
    }
    const efforts = {};
    if (input.efforts && typeof input.efforts === 'object' && !Array.isArray(input.efforts)) {
        for (const [key, level] of Object.entries(input.efforts)) {
            if (typeof level === 'string' && EFFORT_LEVELS.includes(level)) {
                efforts[key] = level;
            }
        }
    }
    const result = {
        provider: typeof input.provider === 'string' ? input.provider : defaults.provider,
        model: typeof input.model === 'string' ? input.model : defaults.model,
        ...(typeof input.baseUrl === 'string' && validBaseUrl(input.baseUrl) ? { baseUrl: input.baseUrl } : {}),
        workspacePermissions: permissions,
        efforts
    };
    if (typeof input.telegramBotToken === 'boolean') {
        result.telegramBotToken = input.telegramBotToken;
    }
    if (Array.isArray(input.telegramAllowedChatIds)) {
        result.telegramAllowedChatIds = input.telegramAllowedChatIds.filter((id) => typeof id === 'string');
    }
    return result;
}
// Remove malformed or credential-bearing endpoints without ever including their values in errors.
async function cleanInvalidBaseUrl(raw) {
    const dir = configDirectory();
    const path = join(dir, 'config.json');
    const lockPath = join(dir, 'config.lock');
    let lock;
    try {
        lock = await acquireLock(lockPath);
    }
    catch (error) {
        if (error.code === 'EEXIST')
            throw new Error('Configuration is being updated; retry.');
        throw error;
    }
    const temp = join(dir, `.config-${randomUUID()}.tmp`);
    try {
        const current = await readFile(path, 'utf8');
        if (current !== raw)
            throw new Error('Configuration changed while loading; retry.');
        const value = JSON.parse(current);
        delete value.baseUrl;
        const cleaned = JSON.stringify(value, null, 2) + '\n';
        await writeFile(temp, cleaned, { mode: 0o600, flag: 'wx' });
        await rename(temp, path);
        return cleaned;
    }
    finally {
        await unlink(temp).catch(() => undefined);
        if (lock) {
            try {
                await lock.close();
            }
            finally {
                await unlink(lockPath).catch(() => undefined);
            }
        }
    }
}
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
    let value = JSON.parse(raw);
    if (value && typeof value === 'object' && !Array.isArray(value) && 'baseUrl' in value && !validBaseUrl(value.baseUrl)) {
        raw = await cleanInvalidBaseUrl(raw);
        value = JSON.parse(raw);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid T Bot config');
    const input = value;
    const defaults = defaultConfig();
    if (input.provider !== undefined && typeof input.provider !== 'string')
        throw new Error('Invalid provider in config');
    if (input.model !== undefined && typeof input.model !== 'string')
        throw new Error('Invalid model in config');
    if (input.baseUrl !== undefined && !validBaseUrl(input.baseUrl))
        throw new Error('Invalid base URL in config');
    if (input.workspacePermissions !== undefined && (!input.workspacePermissions || typeof input.workspacePermissions !== 'object' || Array.isArray(input.workspacePermissions)))
        throw new Error('Invalid workspace permissions in config');
    const permissions = {};
    for (const [key, permission] of Object.entries((input.workspacePermissions || {}))) {
        if (permission !== 'ask' && permission !== 'allow')
            throw new Error('Invalid workspace permission in config');
        permissions[key] = permission;
    }
    const efforts = {};
    if (input.efforts && typeof input.efforts === 'object' && !Array.isArray(input.efforts)) {
        for (const [key, level] of Object.entries(input.efforts))
            if (typeof level === 'string' && EFFORT_LEVELS.includes(level))
                efforts[key] = level;
    }
    const telegramBotToken = typeof input.telegramBotToken === 'boolean' ? input.telegramBotToken : undefined;
    const telegramAllowedChatIds = Array.isArray(input.telegramAllowedChatIds) ? input.telegramAllowedChatIds.filter((id) => typeof id === 'string') : undefined;
    return remember({
        provider: input.provider ?? defaults.provider,
        model: input.model ?? defaults.model,
        ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
        workspacePermissions: permissions,
        efforts,
        ...(telegramBotToken !== undefined ? { telegramBotToken } : {}),
        ...(telegramAllowedChatIds ? { telegramAllowedChatIds } : {})
    }, raw);
}
export async function saveConfig(config) {
    const dir = configDirectory();
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, 'config.json');
    const lockPath = join(dir, 'config.lock');
    if (!revisions.has(config))
        throw new Error('Load configuration before saving it');
    if (config.baseUrl !== undefined && !validBaseUrl(config.baseUrl))
        throw new Error('Invalid base URL in config');
    let lock;
    try {
        lock = await acquireLock(lockPath);
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
        const value = {
            provider: config.provider,
            model: config.model,
            ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
            workspacePermissions: config.workspacePermissions,
            efforts: config.efforts ?? {},
            ...(config.telegramBotToken !== undefined ? { telegramBotToken: config.telegramBotToken } : {}),
            ...(config.telegramAllowedChatIds ? { telegramAllowedChatIds: config.telegramAllowedChatIds } : {})
        };
        const contents = JSON.stringify(value, null, 2) + '\n';
        await writeFile(temp, contents, { mode: 0o600, flag: 'wx' });
        await rename(temp, path);
        revisions.set(config, contents);
    }
    finally {
        await unlink(temp).catch(() => undefined);
        if (lock) {
            try {
                await lock.close();
            }
            finally {
                await unlink(lockPath).catch(() => undefined);
            }
        }
    }
}
function workspaceKey(workspace) { const path = resolve(workspace); return process.platform === 'win32' ? path.toLowerCase() : path; }
export function getWorkspacePermission(config, workspace) { return config.workspacePermissions[workspaceKey(workspace)] ?? 'ask'; }
export function setWorkspacePermission(config, workspace, permission) { config.workspacePermissions[workspaceKey(workspace)] = permission; }
export function getEffort(config, provider = config.provider, model = config.model) {
    const level = config.efforts?.[`${provider}:${model}`];
    return level && EFFORT_LEVELS.includes(level) ? level : 'medium';
}
export function setEffort(config, level, provider = config.provider, model = config.model) {
    if (!EFFORT_LEVELS.includes(level))
        throw new Error('Invalid effort level');
    (config.efforts ??= {})[`${provider}:${model}`] = level;
}
export async function resolveProviderConfig(config, _workspace) {
    const apiKey = await getApiKey(config.provider);
    return { id: config.provider, model: config.model, effort: getEffort(config), ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}), ...(apiKey ? { apiKey } : {}) };
}
//# sourceMappingURL=config.js.map