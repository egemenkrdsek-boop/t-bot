import os from 'node:os';
import { execFile } from 'node:child_process';
import { app } from 'electron';
let lastFreedMB = 0;
let lastTrimAt = 0;
let activeTrim = null;
const TRIM_COOLDOWN_MS = 10_000;
/**
 * Returns current desktop memory and CPU metrics across all Electron processes
 * (Main, Renderer, GPU, Utility) and system free memory.
 */
export function getDesktopMemoryStats(mainWindow) {
    let mainMB = 0;
    let rendererMB = 0;
    let totalWorkingSetMB = 0;
    let cpuPercent = 0;
    try {
        if (app && typeof app.getAppMetrics === 'function') {
            const metrics = app.getAppMetrics();
            for (const m of metrics) {
                const wsMB = Math.round(((m.memory.workingSetSize || 0) / 1024) * 10) / 10;
                totalWorkingSetMB += wsMB;
                cpuPercent += (m.cpu?.percentCPUUsage || 0);
                if (m.type === 'Browser') {
                    mainMB += wsMB;
                }
                else if (m.type === 'Tab') {
                    rendererMB += wsMB;
                }
            }
        }
    }
    catch {
        // Fallback if app metrics are not yet initialized
    }
    // Fallback if mainMB was not captured in metrics
    if (mainMB === 0) {
        const rss = process.memoryUsage().rss;
        mainMB = Math.round((rss / (1024 * 1024)) * 10) / 10;
        if (totalWorkingSetMB === 0) {
            totalWorkingSetMB = mainMB;
        }
    }
    totalWorkingSetMB = Math.round(totalWorkingSetMB * 10) / 10;
    cpuPercent = Math.round(cpuPercent * 10) / 10;
    const systemFreeGB = Math.round((os.freemem() / (1024 * 1024 * 1024)) * 100) / 100;
    return {
        mainMB,
        rendererMB,
        totalWorkingSetMB,
        systemFreeGB,
        cpuPercent,
        lastFreedMB,
        timestamp: Date.now(),
    };
}
/**
 * Executes Win32 EmptyWorkingSet on all Electron processes (Main, Renderer, GPU, Utility)
 * and invokes V8 GC to minimize physical working set memory.
 */
export function trimDesktopMemory(mainWindow, force = true) {
    if (activeTrim)
        return activeTrim;
    activeTrim = performDesktopMemoryTrim(mainWindow, force).finally(() => { activeTrim = null; });
    return activeTrim;
}
/** Hidden windows still reclaim under critical pressure, without changing session state.
 * Share the manual trim timestamp so repeated failures cannot spawn helper storms.
 */
export async function trimDesktopMemoryUnderPressure(mainWindow, stats = getDesktopMemoryStats(mainWindow)) {
    const criticalSystemPressure = stats.systemFreeGB <= 0.25 && stats.totalWorkingSetMB >= 128;
    const excessiveAppMemory = stats.totalWorkingSetMB >= 768;
    if ((!criticalSystemPressure && !excessiveAppMemory) || activeTrim || Date.now() - lastTrimAt < 120_000)
        return;
    return trimDesktopMemory(mainWindow, false);
}
async function performDesktopMemoryTrim(mainWindow, force) {
    const now = Date.now();
    if (!force && now - lastTrimAt < TRIM_COOLDOWN_MS) {
        const current = getDesktopMemoryStats(mainWindow);
        return {
            beforeMB: current.totalWorkingSetMB,
            afterMB: current.totalWorkingSetMB,
            freedMB: 0,
        };
    }
    lastTrimAt = now;
    const beforeStats = getDesktopMemoryStats(mainWindow);
    const beforeMB = beforeStats.totalWorkingSetMB;
    // 1. Invoke V8 GC in main process
    if (typeof global.gc === 'function') {
        try {
            global.gc();
        }
        catch {
            // Safe guard
        }
    }
    // 2. Invoke V8 GC in renderer if available
    if (mainWindow && !mainWindow.isDestroyed()) {
        try {
            mainWindow.webContents.executeJavaScript('if (typeof gc === "function") { gc(); }').catch(() => { });
        }
        catch {
            // Safe guard
        }
    }
    // 3. Trim physical working set on Windows via psapi.dll
    if (process.platform === 'win32') {
        await trimWindowsDesktopPids(mainWindow);
    }
    // Give Windows kernel a brief moment to update working set counter
    await new Promise(r => setTimeout(r, 80));
    const afterStats = getDesktopMemoryStats(mainWindow);
    const afterMB = afterStats.totalWorkingSetMB;
    const freed = Math.max(0, Math.round((beforeMB - afterMB) * 10) / 10);
    lastFreedMB = freed;
    return {
        beforeMB,
        afterMB,
        freedMB: freed,
    };
}
async function trimWindowsDesktopPids(mainWindow) {
    const pids = new Set();
    pids.add(process.pid);
    try {
        if (app && typeof app.getAppMetrics === 'function') {
            const metrics = app.getAppMetrics();
            for (const m of metrics) {
                if (m.pid && m.pid > 0) {
                    pids.add(m.pid);
                }
            }
        }
    }
    catch { }
    if (mainWindow && !mainWindow.isDestroyed()) {
        try {
            const rPid = mainWindow.webContents.getProcessId();
            if (rPid && rPid > 0)
                pids.add(rPid);
        }
        catch { }
    }
    const pidList = Array.from(pids).join(',');
    if (!pidList)
        return;
    return new Promise((resolve) => {
        try {
            const script = `
$def = @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class DesktopMemTrimmer {
    [DllImport("psapi.dll", SetLastError = true)]
    public static extern bool EmptyWorkingSet(IntPtr hProcess);
    public static void Clean(int[] pids) {
        if (pids == null) return;
        foreach (int pid in pids) {
            try {
                using (var cp = Process.GetProcessById(pid)) {
                    EmptyWorkingSet(cp.Handle);
                }
            } catch {}
        }
    }
}
'@
Add-Type -TypeDefinition $def -Language CSharp
[DesktopMemTrimmer]::Clean(@(${pidList}))
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
//# sourceMappingURL=memory-trimmer.js.map