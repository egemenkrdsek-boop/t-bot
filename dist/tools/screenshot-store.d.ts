/** Absolute, contained screenshot directory; throws on links and escapes. */
export declare function screenshotDirectory(workspace: string): string;
/**
 * Create the contained screenshot directory (mode 0700) and return a fresh
 * UUID-named PNG path. The name never collides with a previous capture.
 */
export declare function createScreenshotPath(workspace: string, prefix?: 'browser' | 'desktop' | 'screen'): Promise<string>;
export declare function pruneScreenshots(workspace: string): Promise<number>;
/**
 * Remove abandoned Chromium profile directories left in %TEMP% after a crash
 * or forced process kill. `keep` protects the profile of the current session.
 * Only old directories matching our own prefix are touched.
 */
export declare function sweepStaleBrowserProfiles(keep?: string, maxAgeMs?: number): Promise<number>;
