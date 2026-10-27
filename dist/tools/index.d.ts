import type { ApprovalRequest, ToolCall, ToolDefinition } from '../types.js';
import type { McpConnection } from '../mcp.js';
import { type ImageProviderConfig } from './image.js';
export interface ToolContext {
    workspace: string;
    approve: (request: ApprovalRequest) => Promise<boolean>;
    signal?: AbortSignal;
    mcpTools?: McpConnection[];
    imageProvider?: ImageProviderConfig;
}
export declare const localToolDefinitions: ToolDefinition[];
export declare const toolDefinitions: ToolDefinition[];
export declare const READ_ONLY_TOOLS: Set<string>;
export declare function getToolDefinitions(connectionsOrPolicy?: McpConnection[] | 'all' | 'read-only', policy?: 'all' | 'read-only'): ToolDefinition[];
export declare function executeTool(call: ToolCall, context: ToolContext): Promise<string>;
