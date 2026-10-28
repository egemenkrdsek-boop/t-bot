/** Reject state paths outside the workspace or through existing links/junctions.
 * Checks are synchronous for prompt-loading callers; they do not provide an
 * atomic sandbox against another process changing the filesystem concurrently.
 */
export declare function workspaceStatePath(workspace: string, input: string): string;
