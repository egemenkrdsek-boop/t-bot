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

const isWindows = process.platform === 'win32';

/** Exact case-insensitive file names (no directory part). */
export const SENSITIVE_BASENAMES: ReadonlySet<string> = new Set([
  '.env',
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  '.netrc',
  '_netrc',
  '.pypirc',
  '.git-credentials',
  '.htpasswd',
  '.pgpass',
  '.vault-token',
  '.s3cfg',
  '.terraformrc',
  'credentials',
  'credentials.json',
  'application_default_credentials.json',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'cookies',
  'login data',
  'web data',
  'local state',
  'logins.json',
  'key3.db',
  'key4.db',
  'cert9.db',
  'places.sqlite',
  'secrets.json',
  'secrets.yaml',
  'secrets.yml',
  'secrets.txt',
]);

/** Directory segments whose entire contents are treated as credentials. */
export const SENSITIVE_DIR_SEGMENTS: ReadonlySet<string> = new Set([
  '.ssh',
  '.aws',
  '.gnupg',
  '.kube',
  '.docker',
  '.azure',
  'user data',
]);

/** File extensions that commonly hold private keys or key stores. */
export const SENSITIVE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.ppk',
  '.jks',
  '.keystore',
  '.ovpn',
  '.kdbx',
  '.p8',
]);

/** Dynamic file names that cannot be enumerated in the static set. */
const SENSITIVE_BASENAME_PATTERNS: readonly RegExp[] = [
  /^\.env\..+$/, // .env.local, .env.production.local, .env.test
  /^secrets?\.(?:json|ya?ml|txt)$/, // secret.json, secrets.yaml
];

function normalizeSegment(segment: string): string {
  let value = segment.toLowerCase();
  if (isWindows) {
    // Windows ignores trailing dots/spaces and treats `name:stream` as an
    // alternate data stream of `name`; normalize both before matching.
    value = value.replace(/[. ]+$/u, '');
    const colon = value.indexOf(':');
    if (colon >= 0) value = value.slice(0, colon);
  }
  return value;
}

/**
 * Split on both separators regardless of platform so a Windows path inspected
 * on POSIX (or vice versa) is still parsed correctly. `.` and empty segments
 * are dropped; `..` is kept because it does not hide a credential segment.
 */
function pathSegments(target: string): string[] {
  return target
    .split(/[\\/]+/u)
    .map(normalizeSegment)
    .filter(segment => segment.length > 0 && segment !== '.');
}

function extensionOf(name: string): string | undefined {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? undefined : name.slice(dot);
}

/**
 * Explain why a path is sensitive without revealing file contents or the full
 * path. Returns `undefined` for ordinary paths and a non-secret reason string
 * (matched rule only) for denied paths.
 */
export function describeSensitiveMatch(target: string): string | undefined {
  if (typeof target !== 'string') return 'invalid path input';
  if (target.includes('\0')) return 'invalid path input';
  if (!target.trim()) return undefined;

  const parts = pathSegments(target);
  if (!parts.length) return undefined;

  const name = parts[parts.length - 1];
  const dirs = parts.slice(0, -1);

  for (const dir of dirs) {
    if (SENSITIVE_DIR_SEGMENTS.has(dir)) return `sensitive credential directory: ${dir}`;
  }
  // The path itself may point at a credential directory (`rm -rf .ssh`).
  if (SENSITIVE_DIR_SEGMENTS.has(name)) return `sensitive credential directory: ${name}`;

  if (SENSITIVE_BASENAMES.has(name)) return `sensitive credential file: ${name}`;
  for (const pattern of SENSITIVE_BASENAME_PATTERNS) {
    if (pattern.test(name)) return `sensitive credential file: ${name}`;
  }

  const extension = extensionOf(name);
  if (extension && SENSITIVE_EXTENSIONS.has(extension)) {
    return `sensitive credential extension: ${extension}`;
  }
  return undefined;
}

/**
 * True when a path matches the shared credential policy. Case-insensitive on
 * Windows (and conservatively on every platform); malformed input and null
 * bytes fail closed.
 */
export function isSensitivePath(input: string): boolean {
  return describeSensitiveMatch(input) !== undefined;
}

/** Drop sensitive entries while preserving order. Non-strings are dropped. */
export function filterSensitivePaths(paths: string[]): string[] {
  if (!Array.isArray(paths)) return [];
  return paths.filter(item => typeof item === 'string' && !isSensitivePath(item));
}

/** Credential-store names that contain a space (browser profile files). */
const MULTI_WORD_SENSITIVE =
  /(?:^|[\\/"'`])(?:login data|web data|local state|user data)(?=$|[\\/"'`])/iu;

/** Bare words that only count as a path cue when a separator is present. */
const AMBIGUOUS_BARE_NAMES: ReadonlySet<string> = new Set(['credentials', 'cookies']);

/**
 * Detect a credential-file-like path inside approval text (a shell command, a
 * tool argument preview or a `file_write` payload). Used to add an explicit
 * warning to approval prompts. Detection is token based so ordinary prose such
 * as "env vars" or "invalid credentials" is not flagged unnecessarily.
 */
export function isSensitiveApprovalText(text: string): boolean {
  if (typeof text !== 'string' || !text) return false;
  if (MULTI_WORD_SENSITIVE.test(text)) return true;

  const tokens = text.split(/[\s"'`=<>|;&,()[\]{}]+/u).filter(Boolean);
  for (const raw of tokens) {
    // Strip shell punctuation but keep a leading dot (dotfiles are paths).
    const token = raw.replace(/^[,:;]+/u, '').replace(/[.,:;]+$/u, '');
    if (!token) continue;
    if (AMBIGUOUS_BARE_NAMES.has(token.toLowerCase()) && !/[\\/]/u.test(token)) continue;
    if (isSensitivePath(token)) return true;

    // Percent-encoded paths (`%2eenv`, `.ssh%2fid_rsa`) must not evade the scan.
    if (/%[0-9a-f]{2}/iu.test(token)) {
      try {
        if (isSensitivePath(decodeURIComponent(token))) return true;
      } catch {
        // Malformed escapes are not a path cue.
      }
    }
  }
  return false;
}
