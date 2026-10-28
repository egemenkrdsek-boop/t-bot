import type { Session } from './sessions.js';
export interface MemoryStats {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
    systemTotalMB: number;
    systemFreeMB: number;
    systemUsedPercent: number;
    pressure: 'low' | 'moderate' | 'high' | 'critical';
}
export interface ReclaimResult {
    beforeMB: number;
    afterMB: number;
    freedMB: number;
    compactedCount: number;
    pressure: 'low' | 'moderate' | 'high' | 'critical';
}
/**
 * Trims physical working set memory of the current T Bot process using Win32 EmptyWorkingSet API on Windows.
 * Caches the compiled helper assembly on disk to avoid repeated csc.exe invocations.
 * Enforces a 120-second cooldown unless force is true.
 */
export declare function trimWindowsWorkingSet(force?: boolean): Promise<void>;
/**
 * Returns current memory usage and pressure level based on T Bot process memory or critical system free RAM:
 * - 'high': heapUsedMB > 220 or rssMB > 420 or systemFreeMB < 512
 * - 'moderate': heapUsedMB > 140 or rssMB > 280
 * - 'low': otherwise
 */
export declare function getMemoryStats(): MemoryStats;
/**
 * Reclaims memory when under pressure ('moderate' | 'high') or when force is true:
 * 0. Prunes completed shell processes and their buffers.
 * 1. Releases old image attachments while retaining the latest three image messages and current user image.
 *    Transcript text stays authoritative; provider context selection owns temporary history reduction.
 * 2. Closes idle browser instance if active.
 * 3. Triggers V8 garbage collector if available (global.gc).
 * 4. Trims Windows physical working set if force is true or beforeStats.pressure === 'high'.
 */
export declare function reclaimMemory(session?: Session, force?: boolean): Promise<ReclaimResult>;
/**
 * Starts automatic memory guard running every 30 seconds.
 * Triggers reclaimMemory only when memory pressure is high or heapUsedMB > 160.
 */
export declare function startAutoMemoryGuard(getSession?: () => Session | undefined): void;
/**
 * Stops the automatic memory guard timer.
 */
export declare function stopAutoMemoryGuard(): void;
