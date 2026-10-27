import type { ToolDefinition } from '../types.js';
export declare function resetIdleTimer(): void;
export declare function closeIdleBrowser(idleThresholdMs?: number): Promise<void>;
export declare const browserToolDefinitions: ToolDefinition[];
export declare function safeUrl(raw: string): string;
export declare function closeBrowser(): Promise<void>;
export declare function handleBrowserTool(name: string, args: Record<string, unknown>, options: {
    workspace: string;
    signal?: AbortSignal;
}): Promise<string>;
