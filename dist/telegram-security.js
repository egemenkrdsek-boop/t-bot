import { randomBytes } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { redactSecrets } from './security/redact.js';
import { isSensitivePath, isSensitiveApprovalText } from './security/denylist.js';
import { screenshotDirectory } from './tools/screenshot-store.js';
export function createApprovalNonce() { return randomBytes(16).toString('hex'); }
/** Redact credential-looking values before text leaves the local process. */
export function redactTelegramText(text) { return redactSecrets(text); }
/** True when a generated image path must not be uploaded to Telegram. */
export function isSensitiveGeneratedPath(filePath) { return isSensitivePath(filePath); }
/**
 * Canonical screenshot directory, or undefined when `.tbot/screenshots` is a
 * symlink/junction or otherwise escapes the workspace. Callers must skip
 * listing entirely when this returns undefined.
 */
export function resolvedScreenshotDirectory(workspace) {
    try {
        return screenshotDirectory(workspace);
    }
    catch {
        return undefined;
    }
}
/**
 * Realpath containment for Telegram uploads. Junctions, symlinks and `..`
 * escapes fail closed; the workspace root itself is only accepted when the
 * caller explicitly asks for it (directory scans, never file uploads).
 */
export async function isWorkspaceContainedPath(workspace, candidate, options = {}) {
    try {
        const root = await realpath(path.resolve(workspace));
        const target = await realpath(path.resolve(candidate));
        const rel = path.relative(root, target);
        if (rel === '')
            return options.allowWorkspaceRoot === true;
        return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
    }
    catch {
        return false;
    }
}
/** True when approval arguments/commands reference a credential-like path. */
export function approvalMentionsSensitivePath(text) {
    return isSensitiveApprovalText(text);
}
/** A button must belong to this pending request, not merely to this bot/chat. */
export function parseApprovalCallback(data, nonce) {
    if (data === `approve_yes:${nonce}`)
        return true;
    if (data === `approve_no:${nonce}`)
        return false;
    return undefined;
}
/** Approval must show the exact payload that will execute, without a hidden tail.
 * Credential-looking values are masked first; the 24000-character limit still
 * applies to the redacted display so the payload is fully visible. */
export function formatApprovalArguments(args) {
    const text = redactSecrets(JSON.stringify(args, null, 2));
    if (text.length > 24_000)
        throw new Error('Approval arguments exceed the 24000-character display limit; split the action into smaller steps.');
    return text;
}
export function createPairingChallenge(now = Date.now()) {
    return { code: randomBytes(16).toString('hex'), expiresAt: now + 10 * 60_000, attempts: 0 };
}
/** One global budget covers all chats; restarting locally creates a fresh code. */
export function acceptPairingCode(challenge, code, now = Date.now()) {
    if (now >= challenge.expiresAt || challenge.attempts >= 10)
        return false;
    challenge.attempts++;
    if (code !== challenge.code)
        return false;
    challenge.attempts = 10;
    return true;
}
//# sourceMappingURL=telegram-security.js.map