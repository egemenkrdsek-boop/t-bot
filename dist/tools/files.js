import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
const string = (args, key) => {
    const value = args[key];
    if (typeof value !== 'string' || !value)
        throw new Error(`${key} must be a non-empty string`);
    return value;
};
const schema = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
const p = { type: 'string', description: 'Path relative to the workspace' };
export const fileToolDefinitions = [
    { name: 'file_read', description: 'Read a UTF-8 workspace file (bounded output).', parameters: schema({ path: p }, ['path']) },
    { name: 'file_list', description: 'List a workspace directory.', parameters: schema({ path: p }, []) },
    { name: 'file_search', description: 'Search UTF-8 workspace files for literal text.', parameters: schema({ path: p, query: { type: 'string' } }, ['query']) },
    { name: 'file_write', description: 'Write a UTF-8 workspace file; overwrites existing content and requires approval.', parameters: schema({ path: p, content: { type: 'string' } }, ['path', 'content']) },
    { name: 'file_patch', description: 'Replace one exact occurrence in a workspace file; requires approval.', parameters: schema({ path: p, old_text: { type: 'string' }, new_text: { type: 'string' } }, ['path', 'old_text', 'new_text']) },
];
const LIMIT = 100_000;
function inside(root, target) { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); }
/** Reject symlinks, including existing ancestors. These checks are not atomic against a concurrent filesystem actor. */
async function resolveSafe(workspace, input) {
    if (path.isAbsolute(input) || /^[a-zA-Z]:/.test(input) || input.includes('\0'))
        throw new Error('Path must be relative to workspace');
    const root = await fs.realpath(workspace);
    const target = path.resolve(root, input);
    if (!inside(root, target))
        throw new Error('Path escapes workspace');
    let current = root;
    for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
        current = path.join(current, part);
        try {
            if ((await fs.lstat(current)).isSymbolicLink())
                throw new Error('Symbolic links are not allowed');
        }
        catch (e) {
            if (e.code === 'ENOENT')
                break;
            throw e;
        }
    }
    return target;
}
function bounded(text) { return text.length > LIMIT ? `${text.slice(0, LIMIT)}\n[output truncated]` : text; }
async function atomicWrite(target, content, workspace, input, signal, expected) {
    const temp = path.join(path.dirname(target), `.tbot-${randomUUID()}.tmp`);
    let mode;
    try {
        mode = (await fs.stat(target)).mode & 0o777;
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
    }
    try {
        await fs.writeFile(temp, content, { encoding: 'utf8', flag: 'wx', mode, signal });
        signal?.throwIfAborted();
        await resolveSafe(workspace, input);
        if (expected !== undefined && await fs.readFile(target, { encoding: 'utf8', signal }) !== expected)
            throw new Error('File changed since patch was read; patch not applied');
        signal?.throwIfAborted();
        await fs.rename(temp, target);
    }
    finally {
        await fs.unlink(temp).catch(() => { });
    }
}
export async function handleFileTool(name, args, workspace, signal) {
    signal?.throwIfAborted();
    const input = typeof args.path === 'string' ? args.path : '.';
    const target = await resolveSafe(workspace, input);
    if (name === 'file_read') {
        const stat = await fs.stat(target);
        if (!stat.isFile())
            throw new Error('Not a regular file');
        const handle = await fs.open(target, 'r');
        try {
            const buffer = Buffer.alloc(LIMIT + 1);
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
            const decoder = new StringDecoder('utf8');
            return decoder.write(buffer.subarray(0, Math.min(bytesRead, LIMIT))) + (bytesRead > LIMIT ? '\n[output truncated]' : decoder.end());
        }
        finally {
            await handle.close();
        }
    }
    if (name === 'file_list') {
        const entries = await fs.readdir(target, { withFileTypes: true });
        return bounded(entries.slice(0, 2000).map(e => `${e.isDirectory() ? 'dir' : e.isSymbolicLink() ? 'symlink' : 'file'} ${e.name}`).join('\n') + (entries.length > 2000 ? '\n[entries truncated]' : ''));
    }
    if (name === 'file_write') {
        if (typeof args.content !== 'string')
            throw new Error('content must be a string');
        if (Buffer.byteLength(args.content) > 1_000_000)
            throw new Error('Content exceeds 1 MB');
        await atomicWrite(target, args.content, workspace, input, signal);
        return 'File written.';
    }
    if (name === 'file_patch') {
        const old = string(args, 'old_text');
        if (typeof args.new_text !== 'string')
            throw new Error('new_text must be a string');
        const stat = await fs.stat(target);
        if (stat.size > 1_000_000)
            throw new Error('File exceeds 1 MB');
        const content = await fs.readFile(target, { encoding: 'utf8', signal });
        const at = content.indexOf(old);
        if (at < 0 || content.indexOf(old, at + 1) >= 0)
            throw new Error('old_text must occur exactly once');
        const next = content.slice(0, at) + args.new_text + content.slice(at + old.length);
        if (Buffer.byteLength(next) > 1_000_000)
            throw new Error('Result exceeds 1 MB');
        await atomicWrite(target, next, workspace, input, signal, content);
        return 'File patched.';
    }
    if (name === 'file_search') {
        const query = string(args, 'query');
        const root = await fs.realpath(workspace);
        const found = [];
        let visited = 0;
        let stopped = false;
        async function walk(dir) { signal?.throwIfAborted(); if (stopped)
            return; const entries = await fs.readdir(dir, { withFileTypes: true }); for (const entry of entries) {
            signal?.throwIfAborted();
            if (++visited > 10000 || found.length >= 500) {
                stopped = true;
                return;
            }
            if (entry.isSymbolicLink() || ['.git', 'node_modules'].includes(entry.name))
                continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory())
                await walk(full);
            else if (entry.isFile()) {
                const stat = await fs.stat(full);
                if (stat.size > 1_000_000)
                    continue;
                const content = await fs.readFile(full, 'utf8');
                if (content.includes('\0'))
                    continue;
                for (const [i, line] of content.split(/\r?\n/).entries()) {
                    if (line.includes(query))
                        found.push(`${path.relative(root, full)}:${i + 1}: ${line.slice(0, 1000)}`);
                    if (found.length >= 500) {
                        stopped = true;
                        return;
                    }
                }
            }
        } }
        const stat = await fs.stat(target);
        if (stat.isDirectory())
            await walk(target);
        else
            throw new Error('Search path must be a directory');
        return bounded(found.join('\n') + (stopped ? '\n[search truncated]' : '')) || 'No matches.';
    }
    throw new Error(`Unknown file tool: ${name}`);
}
//# sourceMappingURL=files.js.map