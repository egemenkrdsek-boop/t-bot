import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
interface PackedFile {
    file: string;
    data: string;
    encoding: 'base64';
}
export declare function packWorkspaceFiles(cwd?: string): Promise<PackedFile[]>;
/** Local TBot MCP server backed by selected Vercel REST endpoints, not Vercel's hosted MCP. */
export declare function createVercelAdapter(token: string, options: {
    team?: string;
    project?: string;
    readOnly?: boolean;
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
