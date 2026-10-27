import { type SecretStorageStatus } from './secrets.js';
export type McpService = 'vercel' | 'supabase' | 'github' | (string & {});
export interface McpServiceConfig {
    enabled: boolean;
    readOnly: boolean;
    project?: string;
    team?: string;
    url?: string;
    command?: string;
    args?: string[];
}
export type ConnectionConfig = McpServiceConfig;
export type McpConnections = Record<string, McpServiceConfig> & {
    vercel: McpServiceConfig;
    supabase: McpServiceConfig;
    github: McpServiceConfig;
};
export interface McpConfigFile {
    version: 2;
    services: Record<string, McpServiceConfig>;
    vercel: McpServiceConfig;
    supabase: McpServiceConfig;
    github: McpServiceConfig;
}
export type McpTokenSource = 'saved' | 'env' | 'missing';
export declare function validateService(service: string): void;
export declare function loadConnections(): Promise<McpConnections>;
export declare function saveConnection(service: McpService, patch: Partial<McpServiceConfig>): Promise<void>;
export declare function getMcpToken(service: McpService): Promise<string | undefined>;
export declare function getMcpTokenSource(service: McpService): Promise<McpTokenSource>;
export declare function setMcpToken(service: McpService, token: string): Promise<SecretStorageStatus>;
export declare function removeConnection(service: McpService): Promise<void>;
