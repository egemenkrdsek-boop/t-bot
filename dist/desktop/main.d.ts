/**
 * Resolve a requested screenshot path to a readable file inside the canonical
 * `workspace/.tbot/screenshots` directory. Rejects unknown workspaces, lexical
 * or canonical escapes, symbolic links and non-image files.
 */
export declare function resolveScreenshotFile(workspace: string, requestedPath: string): Promise<{
    path: string;
    contentType: string;
}>;
/** Installed launches start in the user's home, never an installation directory. */
export declare function getDefaultWorkspace(): string;
/** The single telemetry shape sent to every renderer surface. */
export declare function composeDesktopTelemetry(): Record<string, unknown>;
