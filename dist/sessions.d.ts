import type { Message } from './types.js';
export interface Session {
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
/** Redact common credentials before persistence. This cannot recognize every possible secret. */
export declare function redactSecrets(text: string): string;
export declare function createSession(workspace: string): Session;
/** Local sessions are stored under the configured data directory, never transmitted by this store. */
export declare class SessionStore {
    private readonly directory;
    constructor(dataDir: string);
    private file;
    private locked;
    private read;
    get(id: string, workspace: string): Promise<Session | null>;
    list(workspace?: string): Promise<SessionMetadata[]>;
    save(session: Session): Promise<void>;
    delete(id: string, workspace: string): Promise<boolean>;
}
