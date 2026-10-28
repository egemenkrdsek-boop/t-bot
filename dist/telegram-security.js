import { randomBytes } from 'node:crypto';
export function createApprovalNonce() { return randomBytes(16).toString('hex'); }
/** A button must belong to this pending request, not merely to this bot/chat. */
export function parseApprovalCallback(data, nonce) {
    if (data === `approve_yes:${nonce}`)
        return true;
    if (data === `approve_no:${nonce}`)
        return false;
    return undefined;
}
/** Approval must show the exact payload that will execute, without a hidden tail. */
export function formatApprovalArguments(args) {
    const text = JSON.stringify(args, null, 2);
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