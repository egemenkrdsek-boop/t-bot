import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { globalGroundingLedger, validateFileSyntax } from '../grounding.js';
import { handleShellTool } from './shell.js';
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
        }, ['path']),
    },
    {
        name: 'file_outline',
        description: 'Extract an outline of symbols (classes, functions, methods, interfaces, types, exports, markdown headings) with line numbers.',
        parameters: schema({ path: p }, ['path']),
    },
    {
        name: 'file_list',
        description: 'List a workspace directory.',
        parameters: schema({ path: p, offset: offsetParam, limit: limitParam }, []),
    },
    {
        name: 'file_search',
        description: 'Search UTF-8 workspace files for literal text.',
        parameters: schema({ path: p, query: { type: 'string' }, offset: offsetParam, limit: limitParam }, ['query']),
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
function inside(root, target) {
    const relative = path.relative(root, target);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
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
        if (expected !== undefined && (await fs.readFile(target, { encoding: 'utf8', signal })) !== expected) {
            throw new Error('File changed since patch was read; patch not applied');
        }
        signal?.throwIfAborted();
        await fs.rename(temp, target);
    }
    finally {
        await fs.unlink(temp).catch(() => { });
    }
}
function extractSymbols(lines) {
    const symbols = [];
    const isOutlineSymbol = (trimmed) => {
        if (!trimmed)
            return false;
        if (trimmed.startsWith('#'))
            return true; // Markdown
        if (/^(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+\w+/.test(trimmed))
            return true;
        if (/^(?:export\s+)?interface\s+\w+/.test(trimmed))
            return true;
        if (/^(?:export\s+)?type\s+\w+\s*=/.test(trimmed))
            return true;
        if (/^(?:export\s+)?enum\s+\w+/.test(trimmed))
            return true;
        if (/^(?:export\s+(?:default\s+)?)?(?:async\s+)?function(?:\s*\*|\s+)\w+/.test(trimmed))
            return true;
        if (/^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>/.test(trimmed))
            return true;
        if (/^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*function\b/.test(trimmed))
            return true;
        if (/^(?:(?:public|private|protected|static|readonly|async|\*)\s+)*(?:get\s+|set\s+)?[#a-zA-Z0-9_$]+\s*\([^)]*\)\s*(?::\s*[^;{]+)?\s*\{?$/.test(trimmed))
            return true;
        if (/^(?:def|class)\s+\w+/.test(trimmed))
            return true; // Python
        if (/^export\s+(?:\{|\*)/.test(trimmed))
            return true; // export { ... } or export *
        return false;
    };
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (isOutlineSymbol(trimmed)) {
            const display = trimmed.length > 120 ? trimmed.slice(0, 117) + '...' : trimmed;
            symbols.push(`L${i + 1}: ${display}`);
            if (symbols.length >= 120)
                break;
        }
    }
    return symbols;
}
function applyPatchHunk(content, oldText, newText) {
    // 1. Direct match
    const at = content.indexOf(oldText);
    if (at >= 0) {
        if (content.indexOf(oldText, at + 1) >= 0)
            throw new Error('old_text must occur exactly once');
        return content.slice(0, at) + newText + content.slice(at + oldText.length);
    }
    // 2. CRLF -> LF and LF -> CRLF tolerance
    const oldCRLF = oldText.replace(/(?<!\r)\n/g, '\r\n');
    const atCRLF = content.indexOf(oldCRLF);
    if (atCRLF >= 0) {
        if (content.indexOf(oldCRLF, atCRLF + 1) >= 0)
            throw new Error('old_text must occur exactly once');
        const newCRLF = newText.replace(/(?<!\r)\n/g, '\r\n');
        return content.slice(0, atCRLF) + newCRLF + content.slice(atCRLF + oldCRLF.length);
    }
    const oldLF = oldText.replace(/\r\n/g, '\n');
    const atLF = content.indexOf(oldLF);
    if (atLF >= 0) {
        if (content.indexOf(oldLF, atLF + 1) >= 0)
            throw new Error('old_text must occur exactly once');
        const newLF = newText.replace(/\r\n/g, '\n');
        return content.slice(0, atLF) + newLF + content.slice(atLF + oldLF.length);
    }
    // 3. Fallback: normalize both content and oldText to LF and restore dominant newline
    const contentLF = content.replace(/\r\n/g, '\n');
    const atNorm = contentLF.indexOf(oldLF);
    if (atNorm >= 0) {
        if (contentLF.indexOf(oldLF, atNorm + 1) >= 0)
            throw new Error('old_text must occur exactly once');
        const newLF = newText.replace(/\r\n/g, '\n');
        const replacedLF = contentLF.slice(0, atNorm) + newLF + contentLF.slice(atNorm + oldLF.length);
        const isCRLF = (content.match(/\r\n/g)?.length ?? 0) > (content.match(/[^\r]\n/g)?.length ?? 0);
        return isCRLF ? replacedLF.replace(/(?<!\r)\n/g, '\r\n') : replacedLF;
    }
    throw new Error('old_text was not found in file');
}
export async function handleFileTool(name, args, workspace, signal) {
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
        const content = await fs.readFile(target, 'utf8');
        const lines = content.split(/\r?\n/);
        const symbols = extractSymbols(lines);
        globalGroundingLedger.markFileInspected(target, workspace);
        const summary = `Total lines: ${lines.length} | Outline symbols: ${symbols.length}${symbols.length >= 120 ? ' (showing first 120)' : ''}\n`;
        return summary + symbols.join('\n');
    }
    if (name === 'file_read') {
        const stat = await fs.stat(target);
        if (!stat.isFile())
            throw new Error('Not a regular file');
        // Line range mode
        if (args.start_line !== undefined || args.end_line !== undefined) {
            const content = await fs.readFile(target, 'utf8');
            const allLines = content.split(/\r?\n/);
            const start = typeof args.start_line === 'number' && Number.isInteger(args.start_line) ? Math.max(1, args.start_line) : 1;
            const end = typeof args.end_line === 'number' && Number.isInteger(args.end_line) ? Math.min(allLines.length, Math.max(start, args.end_line)) : allLines.length;
            const selected = allLines.slice(start - 1, end);
            const formatted = selected.map((line, idx) => `${start + idx}: ${line}`).join('\n');
            globalGroundingLedger.markFileInspected(target, workspace);
            return formatted || '(empty line range)';
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
            globalGroundingLedger.markFileInspected(target, workspace);
            return JSON.stringify({ content: text, offset, next_offset: bytesRead > consumed ? offset + consumed : null });
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
    if (name === 'file_write') {
        if (typeof args.content !== 'string')
            throw new Error('content must be a string');
        if (Buffer.byteLength(args.content) > 1_000_000)
            throw new Error('Content exceeds 1 MB');
        let exists = false;
        let oldContent = null;
        try {
            const stat = await fs.stat(target);
            exists = stat.isFile();
            if (exists) {
                oldContent = await fs.readFile(target, 'utf8');
            }
        }
        catch {
            exists = false;
        }
        // Grounding check for existing files
        if (exists) {
            const check = globalGroundingLedger.verifyCanModifyFile(target, exists, workspace);
            if (!check.allowed) {
                return JSON.stringify({ ok: false, output: check.error });
            }
        }
        await atomicWrite(target, args.content, workspace, input, signal);
        // Validate syntax immediately after write
        const syntax = await validateFileSyntax(target, args.content, workspace);
        if (!syntax.valid) {
            if (oldContent !== null) {
                await fs.writeFile(target, oldContent, 'utf8');
            }
            else {
                await fs.unlink(target).catch(() => { });
            }
            return JSON.stringify({
                ok: false,
                output: 'Sözdizimi/Grounding Doğrulama Hatası (Değişiklik geri alındı): ' + syntax.error,
            });
        }
        globalGroundingLedger.markFileModified(target, workspace);
        return 'File written.';
    }
    if (name === 'file_patch') {
        const patches = [];
        if (Array.isArray(args.patches) && args.patches.length > 0) {
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
        let exists = false;
        let oldContent = '';
        try {
            const stat = await fs.stat(target);
            exists = stat.isFile();
            if (stat.size > 1_000_000)
                throw new Error('File exceeds 1 MB');
            oldContent = await fs.readFile(target, { encoding: 'utf8', signal });
        }
        catch (e) {
            if (e.code === 'ENOENT')
                throw new Error(`File not found: ${input}`);
            throw e;
        }
        // Grounding check before modifying file
        const check = globalGroundingLedger.verifyCanModifyFile(target, exists, workspace);
        if (!check.allowed) {
            return JSON.stringify({ ok: false, output: check.error });
        }
        let nextContent = oldContent;
        for (const p of patches) {
            nextContent = applyPatchHunk(nextContent, p.old_text, p.new_text);
        }
        if (Buffer.byteLength(nextContent) > 1_000_000)
            throw new Error('Result exceeds 1 MB');
        await atomicWrite(target, nextContent, workspace, input, signal, oldContent);
        // Validate syntax immediately after patch
        const syntax = await validateFileSyntax(target, nextContent, workspace);
        if (!syntax.valid) {
            await fs.writeFile(target, oldContent, 'utf8');
            return JSON.stringify({
                ok: false,
                output: 'Sözdizimi/Grounding Doğrulama Hatası (Değişiklik geri alındı): ' + syntax.error,
            });
        }
        globalGroundingLedger.markFileModified(target, workspace);
        return 'File patched.';
    }
    if (name === 'file_search') {
        const query = string(args, 'query');
        const root = await fs.realpath(workspace);
        const found = [];
        const offset = numberArg(args.offset, 0, 100000);
        const limit = Math.max(1, numberArg(args.limit, 30, 200));
        let matches = 0;
        let visited = 0;
        let stopped = false;
        let capped = false;
        async function walk(dir) {
            signal?.throwIfAborted();
            if (stopped)
                return;
            const entries = await fs.readdir(dir, { withFileTypes: true });
            entries.sort((a, b) => a.name.localeCompare(b.name));
            for (const entry of entries) {
                signal?.throwIfAborted();
                if (++visited > 10000) {
                    stopped = true;
                    capped = true;
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
                    let fileMatched = false;
                    for (const [i, line] of content.split(/\r?\n/).entries()) {
                        if (line.includes(query)) {
                            fileMatched = true;
                            if (matches++ >= offset) {
                                const start = Math.max(0, line.indexOf(query) - 100);
                                found.push(`${path.relative(root, full)}:${i + 1}: ${start ? '…' : ''}${line.slice(start, start + Math.max(300, query.length))}${line.length > start + Math.max(300, query.length) ? '…' : ''}`);
                            }
                            if (found.length > limit) {
                                stopped = true;
                                return;
                            }
                        }
                    }
                    if (fileMatched) {
                        globalGroundingLedger.markFileInspected(full, workspace);
                    }
                }
            }
        }
        const stat = await fs.stat(target);
        if (stat.isDirectory())
            await walk(target);
        else
            throw new Error('Search path must be a directory');
        globalGroundingLedger.markFileInspected(target, workspace);
        return JSON.stringify({ matches: found.slice(0, limit), next_offset: found.length > limit ? offset + limit : null, scan_limit_reached: capped });
    }
    throw new Error(`Unknown file tool: ${name}`);
}
//# sourceMappingURL=files.js.map