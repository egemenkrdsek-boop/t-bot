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
}
export type McpServiceInput = McpService | McpServerDefinition | {
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
