import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
export const gitToolDefinitions = [
    { name: 'git_status', description: 'Show Git status for files in the workspace.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'git_diff', description: 'Show unstaged or staged Git changes within the workspace.', parameters: { type: 'object', properties: { staged: { type: 'boolean', description: 'Show staged changes instead of unstaged changes.' } }, additionalProperties: false } },
    { name: 'git_log', description: 'Show recent commits affecting the workspace.', parameters: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false } },
];
function runGit(cwd, args, signal) {
    signal?.throwIfAborted();
    const env = { ...process.env };
    for (const key of Object.keys(env))
        if (key.toUpperCase().startsWith('GIT_'))
            delete env[key];
    return new Promise((resolvePromise, reject) => {
        execFile('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.pager=cat', '-c', 'color.ui=false', ...args], {
            cwd, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true, signal,
            env: { ...env, GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0', GIT_EXTERNAL_DIFF: '', GIT_CONFIG_NOSYSTEM: '1' },
        }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`Git failed: ${stderr.trim() || error.message}`));
                return;
            }
            resolvePromise(stdout || stderr || '(no output)');
        });
    });
}
export async function handleGitTool(name, args, context) {
    const workspace = await realpath(resolve(context.workspace));
    const root = await realpath((await runGit(workspace, ['rev-parse', '--show-toplevel'], context.signal)).trim());
    const inside = relative(root, workspace);
    if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`))
        throw new Error('Workspace is outside the Git repository');
    if (name === 'git_status')
        return runGit(workspace, ['status', '--porcelain=v1', '--no-renames', '--untracked-files=normal', '--', '.'], context.signal);
    if (name === 'git_diff') {
        if (args.staged !== undefined && typeof args.staged !== 'boolean')
            throw new Error('staged must be a boolean');
        return runGit(workspace, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', ...(args.staged ? ['--cached'] : []), '--', '.'], context.signal);
    }
    if (name === 'git_log') {
        const limit = args.limit === undefined ? 20 : args.limit;
        if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50)
            throw new Error('limit must be an integer between 1 and 50');
        return runGit(workspace, ['log', `--max-count=${limit}`, '--format=%h %ad %s', '--date=short', '--', '.'], context.signal);
    }
    throw new Error(`Unknown Git tool: ${name}`);
}
//# sourceMappingURL=git.js.map