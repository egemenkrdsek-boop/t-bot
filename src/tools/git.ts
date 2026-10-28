import { execFile } from 'node:child_process';
import { access, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ToolDefinition } from '../types.js';
import { shellEnvironment } from './shell.js';

export const gitToolDefinitions: ToolDefinition[] = [
  {
    name: 'git_status',
    description: 'Show Git status for files in the workspace.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'git_diff',
    description: 'Show unstaged or staged Git changes within the workspace.',
    parameters: {
      type: 'object',
      properties: {
        staged: { type: 'boolean', description: 'Show staged changes instead of unstaged changes.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'git_log',
    description: 'Show recent commits affecting the workspace.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum number of commits to show (1-50).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'git_add',
    description: 'Stage file contents for the next commit in the workspace.',
    parameters: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Paths relative to workspace to stage. Defaults to ["."]',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'git_commit',
    description: 'Record changes to the repository with a commit message. Requires approval.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The commit message.' },
        all: { type: 'boolean', description: 'Stage all modified and deleted files before commit (-a).' },
      },
      required: ['message'],
      additionalProperties: false,
    },
  },
  {
    name: 'git_branch',
    description: 'List branches or create/checkout a branch in the workspace.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Branch name to create or switch to. If omitted, lists branches.' },
        checkout: { type: 'boolean', description: 'Switch to the branch if true (creates it if it does not exist).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'git_push',
    description: 'Update remote refs along with associated objects.',
    parameters: {
      type: 'object',
      properties: {
        remote: { type: 'string', description: 'Remote repository name (default: "origin").' },
        branch: { type: 'string', description: 'Branch name to push (default: current branch).' },
      },
      additionalProperties: false,
    },
  },
];

/** Never let Windows search the untrusted child cwd for git.exe. */
export async function resolveGitExecutable(workspace: string, source: NodeJS.ProcessEnv = process.env): Promise<string> {
  const root = await realpath(workspace);
  const pathValue = Object.entries(source).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? '';
  for (const raw of pathValue.split(delimiter)) {
    const dir = raw.replace(/^"(.*)"$/, '$1');
    if (!isAbsolute(dir)) continue;
    try {
      const candidate = await realpath(join(dir, process.platform === 'win32' ? 'git.exe' : 'git'));
      const rel = relative(root, candidate);
      if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)) continue;
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, constants.X_OK);
      return candidate;
    } catch { /* Try the next absolute installation directory. */ }
  }
  throw new Error('A Git installation outside the workspace must be available on an absolute PATH.');
}

function runGit(executable: string, cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const env = shellEnvironment();
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('GIT_')) delete env[key];
  return new Promise((resolvePromise, reject) => {
    execFile(executable, ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.pager=cat', '-c', 'color.ui=false', ...args], {
      cwd, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true, signal,
      env: { ...env, GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0', GIT_EXTERNAL_DIFF: '', GIT_CONFIG_NOSYSTEM: '1' },
    }, (error, stdout, stderr) => {
      if (error) { reject(new Error(`Git failed: ${stderr.trim() || error.message}`)); return; }
      resolvePromise(stdout || stderr || '(no output)');
    });
  });
}

export async function handleGitTool(name: string, args: Record<string, unknown>, context: { workspace: string; signal?: AbortSignal }): Promise<string> {
  const workspace = await realpath(resolve(context.workspace));
  context.signal?.throwIfAborted();
  const executable = await resolveGitExecutable(workspace);
  const run = (args: string[]) => runGit(executable, workspace, args, context.signal);
  const root = await realpath((await run(['rev-parse', '--show-toplevel'])).trim());
  const inside = relative(root, workspace);
  if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) throw new Error('Workspace is outside the Git repository');

  if (name === 'git_status') {
    return run(['status', '--porcelain=v1', '--no-renames', '--untracked-files=normal', '--', '.']);
  }
  if (name === 'git_diff') {
    if (args.staged !== undefined && typeof args.staged !== 'boolean') throw new Error('staged must be a boolean');
    return run(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', ...(args.staged ? ['--cached'] : []), '--', '.']);
  }
  if (name === 'git_log') {
    const limit = args.limit === undefined ? 20 : args.limit;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('limit must be an integer between 1 and 50');
    return run(['log', `--max-count=${limit}`, '--format=%h %ad %s', '--date=short', '--', '.']);
  }
  if (name === 'git_add') {
    const rawPaths = Array.isArray(args.paths) ? args.paths : ['.'];
    const paths: string[] = [];
    for (const p of rawPaths) {
      if (typeof p !== 'string' || !p.trim()) throw new Error('paths elements must be non-empty strings');
      paths.push(p.trim());
    }
    const output = await run(['add', '--', ...paths]);
    return output.trim() === '(no output)' || !output.trim() ? 'Files staged successfully.' : output;
  }
  if (name === 'git_commit') {
    if (typeof args.message !== 'string' || !args.message.trim()) throw new Error('message must be a non-empty string');
    if (args.all !== undefined && typeof args.all !== 'boolean') throw new Error('all must be a boolean');
    const commitArgs = ['commit', ...(args.all ? ['-a'] : []), '-m', args.message.trim()];
    return run(commitArgs);
  }
  if (name === 'git_branch') {
    const branchName = typeof args.name === 'string' ? args.name.trim() : '';
    if (args.checkout !== undefined && typeof args.checkout !== 'boolean') throw new Error('checkout must be a boolean');
    if (!branchName) {
      return run(['branch', '--list', '-v']);
    }
    // Prevent unsafe branch argument injection
    if (/[\s~^:?*\[\\]/.test(branchName) || branchName.startsWith('-')) throw new Error('Invalid branch name');
    if (args.checkout) {
      let branchExists = false;
      try {
        await run(['rev-parse', '--verify', `refs/heads/${branchName}`]);
        branchExists = true;
      } catch {
        branchExists = false;
      }

      if (branchExists) {
        return run(['checkout', branchName]);
      }
      return run(['checkout', '-b', branchName]);
    }
    return run(['branch', branchName]);
  }
  if (name === 'git_push') {
    const remote = typeof args.remote === 'string' && args.remote.trim() ? args.remote.trim() : 'origin';
    if (remote.startsWith('-') || /[\s]/.test(remote)) throw new Error('Invalid remote name');
    const pushArgs = ['push', remote];
    if (typeof args.branch === 'string' && args.branch.trim()) {
      const branch = args.branch.trim();
      if (branch.startsWith('-') || /[\s~^:?*\[\\]/.test(branch)) throw new Error('Invalid branch name');
      pushArgs.push(branch);
    }
    return run(pushArgs);
  }
  throw new Error(`Unknown Git tool: ${name}`);
}
