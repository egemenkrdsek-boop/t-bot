export declare function isProcessAlive(pid: number): boolean;
export declare function acquireFileLock(lockPath: string, staleMs?: number, maxWaitMs?: number): Promise<() => Promise<void>>;
export declare function withFileLock<T>(lockPath: string, fn: () => Promise<T>, staleMs?: number): Promise<T>;
