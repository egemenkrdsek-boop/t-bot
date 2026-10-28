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
export declare const MAX_INSPECT_ELEMENTS = 80;
export interface SessionWindow {
    id: string;
    handle: string;
    title: string;
    process: string;
}
/**
 * Flexible normalizer for model arguments.
 * Eliminates strict errors and accommodates all LLM variations.
 */
export declare function normalizeComputerArgs(rawArgs: Record<string, unknown>): {
    action: string;
    handle?: string;
    target?: string;
    windowTitle?: string;
    processName?: string;
    timeoutMs?: number;
    auto_screenshot?: boolean;
    x?: number;
    y?: number;
    to_x?: number;
    to_y?: number;
    button?: string;
    text?: string;
    key?: string;
    delta?: number;
    press_enter?: boolean;
    waitDurationMs?: number;
};
export declare function executeComputerTool(name: string, args: Record<string, unknown>, workspace?: string): Promise<string>;
export declare function handleComputerTool(name: string, args: Record<string, unknown>, context: {
    workspace: string;
    signal?: AbortSignal;
}): Promise<string>;
