import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { configDirectory } from './config.js';

export type ProviderId = string;
const secretCache = new Map<ProviderId | string, string>();

export class SecretStorageError extends Error {
  constructor(public readonly code: 'security' | 'encrypt' | 'decrypt' | 'read' | 'save') {
    super(`Secret storage failed (${code}).`);
    this.name = 'SecretStorageError';
  }
}
export interface SecretStorageStatus { method: 'dpapi' | 'file'; warning?: string }
export type ApiKeySource = 'saved' | 'provider-env' | 'generic-env' | 'missing';

export const normalizeKey = (key: string): string => {
  const trim = (value: string) => value.replace(/^[\s\u200B-\u200D\u2060\uFEFF\x00-\x1F\x7F]+|[\s\u200B-\u200D\u2060\uFEFF\x00-\x1F\x7F]+$/g, '');
  const unquote = (value: string) => value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) ? trim(value.slice(1, -1)) : value;
  // Accept a pasted Authorization value without sending a duplicate Bearer prefix.
  let value = unquote(trim(key));
  value = trim(value.replace(/^Bearer\s+/i, ''));
  return unquote(value);
};

export function prepareApiKey(key: string): string {
  const value = normalizeKey(key);
  if (!value || /^\*+$/.test(value) || /[\s\x00-\x1F\x7F-\x9F\u200B-\u200D\u2060\uFEFF]/u.test(value)) throw new Error('API key is empty or contains invalid characters');
  return value;
}

const powershellPath = () => join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const secretDir = () => join(configDirectory(), 'secrets');

function secretPath(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid secret or provider ID');
  return join(secretDir(), `${id.toLowerCase()}.json`);
}

function run(command: string, args: string[], input = ''): Promise<string> {
  const TIMEOUT_MS = 10_000;
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      reject(new SecretStorageError('security'));
    }, TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { output += chunk; });
    child.stderr.resume();
    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('Secret storage operation failed'));
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      code === 0 ? resolve(output.trim()) : reject(new Error('Secret storage operation failed'));
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}

async function secureDirectory(): Promise<void> {
  const dir = secretDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    // Replace inherited and explicit access with a rule for the current user only.
    const script = "$ErrorActionPreference='Stop'; [Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false); $p=[Console]::In.ReadToEnd(); $a=New-Object System.Security.AccessControl.DirectorySecurity; $a.SetAccessRuleProtection($true,$false); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $r=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $a.AddAccessRule($r); (New-Object System.IO.DirectoryInfo($p)).SetAccessControl($a)";
    await run(powershellPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], dir);
  } else await chmod(dir, 0o700);
}

