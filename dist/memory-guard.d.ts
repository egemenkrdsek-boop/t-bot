import type { Session } from './sessions.js';
export interface MemoryStats {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
    systemTotalMB: number;
    systemFreeMB: number;
    systemUsedPercent: number;
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
 * Trims physical working set memory using Win32 EmptyWorkingSet API on Windows.
 * Runs with a 20-second cooldown and a 5-second timeout, failing silently if an error occurs.
 */
export declare function trimWindowsWorkingSet(): Promise<void>;
/**
 * Returns current memory usage and pressure level:
 * - 'high': heapUsedMB > 140 or rssMB > 280 or systemUsedPercent > 82
 * - 'moderate': heapUsedMB > 90 or rssMB > 200 or systemUsedPercent > 70
 * - 'low': otherwise
 */
export declare function getMemoryStats(): MemoryStats;
/**
 * Reclaims memory when under pressure ('moderate' | 'high') or when force is true:
 * 0. Prunes completed shell processes and their buffers.
 * 1. Compacts older large tool outputs (>1500 chars) in session messages (preserving last 4),
 *    and clears old image attachments (preserving only the latest message's image).
 * 2. Closes idle browser instance if active.
 * 3. Triggers V8 garbage collector if available (global.gc).
 * 4. Trims Windows physical working set if force is true or before.pressure !== 'low'.
 */
export declare function reclaimMemory(session?: Session, force?: boolean): Promise<ReclaimResult>;
/**
 * Starts automatic memory guard running every 20 seconds.
 * Triggers reclaimMemory when memory pressure is moderate or high.
 */
export declare function startAutoMemoryGuard(getSession?: () => Session | undefined): void;
/**
 * Stops the automatic memory guard timer.
 */
export declare function stopAutoMemoryGuard(): void;
