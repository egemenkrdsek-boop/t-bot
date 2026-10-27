import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { configDirectory } from './config.js';
import { deleteApiKey, normalizeKey, readSavedKey, setApiKey } from './secrets.js';
const defaultConnections = () => ({ vercel: { enabled: false, readOnly: true }, supabase: { enabled: false, readOnly: true } });
function validateService(service) { if (service !== 'vercel' && service !== 'supabase')
    throw new Error('Unknown MCP service'); }
function parseConnection(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid MCP connection configuration');
    const record = value;
    if (typeof record.enabled !== 'boolean' || typeof record.readOnly !== 'boolean' || (record.project !== undefined && typeof record.project !== 'string') || (record.team !== undefined && typeof record.team !== 'string'))
        throw new Error('Invalid MCP connection configuration');
    return { enabled: record.enabled, readOnly: record.readOnly, ...(record.project ? { project: record.project } : {}), ...(record.team ? { team: record.team } : {}) };
}
export async function loadConnections() {
    let raw;
    try {
        raw = await readFile(join(configDirectory(), 'mcp.json'), 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return defaultConnections();
        throw error;
    }
    let data;
    try {
        data = JSON.parse(raw);
    }
    catch {
        throw new Error('Invalid MCP connection configuration');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new Error('Invalid MCP connection configuration');
    const input = data;
    const defaults = defaultConnections();
    return { vercel: input.vercel === undefined ? defaults.vercel : parseConnection(input.vercel), supabase: input.supabase === undefined ? defaults.supabase : parseConnection(input.supabase) };
}
export async function saveConnection(service, patch) {
    validateService(service);
    const dir = configDirectory();
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const lockPath = join(dir, 'mcp.lock');
    let lock;
    try {
        lock = await open(lockPath, 'wx', 0o600);
    }
    catch (error) {
        if (error.code === 'EEXIST')
            throw new Error(`MCP configuration is being updated; retry. If a process crashed, remove ${lockPath} first.`);
        throw error;
    }
    const temp = join(dir, `.mcp-${randomUUID()}.tmp`);
    try {
        const connections = await loadConnections();
        const previous = connections[service];
        // Whitelist fields: tokens and other unexpected values never enter metadata.
        connections[service] = parseConnection({ enabled: patch.enabled ?? previous.enabled, readOnly: patch.readOnly ?? previous.readOnly, project: patch.project === undefined ? previous.project : patch.project, team: patch.team === undefined ? previous.team : patch.team });
        await writeFile(temp, JSON.stringify(connections, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        await rename(temp, join(dir, 'mcp.json'));
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
async function resolveToken(service) {
    validateService(service);
    const saved = await readSavedKey(`mcp-${service}`);
    if (saved)
        return { token: saved, source: 'saved' };
    const env = normalizeKey(process.env[service === 'vercel' ? 'VERCEL_TOKEN' : 'SUPABASE_ACCESS_TOKEN'] || '');
    return env ? { token: env, source: 'env' } : { source: 'missing' };
}
export async function getMcpToken(service) { return (await resolveToken(service)).token; }
export async function getMcpTokenSource(service) { return (await resolveToken(service)).source; }
export async function setMcpToken(service, token) { validateService(service); return setApiKey(`mcp-${service}`, token); }
export async function removeConnection(service) { validateService(service); await saveConnection(service, { enabled: false, readOnly: true, project: '', team: '' }); await deleteApiKey(`mcp-${service}`); }
//# sourceMappingURL=mcp-config.js.map