import type { ToolDefinition } from '../types.js';
export declare const computerToolDefinitions: ToolDefinition[];
export declare function resetDesktopIdleTimer(): void;
/**
 * Shuts down the idle desktop daemon process to reclaim system RAM.
 * Can be invoked by memory-guard or during idle timeouts.
 */
export declare function closeIdleDesktopDaemon(): Promise<void>;
/** Native PowerShell cannot read Electron's virtual ASAR filesystem. */
export declare function resolveComputerScriptPath(defaultPath: string, resPath: string, cwd: string, exists?: (path: string) => boolean): string;
export declare function getScriptPath(): string;
export declare function executeComputerTool(name: string, args: Record<string, unknown>, workspace?: string): Promise<string>;
export declare function handleComputerTool(name: string, args: Record<string, unknown>, context: {
    workspace: string;
    signal?: AbortSignal;
}): Promise<string>;
