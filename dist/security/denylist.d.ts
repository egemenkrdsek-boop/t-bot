/**
 * Shared sensitive-file policy. Every path that can carry credentials must be
 * screened through this module: file reads/searches, workspace packing,
 * screenshots, Telegram delivery and approval text. The policy is lexical and
 * fail-closed: it never inspects file contents and never returns a secret value
 * in its reason strings.
 *
 * `paths.ts` keeps its T Bot data-directory checks (config/sessions/secrets)
 * and delegates the file-name part here, so callers using either module see the
 * same expanded policy.
 */
/** Exact case-insensitive file names (no directory part). */
export declare const SENSITIVE_BASENAMES: ReadonlySet<string>;
/** Directory segments whose entire contents are treated as credentials. */
export declare const SENSITIVE_DIR_SEGMENTS: ReadonlySet<string>;
/** File extensions that commonly hold private keys or key stores. */
export declare const SENSITIVE_EXTENSIONS: ReadonlySet<string>;
/**
 * Explain why a path is sensitive without revealing file contents or the full
 * path. Returns `undefined` for ordinary paths and a non-secret reason string
 * (matched rule only) for denied paths.
 */
export declare function describeSensitiveMatch(target: string): string | undefined;
/**
 * True when a path matches the shared credential policy. Case-insensitive on
 * Windows (and conservatively on every platform); malformed input and null
 * bytes fail closed.
 */
export declare function isSensitivePath(input: string): boolean;
/** Drop sensitive entries while preserving order. Non-strings are dropped. */
export declare function filterSensitivePaths(paths: string[]): string[];
/**
 * Detect a credential-file-like path inside approval text (a shell command, a
 * tool argument preview or a `file_write` payload). Used to add an explicit
 * warning to approval prompts. Detection is token based so ordinary prose such
 * as "env vars" or "invalid credentials" is not flagged unnecessarily.
 */
export declare function isSensitiveApprovalText(text: string): boolean;
