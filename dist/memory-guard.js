import { closeIdleBrowser } from './tools/browser.js';
/**
 * Returns current memory usage and pressure level:
 * - 'high': heapUsedMB > 160 or rssMB > 320
 * - 'moderate': heapUsedMB > 100
 * - 'low': otherwise
 */
export function getMemoryStats() {
    const usage = process.memoryUsage();
    const heapUsedMB = Math.round((usage.heapUsed / (1024 * 1024)) * 10) / 10;
    const heapTotalMB = Math.round((usage.heapTotal / (1024 * 1024)) * 10) / 10;
    const rssMB = Math.round((usage.rss / (1024 * 1024)) * 10) / 10;
    let pressure = 'low';
    if (heapUsedMB > 160 || rssMB > 320) {
        pressure = 'high';
    }
    else if (heapUsedMB > 100) {
        pressure = 'moderate';
    }
    return { heapUsedMB, heapTotalMB, rssMB, pressure };
}
/**
 * Reclaims memory when under pressure ('moderate' | 'high') or when force is true:
 * 1. Compacts older large tool outputs (>1500 chars) in session messages (preserving last 4),
 *    and clears old image attachments (preserving only the latest message's image).
 * 2. Closes idle browser instance if active.
 * 3. Triggers V8 garbage collector if available (global.gc).
 */
export async function reclaimMemory(session, force = false) {
    const beforeStats = getMemoryStats();
    const beforeMB = beforeStats.heapUsedMB;
    let compactedCount = 0;
    if (beforeStats.pressure === 'moderate' || beforeStats.pressure === 'high' || force) {
        // 1. In-place compaction of session messages
        if (session && Array.isArray(session.messages)) {
            const messages = session.messages;
            const total = messages.length;
            for (let i = 0; i < total; i++) {
                const msg = messages[i];
                let modified = false;
                // Truncate older tool outputs (>1500 chars) excluding the last 4 messages
                if (i < total - 4) {
                    if ((msg.role === 'tool' || msg.toolCallId) && typeof msg.content === 'string' && msg.content.length > 1500) {
                        const half = 750;
                        msg.content = `${msg.content.slice(0, half)}\n[Older tool output truncated; inspect again if needed.]\n${msg.content.slice(-half)}`;
                        modified = true;
                    }
                }
                // Remove images from older messages (keep only the very last message's images)
                if (i < total - 1) {
                    if (msg.images && msg.images.length > 0) {
                        delete msg.images;
                        modified = true;
                    }
                }
                if (modified) {
                    compactedCount++;
                }
            }
        }
        // 2. Close idle browser if active
        try {
            await closeIdleBrowser();
        }
        catch {
            // Ignore browser close error during memory reclaim
        }
        // 3. Trigger V8 garbage collection if enabled
        if (typeof global.gc === 'function') {
            try {
                global.gc();
            }
            catch {
                // Safe guard against GC execution issues
            }
        }
    }
    const afterStats = getMemoryStats();
    const afterMB = afterStats.heapUsedMB;
    const freedMB = Math.max(0, Math.round((beforeMB - afterMB) * 10) / 10);
    return {
        beforeMB,
        afterMB,
        freedMB,
        compactedCount,
        pressure: afterStats.pressure,
    };
}
//# sourceMappingURL=memory-guard.js.map