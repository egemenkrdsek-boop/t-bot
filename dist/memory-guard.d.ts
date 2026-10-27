import type { Session } from './sessions.js';
export interface MemoryStats {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
    pressure: 'low' | 'moderate' | 'high';
}
export interface ReclaimResult {
    beforeMB: number;
    afterMB: number;
    freedMB: number;
    compactedCount: number;
    pressure: 'low' | 'moderate' | 'high';
}
/**
 * Returns current memory usage and pressure level:
 * - 'high': heapUsedMB > 160 or rssMB > 320
 * - 'moderate': heapUsedMB > 100
 * - 'low': otherwise
 */
export declare function getMemoryStats(): MemoryStats;
/**
 * Reclaims memory when under pressure ('moderate' | 'high') or when force is true:
 * 1. Compacts older large tool outputs (>1500 chars) in session messages (preserving last 4),
 *    and clears old image attachments (preserving only the latest message's image).
 * 2. Closes idle browser instance if active.
 * 3. Triggers V8 garbage collector if available (global.gc).
 */
export declare function reclaimMemory(session?: Session, force?: boolean): Promise<ReclaimResult>;
