import type { ToolDefinition } from '../types.js';
export interface StoredArtifact {
    id: string;
    bytes: number;
    sha256: string;
    truncated: boolean;
}
/**
 * Persist a large tool output outside the conversation. The model receives a
 * bounded summary plus this id, so the full result stays inspectable without
 * being resent on every turn. Credentials are redacted before persistence.
 */
export declare function storeArtifact(workspace: string, tool: string, raw: string): Promise<StoredArtifact>;
export declare function artifactHint(artifact: StoredArtifact): string;
export declare const artifactToolDefinitions: ToolDefinition[];
export declare function handleArtifactTool(name: string, args: Record<string, unknown>, workspace: string): Promise<string>;
