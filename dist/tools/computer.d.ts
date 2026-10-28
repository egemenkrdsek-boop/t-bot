import type { ToolDefinition } from '../types.js';
export declare const computerToolDefinitions: ToolDefinition[];
export declare function resetDesktopIdleTimer(): void;
/**
 * Shuts down the idle desktop daemon process to reclaim system RAM.
 * Can be invoked by memory-guard or during idle timeouts.
 */
export declare function closeIdleDesktopDaemon(): Promise<void>;
export declare function handleComputerTool(name: string, args: Record<string, unknown>, context: {
    workspace: string;
    signal?: AbortSignal;
}): Promise<string>;