async function dpapi(input: string, decrypt: boolean): Promise<string> {
  const action = decrypt ? 'Unprotect' : 'Protect';
  const script = `$ErrorActionPreference='Stop'; [Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false); Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($s); $r=[Security.Cryptography.ProtectedData]::${action}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  return run(powershellPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], input);
}

export async function setApiKey(id: string, key: string): Promise<SecretStorageStatus> {
  const target = secretPath(id);
  key = prepareApiKey(key);
  try { await secureDirectory(); } catch { throw new SecretStorageError('security'); }
  let method: 'dpapi' | 'file' = 'file';
  let value = key;
  if (process.platform === 'win32') {
    try { value = await dpapi(Buffer.from(key, 'utf8').toString('base64'), false); method = 'dpapi'; }
    catch { throw new SecretStorageError('encrypt'); }
  }
  const temp = join(secretDir(), `.secret-${randomUUID()}.tmp`);
  try { await writeFile(temp, JSON.stringify({ method, value }), { mode: 0o600, flag: 'wx' }); await rename(temp, target); }
  catch { throw new SecretStorageError('save'); }
  finally { await unlink(temp).catch(() => undefined); }
  secretCache.set(id, key);
  return method === 'dpapi' ? { method } : { method, warning: 'API key is stored in a user-restricted file without encryption.' };
}

export async function readSavedKey(id: string): Promise<string | undefined> {
  if (secretCache.has(id)) return secretCache.get(id);
  const path = secretPath(id);
  let raw: string;
  try { raw = await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw new SecretStorageError('read'); }
  let entry: unknown;
  try { entry = JSON.parse(raw); } catch { throw new SecretStorageError('read'); }
  if (!entry || typeof entry !== 'object' || !('method' in entry) || !('value' in entry) || typeof entry.value !== 'string') throw new SecretStorageError('read');
  let value: string;
  if (entry.method === 'file') value = entry.value;
  else if (entry.method === 'dpapi' && process.platform === 'win32') {
    try { value = Buffer.from(await dpapi(entry.value, true), 'base64').toString('utf8'); } catch { throw new SecretStorageError('decrypt'); }
  } else throw new SecretStorageError('decrypt');
  const normalized = normalizeKey(value) || undefined;
  if (normalized) secretCache.set(id, normalized);
  return normalized;
}

async function resolveApiKey(id: string): Promise<{ key?: string; source: ApiKeySource }> {
  if (secretCache.has(id)) {
    return { key: secretCache.get(id), source: 'saved' };
  }
  // Explicitly saved provider credentials win over environment fallbacks.
  const saved = await readSavedKey(id);
  if (saved) return { key: saved, source: 'saved' };
  const providerKey = normalizeKey(process.env[`${id.toUpperCase().replace(/-/g, '_')}_API_KEY`] || '');
  if (providerKey) return { key: providerKey, source: 'provider-env' };
  const genericKey = normalizeKey(process.env.TBOT_API_KEY || '');
  return genericKey ? { key: genericKey, source: 'generic-env' } : { source: 'missing' };
}

export async function getApiKey(id: string): Promise<string | undefined> { return (await resolveApiKey(id)).key; }
export async function getApiKeySource(id: string): Promise<ApiKeySource> { return (await resolveApiKey(id)).source; }

export async function deleteApiKey(id: string): Promise<void> {
  secretCache.delete(id);
  try { await unlink(secretPath(id)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

export async function getSecret(id: ProviderId | string): Promise<string | undefined> {
  if (secretCache.has(id)) return secretCache.get(id);
  const key = await getApiKey(id);
  if (key) secretCache.set(id, key);
  return key;
}

export async function setSecret(id: ProviderId | string, key: string): Promise<SecretStorageStatus> {
  const result = await setApiKey(id, key);
  secretCache.set(id, prepareApiKey(key));
  return result;
}

export async function deleteSecret(id: ProviderId | string): Promise<void> {
  secretCache.delete(id);
  await deleteApiKey(id);
}

function toCustomId(name: string): string {
  const clean = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  if (!clean) throw new Error('Invalid secret name');
  return clean.startsWith('custom-') ? clean : `custom-${clean}`;
}

export async function getCustomSecret(name: string): Promise<string | undefined> {
  const id = toCustomId(name);
  if (secretCache.has(id)) return secretCache.get(id);
  if (secretCache.has(name)) return secretCache.get(name);
  const val = await readSavedKey(id);
  if (val !== undefined) {
    secretCache.set(name, val);
    return val;
  }
  const rawId = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  if (rawId && rawId !== id) {
    const rawVal = await readSavedKey(rawId);
    if (rawVal !== undefined) {
      secretCache.set(name, rawVal);
      return rawVal;
    }
  }
  return undefined;
}

export async function setCustomSecret(name: string, value: string): Promise<void> {
  const id = toCustomId(name);
  await setApiKey(id, value);
  const prepared = prepareApiKey(value);
  secretCache.set(id, prepared);
  secretCache.set(name, prepared);
}

export async function deleteCustomSecret(name: string): Promise<void> {
  const id = toCustomId(name);
  secretCache.delete(id);
  secretCache.delete(name);
  await deleteApiKey(id);
  const rawId = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  if (rawId && rawId !== id) {
    await deleteApiKey(rawId).catch(() => undefined);
  }
}
