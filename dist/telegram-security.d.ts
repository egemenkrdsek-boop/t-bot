export declare function createApprovalNonce(): string;
/** Redact credential-looking values before text leaves the local process. */
export declare function redactTelegramText(text: string): string;
/** True when a generated image path must not be uploaded to Telegram. */
export declare function isSensitiveGeneratedPath(filePath: string): boolean;
/**
 * Canonical screenshot directory, or undefined when `.tbot/screenshots` is a
 * symlink/junction or otherwise escapes the workspace. Callers must skip
 * listing entirely when this returns undefined.
 */
export declare function resolvedScreenshotDirectory(workspace: string): string | undefined;
/**
 * Realpath containment for Telegram uploads. Junctions, symlinks and `..`
 * escapes fail closed; the workspace root itself is only accepted when the
 * caller explicitly asks for it (directory scans, never file uploads).
 */
export declare function isWorkspaceContainedPath(workspace: string, candidate: string, options?: {
    allowWorkspaceRoot?: boolean;
}): Promise<boolean>;
/** True when approval arguments/commands reference a credential-like path. */
export declare function approvalMentionsSensitivePath(text: string): boolean;
/** A button must belong to this pending request, not merely to this bot/chat. */
export declare function parseApprovalCallback(data: string | undefined, nonce: string): boolean | undefined;
/** Approval must show the exact payload that will execute, without a hidden tail.
 * Credential-looking values are masked first; the 24000-character limit still
 * applies to the redacted display so the payload is fully visible. */
export declare function formatApprovalArguments(args: Record<string, unknown>): string;
export interface PairingChallenge {
    code: string;
    expiresAt: number;
    attempts: number;
}
export declare function createPairingChallenge(now?: number): PairingChallenge;
/** One global budget covers all chats; restarting locally creates a fresh code. */
export declare function acceptPairingCode(challenge: PairingChallenge, code: string, now?: number): boolean;
