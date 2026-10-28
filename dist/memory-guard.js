import os, { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { closeIdleBrowser } from './tools/browser.js';
import { closeIdleDesktopDaemon } from './tools/computer.js';
import { pruneCompletedProcesses } from './tools/shell.js';
let lastTrimAt = 0;
const TRIM_COOLDOWN_MS = 120_000;
let guardTimer = null;
/**
 * Trims physical working set memory of the current T Bot process using Win32 EmptyWorkingSet API on Windows.
 * Caches the compiled helper assembly on disk to avoid repeated csc.exe invocations.
 * Enforces a 120-second cooldown unless force is true.
 */
export async function trimWindowsWorkingSet(force = false) {
    if (process.platform !== 'win32') {
        return;
    }
    const now = Date.now();
    if (!force && now - lastTrimAt < TRIM_COOLDOWN_MS) {
        return;
    }
    lastTrimAt = now;
    const dllPath = join(process.env.APPDATA || homedir(), 'TBot', 'bin', 'tbot-wstrim-v2.dll');
    await mkdir(dirname(dllPath), { recursive: true, mode: 0o700 }).catch(() => undefined);
    return new Promise((resolve) => {
        try {
            const curPid = process.pid;
            const escapedDllPath = dllPath.replace(/'/g, "''");
            const script = `
$dll = '${escapedDllPath}'
if (Test-Path -LiteralPath $dll) {
  [void][Reflection.Assembly]::LoadFrom($dll)
} else {
  $def = @'
using System;
using System.Runtime.InteropServices;
public static class WsTrim {
    [DllImport("psapi.dll")]
    public static extern bool EmptyWorkingSet(IntPtr hProcess);
    public static void Clean(int curPid) {
        try {
            using (var cp = System.Diagnostics.Process.GetProcessById(curPid)) {
                EmptyWorkingSet(cp.Handle);
            }
        } catch {}
    }
}
'@
  Add-Type -TypeDefinition $def -Language CSharp -OutputAssembly $dll
  [void][Reflection.Assembly]::LoadFrom($dll)
}
[WsTrim]::Clean(${curPid})
`;
            execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeout: 5000, windowsHide: true }, () => {
                resolve();
            });
        }
        catch {
            resolve();
        }
    });
}
/**
 * Returns current memory usage and pressure level based on T Bot process memory or critical system free RAM:
 * - 'high': heapUsedMB > 220 or rssMB > 420 or systemFreeMB < 512
 * - 'moderate': heapUsedMB > 140 or rssMB > 280
 * - 'low': otherwise
 */
export function getMemoryStats() {
    const usage = process.memoryUsage();
    const heapUsedMB = Math.round((usage.heapUsed / (1024 * 1024)) * 10) / 10;
    const heapTotalMB = Math.round((usage.heapTotal / (1024 * 1024)) * 10) / 10;
    const rssMB = Math.round((usage.rss / (1024 * 1024)) * 10) / 10;
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const systemTotalMB = Math.round(totalBytes / (1024 * 1024));
    const systemFreeMB = Math.round(freeBytes / (1024 * 1024));
    const systemUsedPercent = totalBytes > 0
        ? Math.round(((totalBytes - freeBytes) / totalBytes) * 1000) / 10
        : 0;
    let pressure = 'low';
    if (heapUsedMB > 280 || rssMB > 500 || systemFreeMB < 256) {
        pressure = 'critical';
    }
    else if (heapUsedMB > 220 || rssMB > 420 || systemFreeMB < 512) {
        pressure = 'high';
    }
    else if (heapUsedMB > 140 || rssMB > 280) {
        pressure = 'moderate';
    }
    return {
        heapUsedMB,
        heapTotalMB,
        rssMB,
        systemTotalMB,
        systemFreeMB,
        systemUsedPercent,
        pressure,
    };
}
/**
 * Reclaims memory when under pressure ('moderate' | 'high') or when force is true:
 * 0. Prunes completed shell processes and their buffers.
 * 1. Compacts older large tool outputs (>1500 chars) in session messages (preserving last 4),
 *    and clears old image attachments (preserving only the latest message's image).
 * 2. Closes idle browser instance if active.
 * 3. Triggers V8 garbage collector if available (global.gc).
 * 4. Trims Windows physical working set if force is true or beforeStats.pressure === 'high'.
 */
export async function reclaimMemory(session, force = false) {
    const beforeStats = getMemoryStats();
    const beforeMB = beforeStats.heapUsedMB;
    let compactedCount = 0;
    if (beforeStats.pressure === 'moderate' || beforeStats.pressure === 'high' || force) {
        // 0. Prune completed background processes
        try {
            pruneCompletedProcesses();
        }
        catch {
            // Ignore background process prune errors
        }
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
        // 2. Close idle browser and desktop daemon if active
        try {
            await closeIdleBrowser();
        }
        catch {
            // Ignore browser close error during memory reclaim
        }
        try {
            await closeIdleDesktopDaemon();
        }
        catch {
            // Ignore desktop daemon close error during memory reclaim
        }
        // 3. Trigger V8 garbage collection if enabled (instant <1ms in-memory GC)
        if (typeof global.gc === 'function') {
            try {
                global.gc();
            }
            catch {
                // Safe guard against GC execution issues
            }
        }
        // 4. Windows physical Working Set trim: SADECE force === true veya pressure === 'critical' iken çalıştır
        if (force || beforeStats.pressure === 'critical') {
            try {
                await trimWindowsWorkingSet(force);
            }
            catch {
                // Safe guard against working set trim errors
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
/**
 * Starts automatic memory guard running every 30 seconds.
 * Triggers reclaimMemory only when memory pressure is high or heapUsedMB > 160.
 */
export function startAutoMemoryGuard(getSession) {
    if (guardTimer) {
        return;
    }
    guardTimer = setInterval(async () => {
        try {
            const stats = getMemoryStats();
            if (stats.pressure === 'high' || stats.heapUsedMB > 160) {
                await reclaimMemory(getSession?.(), false);
            }
        }
        catch {
            // Safe guard against background watcher errors
        }
    }, 30_000);
    guardTimer.unref();
}
/**
 * Stops the automatic memory guard timer.
 */
export function stopAutoMemoryGuard() {
    if (guardTimer) {
        clearInterval(guardTimer);
        guardTimer = null;
    }
}
//# sourceMappingURL=memory-guard.js.map