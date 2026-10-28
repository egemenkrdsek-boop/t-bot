import { BrowserWindow } from 'electron';
export interface DesktopMemoryStats {
    mainMB: number;
    rendererMB: number;
    totalWorkingSetMB: number;
    systemFreeGB: number;
    cpuPercent: number;
    lastFreedMB: number;
    timestamp: number;
}
export interface DesktopTrimResult {
    beforeMB: number;
    afterMB: number;
    freedMB: number;
}
/**
 * Returns current desktop memory and CPU metrics across all Electron processes
 * (Main, Renderer, GPU, Utility) and system free memory.
 */
export declare function getDesktopMemoryStats(mainWindow?: BrowserWindow): DesktopMemoryStats;
/**
 * Executes Win32 EmptyWorkingSet on all Electron processes (Main, Renderer, GPU, Utility)
 * and invokes V8 GC to minimize physical working set memory.
 */
export declare function trimDesktopMemory(mainWindow?: BrowserWindow, force?: boolean): Promise<DesktopTrimResult>;
