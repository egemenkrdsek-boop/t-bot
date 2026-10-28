import ts from 'typescript';
export interface AstValidationResult {
    valid: boolean;
    error?: string;
    warnings?: string[];
}
export declare function withPendingExportScope<T>(action: () => T): T;
export declare function getPendingCrossFileExports(): Map<string, Set<string>>;
export declare function clearPendingCrossFileExports(): void;
/**
 * Computes the Levenshtein edit distance between two strings.
 */
export declare function levenshteinDistance(a: string, b: string): number;
/**
 * Resolves a relative import specifier (./ or ../) against the filesystem.
 * Supports TypeScript ESM conventions (.js -> .ts/.tsx) and index files.
 */
export declare function resolveRelativeImport(filePath: string, spec: string, workspace: string): string | null;
/**
 * Extracts exported symbols directly from a parsed TypeScript/JavaScript SourceFile AST.
 */
export declare function extractExportsFromSourceFile(sourceFile: ts.SourceFile, content: string): {
    exports: Set<string>;
    hasWildcard: boolean;
};
/**
 * Parses a target TypeScript/JavaScript module and extracts its exported symbol names.
 */
export declare function extractModuleExports(targetFilePath: string): {
    exports: Set<string>;
    hasWildcard: boolean;
};
/**
 * Validates structural syntax (bracket balance, quote closures, comment integrity)
 * for Go, Rust, Shell, PowerShell, CSS and HTML files.
 */
export declare function validateMultiLangSyntax(filePath: string, content: string, ext: string): AstValidationResult;
/**
 * Deterministic in-memory AST and Grounding validator that runs BEFORE writing to disk.
 */
export declare function validateCodeAstAndGrounding(filePath: string, content: string, workspace: string): Promise<AstValidationResult>;
