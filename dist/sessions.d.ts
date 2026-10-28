import type { Message } from './types.js';
export { redactSecrets } from './security/redact.js';
declare const REVISION: unique symbol;
export interface Session {
    [REVISION]?: string | null;
    id: string;
    workspace: string;
    createdAt: string;
    updatedAt: string;
    messages: Message[];
}
export interface SessionMetadata {
    id: string;
    workspace: string;
    createdAt: string;
    updatedAt: string;
    title: string;
    messageCount: number;
}
export declare function createSession(workspace: string): Session;
/** Local sessions are stored under the configured data directory, never transmitted by this store. */
export declare class SessionStore {
    private readonly directory;
    private readonly maxLoadBytes;
    constructor(dataDir: string, options?: {
        maxLoadBytes?: number;
    });
    private file;
    private locked;
    private ownedSegment;
    private readRecord;
    get(id: string, workspace: string): Promise<Session | null>;
    list(workspace?: string): Promise<SessionMetadata[]>;
    save(session: Session): Promise<void>;
    private writeSynced;
    private cleanup;
    delete(id: string, workspace: string): Promise<boolean>;
}
