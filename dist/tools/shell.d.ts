import type { ToolDefinition } from '../types.js';
export declare const shellToolDefinitions: ToolDefinition[];
export declare function handleShellTool(args: Record<string, unknown>, workspace: string, signal?: AbortSignal): Promise<string>;
