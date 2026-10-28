import type { ToolDefinition } from '../types.js';
export interface VerificationCommand {
    script: string;
    command: string;
}
export declare const verifyToolDefinitions: ToolDefinition[];
/** Detect only project-declared scripts; never invent a command or run a shell string from model input. */
export declare function detectVerificationCommands(workspace: string): Promise<VerificationCommand[]>;
export declare function handleVerifyTool(name: string, args: Record<string, unknown>, workspace: string, signal?: AbortSignal, processOwner?: string): Promise<string>;
