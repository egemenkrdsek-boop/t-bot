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
    /** Explicit per-service user approval for a local stdio server. */
    stdioApproved?: boolean;
}
export type ConnectionConfig = McpServiceConfig;
/** Test/UI helper: names accepted by isAllowedStdioCommand. */
export declare function stdioCommandAllowlist(): string[];
export declare function isAllowedStdioCommand(command: string): boolean;
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
/** Record explicit user approval for this service's stdio command line. */
export declare function approveStdioConnection(service: McpService, approved?: boolean): Promise<void>;
export declare function revokeStdioConnection(service: McpService): Promise<void>;
export declare function getMcpToken(service: McpService): Promise<string | undefined>;
export declare function getMcpTokenSource(service: McpService): Promise<McpTokenSource>;
export declare function setMcpToken(service: McpService, token: string): Promise<SecretStorageStatus>;
export declare function removeConnection(service: McpService): Promise<void>;
