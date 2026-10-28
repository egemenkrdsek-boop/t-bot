import type { ToolDefinition } from '../types.js';
/**
 * Deterministic tool-definition registry.
 *
 * The same tool name may arrive from several sources (local modules, workflow
 * tools appended by the agent, MCP catalogs). Sending a name twice makes
 * providers reject the request and wastes schema tokens, so the dispatcher
 * builds one registry and reads definitions from it. Earlier definitions win:
 * the caller's array order is the priority order (local before remote).
 */
export interface ToolDefinitionDuplicate {
    name: string;
    /** Index of the definition that the registry kept. */
    keptIndex: number;
    /** Indexes of definitions that were ignored. */
    droppedIndexes: number[];
}
export interface ToolRegistryBuildResult {
    registry: Map<string, ToolDefinition>;
    duplicates: ToolDefinitionDuplicate[];
}
export declare function buildToolRegistryWithReport(defs: ToolDefinition[]): ToolRegistryBuildResult;
export declare function buildToolRegistry(defs: ToolDefinition[]): Map<string, ToolDefinition>;
export declare function uniqueToolDefinitions(defs: ToolDefinition[]): ToolDefinition[];
export declare function getToolDefinition(registry: Map<string, ToolDefinition>, name: string): ToolDefinition | undefined;
