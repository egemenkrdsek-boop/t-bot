import type { ToolDefinition } from './types.js';
export interface CheckpointMeta {
    id: string;
    path: string;
    createdAt: string;
    tool: string;
    bytes: number;
    sha256: string;
}
/** Best-effort snapshot of the previous file content. Never blocks a write. */
export declare function saveCheckpoint(workspace: string, target: string, content: string, tool: string): Promise<CheckpointMeta | undefined>;
export declare function listCheckpoints(workspace: string, limit?: number): Promise<CheckpointMeta[]>;
export declare function readCheckpoint(workspace: string, id: string): Promise<{
    meta: CheckpointMeta;
    content: string;
}>;
/** Restore one checkpoint. The dispatcher requires explicit approval first. */
export declare function restoreCheckpoint(workspace: string, id: string): Promise<{
    path: string;
    bytes: number;
}>;
export declare const checkpointToolDefinitions: ToolDefinition[];
export declare function handleCheckpointTool(name: string, args: Record<string, unknown>, workspace: string): Promise<string>;
