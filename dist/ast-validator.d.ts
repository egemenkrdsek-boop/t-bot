export interface AstValidationResult {
    valid: boolean;
    error?: string;
    warnings?: string[];
}
/**
 * Resolves a relative import specifier (./ or ../) against the filesystem.
 * Supports TypeScript ESM conventions (.js -> .ts/.tsx) and index files.
 */
export declare function resolveRelativeImport(filePath: string, spec: string, workspace: string): string | null;
/**
 * Parses a target TypeScript/JavaScript module and extracts its exported symbol names.
 */
export declare function extractModuleExports(targetFilePath: string): {
    exports: Set<string>;
    hasWildcard: boolean;
};
/**
 * Deterministic in-memory AST and Grounding validator that runs BEFORE writing to disk.
 */
export declare function validateCodeAstAndGrounding(filePath: string, content: string, workspace: string): Promise<AstValidationResult>;
