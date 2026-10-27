import type { McpService } from './mcp-presets.js';
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
}
export declare function connectMcp(service: McpService, token: string, options?: McpOptions): Promise<McpConnection>;
