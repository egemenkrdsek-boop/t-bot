import { type SecretStorageStatus } from './secrets.js';
export type McpService = 'vercel' | 'supabase';
export interface ConnectionConfig {
    enabled: boolean;
    readOnly: boolean;
    project?: string;
    team?: string;
}
export type McpConnections = Record<McpService, ConnectionConfig>;
export type McpTokenSource = 'saved' | 'env' | 'missing';
export declare function loadConnections(): Promise<McpConnections>;
export declare function saveConnection(service: McpService, patch: Partial<ConnectionConfig>): Promise<void>;
export declare function getMcpToken(service: McpService): Promise<string | undefined>;
export declare function getMcpTokenSource(service: McpService): Promise<McpTokenSource>;
export declare function setMcpToken(service: McpService, token: string): Promise<SecretStorageStatus>;
export declare function removeConnection(service: McpService): Promise<void>;
