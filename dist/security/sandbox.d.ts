export type SandboxKind = 'none' | 'bubblewrap' | 'sandbox-exec';
export type SandboxMode = 'auto' | 'off' | 'required' | 'bwrap' | 'sandbox-exec';
export interface SandboxStatus {
    mode: SandboxMode;
    kind: SandboxKind;
    available: boolean;
    reason: string;
}
export declare function sandboxStatus(env?: NodeJS.ProcessEnv): SandboxStatus;
export declare function assertShellAllowed(env?: NodeJS.ProcessEnv): void;
export interface SandboxCommand {
    file: string;
    args: string[];
}
/**
 * Wrap a shell command when a real adapter is selected. The command still runs
 * through /bin/sh; the adapter constrains filesystem writes to the workspace
 * (and on macOS allows the normal read/execute surface).
 */
export declare function sandboxWrap(command: string, cwd: string, env?: NodeJS.ProcessEnv): SandboxCommand | undefined;
