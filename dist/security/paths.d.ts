export type PathOperation = 'read' | 'write';
export declare class SensitivePathError extends Error {
    readonly target: string;
    readonly operation: PathOperation;
    readonly reason: string;
    constructor(target: string, operation: PathOperation, reason: string);
}
export declare function isSensitivePath(target: string): boolean;
/**
 * Throw when a path is protected. Writes to any protected path are rejected;
 * reads are rejected too, so callers that want to allow a read must obtain
 * explicit approval before invoking the file handler.
 */
export declare function assertNotSensitivePath(target: string, options?: {
    operation?: PathOperation;
}): void;
/**
 * Resolve a workspace-relative path and enforce containment. Rejects null
 * bytes, `..` escapes, absolute escapes and any symlink/junction in the path
 * (including a linked ancestor), case-insensitively on Windows.
 */
export declare function resolveWorkspacePath(workspace: string, target: string): Promise<string>;
/**
 * Default desktop workspace. Never the home root itself.
 * Desktop main-process integration lives in the desktop module.
 */
export declare function defaultDesktopWorkspace(env?: NodeJS.ProcessEnv): string;
