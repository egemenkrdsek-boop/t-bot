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
 * Builds a compact, query-ranked AST repository map within maxTokens budget.
 * Uses mtimeMs caching to avoid re-parsing unchanged files across turns.
 */
export declare function buildWorkspaceRepoMap(workspace: string, query?: string, maxTokens?: number): Promise<string>;
