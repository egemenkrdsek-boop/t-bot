import { realpathSync } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { configDirectory } from '../config.js';
import { describeSensitiveMatch } from './denylist.js';
const isWindows = process.platform === 'win32';
export class SensitivePathError extends Error {
    target;
    operation;
    reason;
    constructor(target, operation, reason) {
        super(`[Protected path] ${operation} is not permitted for ${target} (${reason})`);
        this.target = target;
        this.operation = operation;
        this.reason = reason;
        this.name = 'SensitivePathError';
    }
}
function canonical(value) {
    const resolved = resolve(value);
    return isWindows ? resolved.toLowerCase() : resolved;
}
function inside(root, target) {
    const rel = relative(canonical(root), canonical(target));
    return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}
function segments(value) {
    return resolve(value).split(/[\\/]+/).filter(Boolean).map(part => part.toLowerCase());
}
/**
 * Resolve symlinks, junctions and Windows 8.3 aliases for the deepest existing
 * ancestor (the leaf may not exist yet). Falls back to the lexical path when
 * the filesystem cannot answer.
 */
function canonicalExisting(value) {
    let ancestor = resolve(value);
    const missing = [];
    for (;;) {
        try {
            return join(realpathSync.native(ancestor), ...missing.reverse());
        }
        catch (error) {
            if (error.code !== 'ENOENT' || dirname(ancestor) === ancestor) {
                return resolve(value);
            }
            missing.push(basename(ancestor));
            ancestor = dirname(ancestor);
        }
    }
}
let cachedCanonicalTemp;
function canonicalTempRoot() {
    const source = tmpdir();
    if (!cachedCanonicalTemp || cachedCanonicalTemp.source !== source) {
        cachedCanonicalTemp = { source, canonical: canonicalExisting(source) };
    }
    return cachedCanonicalTemp.canonical;
}
/**
 * GitHub runners and other Windows hosts may expose the same temp tree as
 * `RUNNER~1` or `runneradmin`, and `%TEMP%` may differ from the workspace's
 * spelling. An `AppData` segment followed by `Temp`/`Tmp` is treated as temp
 * for the broad user-configuration rule only; credential file, directory and
 * extension checks below still run inside temp.
 */
function looksLikeWindowsTemp(parts) {
    const appData = parts.indexOf('appdata');
    return appData >= 0 && parts.slice(appData + 1).some(part => part === 'temp' || part === 'tmp');
}
/** T Bot data directories (config, sessions, secrets). */
function protectedRoots() {
    const roots = new Set();
    const add = (value) => { if (value)
        roots.add(resolve(value)); };
    add(process.env.APPDATA ? join(process.env.APPDATA, 'TBot') : undefined);
    add(process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'TBot') : undefined);
    add(join(homedir(), '.config', 'TBot'));
    try {
        add(configDirectory());
    }
    catch { /* config resolution is best effort here */ }
    return [...roots];
}
const CREDENTIAL_SEGMENTS = new Set(['.ssh', '.aws', '.gnupg', 'user data']);
const PROTECTED_FILES = [
    /^\.env(?:\..+)?$/,
    /^\.npmrc$/,
    /^\.git-credentials$/,
    /^\.netrc$/,
    /^\.pypirc$/,
    /^\.htpasswd$/,
    /^credentials\.json$/,
    /^id_(?:rsa|dsa|ecdsa|ed25519)$/,
    /\.(?:pem|key|p12|pfx|ppk|jks|keystore|ovpn)$/,
    // Browser credential stores.
    /^login data$/,
    /^cookies$/,
    /^web data$/,
    /^local state$/,
    /^logins\.json$/,
    /^key[34]\.db$/,
    /^cert9\.db$/,
    /^places\.sqlite$/,
];
function sensitiveReason(target) {
    const resolved = resolve(target);
    for (const root of protectedRoots()) {
        if (inside(root, resolved))
            return 'T Bot data directory';
    }
    // A workspace placed under the OS temp tree (which itself lives under
    // AppData on Windows) is not treated as a user profile directory. Compare
    // canonical paths so 8.3 aliases (`RUNNER~1`) and short/long spellings match.
    const parts = segments(resolved);
    let inTemp = inside(resolve(tmpdir()), resolved);
    if (!inTemp && (parts.includes('appdata') || parts.includes('.config') || parts.includes('temp') || parts.includes('tmp'))) {
        inTemp = inside(canonicalTempRoot(), canonicalExisting(resolved));
    }
    if (!inTemp)
        inTemp = looksLikeWindowsTemp(parts);
    if (!inTemp && (parts.includes('appdata') || parts.includes('.config'))) {
        return 'user configuration directory';
    }
    if (parts.some(part => CREDENTIAL_SEGMENTS.has(part)))
        return 'credential directory';
    const name = basename(resolved).toLowerCase();
    if (PROTECTED_FILES.some(pattern => pattern.test(name)))
        return 'credential file';
    // Shared policy used by file search, workspace packing, screenshots,
    // Telegram delivery and approval text. Keeping it last preserves the
    // existing T Bot data-directory reasons above without weakening them.
    const shared = describeSensitiveMatch(resolved);
    if (shared)
        return shared;
    return null;
}
export function isSensitivePath(target) {
    return sensitiveReason(target) !== null;
}
/**
 * Throw when a path is protected. Writes to any protected path are rejected;
 * reads are rejected too, so callers that want to allow a read must obtain
 * explicit approval before invoking the file handler.
 */
export function assertNotSensitivePath(target, options = {}) {
    const reason = sensitiveReason(target);
    if (!reason)
        return;
    throw new SensitivePathError(resolve(target), options.operation ?? 'read', reason);
}
async function realpathDeepest(value) {
    let ancestor = resolve(value);
    const missing = [];
    for (;;) {
        try {
            return join(await realpath(ancestor), ...missing.reverse());
        }
        catch (error) {
            if (error.code !== 'ENOENT' || dirname(ancestor) === ancestor)
                throw error;
            missing.push(basename(ancestor));
            ancestor = dirname(ancestor);
        }
    }
}
/**
 * Resolve a workspace-relative path and enforce containment. Rejects null
 * bytes, `..` escapes, absolute escapes and any symlink/junction in the path
 * (including a linked ancestor), case-insensitively on Windows.
 */
export async function resolveWorkspacePath(workspace, target) {
    if (typeof target !== 'string' || target.includes('\0')) {
        throw new Error('Path must not contain null bytes');
    }
    const root = await realpath(resolve(workspace));
    const candidate = isAbsolute(target) || /^[a-zA-Z]:/.test(target) ? resolve(target) : resolve(root, target);
    if (!inside(root, candidate))
        throw new Error('Path escapes workspace');
    let current = root;
    for (const part of relative(root, candidate).split(sep).filter(Boolean)) {
        current = join(current, part);
        try {
            if ((await lstat(current)).isSymbolicLink())
                throw new Error('Symbolic links are not allowed');
        }
        catch (error) {
            if (error.code === 'ENOENT')
                break;
            throw error;
        }
    }
    // Canonical containment of the deepest existing ancestor guards junction
    // and 8.3 alias escapes even when the leaf does not exist yet.
    if (!inside(root, await realpathDeepest(candidate)))
        throw new Error('Path escapes workspace');
    return candidate;
}
/**
 * Default desktop workspace. Never the home root itself.
 * Desktop main-process integration lives in the desktop module.
 */
export function defaultDesktopWorkspace(env = process.env) {
    const home = env.USERPROFILE || env.HOME || homedir();
    return join(home, 'T-Bot');
}
//# sourceMappingURL=paths.js.map