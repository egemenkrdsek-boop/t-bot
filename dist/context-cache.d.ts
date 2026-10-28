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
    lastContent?: string;
}
export type ReadCacheEntry = CachedFileEntry;
export interface DifferentialReadResult {
    cached: boolean;
    output: string;
    savedTokens: number;
}
/**
 * Line-based Differential Unified Diff Engine.
 * Produces standard @@ -L...,... +L...,... @@ diff blocks with context lines.
 */
export declare function computeUnifiedLineDiff(prevContent: string, newContent: string, contextLines?: number): string;
/**
 * Differential File Read Cache (FileReadCache).
 * Tracks SHA-256 content hashes, lines, and read line ranges (startLine, endLine, turnIndex)
 * to eliminate redundant full-file or overlapping slice reads across agent turns,
 * and produces unified line diffs when files are modified.
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
