export interface AstSymbolItem {
    kind: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'const' | 'method';
    name: string;
    signature: string;
    startLine: number;
    endLine: number;
    exported: boolean;
}
export interface FileAstOutline {
    totalLines: number;
    symbols: AstSymbolItem[];
    imports: string[];
    exports: string[];
    formatted: string;
}
/**
 * Extracts AST symbols, line ranges [L<start>-L<end>], imports, exports, and a formatted outline.
 */
export declare function extractFileAstOutline(filePath: string, content: string): FileAstOutline;
/**
 * Detects overly broad or system directories (homedir, desktop root, AppData, etc.)
 * where generating an AST repository map would scan thousands of unrelated files.
 */
export declare function isBroadOrSystemWorkspace(ws?: string): boolean;
/** Deterministic filename selection; no disk access, embeddings or model calls. */
export declare function rankRepoPaths(paths: string[], query: string, limit?: number): string[];
/** Bounded inventory, filename selection and query-ranked source symbols. */
export declare function buildWorkspaceRepoMap(workspace: string, query?: string, maxTokens?: number): Promise<string>;
