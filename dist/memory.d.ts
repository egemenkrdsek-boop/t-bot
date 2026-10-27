import type { ToolDefinition } from './types.js';
export interface MemoryEntry {
    key: string;
    value: string;
    scope: 'project' | 'global';
    updatedAt: string;
}
export interface ToolExecutionContext {
    workspace: string;
    signal?: AbortSignal;
}
export type ToolResult = string;
/**
 * Persists a key-value fact into project or global memory.
 */
export declare function rememberFact(workspace: string, key: string, value: string, scope?: 'project' | 'global'): Promise<string>;
/**
 * Recalls facts from project and global memory, with optional query search.
 * Project entries take precedence over global entries with identical keys.
 */
export declare function recallFacts(workspace: string, query?: string): Promise<MemoryEntry[]>;
/**
 * Removes a fact by key from project and global memory.
 */
export declare function forgetFact(workspace: string, key: string): Promise<boolean>;
/**
 * Builds a concise memory context (max 600 chars) for prompt injection.
 * Returns empty string "" if no facts exist.
 */
export declare function buildMemoryContext(workspace: string, userQuery?: string): Promise<string>;
export declare const memoryToolDefinitions: ToolDefinition[];
export declare function handleMemoryTool(name: string, args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult>;
