import type { ToolDefinition } from '../types.js';
export declare const gitToolDefinitions: ToolDefinition[];
/** Never let Windows search the untrusted child cwd for git.exe. */
export declare function resolveGitExecutable(workspace: string, source?: NodeJS.ProcessEnv): Promise<string>;
export interface GitApprovalPreview {
    description: string;
    /** Set when the operation must be refused before the approval prompt. */
    blocked?: string;
}
/**
 * Build the approval text for git writes: staged paths, diff summary and a
 * sensitive-path refusal. Returns undefined for read-only git tools.
 */
export declare function buildGitApprovalPreview(name: string, args: Record<string, unknown>, workspace: string, signal?: AbortSignal): Promise<GitApprovalPreview | undefined>;
export declare function handleGitTool(name: string, args: Record<string, unknown>, context: {
    workspace: string;
    signal?: AbortSignal;
}): Promise<string>;
