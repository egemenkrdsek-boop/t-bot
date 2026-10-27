export interface ReadRangeRecord {
    startLine: number;
    endLine: number;
    turnIndex: number;
}
export interface CachedFileEntry {
    workspace: string;
    normalizedPath: string;
    hash: string;
    lines: string[];
    totalLines: number;
    reads: ReadRangeRecord[];
}
export interface DifferentialReadResult {
    cached: boolean;
    output: string;
    savedTokens: number;
}
/**
 * Differential File Read Cache (FileReadCache).
 * Tracks SHA-256 content hashes, lines, and read line ranges (startLine, endLine, turnIndex)
 * to eliminate redundant full-file or overlapping slice reads across agent turns.
 */
export declare class ContextReadCache {
    private entries;
    private turnCounter;
    checkAndRecordRead(workspace: string, relPath: string, fullContent: string, startLine: number, endLine: number, formattedSlice: string): DifferentialReadResult;
    invalidateFile(workspace: string, relPath: string): void;
    clearWorkspace(workspace?: string): void;
}
export { ContextReadCache as FileReadCache };
export declare const globalContextCache: ContextReadCache;
