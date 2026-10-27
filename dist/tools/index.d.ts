import type { ApprovalRequest, ToolCall, ToolDefinition } from '../types.js';
export interface ToolContext {
    workspace: string;
    approve: (request: ApprovalRequest) => Promise<boolean>;
    signal?: AbortSignal;
}
export declare function getToolDefinitions(): ToolDefinition[];
export declare function executeTool(call: ToolCall, context: ToolContext): Promise<string>;
