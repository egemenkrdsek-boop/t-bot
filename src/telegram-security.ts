import { randomBytes } from 'node:crypto';

export function createApprovalNonce(): string { return randomBytes(16).toString('hex'); }

/** A button must belong to this pending request, not merely to this bot/chat. */
export function parseApprovalCallback(data: string | undefined, nonce: string): boolean | undefined {
  if (data === `approve_yes:${nonce}`) return true;
  if (data === `approve_no:${nonce}`) return false;
  return undefined;
}
