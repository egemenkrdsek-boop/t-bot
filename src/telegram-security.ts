import { randomBytes } from 'node:crypto';

export function createApprovalNonce(): string { return randomBytes(16).toString('hex'); }

/** A button must belong to this pending request, not merely to this bot/chat. */
export function parseApprovalCallback(data: string | undefined, nonce: string): boolean | undefined {
  if (data === `approve_yes:${nonce}`) return true;
  if (data === `approve_no:${nonce}`) return false;
  return undefined;
}

/** Approval must show the exact payload that will execute, without a hidden tail. */
export function formatApprovalArguments(args: Record<string, unknown>): string {
  const text = JSON.stringify(args, null, 2);
  if (text.length > 24_000) throw new Error('Approval arguments exceed the 24000-character display limit; split the action into smaller steps.');
  return text;
}

export interface PairingChallenge { code: string; expiresAt: number; attempts: number }
export function createPairingChallenge(now = Date.now()): PairingChallenge {
  return { code: randomBytes(16).toString('hex'), expiresAt: now + 10 * 60_000, attempts: 0 };
}
/** One global budget covers all chats; restarting locally creates a fresh code. */
export function acceptPairingCode(challenge: PairingChallenge, code: string, now = Date.now()): boolean {
  if (now >= challenge.expiresAt || challenge.attempts >= 10) return false;
  challenge.attempts++;
  if (code !== challenge.code) return false;
  challenge.attempts = 10;
  return true;
}
