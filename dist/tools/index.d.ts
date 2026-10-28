import type { ApprovalRequest, ToolCall, ToolDefinition } from '../types.js';
import type { McpConnection } from '../mcp.js';
import { type ImageProviderConfig } from './image.js';
export interface ToolContext {
    workspace: string;
    approve: (request: ApprovalRequest) => Promise<boolean>;
    signal?: AbortSignal;
    mcpTools?: McpConnection[];
    imageProvider?: ImageProviderConfig;
    /** Host-supplied conversation identity; never accepted from tool arguments. */
    processOwner?: string;
    [key: string]: unknown;
}
export declare function isToolResultOk(name: string, output: string): boolean;
/**
 * Fuzzy Tool and Argument Normalization (Aliases).
 * Maps tool nicknames (cat, grep, ls, bash, search_web, todo, etc.) and
 * argument aliases (filePath, cmd, q, startLine, oldText, etc.) to canonical contracts.
 */
export declare function normalizeToolCall(name: string, rawArgs: Record<string, unknown>): {
    name: string;
    args: Record<string, unknown>;
};
export declare const localToolDefinitions: ToolDefinition[];
export declare const toolDefinitions: ToolDefinition[];
export declare const READ_ONLY_TOOLS: Set<string>;
export declare function getToolDefinitions(connectionsOrPolicy?: McpConnection[] | 'all' | 'read-only', policy?: 'all' | 'read-only'): ToolDefinition[];
export declare const APPROVAL_REQUIRED_TOOLS: string[];
export declare function registerGuiKillSwitch(cb: ((reason: string) => void) | null): void;
export declare function triggerGuiKillSwitch(reason: string): void;
export declare function executeTool(call: ToolCall, context: ToolContext): Promise<string>;
export { executeComputerTool, closeIdleDesktopDaemon, handleComputerTool } from './computer.js';
