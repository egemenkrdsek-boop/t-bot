import type { ToolCall, ToolDefinition } from './types.js';
export type MemoryCategory = 'architecture' | 'convention' | 'bugfix' | 'preference' | 'environment';
export interface MemoryFact {
    key: string;
    value: string;
    scope: 'project' | 'global';
    updatedAt: string;
    category?: MemoryCategory;
    tags?: string[];
}
export type MemoryEntry = MemoryFact;
export interface ToolExecutionContext {
    workspace: string;
    signal?: AbortSignal;
    /** Set only after the host obtained explicit user approval for a global write. */
    approvedGlobal?: boolean;
}
export type ToolResult = string;
/**
 * Persists a key-value fact into project or global memory with optional category and tags.
 * Global scope is a persistent cross-project instruction vector and therefore
 * requires `approvedGlobal` from the host's approval boundary.
 */
export declare function rememberFact(workspace: string, key: string, value: string, scope?: 'project' | 'global', category?: MemoryCategory, tags?: string[], options?: {
    approvedGlobal?: boolean;
}): Promise<string>;
/**
 * Dispatcher contract (tools/index.ts): approve the call before execution when
 * this returns true, then pass `{ approvedGlobal: true }` in the tool context.
 */
export declare function requiresGlobalMemoryApproval(name: string, args: Record<string, unknown>): boolean;
/**
 * Recalls facts from project and global memory, with BM25/TF lexical overlap,
 * Turkish/English technical synonym expansion, and recency scoring.
 * Project entries take precedence over global entries with identical keys.
 */
export declare function recallFacts(workspace: string, query?: string): Promise<MemoryFact[]>;
/**
 * Technical synonym expanded BM25 memory retrieval alias for recallFacts.
 */
export declare const recallMemories: typeof recallFacts;
/**
 * Removes a fact by key from project and/or global memory.
 */
export declare function forgetFact(workspace: string, key: string, scope?: 'project' | 'global'): Promise<boolean>;
/**
 * Builds a rich memory context (max 2400 chars) for prompt injection,
 * including automatic discovery of AGENTS.md, CLAUDE.md, or .tbot/rules.md.
 * Returns empty string "" if neither rules nor facts exist.
 */
export declare function buildMemoryContext(workspace: string, userQuery?: string): Promise<string>;
export declare const memoryToolDefinitions: ToolDefinition[];
export declare function handleMemoryTool(call: ToolCall, workspaceOrCtx: string | ToolExecutionContext): Promise<ToolResult>;
export declare function handleMemoryTool(name: string, args: Record<string, unknown>, ctx: string | ToolExecutionContext): Promise<ToolResult>;
