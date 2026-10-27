import type { ApprovalRequest, ToolCall, ToolDefinition } from '../types.js';
import type { McpConnection } from '../mcp.js';
export interface ToolContext {
    workspace: string;
    approve: (request: ApprovalRequest) => Promise<boolean>;
    signal?: AbortSignal;
    mcpTools?: McpConnection[];
}
export declare function getToolDefinitions(connections?: McpConnection[]): ToolDefinition[];
export declare function executeTool(call: ToolCall, context: ToolContext): Promise<string>;
