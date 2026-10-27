import type { ToolDefinition } from '../types.js';
export declare const gitToolDefinitions: ToolDefinition[];
export declare function handleGitTool(name: string, args: Record<string, unknown>, context: {
    workspace: string;
    signal?: AbortSignal;
}): Promise<string>;
