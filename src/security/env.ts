/**
 * Single allowlist for every child process environment (shell, git, secrets).
 *
 * Only a small set of non-secret runtime variables is forwarded. Everything
 * else is dropped, so a model-launched program never inherits provider,
 * bridge, database or cloud credentials from the T Bot process.
 */

/** Safe base variables that describe the host runtime and are not secrets. */
const SAFE_ENV_NAMES = new Set([
  'PATH',
  'SYSTEMROOT',
  'COMSPEC',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOME',
  'APPDATA',
  'LOCALAPPDATA',
  'PATHEXT',
  'OS',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'PROGRAMDATA',
  'WINDIR',
  'SYSTEMDRIVE',
]);

/**
 * Names that must never reach a child process, even when a caller passes them
 * explicitly through `extra`.
 */
const SENSITIVE_ENV_NAME =
  /(?:^|_)(?:KEY|TOKENS?|SECRETS?|PASSWORDS?|PASS|CREDENTIALS?|DSN)(?:_|$)|CREDENTIAL|CONNECTION_STRING$|^(?:DATABASE_URL|AWS_|AZURE_|GOOGLE_|GCP_|OPENAI_|ANTHROPIC_|TELEGRAM_|TBOT_)/i;

export function isSensitiveEnvName(name: string): boolean {
  return SENSITIVE_ENV_NAME.test(name);
}

/**
 * Build a hardened environment for a spawned process.
 *
 * `extra` entries are merged last (for per-call needs such as git flags) but
 * still pass through the sensitive-name filter. `source` defaults to the
 * current process environment and exists for tests.
 */
export function childEnvironment(
  extra: NodeJS.ProcessEnv = {},
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (typeof value !== 'string') continue;
    if (!SAFE_ENV_NAMES.has(name.toUpperCase())) continue;
    if (isSensitiveEnvName(name)) continue;
    env[name] = value;
  }
  if (process.platform === 'win32') {
    // Stop cmd.exe and CreateProcess from resolving executables in the
    // untrusted launch directory before searching PATH.
    env.NoDefaultCurrentDirectoryInExePath = '1';
  }
  env.CI = 'true';
  env.GIT_TERMINAL_PROMPT = '0';
  env.GCM_INTERACTIVE = 'never';
  env.NPM_CONFIG_YES = 'true';
  for (const [name, value] of Object.entries(extra)) {
    if (typeof value !== 'string') continue;
    if (isSensitiveEnvName(name)) continue;
    env[name] = value;
  }
  return env;
}
