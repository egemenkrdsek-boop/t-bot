export declare function createApprovalNonce(): string;
/** A button must belong to this pending request, not merely to this bot/chat. */
export declare function parseApprovalCallback(data: string | undefined, nonce: string): boolean | undefined;
