/**
 * Optional shell isolation adapters.
 *
 * T Bot does not pretend that approval prompts are an OS sandbox. This module
 * detects a real adapter when one is available and lets the user require it:
 *
 *   TBOT_SANDBOX=required   fail closed when no adapter exists
 *   TBOT_SANDBOX=bwrap      use bubblewrap on Linux
 *   TBOT_SANDBOX=sandbox-exec  use sandbox-exec on macOS
 *   TBOT_SANDBOX=auto|off   no wrapping (default; approval boundary only)
 *
 * The adapters are intentionally small and auditable. They are not a
 * substitute for a container or a dedicated low-privilege OS account.
 */
import { existsSync } from 'node:fs';

export type SandboxKind = 'none' | 'bubblewrap' | 'sandbox-exec';
export type SandboxMode = 'auto' | 'off' | 'required' | 'bwrap' | 'sandbox-exec';

export interface SandboxStatus {
  mode: SandboxMode;
  kind: SandboxKind;
  available: boolean;
  reason: string;
}

function modeFromEnv(env: NodeJS.ProcessEnv): SandboxMode {
  const value = String(env.TBOT_SANDBOX || '').trim().toLowerCase();
  if (value === 'required' || value === 'bwrap' || value === 'sandbox-exec' || value === 'off') return value;
  return 'auto';
}

function findBubblewrap(): string | undefined {
  for (const candidate of ['/usr/bin/bwrap', '/bin/bwrap', '/usr/local/bin/bwrap']) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export function sandboxStatus(env: NodeJS.ProcessEnv = process.env): SandboxStatus {
  const mode = modeFromEnv(env);
  if (mode === 'off' || mode === 'auto') {
    return {
      mode,
      kind: 'none',
      available: false,
      reason: mode === 'off'
        ? 'Shell isolation is explicitly disabled.'
        : 'No sandbox mode selected; shell uses the approval boundary and the user OS permissions.',
    };
  }

  if (process.platform === 'linux') {
    if (mode === 'sandbox-exec') {
      return { mode, kind: 'none', available: false, reason: 'sandbox-exec is only available on macOS.' };
    }
    const bwrap = findBubblewrap();
    if (bwrap) {
      return { mode, kind: 'bubblewrap', available: true, reason: `bubblewrap found at ${bwrap}.` };
    }
    return {
      mode,
      kind: 'none',
      available: false,
      reason: 'bubblewrap is not installed; install bwrap or set TBOT_SANDBOX=auto.',
    };
  }

  if (process.platform === 'darwin') {
    if (mode === 'bwrap') {
      return { mode, kind: 'none', available: false, reason: 'bubblewrap is only available on Linux.' };
    }
    if (existsSync('/usr/bin/sandbox-exec')) {
      return { mode, kind: 'sandbox-exec', available: true, reason: 'macOS sandbox-exec is available.' };
    }
    return { mode, kind: 'none', available: false, reason: 'sandbox-exec was not found.' };
  }

  return {
    mode,
    kind: 'none',
    available: false,
    reason: `No shell sandbox adapter is available on ${process.platform}. Install one or set TBOT_SANDBOX=auto.`,
  };
}

export function assertShellAllowed(env: NodeJS.ProcessEnv = process.env): void {
  const status = sandboxStatus(env);
  if (status.mode === 'required' && !status.available) {
    throw new Error(`Shell sandbox required but unavailable: ${status.reason}`);
  }
}

export interface SandboxCommand {
  file: string;
  args: string[];
}

function profileString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Wrap a shell command when a real adapter is selected. The command still runs
 * through /bin/sh; the adapter constrains filesystem writes to the workspace
 * (and on macOS allows the normal read/execute surface).
 */
export function sandboxWrap(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
): SandboxCommand | undefined {
  const status = sandboxStatus(env);
  if (!status.available) return undefined;

  if (status.kind === 'bubblewrap') {
    return {
      file: findBubblewrap() || '/usr/bin/bwrap',
      args: [
        '--ro-bind', '/', '/',
        '--bind', cwd, cwd,
        '--chdir', cwd,
        '--dev', '/dev',
        '--proc', '/proc',
        '--unshare-pid',
        '--die-with-parent',
        '/bin/sh', '-lc', command,
      ],
    };
  }

  if (status.kind === 'sandbox-exec') {
    const profile = [
      '(version 1)',
      '(allow default)',
      '(deny file-write*)',
      `(allow file-write* (subpath ${profileString(cwd)}))`,
    ].join(' ');
    return {
      file: '/usr/bin/sandbox-exec',
      args: ['-p', profile, '/bin/sh', '-lc', command],
    };
  }

  return undefined;
}
