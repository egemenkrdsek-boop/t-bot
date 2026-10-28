import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
interface PackedFile {
    file: string;
    data: string;
    encoding: 'base64';
}
export interface WorkspacePack {
    files: PackedFile[];
    digest: string;
    bytes: number;
    /** Sensitive paths skipped by the shared credential policy. */
    sensitiveSkipped: string[];
}
/**
 * Pack workspace files for a Vercel deployment. Every path is screened by the
 * shared denylist (`.ssh`, `.aws`, `.env*`, `.git-credentials`, keys, ...);
 * sensitive files are never read or uploaded, and are reported by count only.
 */
export declare function buildWorkspacePack(cwd?: string): Promise<WorkspacePack>;
export declare function packWorkspaceFiles(cwd?: string): Promise<PackedFile[]>;
/** Local TBot MCP server backed by selected Vercel REST endpoints, not Vercel's hosted MCP. */
export declare function createVercelAdapter(token: string, options: {
    team?: string;
    project?: string;
    readOnly?: boolean;
    workspace?: string;
    signal?: AbortSignal;
}): Promise<{
    clientTransport: InMemoryTransport;
    server: Server<{
        method: string;
        params?: {
            [x: string]: unknown;
            _meta?: {
                [x: string]: unknown;
                progressToken?: string | number | undefined;
                "io.modelcontextprotocol/related-task"?: {
                    taskId: string;
                } | undefined;
            } | undefined;
        } | undefined;
    }, {
        method: string;
        params?: {
            [x: string]: unknown;
            _meta?: {
                [x: string]: unknown;
                progressToken?: string | number | undefined;
                "io.modelcontextprotocol/related-task"?: {
                    taskId: string;
                } | undefined;
            } | undefined;
        } | undefined;
    }, {
        [x: string]: unknown;
        _meta?: {
            [x: string]: unknown;
            progressToken?: string | number | undefined;
            "io.modelcontextprotocol/related-task"?: {
                taskId: string;
            } | undefined;
        } | undefined;
    }>;
}>;
export {};
