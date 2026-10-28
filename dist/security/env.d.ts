/**
 * Single allowlist for every child process environment (shell, git, secrets).
 *
 * Only a small set of non-secret runtime variables is forwarded. Everything
 * else is dropped, so a model-launched program never inherits provider,
 * bridge, database or cloud credentials from the T Bot process.
 */
export declare function isSensitiveEnvName(name: string): boolean;
/**
 * Build a hardened environment for a spawned process.
 *
 * `extra` entries are merged last (for per-call needs such as git flags) but
 * still pass through the sensitive-name filter. `source` defaults to the
 * current process environment and exists for tests.
 */
export declare function childEnvironment(extra?: NodeJS.ProcessEnv, source?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
