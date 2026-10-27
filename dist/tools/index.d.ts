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
export declare function getToolDefinitions(connections?: McpConnection[]): ToolDefinition[];
export declare function executeTool(call: ToolCall, context: ToolContext): Promise<string>;
