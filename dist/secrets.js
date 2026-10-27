import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { configDirectory } from './config.js';
export class SecretStorageError extends Error {
    code;
    constructor(code) {
        super(`Secret storage failed (${code}).`);
        this.code = code;
        this.name = 'SecretStorageError';
    }
}
export const normalizeKey = (key) => {
    const trim = (value) => value.replace(/^[\s\u200B-\u200D\u2060\uFEFF\x00-\x1F\x7F]+|[\s\u200B-\u200D\u2060\uFEFF\x00-\x1F\x7F]+$/g, '');
    const unquote = (value) => value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) ? trim(value.slice(1, -1)) : value;
    // Accept a pasted Authorization value without sending a duplicate Bearer prefix.
    let value = unquote(trim(key));
    value = trim(value.replace(/^Bearer\s+/i, ''));
    return unquote(value);
};
export function prepareApiKey(key) {
    const value = normalizeKey(key);
    if (!value || /^\*+$/.test(value) || /[\s\x00-\x1F\x7F-\x9F\u200B-\u200D\u2060\uFEFF]/u.test(value))
        throw new Error('API key is empty or contains invalid characters');
    return value;
}
const powershellPath = () => join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const secretDir = () => join(configDirectory(), 'secrets');
function secretPath(id) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id))
        throw new Error('Invalid provider ID');
    return join(secretDir(), `${id.toLowerCase()}.json`);
}
function run(command, args, input = '') {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        let output = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => { output += chunk; });
        child.stderr.resume();
        child.on('error', () => reject(new Error('Secret storage operation failed')));
        child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error('Secret storage operation failed')));
        child.stdin.on('error', () => undefined);
        child.stdin.end(input);
    });
}
async function secureDirectory() {
    const dir = secretDir();
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if (process.platform === 'win32') {
        // Replace inherited and explicit access with a rule for the current user only.
        const script = "$ErrorActionPreference='Stop'; [Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false); $p=[Console]::In.ReadToEnd(); $a=New-Object System.Security.AccessControl.DirectorySecurity; $a.SetAccessRuleProtection($true,$false); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $r=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $a.AddAccessRule($r); (New-Object System.IO.DirectoryInfo($p)).SetAccessControl($a)";
        await run(powershellPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], dir);
    }
    else
        await chmod(dir, 0o700);
}
async function dpapi(input, decrypt) {
    const action = decrypt ? 'Unprotect' : 'Protect';
    const script = `$ErrorActionPreference='Stop'; [Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false); Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($s); $r=[Security.Cryptography.ProtectedData]::${action}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
    return run(powershellPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], input);
}
export async function setApiKey(id, key) {
    const target = secretPath(id);
    key = prepareApiKey(key);
    try {
        await secureDirectory();
    }
    catch {
        throw new SecretStorageError('security');
    }
    let method = 'file';
    let value = key;
    if (process.platform === 'win32') {
        try {
            value = await dpapi(Buffer.from(key, 'utf8').toString('base64'), false);
            method = 'dpapi';
        }
        catch {
            throw new SecretStorageError('encrypt');
        }
    }
    const temp = join(secretDir(), `.secret-${randomUUID()}.tmp`);
    try {
        await writeFile(temp, JSON.stringify({ method, value }), { mode: 0o600, flag: 'wx' });
        await rename(temp, target);
    }
    catch {
        throw new SecretStorageError('save');
    }
    finally {
        await unlink(temp).catch(() => undefined);
    }
    return method === 'dpapi' ? { method } : { method, warning: 'API key is stored in a user-restricted file without encryption.' };
}
async function readSavedKey(id) {
    const path = secretPath(id);
    let raw;
    try {
        raw = await readFile(path, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw new SecretStorageError('read');
    }
    let entry;
    try {
        entry = JSON.parse(raw);
    }
    catch {
        throw new SecretStorageError('read');
    }
    if (!entry || typeof entry !== 'object' || !('method' in entry) || !('value' in entry) || typeof entry.value !== 'string')
        throw new SecretStorageError('read');
    let value;
    if (entry.method === 'file')
        value = entry.value;
    else if (entry.method === 'dpapi' && process.platform === 'win32') {
        try {
            value = Buffer.from(await dpapi(entry.value, true), 'base64').toString('utf8');
        }
        catch {
            throw new SecretStorageError('decrypt');
        }
    }
    else
        throw new SecretStorageError('decrypt');
    return normalizeKey(value) || undefined;
}
async function resolveApiKey(id) {
    // Explicitly saved provider credentials win over environment fallbacks.
    const saved = await readSavedKey(id);
    if (saved)
        return { key: saved, source: 'saved' };
    const providerKey = normalizeKey(process.env[`${id.toUpperCase().replace(/-/g, '_')}_API_KEY`] || '');
    if (providerKey)
        return { key: providerKey, source: 'provider-env' };
    const genericKey = normalizeKey(process.env.TBOT_API_KEY || '');
    return genericKey ? { key: genericKey, source: 'generic-env' } : { source: 'missing' };
}
export async function getApiKey(id) { return (await resolveApiKey(id)).key; }
export async function getApiKeySource(id) { return (await resolveApiKey(id)).source; }
export async function deleteApiKey(id) {
    try {
        await unlink(secretPath(id));
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
    }
}
//# sourceMappingURL=secrets.js.map