import type { ToolDefinition } from '../types.js';
export declare const gitToolDefinitions: ToolDefinition[];
/** Never let Windows search the untrusted child cwd for git.exe. */
export declare function resolveGitExecutable(workspace: string, source?: NodeJS.ProcessEnv): Promise<string>;
export declare function handleGitTool(name: string, args: Record<string, unknown>, context: {
    workspace: string;
    signal?: AbortSignal;
}): Promise<string>;
