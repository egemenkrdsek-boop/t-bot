export declare function createApprovalNonce(): string;
/** A button must belong to this pending request, not merely to this bot/chat. */
export declare function parseApprovalCallback(data: string | undefined, nonce: string): boolean | undefined;
/** Approval must show the exact payload that will execute, without a hidden tail. */
export declare function formatApprovalArguments(args: Record<string, unknown>): string;
export interface PairingChallenge {
    code: string;
    expiresAt: number;
    attempts: number;
}
export declare function createPairingChallenge(now?: number): PairingChallenge;
/** One global budget covers all chats; restarting locally creates a fresh code. */
export declare function acceptPairingCode(challenge: PairingChallenge, code: string, now?: number): boolean;
