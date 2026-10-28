import type { McpService, McpServerDefinition } from './mcp-presets.js';
import type { ToolCall, ToolDefinition } from './types.js';
export interface McpConnection {
    service: McpService;
    definitions: ToolDefinition[];
    execute(call: ToolCall, signal?: AbortSignal): Promise<string>;
    close(): Promise<void>;
}
export interface McpOptions {
    signal?: AbortSignal;
    readOnly?: boolean;
    project?: string;
    team?: string;
    url?: string;
    command?: string;
    args?: string[];
    workspace?: string;
    /** Explicit approval for starting this local stdio server. */
    stdioApproved?: boolean;
    /** Host UI callback; without it (or a saved approval) stdio is refused. */
    approve?: (request: McpStdioApprovalRequest) => Promise<boolean>;
}
export interface McpStdioApprovalRequest {
    service: string;
    command: string;
    args: string[];
    cwd: string;
}
type McpStdioApprover = (request: McpStdioApprovalRequest) => Promise<boolean>;
/**
 * Hosts (desktop/main, CLI) register their approval dialog here. A stdio MCP
 * server is never spawned without either this callback, a per-call approver or
 * a persisted `stdioApproved` flag the user set explicitly.
 */
export declare function registerMcpStdioApproval(approver: McpStdioApprover | undefined): void;
export type McpServiceInput = McpService | (string & {}) | McpServerDefinition | {
    id?: string;
    name?: string;
    url?: string;
    command?: string;
    args?: string[];
    [key: string]: unknown;
};
export declare function parseStdioCommand(raw: string): {
    command: string;
    args: string[];
};
export declare function connectMcp(service: McpServiceInput, token?: string, options?: McpOptions): Promise<McpConnection>;
export {};
