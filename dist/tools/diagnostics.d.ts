import type * as TS from 'typescript';
import type { ToolDefinition } from '../types.js';
type TSModule = typeof import('typescript');
export declare const diagnosticsToolDefinitions: ToolDefinition[];
export declare function handleDiagnosticsTool(name: string, args: Record<string, unknown>, workspace: string, signal?: AbortSignal): Promise<string>;
/** Exported for component tests without loading the compiler at module import. */
export declare function _diagnosticsInternals(): {
    defaultOptions: (ts: TSModule) => TS.CompilerOptions;
    workspaceFiles: (ts: TSModule, workspace: string) => string[];
};
export {};
