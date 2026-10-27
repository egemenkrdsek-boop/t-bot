import { type ChildProcess } from 'node:child_process';
import type { ToolDefinition } from '../types.js';
export interface ManagedProcess {
    processId: string;
    pid: number | undefined;
    command: string;
    cwd: string;
    startTime: number;
    status: 'running' | 'completed' | 'failed' | 'stopped';
    exitCode: number | null;
    output: string;
    child: ChildProcess;
}
export declare function stopAllBackgroundProcesses(): void;
export declare function pruneCompletedProcesses(): number;
export declare const shellToolDefinitions: ToolDefinition[];
export declare function handleShellTool(toolNameOrArgs: string | Record<string, unknown>, argsOrWorkspace?: Record<string, unknown> | string, workspaceOrSignal?: string | AbortSignal, maybeSignal?: AbortSignal): Promise<string>;
