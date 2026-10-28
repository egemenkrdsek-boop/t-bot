import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { StringDecoder } from 'node:string_decoder';
import { globalGroundingLedger, validateFileSyntax } from '../grounding.js';
import { extractFileAstOutline } from '../repo-map.js';
import { globalContextCache } from '../context-cache.js';
import { estimateTokens, globalTokenTracker } from '../token-optimizer.js';
import { handleShellTool } from './shell.js';
import { applyEdit } from './edit-match.js';
import { resolveGitExecutable } from './git.js';
import { assertNotSensitivePath, isSensitivePath, resolveWorkspacePath } from '../security/paths.js';
import { childEnvironment } from '../security/env.js';
import { redactSecrets } from '../secrets.js';
import { saveCheckpoint } from '../checkpoints.js';
const string = (args, key) => {
    const value = args[key];
    if (typeof value !== 'string' || !value)
        throw new Error(`${key} must be a non-empty string`);
    return value;
};
const schema = (properties, required) => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
});
const p = { type: 'string', description: 'Path relative to the workspace' };
const offsetParam = { type: 'integer', minimum: 0, description: 'Continuation offset from the previous result' };
const limitParam = { type: 'integer', minimum: 1, description: 'Maximum items to return' };
const numberArg = (value, fallback, max) => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? Math.min(value, max) : fallback;
const SKIP_DIRS = new Set([
    '.git',
    'node_modules',
    'dist',
    'build',
    'coverage',
    '.tbot',
    '__pycache__',
    '.venv',
    'target',
]);
const LAZY_PLACEHOLDER_REGEX = /(?:\/\/|\/\*+|#)\s*\.\.\.\s*(?:existing\s+code|rest\s+of|previous\s+code|remaining\s+code|unchanged|omitted|existing|gerisi|mevcut\s+kod)/i;
export const fileToolDefinitions = [
    {
        name: 'file_read',
        description: 'Read a UTF-8 workspace file (bounded output). Supports reading specific line ranges.',
        parameters: schema({
            path: p,
            offset: offsetParam,
            max_bytes: { type: 'integer', minimum: 1, maximum: 100000 },
            start_line: { type: 'integer', minimum: 1, description: 'Optional 1-based start line' },
            end_line: { type: 'integer', minimum: 1, description: 'Optional 1-based end line' },
            skeleton: { type: 'boolean', description: 'Yalnızca AST sembol/fonksiyon imzalarını ve satır aralıklarını döndür (%75 token tasarrufu).' },
            full: { type: 'boolean', description: 'Otomatik iskeletlemeyi atlayarak tüm dosya metnini eksiksiz döndür.' },
        }, ['path']),
    },
    {
        name: 'file_outline',
        description: 'Extract an AST outline of symbols (classes, functions, methods, interfaces, types, exports, markdown headings) with start and end line numbers.',
        parameters: schema({ path: p }, ['path']),
    },
    {
        name: 'file_list',
        description: 'List a workspace directory.',
        parameters: schema({ path: p, offset: offsetParam, limit: limitParam }, []),
    },
    {
        name: 'file_glob',
        description: 'Fast file path finder using glob pattern matching (e.g. "**/*.ts", "src/**/*.js").',
        parameters: schema({
            pattern: { type: 'string', description: 'Glob pattern to match file paths (e.g. "**/*.ts")' },
            path: p,
            limit: limitParam,
        }, ['pattern']),
    },
    {
        name: 'file_search',
        description: 'Search UTF-8 workspace files for literal text or regex pattern.',
        parameters: schema({
            path: p,
            query: { type: 'string' },
            regex: { type: 'boolean', description: 'Treat query as a regular expression' },
            file_pattern: { type: 'string', description: 'Optional glob pattern to filter searched files (e.g. "*.ts")' },
            context_lines: { type: 'integer', minimum: 0, maximum: 10, description: 'Optional number of context lines before and after each match' },
            offset: offsetParam,
            limit: limitParam,
        }, ['query']),
    },
    {
        name: 'file_write',
        description: 'Write a UTF-8 workspace file; overwrites existing content and requires approval.',
        parameters: schema({ path: p, content: { type: 'string' } }, ['path', 'content']),
    },
    {
        name: 'file_patch',
        description: 'Replace exact occurrences in a workspace file. Supports single (old_text, new_text) or multi-hunk (patches: [{ old_text, new_text }]). Requires approval.',
        parameters: {
            type: 'object',
            properties: {
                path: p,
                old_text: { type: 'string', description: 'Exact text to replace (single patch mode)' },
                new_text: { type: 'string', description: 'Replacement text (single patch mode)' },
                patches: {
                    type: 'array',
                    description: 'Array of patch objects { old_text, new_text } for multi-hunk patching',
                    items: {
                        type: 'object',
                        properties: {
                            old_text: { type: 'string' },
                            new_text: { type: 'string' },
                        },
                        required: ['old_text', 'new_text'],
                        additionalProperties: false,
                    },
                },
            },
            required: ['path'],
            additionalProperties: false,
        },
    },
];
const LIMIT = 100_000;
/** Reject symlinks, including existing ancestors. These checks are not atomic against a concurrent filesystem actor. */
async function resolveSafe(workspace, input) {
    return resolveWorkspacePath(workspace, input);
}
async function atomicWrite(target, content, workspace, input, signal, expected) {
    if (content.includes('\0') || Buffer.from(content, 'utf8').toString('utf8') !== content) {
        throw new Error('File mutations require valid UTF-8 text without NUL bytes');
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
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
        // A new file is published with an atomic no-clobber link, never rename over
        // an entry that another process created after validation.
        if (expected === null) {
            await resolveSafe(workspace, input);
            signal?.throwIfAborted();
            await fs.link(temp, target);
            return;
        }
        for (let attempt = 0; attempt < 3; attempt++) {
            signal?.throwIfAborted();
            await resolveSafe(workspace, input);
            if ((await fs.readFile(target, { encoding: 'utf8', signal })) !== expected) {
                throw new Error('File changed since mutation was read; edit not applied');
            }
            signal?.throwIfAborted();
            try {
                await fs.rename(temp, target);
                return;
            }
            catch (err) {
                if (['EPERM', 'EBUSY', 'EACCES'].includes(err?.code) && attempt < 2) {
                    await new Promise((r) => setTimeout(r, 40));
                }
                else {
                    throw err;
                }
            }
        }
    }
    finally {
        await fs.unlink(temp).catch(() => { });
    }
}
function globToMatcher(pattern) {
    const norm = pattern.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').trim();
    const hasSlash = norm.includes('/');
    const toRegexStr = (glob) => {
        let out = '^';
        let i = 0;
        while (i < glob.length) {
            const c = glob[i];
            if (c === '*') {
                if (glob[i + 1] === '*') {
                    if (glob[i + 2] === '/') {
                        out += '(?:.*/)?';
                        i += 3;
                        continue;
                    }
                    out += '.*';
                    i += 2;
                    continue;
                }
                out += '[^/]*';
                i++;
                continue;
            }
            if (c === '?') {
                out += '[^/]';
                i++;
                continue;
            }
            if (c === '{') {
                const close = glob.indexOf('}', i);
                if (close > i) {
                    const parts = glob
                        .slice(i + 1, close)
                        .split(',')
                        .map(s => s.replace(/[.+^$|()[\]\\]/g, '\\$&'));
                    out += `(?:${parts.join('|')})`;
                    i = close + 1;
                    continue;
                }
            }
            if (/[.+^$|()[\]\\]/.test(c)) {
                out += `\\${c}`;
            }
            else {
                out += c;
            }
            i++;
        }
        out += '$';
        return out;
    };
    const re = new RegExp(toRegexStr(norm), process.platform === 'win32' ? 'i' : '');
    return (relPath, fileName) => {
        const cleanRel = relPath.replace(/\\/g, '/');
        return hasSlash ? re.test(cleanRel) : re.test(fileName) || re.test(cleanRel);
    };
}
// Process-local transaction serialization, like pinned OpenCode FileMutation:
// fa1260d6ca484fe0fd868aa992ad81ab85343cf3/packages/core/src/file-mutation.ts.
// External processes do not participate; content checks below remain necessary.
const fileTransactions = new Map();
async function withFileTransaction(target, action) {
    const key = process.platform === 'win32' ? target.toLowerCase() : target;
    const previous = fileTransactions.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    fileTransactions.set(key, current);
    await previous;
    try {
        return await action();
    }
    finally {
        release();
        if (fileTransactions.get(key) === current)
            fileTransactions.delete(key);
    }
}
async function fileRevision(target) {
    const stat = await fs.stat(target, { bigint: true });
    return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}
async function readMutationText(target, signal) {
    const bytes = await fs.readFile(target, { signal });
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes) || bytes.includes(0)) {
        throw new Error('File mutations require valid UTF-8 text without NUL bytes');
    }
    return text;
}
/** Full-file NUL scan (bounded to the caller's size cap), so binaries past the first 4 KB are still caught. */
async function fileHasNul(target, size, signal) {
    const handle = await fs.open(target, 'r');
    try {
        const chunk = Buffer.alloc(64 * 1024);
        let position = 0;
        while (position < size) {
            signal?.throwIfAborted();
            const length = Math.min(chunk.length, size - position);
            const { bytesRead } = await handle.read(chunk, 0, length, position);
            if (!bytesRead)
                break;
            if (chunk.subarray(0, bytesRead).includes(0))
                return true;
            position += bytesRead;
        }
        return false;
    }
    finally {
        await handle.close();
    }
}
const SEARCH_BUDGET_MS = 8_000;
const SEARCH_REGEX_LINE_LIMIT = 8_192;
const GIT_REPO_CACHE_MS = 30_000;
/** Reject scopes that are the usual catastrophic-backtracking shapes. */
const UNSAFE_REGEX_PATTERNS = [
    /\([^()]*[+*][^()]*\)\s*[+*{]/u, // (a+)+, (a*)*
    /\([^()]*\|[^()]*\)\s*[+*{]/u, // (a|a?)+, (a|aa)+
    /\\[1-9]/u, // backreferences
    /\(\?(?:=|!|<=|<!)/u, // lookarounds
];
/** POSIX ERE (git grep -E) cannot express JS-specific escapes; use the bounded Node scan instead. */
const JS_ONLY_REGEX = /\\[dDwWsSbBAZz]|\(\?[:=!<]|\\p\{|\\u\{/u;
/**
 * Runs a user-supplied regular expression off the main thread. A catastrophic
 * pattern blocks the worker event loop, never the agent; the parent terminates
 * the thread after 2.5 s. The worker file is compiled to dist/tools.
 */
class RegexMatcher {
    query;
    worker = null;
    nextId = 1;
    pending = new Map();
    constructor(query) {
        this.query = query;
    }
    ensureWorker() {
        if (this.worker)
            return this.worker;
        const compiled = new URL('./search-worker.js', import.meta.url);
        const source = new URL('./search-worker.ts', import.meta.url);
        const target = fileURLToPath(import.meta.url).endsWith('.ts')
            ? source
            : (existsSync(fileURLToPath(compiled)) ? compiled : source);
        // Under tsx the source worker is a .ts file and needs the same loader.
        // Only loader flags are forwarded: `--test`, `--input-type` and inspector
        // flags belong to the parent and break (or hijack) a worker that loads a file.
        const loaderFlags = new Set(['--import', '--loader', '--experimental-loader', '--require', '-r', '--conditions']);
        const filtered = [];
        for (let i = 0; i < process.execArgv.length; i++) {
            const arg = process.execArgv[i];
            if (loaderFlags.has(arg)) {
                filtered.push(arg);
                const value = process.execArgv[i + 1];
                if (value !== undefined) {
                    filtered.push(value);
                    i++;
                }
                continue;
            }
            if (/^--(?:import|loader|experimental-loader|require|conditions)=/u.test(arg))
                filtered.push(arg);
        }
        const execArgv = fileURLToPath(target).endsWith('.ts') && !filtered.some(arg => arg.includes('tsx'))
            ? [...filtered, '--import', 'tsx']
            : filtered;
        const worker = new Worker(target, { execArgv });
        worker.on('message', (message) => {
            const task = this.pending.get(message.id);
            if (!task)
                return;
            clearTimeout(task.timer);
            this.pending.delete(message.id);
            if (message.error)
                task.reject(new Error(message.error));
            else
                task.resolve(message.matches ?? []);
        });
        worker.on('error', error => this.failAll(error));
        worker.on('exit', code => {
            if (this.worker === worker)
                this.worker = null;
            if (code !== 0)
                this.failAll(new Error(`Regular expression worker exited with code ${code}.`));
        });
        this.worker = worker;
        return worker;
    }
    failAll(error) {
        this.worker = null;
        for (const task of this.pending.values()) {
            clearTimeout(task.timer);
            task.reject(error);
        }
        this.pending.clear();
    }
    match(lines) {
        if (!lines.length)
            return Promise.resolve([]);
        let worker;
        try {
            worker = this.ensureWorker();
        }
        catch (error) {
            return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                const current = this.worker;
                this.worker = null;
                void current?.terminate().catch(() => undefined);
                reject(new Error('Regular expression search exceeded the 2.5 second budget and was stopped. Use a simpler pattern or a literal search.'));
            }, 2_500);
            this.pending.set(id, { resolve, reject, timer });
            try {
                worker.postMessage({ id, query: this.query, lines });
            }
            catch (error) {
                clearTimeout(timer);
                this.pending.delete(id);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }
    close() {
        const worker = this.worker;
        this.failAll(new Error('Regular expression search cancelled.'));
        void worker?.terminate().catch(() => undefined);
    }
}
const gitRepoCache = new Map();
function gitEnvironment() {
    const env = childEnvironment();
    for (const key of Object.keys(env)) {
        if (key.toUpperCase().startsWith('GIT_'))
            delete env[key];
    }
    return {
        ...env,
        GIT_PAGER: 'cat',
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    };
}
function execGit(executable, cwd, args, signal, timeoutMs) {
    signal?.throwIfAborted();
    return new Promise((resolvePromise, reject) => {
        execFile(executable, [
            '--no-optional-locks',
            '-c', 'core.hooksPath=',
            '-c', 'core.fsmonitor=false',
            '-c', 'core.pager=cat',
            '-c', 'credential.helper=',
            '-c', 'core.sshCommand=',
            '-c', 'color.ui=false',
            '-c', 'color.grep=never',
            '-c', 'core.quotepath=false',
            ...args,
        ], { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true, signal, env: gitEnvironment() }, (error, stdout, stderr) => {
            const rawCode = error?.code;
            const code = typeof rawCode === 'number' ? rawCode : error ? -1 : 0;
            // `git grep` exits 1 when there are no matches.
            if (error && code !== 1) {
                reject(new Error(`Git failed: ${String(stderr || error.message).trim()}`));
                return;
            }
            resolvePromise({ stdout: stdout || '', stderr: stderr || '', code });
        });
    });
}
async function gitRepoFor(workspace, signal) {
    const key = process.platform === 'win32' ? workspace.toLowerCase() : workspace;
    const cached = gitRepoCache.get(key);
    if (cached && cached.expires > Date.now())
        return cached.info;
    let info = null;
    try {
        const executable = await resolveGitExecutable(workspace);
        const result = await execGit(executable, workspace, ['rev-parse', '--show-toplevel'], signal, 3_000);
        const root = result.stdout.trim();
        if (root)
            info = { executable, root };
    }
    catch {
        info = null;
    }
    gitRepoCache.set(key, { expires: Date.now() + GIT_REPO_CACHE_MS, info });
    return info;
}
/** Parse `git grep -n` output (`path:line:text`); context lines use `path-line-text`. */
function parseGitGrep(stdout, withContext) {
    const groups = [];
    let current = [];
    const flush = () => {
        if (current.length)
            groups.push(current);
        current = [];
    };
    for (const raw of stdout.split(/\r?\n/)) {
        if (!raw)
            continue;
        if (withContext && raw === '--') {
            flush();
            continue;
        }
        const match = /^(.*?):(\d+):(.*)$/u.exec(raw);
        if (match) {
            current.push({ file: match[1].replace(/^\.\//u, ''), line: Number(match[2]), text: match[3], match: true });
            continue;
        }
        if (withContext) {
            const context = /^(.*?)-(\d+)-(.*)$/u.exec(raw);
            if (context)
                current.push({ file: context[1].replace(/^\.\//u, ''), line: Number(context[2]), text: context[3], match: false });
        }
    }
    flush();
    return groups;
}
function searchSnippet(text, index, length) {
    const start = Math.max(0, index - 100);
    const sliceLen = Math.max(300, length);
    return `${start ? '…' : ''}${text.slice(start, start + sliceLen)}${text.length > start + sliceLen ? '…' : ''}`;
}
/** Fast path: git grep tracked + untracked text files, with the same sensitive-path filter. */
async function searchWithGit(options) {
    if (options.useRegex && JS_ONLY_REGEX.test(options.query))
        return undefined;
    const repo = await gitRepoFor(options.workspace, options.signal);
    if (!repo)
        return undefined;
    const relTarget = path.relative(options.workspace, options.target).replace(/\\/g, '/') || '.';
    if (relTarget.startsWith('..'))
        return undefined;
    let stdout;
    try {
        const result = await execGit(repo.executable, options.workspace, [
            'grep', '-n', '-I', '--untracked', '--no-color',
            ...(options.contextLines > 0 ? ['-C', String(options.contextLines)] : []),
            options.useRegex ? '-E' : '-F',
            '-e', options.query,
            '--', relTarget,
        ], options.signal, 15_000);
        stdout = result.stdout;
    }
    catch (error) {
        if (options.signal?.aborted)
            throw error;
        return undefined; // Fall back to the bounded Node scan on any git failure.
    }
    const sensitive = new Set();
    const matches = [];
    let matchCount = 0;
    let stopped = false;
    // Filter on the main thread (cheap string checks), then run the regex on the
    // worker so a pathological pattern cannot block the agent.
    const groups = parseGitGrep(stdout, options.contextLines > 0);
    const candidates = [];
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
        const group = groups[groupIndex];
        for (let index = 0; index < group.length; index++) {
            const line = group[index];
            if (!line.match)
                continue;
            if (isSensitivePath(path.resolve(options.workspace, line.file))) {
                sensitive.add(line.file);
                continue;
            }
            if (options.fileMatcher && !options.fileMatcher(line.file, path.basename(line.file)))
                continue;
            candidates.push({ line, group: groupIndex, index });
        }
    }
    const regexMatches = options.matcher
        ? await options.matcher.match(candidates.map(candidate => candidate.line.text))
        : undefined;
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
        if (stopped)
            break;
        const { line, group: groupIndex, index } = candidates[candidateIndex];
        let matched;
        if (options.matcher) {
            matched = regexMatches?.[candidateIndex] ?? undefined;
        }
        else {
            const at = line.text.indexOf(options.query);
            if (at >= 0)
                matched = { index: at, length: options.query.length };
        }
        if (!matched)
            continue;
        if (matchCount++ < options.offset)
            continue;
        if (options.contextLines > 0) {
            const group = groups[groupIndex];
            const from = Math.max(0, index - options.contextLines);
            const to = Math.min(group.length - 1, index + options.contextLines);
            const block = [];
            for (let c = from; c <= to; c++) {
                const entry = group[c];
                block.push(`${c === index ? '>' : ' '} ${entry.file}:${entry.line}: ${entry.text.slice(0, 300)}`);
            }
            matches.push(block.join('\n'));
        }
        else {
            matches.push(`${line.file}:${line.line}: ${searchSnippet(line.text, matched.index, matched.length)}`);
        }
        if (matches.length > options.limit)
            stopped = true;
    }
    return {
        matches,
        nextOffset: matches.length > options.limit ? options.offset + options.limit : null,
        capped: false,
        sensitiveSkipped: sensitive.size,
    };
}
async function rememberWrittenFile(target, content, workspace) {
    globalGroundingLedger.forgetFileSnapshot(target, workspace);
    const before = await fileRevision(target);
    if (await fs.readFile(target, 'utf8') !== content || await fileRevision(target) !== before) {
        throw new Error('File changed during write confirmation; inspect the current file before retrying');
    }
    globalGroundingLedger.markFileInspected(target, workspace, content);
    globalGroundingLedger.recordFileRevision(target, before, workspace);
}
export async function handleFileTool(name, args, workspace, signal) {
    if (!['file_read', 'file_outline', 'file_write', 'file_patch'].includes(name)) {
        return handleFileToolInTransaction(name, args, workspace, signal);
    }
    const input = typeof args.path === 'string' ? args.path : '.';
    const target = await resolveSafe(workspace, input);
    return withFileTransaction(target, async () => {
        signal?.throwIfAborted();
        if (name === 'file_write' || name === 'file_patch') {
            return handleFileToolInTransaction(name, args, workspace, signal);
        }
        globalGroundingLedger.forgetFileSnapshot(target, workspace);
        const before = await fileRevision(target);
        const output = await handleFileToolInTransaction(name, args, workspace, signal);
        if (await fileRevision(target) !== before) {
            globalGroundingLedger.forgetFileSnapshot(target, workspace);
            throw new Error('File changed during inspection; read the file again');
        }
        if (!output.startsWith('[İKİLİ DOSYA ENGELİ'))
            globalGroundingLedger.recordFileRevision(target, before, workspace);
        // Reading a protected file is allowed only after approval (enforced by the
        // tool dispatcher), and secret-looking values are masked here.
        return isSensitivePath(target) ? redactSecrets(output) : output;
    });
}
async function handleFileToolInTransaction(name, args, workspace, signal) {
    signal?.throwIfAborted();
    // Forward background process management tools to shell handler if invoked through file tool dispatcher
    if (name === 'process_list' || name === 'process_output' || name === 'process_stop') {
        return handleShellTool(name, args, workspace, signal);
    }
    const input = typeof args.path === 'string' ? args.path : '.';
    const target = await resolveSafe(workspace, input);
    if (name === 'file_outline') {
        const stat = await fs.stat(target);
        if (!stat.isFile())
            throw new Error('Not a regular file');
        if (stat.size > 10 * 1024 * 1024)
            throw new Error('File exceeds the 10 MB outline limit');
        const relPath = path.relative(workspace, target).replace(/\\/g, '/') || path.basename(target);
        if (await fileHasNul(target, stat.size, signal)) {
            return `[İKİLİ DOSYA ENGELİ: '${relPath}' ikili (binary) bir dosyadır ve metin olarak okunamaz.]`;
        }
        const content = await fs.readFile(target, 'utf8');
        const outline = extractFileAstOutline(relPath, content);
        globalGroundingLedger.markFileInspected(target, workspace, content);
        return outline.formatted;
    }
    if (name === 'file_read') {
        const stat = await fs.stat(target);
        if (!stat.isFile())
            throw new Error('Not a regular file');
        const relPath = path.relative(workspace, target).replace(/\\/g, '/') || path.basename(target);
        // 1. File size guard (>10 MB) to prevent OOM
        if (stat.size > 10 * 1024 * 1024) {
            throw new Error(`[BOYUT ENGELİ: '${relPath}' dosyası 10 MB sınırını aşıyor (${(stat.size / (1024 * 1024)).toFixed(1)} MB); bellek tükenmesini (OOM) önlemek için okuma engellendi.]`);
        }
        // 2. Binary file protection: scan the whole bounded file for a NUL byte,
        //    not just the first 4 KB (binaries can start with a text header).
        if (await fileHasNul(target, stat.size, signal)) {
            return `[İKİLİ DOSYA ENGELİ: '${relPath}' ikili (binary) bir dosyadır ve metin olarak okunamaz.]`;
        }
        // 3. Explicit AST Skeleton reading (%75 token savings)
        if (args.skeleton === true) {
            const content = await fs.readFile(target, 'utf8');
            const outline = extractFileAstOutline(relPath, content);
            const fullTokens = estimateTokens(content);
            const skeletonTokens = estimateTokens(outline.formatted);
            const savedTokens = Math.max(0, fullTokens - skeletonTokens);
            globalTokenTracker.recordContextCacheSaving(savedTokens);
            globalGroundingLedger.markFileInspected(target, workspace, content);
            return outline.formatted;
        }
        // 4. Line range mode
        if (args.start_line !== undefined || args.end_line !== undefined) {
            const content = await fs.readFile(target, 'utf8');
            const allLines = content.split(/\r?\n/);
            const start = typeof args.start_line === 'number' && Number.isInteger(args.start_line) ? Math.max(1, args.start_line) : 1;
            const end = typeof args.end_line === 'number' && Number.isInteger(args.end_line) ? Math.min(allLines.length, Math.max(start, args.end_line)) : allLines.length;
            const selected = allLines.slice(start - 1, end);
            const formatted = selected.map((line, idx) => `${start + idx}: ${line}`).join('\n') || '(empty line range)';
            globalGroundingLedger.markFileInspected(target, workspace, content);
            const diff = globalContextCache.checkAndRecordRead(workspace, relPath, content, start, end, formatted);
            return diff.output;
        }
        // 5. Explicit Full Content / Bypass Skeletonization Mode
        const bypassSkeleton = args.skeleton === false || args.full === true;
        if (bypassSkeleton && args.offset === undefined && args.start_line === undefined && args.end_line === undefined) {
            const content = await fs.readFile(target, 'utf8');
            globalGroundingLedger.markFileInspected(target, workspace, content);
            return content;
        }
        // 6. Automatic Large File Skeletonization (>320 lines of code)
        const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs']);
        const ext = path.extname(target).toLowerCase();
        if (!bypassSkeleton && CODE_EXTENSIONS.has(ext) && (args.offset === undefined || args.offset === 0)) {
            const content = await fs.readFile(target, 'utf8');
            const allLines = content.split(/\r?\n/);
            if (allLines.length > 320) {
                const head = allLines.slice(0, 80).map((l, idx) => `${idx + 1}: ${l}`).join('\n');
                const outline = extractFileAstOutline(relPath, content);
                const tailStart = Math.max(80, allLines.length - 30);
                const tail = allLines.slice(-30).map((l, idx) => `${tailStart + idx + 1}: ${l}`).join('\n');
                const summaryMsg = `[AKILLI AST İSKELET ÖZETİ: Dosya ${allLines.length} satır. Token tasarrufu için aşağıda tüm sembollerin satır aralıkları verilmiştir; hedef fonksiyonu start_line/end_line ile okuyun]`;
                const result = `${head}\n\n${summaryMsg}\n\n${outline.formatted}\n\n[Son 30 Satır]:\n${tail}`;
                const fullTokens = estimateTokens(content);
                const resultTokens = estimateTokens(result);
                const savedTokens = Math.max(0, fullTokens - resultTokens);
                globalTokenTracker.recordContextCacheSaving(savedTokens);
                globalGroundingLedger.markFileInspected(target, workspace, content);
                return result;
            }
        }
        // Default offset / max_bytes mode
        const handle = await fs.open(target, 'r');
        try {
            const offset = numberArg(args.offset, 0, Number.MAX_SAFE_INTEGER);
            const maxBytes = Math.max(1, numberArg(args.max_bytes, 12000, LIMIT));
            const buffer = Buffer.alloc(maxBytes + 1);
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
            let consumed = Math.min(bytesRead, maxBytes);
            // Avoid splitting a UTF-8 character between pages.
            if (bytesRead > maxBytes) {
                while (consumed > 0 && (buffer[consumed] & 0xc0) === 0x80)
                    consumed--;
                if (!consumed)
                    consumed = maxBytes;
            }
            const decoder = new StringDecoder('utf8');
            const text = decoder.write(buffer.subarray(0, consumed)) + decoder.end();
            const nextOffset = bytesRead > consumed ? offset + consumed : null;
            globalGroundingLedger.markFileInspected(target, workspace, offset === 0 && nextOffset === null ? text : undefined);
            if (offset === 0 && nextOffset === null) {
                const lineCount = text.length === 0 ? 1 : text.split(/\r?\n/).length;
                const diff = globalContextCache.checkAndRecordRead(workspace, relPath, text, 1, lineCount, text);
                return JSON.stringify({ content: diff.output, offset, next_offset: null });
            }
            return JSON.stringify({ content: text, offset, next_offset: nextOffset });
        }
        finally {
            await handle.close();
        }
    }
    if (name === 'file_list') {
        const entries = await fs.readdir(target, { withFileTypes: true });
        entries.sort((a, b) => a.name.localeCompare(b.name));
        const offset = numberArg(args.offset, 0, Number.MAX_SAFE_INTEGER);
        const limit = Math.max(1, numberArg(args.limit, 80, 500));
        return JSON.stringify({
            entries: entries.slice(offset, offset + limit).map(e => ({
                name: e.name,
                type: e.isDirectory() ? 'dir' : e.isSymbolicLink() ? 'symlink' : 'file',
            })),
            next_offset: offset + limit < entries.length ? offset + limit : null,
        });
    }
    if (name === 'file_glob') {
        const pattern = string(args, 'pattern');
        const root = await fs.realpath(workspace);
        const limit = Math.max(1, numberArg(args.limit, 100, 500));
        const matcher = globToMatcher(pattern);
        const matches = [];
        let visited = 0;
        let capped = false;
        async function walkGlob(dir) {
            signal?.throwIfAborted();
            if (matches.length >= limit || capped)
                return;
            const entries = await fs.readdir(dir, { withFileTypes: true });
            entries.sort((a, b) => a.name.localeCompare(b.name));
            for (const entry of entries) {
                signal?.throwIfAborted();
                if (++visited > 20000) {
                    capped = true;
                    return;
                }
                if (entry.isSymbolicLink() || SKIP_DIRS.has(entry.name))
                    continue;
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    await walkGlob(full);
                    if (matches.length >= limit || capped)
                        return;
                }
                else if (entry.isFile()) {
                    const relFromRoot = path.relative(root, full).replace(/\\/g, '/');
                    const relFromTarget = path.relative(target, full).replace(/\\/g, '/');
                    if (matcher(relFromTarget, entry.name) || matcher(relFromRoot, entry.name)) {
                        matches.push(relFromRoot);
                        if (matches.length >= limit)
                            return;
                    }
                }
            }
        }
        const stat = await fs.stat(target);
        if (!stat.isDirectory())
            throw new Error('Glob search path must be a directory');
        await walkGlob(target);
        return JSON.stringify({
            files: matches,
            count: matches.length,
            truncated: matches.length >= limit || capped,
        });
    }
    if (name === 'file_write') {
        assertNotSensitivePath(target, { operation: 'write' });
        if (typeof args.content !== 'string')
            throw new Error('content must be a string');
        if (Buffer.byteLength(args.content) > 1_000_000)
            throw new Error('Content exceeds 1 MB');
        let exists = false;
        let oldContent = null;
        try {
            const stat = await fs.stat(target);
            exists = stat.isFile();
            if (!exists)
                throw new Error('Not a regular file');
            if (stat.size > 10 * 1024 * 1024)
                throw new Error('Existing file exceeds the 10 MB read limit');
            if (exists) {
                oldContent = await readMutationText(target, signal);
            }
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        // 1. Read-Before-Write Grounding Gate (throws on failure so executeTool records ok: false)
        if (exists) {
            const check = globalGroundingLedger.verifyCanModifyFile(target, exists, workspace);
            if (!check.allowed) {
                throw new Error(check.error);
            }
            globalGroundingLedger.assertFileSnapshot(target, await fileRevision(target), oldContent, workspace);
        }
        // 2. Anti-Truncation Guard
        if (LAZY_PLACEHOLDER_REGEX.test(args.content)) {
            throw new Error('[KESİLME ENGELİ] Mevcut büyük dosyayı kısaltarak veya yer tutucu yorumlarla ezemezsiniz. Cerrahi değişiklik için file_patch kullanın.');
        }
        if (exists && oldContent !== null) {
            const oldLineCount = oldContent.split(/\r?\n/).length;
            const newLineCount = args.content.split(/\r?\n/).length;
            if (oldLineCount > 100 && newLineCount < oldLineCount * 0.5) {
                throw new Error('[KESİLME ENGELİ] Mevcut büyük dosyayı kısaltarak veya yer tutucu yorumlarla ezemezsiniz. Cerrahi değişiklik için file_patch kullanın.');
            }
        }
        // 3. Validate-Before-Write (in-memory AST & Grounding check BEFORE touching disk)
        const syntax = await validateFileSyntax(target, args.content, workspace);
        if (!syntax.valid) {
            throw new Error(`Sözdizimi/Grounding Doğrulama Hatası: ${syntax.error}`);
        }
        if (exists && oldContent !== null) {
            await saveCheckpoint(workspace, target, oldContent, 'file_write').catch(() => undefined);
        }
        await atomicWrite(target, args.content, workspace, input, signal, oldContent);
        const relPath = path.relative(workspace, target).replace(/\\/g, '/');
        globalContextCache.invalidateFile(workspace, relPath);
        globalGroundingLedger.markFileModified(target, workspace);
        await rememberWrittenFile(target, args.content, workspace);
        let msg = 'File written.';
        if (syntax.warnings && syntax.warnings.length > 0) {
            msg += `\n[AST UYARILARI]:\n${syntax.warnings.map(w => `- ${w}`).join('\n')}`;
        }
        return msg;
    }
    if (name === 'file_patch') {
        assertNotSensitivePath(target, { operation: 'write' });
        const patches = [];
        if (Array.isArray(args.patches) && args.patches.length > 0) {
            if (args.patches.length > 32)
                throw new Error('A patch batch may contain at most 32 hunks');
            for (const item of args.patches) {
                if (!item || typeof item !== 'object')
                    throw new Error('Each patch item must be an object');
                const rec = item;
                if (typeof rec.old_text !== 'string' || !rec.old_text)
                    throw new Error('old_text must be a non-empty string');
                if (typeof rec.new_text !== 'string')
                    throw new Error('new_text must be a string');
                patches.push({ old_text: rec.old_text, new_text: rec.new_text });
            }
        }
        else {
            const old = string(args, 'old_text');
            if (typeof args.new_text !== 'string')
                throw new Error('new_text must be a string');
            patches.push({ old_text: old, new_text: args.new_text });
        }
        if (patches.reduce((total, patch) => total + patch.old_text.length + patch.new_text.length, 0) > 1_000_000) {
            throw new Error('Combined patch text exceeds 1 million characters');
        }
        let exists = false;
        let oldContent = '';
        try {
            const stat = await fs.stat(target);
            exists = stat.isFile();
            if (stat.size > 1_000_000)
                throw new Error('File exceeds 1 MB');
            oldContent = await readMutationText(target, signal);
        }
        catch (e) {
            if (e.code === 'ENOENT')
                throw new Error(`File not found: ${input}`);
            throw e;
        }
        // 1. Read-Before-Write Grounding Gate (throws on failure so executeTool records ok: false)
        const check = globalGroundingLedger.verifyCanModifyFile(target, exists, workspace);
        if (!check.allowed) {
            throw new Error(check.error);
        }
        globalGroundingLedger.assertFileSnapshot(target, await fileRevision(target), oldContent, workspace);
        let nextContent = oldContent;
        let added = 0;
        let removed = 0;
        let firstPatchLine = 1;
        for (let i = 0; i < patches.length; i++) {
            const p = patches[i];
            if (LAZY_PLACEHOLDER_REGEX.test(p.new_text)) {
                throw new Error('[KESİLME ENGELİ] Mevcut büyük dosyayı kısaltarak veya yer tutucu yorumlarla ezemezsiniz. Cerrahi değişiklik için file_patch kullanın.');
            }
            const applied = applyEdit(nextContent, p.old_text, p.new_text);
            nextContent = applied.content;
            if (i === 0) {
                firstPatchLine = applied.line;
            }
            added += p.new_text.split(/\r?\n/).length;
            removed += p.old_text.split(/\r?\n/).length;
        }
        if (Buffer.byteLength(nextContent) > 1_000_000)
            throw new Error('Result exceeds 1 MB');
        // 2. Validate-Before-Write (in-memory AST & Grounding check BEFORE touching disk)
        const syntax = await validateFileSyntax(target, nextContent, workspace);
        if (!syntax.valid) {
            throw new Error(`Sözdizimi/Grounding Doğrulama Hatası: ${syntax.error}`);
        }
        await saveCheckpoint(workspace, target, oldContent, 'file_patch').catch(() => undefined);
        await atomicWrite(target, nextContent, workspace, input, signal, oldContent);
        const rel = path.relative(workspace, target).replace(/\\/g, '/') || input;
        globalContextCache.invalidateFile(workspace, rel);
        globalGroundingLedger.markFileModified(target, workspace);
        await rememberWrittenFile(target, nextContent, workspace);
        let msg = `File patched: ${rel} (+${added}/-${removed} lines, around L${firstPatchLine})`;
        if (syntax.warnings && syntax.warnings.length > 0) {
            msg += `\n[AST UYARILARI]:\n${syntax.warnings.map(w => `- ${w}`).join('\n')}`;
        }
        return msg;
    }
    if (name === 'file_search') {
        const query = string(args, 'query');
        const useRegex = args.regex === true;
        const filePattern = typeof args.file_pattern === 'string' && args.file_pattern.trim() ? args.file_pattern.trim() : undefined;
        const contextLines = numberArg(args.context_lines, 0, 10);
        const fileMatcher = filePattern ? globToMatcher(filePattern) : undefined;
        const offset = numberArg(args.offset, 0, 100000);
        const limit = Math.max(1, numberArg(args.limit, 30, 200));
        if (useRegex) {
            if (UNSAFE_REGEX_PATTERNS.some(pattern => pattern.test(query))) {
                throw new Error('Potentially catastrophic regular expression; simplify the pattern or search for a literal string.');
            }
            try {
                new RegExp(query);
            }
            catch (e) {
                throw new Error(`Invalid regular expression: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
        const matcher = useRegex ? new RegexMatcher(query) : undefined;
        try {
            const stat = await fs.stat(target);
            if (!stat.isDirectory())
                throw new Error('Search path must be a directory');
            // Git's `-C` context is parsed back into per-match blocks; any git failure
            // falls back to the bounded in-process scan below.
            const gitResult = await searchWithGit({
                workspace, target, query, useRegex, matcher, fileMatcher, contextLines, offset, limit, signal,
            });
            let result;
            if (gitResult) {
                result = gitResult;
            }
            else {
                const root = await fs.realpath(workspace);
                const found = [];
                const deadline = Date.now() + SEARCH_BUDGET_MS;
                let matches = 0;
                let visited = 0;
                let stopped = false;
                let capped = false;
                let sensitiveSkipped = 0;
                async function walk(dir) {
                    signal?.throwIfAborted();
                    if (stopped)
                        return;
                    if (Date.now() > deadline) {
                        stopped = true;
                        capped = true;
                        return;
                    }
                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    entries.sort((a, b) => a.name.localeCompare(b.name));
                    for (const entry of entries) {
                        signal?.throwIfAborted();
                        if (++visited > 10000) {
                            stopped = true;
                            capped = true;
                            return;
                        }
                        if (entry.isSymbolicLink() || SKIP_DIRS.has(entry.name))
                            continue;
                        const full = path.join(dir, entry.name);
                        // Credential files and directories are never read into the result set.
                        if (isSensitivePath(full)) {
                            sensitiveSkipped++;
                            continue;
                        }
                        if (entry.isDirectory()) {
                            await walk(full);
                        }
                        else if (entry.isFile()) {
                            const relFile = path.relative(root, full);
                            if (fileMatcher && !fileMatcher(relFile, entry.name))
                                continue;
                            const fileStat = await fs.stat(full);
                            if (fileStat.size > 1_000_000)
                                continue;
                            const content = await fs.readFile(full, 'utf8');
                            if (content.includes('\0'))
                                continue;
                            const lines = content.split(/\r?\n/);
                            const lineMatches = matcher
                                ? await matcher.match(lines.map(line => line.length > SEARCH_REGEX_LINE_LIMIT ? line.slice(0, SEARCH_REGEX_LINE_LIMIT) : line))
                                : undefined;
                            for (let i = 0; i < lines.length; i++) {
                                if ((i & 63) === 0) {
                                    signal?.throwIfAborted();
                                    if (Date.now() > deadline) {
                                        stopped = true;
                                        capped = true;
                                        return;
                                    }
                                }
                                const line = lines[i];
                                let matchIdx = -1;
                                let matchLen = query.length;
                                if (matcher) {
                                    const found = lineMatches?.[i];
                                    if (found) {
                                        matchIdx = found.index;
                                        matchLen = found.length;
                                    }
                                }
                                else {
                                    matchIdx = line.indexOf(query);
                                }
                                if (matchIdx >= 0) {
                                    if (matches++ >= offset) {
                                        const snippet = searchSnippet(line, matchIdx, matchLen);
                                        if (contextLines > 0) {
                                            const ctxStart = Math.max(0, i - contextLines);
                                            const ctxEnd = Math.min(lines.length - 1, i + contextLines);
                                            const block = [];
                                            for (let c = ctxStart; c <= ctxEnd; c++) {
                                                const prefix = c === i ? '>' : ' ';
                                                block.push(`${prefix} ${relFile}:${c + 1}: ${lines[c].slice(0, 300)}`);
                                            }
                                            found.push(block.join('\n'));
                                        }
                                        else {
                                            found.push(`${relFile}:${i + 1}: ${snippet}`);
                                        }
                                    }
                                    if (found.length > limit) {
                                        stopped = true;
                                        return;
                                    }
                                }
                            }
                        }
                    }
                }
                await walk(target);
                result = {
                    matches: found,
                    nextOffset: found.length > limit ? offset + limit : null,
                    capped,
                    sensitiveSkipped,
                };
            }
            // Redact each match string before serialization: redacting the JSON
            // payload itself can break quoting and produce invalid JSON.
            return JSON.stringify({
                matches: result.matches.slice(0, limit).map(match => redactSecrets(match)),
                next_offset: result.nextOffset,
                scan_limit_reached: result.capped,
                sensitive_skipped: result.sensitiveSkipped,
            });
        }
        finally {
            matcher?.close();
        }
    }
    throw new Error(`Unknown file tool: ${name}`);
}
//# sourceMappingURL=files.js.map