import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { configDirectory } from './config.js';
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
        const script = "$ErrorActionPreference='Stop'; $p=[Console]::In.ReadToEnd(); $a=New-Object System.Security.AccessControl.DirectorySecurity; $a.SetAccessRuleProtection($true,$false); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $r=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $a.AddAccessRule($r); Set-Acl -LiteralPath $p -AclObject $a";
        await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], dir);
    }
    else
        await chmod(dir, 0o700);
}
async function dpapi(input, decrypt) {
    const action = decrypt ? 'Unprotect' : 'Protect';
    const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($s); $r=[Security.Cryptography.ProtectedData]::${action}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
    return run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], input);
}
export async function setApiKey(id, key) {
    const target = secretPath(id);
    if (!key.trim())
        throw new Error('API key must not be empty');
    await secureDirectory();
    let method = 'file';
    let value = key;
    if (process.platform === 'win32') {
        try {
            value = await dpapi(Buffer.from(key, 'utf8').toString('base64'), false);
            method = 'dpapi';
        }
        catch { /* Fall back to the restricted directory. */ }
    }
    const temp = join(secretDir(), `.secret-${randomUUID()}.tmp`);
    try {
        await writeFile(temp, JSON.stringify({ method, value }), { mode: 0o600, flag: 'wx' });
        await rename(temp, target);
    }
    finally {
        await unlink(temp).catch(() => undefined);
    }
    return method === 'dpapi' ? { method } : { method, warning: 'API key is stored in a user-restricted file without encryption.' };
}
export async function getApiKey(id) {
    const path = secretPath(id);
    const envKey = process.env[`${id.toUpperCase().replace(/-/g, '_')}_API_KEY`] || process.env.TBOT_API_KEY;
    if (envKey)
        return envKey;
    let raw;
    try {
        raw = await readFile(path, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
    const entry = JSON.parse(raw);
    if (!entry || typeof entry !== 'object' || !('method' in entry) || !('value' in entry) || typeof entry.value !== 'string')
        throw new Error('Invalid secret storage format');
    if (entry.method === 'file')
        return entry.value;
    if (entry.method === 'dpapi' && process.platform === 'win32')
        return Buffer.from(await dpapi(entry.value, true), 'base64').toString('utf8');
    throw new Error('Cannot decrypt the stored API key on this platform');
}
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