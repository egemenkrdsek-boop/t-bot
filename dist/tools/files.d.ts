import type { ToolDefinition } from '../types.js';
export declare const fileToolDefinitions: ToolDefinition[];
export declare function handleFileTool(name: string, args: Record<string, unknown>, workspace: string, signal?: AbortSignal): Promise<string>;
