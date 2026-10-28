import { type ChildProcess } from 'node:child_process';
import type { Writable } from 'node:stream';
import type { ToolDefinition } from '../types.js';
interface ProcessScope {
    workspace: string;
    conversation: string;
    deletedAlias?: string;
}
export interface ManagedProcess {
    processId: string;
    pid: number | undefined;
    command: string;
    cwd: string;
    owner: ProcessScope;
    startTime: number;
    status: 'running' | 'completed' | 'failed' | 'stopped';
    exitCode: number | null;
    output: string;
    child: ChildProcess;
    stdin?: Writable | null;
}
/** Avoid implicitly giving model-launched programs provider and bridge secrets.
 * This is defense in depth; commands still run with the user's OS permissions. */
export declare function shellEnvironment(source?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export declare function stopAllBackgroundProcesses(): void;
export declare function pruneCompletedProcesses(): number;
export declare const shellToolDefinitions: ToolDefinition[];
export declare const SHELL_TOOLS: ToolDefinition[];
export declare const executeShellTool: typeof handleShellTool;
export declare function handleShellTool(toolNameOrArgs: string | Record<string, unknown>, argsOrWorkspace?: Record<string, unknown> | string, workspaceOrSignal?: string | AbortSignal, maybeSignal?: AbortSignal, processOwner?: string): Promise<string>;
export {};
