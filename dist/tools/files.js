import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { globalGroundingLedger, validateFileSyntax } from '../grounding.js';
import { extractFileAstOutline } from '../repo-map.js';
import { globalContextCache } from '../context-cache.js';
import { estimateTokens, globalTokenTracker } from '../token-optimizer.js';
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
function applyPatchHunk(content, oldText, newText) {
    const lineAtOffset = (text, index) => text.slice(0, index).split(/\r?\n/).length;
    // 1. Direct match
    const at = content.indexOf(oldText);
    if (at >= 0) {
        if (content.indexOf(oldText, at + 1) >= 0)
            throw new Error('old_text must occur exactly once');
        return {
            content: content.slice(0, at) + newText + content.slice(at + oldText.length),
            line: lineAtOffset(content, at),
        };
    }
    // 2. CRLF -> LF and LF -> CRLF tolerance
    const oldCRLF = oldText.replace(/(?<!\r)\n/g, '\r\n');
    const atCRLF = content.indexOf(oldCRLF);
    if (atCRLF >= 0) {
        if (content.indexOf(oldCRLF, atCRLF + 1) >= 0)
            throw new Error('old_text must occur exactly once');
        const newCRLF = newText.replace(/(?<!\r)\n/g, '\r\n');
        return {
            content: content.slice(0, atCRLF) + newCRLF + content.slice(atCRLF + oldCRLF.length),
            line: lineAtOffset(content, atCRLF),
        };
    }
    const oldLF = oldText.replace(/\r\n/g, '\n');
    const atLF = content.indexOf(oldLF);
    if (atLF >= 0) {
        if (content.indexOf(oldLF, atLF + 1) >= 0)
            throw new Error('old_text must occur exactly once');
        const newLF = newText.replace(/\r\n/g, '\n');
        return {
            content: content.slice(0, atLF) + newLF + content.slice(atLF + oldLF.length),
            line: lineAtOffset(content, atLF),
        };
    }
    // 3. Fallback: normalize both content and oldText to LF and restore dominant newline
    const isCRLF = (content.match(/\r\n/g)?.length ?? 0) > (content.match(/[^\r]\n/g)?.length ?? 0);
    const contentLF = content.replace(/\r\n/g, '\n');
    const atNorm = contentLF.indexOf(oldLF);
    if (atNorm >= 0) {
        if (contentLF.indexOf(oldLF, atNorm + 1) >= 0)
            throw new Error('old_text must occur exactly once');
        const newLF = newText.replace(/\r\n/g, '\n');
        const replacedLF = contentLF.slice(0, atNorm) + newLF + contentLF.slice(atNorm + oldLF.length);
        return {
            content: isCRLF ? replacedLF.replace(/(?<!\r)\n/g, '\r\n') : replacedLF,
            line: lineAtOffset(contentLF, atNorm),
        };
    }
    // 4. Trailing whitespace tolerant line-by-line match (trimEnd normalization)
    const contentLines = contentLF.split('\n');
    const oldLines = oldLF.split('\n');
    const oldTrimmed = oldLines.map(l => l.trimEnd());
    if (oldLines.length > 0 && oldLines.length <= contentLines.length) {
        const matchIndices = [];
        for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
            let ok = true;
            for (let j = 0; j < oldLines.length; j++) {
                if (contentLines[i + j].trimEnd() !== oldTrimmed[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) {
                matchIndices.push(i);
            }
        }
        if (matchIndices.length > 1) {
            throw new Error('old_text must occur exactly once');
        }
        if (matchIndices.length === 1) {
            const startIdx = matchIndices[0];
            const newLines = newText.replace(/\r\n/g, '\n').split('\n');
            const updatedLines = [
                ...contentLines.slice(0, startIdx),
                ...newLines,
                ...contentLines.slice(startIdx + oldLines.length),
            ];
            const joinedLF = updatedLines.join('\n');
            return {
                content: isCRLF ? joinedLF.replace(/(?<!\r)\n/g, '\r\n') : joinedLF,
                line: startIdx + 1,
            };
        }
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
        const relPath = path.relative(workspace, target).replace(/\\/g, '/') || path.basename(target);
        const outline = extractFileAstOutline(relPath, content);
        globalGroundingLedger.markFileInspected(target, workspace);
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
        // 2. Binary file protection: inspect first 4096 bytes for null byte (\0)
        const probeHandle = await fs.open(target, 'r');
        let isBinary = false;
        try {
            const probeBuf = Buffer.alloc(Math.min(4096, stat.size));
            const { bytesRead } = await probeHandle.read(probeBuf, 0, probeBuf.length, 0);
            for (let i = 0; i < bytesRead; i++) {
                if (probeBuf[i] === 0) {
                    isBinary = true;
                    break;
                }
            }
        }
        finally {
            await probeHandle.close();
        }
        if (isBinary) {
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
            globalGroundingLedger.markFileInspected(target, workspace);
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
            globalGroundingLedger.markFileInspected(target, workspace);
            const diff = globalContextCache.checkAndRecordRead(workspace, relPath, content, start, end, formatted);
            return diff.output;
        }
        // 5. Automatic Large File Skeletonization (>320 lines of code)
        const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs']);
        const ext = path.extname(target).toLowerCase();
        if (CODE_EXTENSIONS.has(ext) && (args.offset === undefined || args.offset === 0)) {
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
                globalGroundingLedger.markFileInspected(target, workspace);
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
            globalGroundingLedger.markFileInspected(target, workspace);
            const nextOffset = bytesRead > consumed ? offset + consumed : null;
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
        // 1. Read-Before-Write Grounding Gate (throws on failure so executeTool records ok: false)
        if (exists) {
            const check = globalGroundingLedger.verifyCanModifyFile(target, exists, workspace);
            if (!check.allowed) {
                throw new Error(check.error);
            }
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
        await atomicWrite(target, args.content, workspace, input, signal);
        const relPath = path.relative(workspace, target).replace(/\\/g, '/');
        globalContextCache.invalidateFile(workspace, relPath);
        globalGroundingLedger.markFileModified(target, workspace);
        let msg = 'File written.';
        if (syntax.warnings && syntax.warnings.length > 0) {
            msg += `\n[AST UYARILARI]:\n${syntax.warnings.map(w => `- ${w}`).join('\n')}`;
        }
        return msg;
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
        // 1. Read-Before-Write Grounding Gate (throws on failure so executeTool records ok: false)
        const check = globalGroundingLedger.verifyCanModifyFile(target, exists, workspace);
        if (!check.allowed) {
            throw new Error(check.error);
        }
        let nextContent = oldContent;
        let added = 0;
        let removed = 0;
        let firstPatchLine = 1;
        for (let i = 0; i < patches.length; i++) {
            const p = patches[i];
            if (LAZY_PLACEHOLDER_REGEX.test(p.new_text)) {
                throw new Error('[KESİLME ENGELİ] Mevcut büyük dosyayı kısaltarak veya yer tutucu yorumlarla ezemezsiniz. Cerrahi değişiklik için file_patch kullanın.');
            }
            const applied = applyPatchHunk(nextContent, p.old_text, p.new_text);
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
        await atomicWrite(target, nextContent, workspace, input, signal, oldContent);
        const rel = path.relative(workspace, target).replace(/\\/g, '/') || input;
        globalContextCache.invalidateFile(workspace, rel);
        globalGroundingLedger.markFileModified(target, workspace);
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
        let queryRegex;
        if (useRegex) {
            try {
                queryRegex = new RegExp(query);
            }
            catch (e) {
                throw new Error(`Invalid regular expression: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
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
                if (entry.isSymbolicLink() || SKIP_DIRS.has(entry.name))
                    continue;
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    await walk(full);
                }
                else if (entry.isFile()) {
                    const relFile = path.relative(root, full);
                    if (fileMatcher && !fileMatcher(relFile, entry.name))
                        continue;
                    const stat = await fs.stat(full);
                    if (stat.size > 1_000_000)
                        continue;
                    const content = await fs.readFile(full, 'utf8');
                    if (content.includes('\0'))
                        continue;
                    const lines = content.split(/\r?\n/);
                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];
                        let matchIdx = -1;
                        let matchLen = query.length;
                        if (queryRegex) {
                            const m = queryRegex.exec(line);
                            if (m) {
                                matchIdx = m.index;
                                matchLen = Math.max(1, m[0].length);
                            }
                        }
                        else {
                            matchIdx = line.indexOf(query);
                        }
                        if (matchIdx >= 0) {
                            if (matches++ >= offset) {
                                const start = Math.max(0, matchIdx - 100);
                                const sliceLen = Math.max(300, matchLen);
                                const snippet = `${start ? '…' : ''}${line.slice(start, start + sliceLen)}${line.length > start + sliceLen ? '…' : ''}`;
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
        const stat = await fs.stat(target);
        if (stat.isDirectory())
            await walk(target);
        else
            throw new Error('Search path must be a directory');
        return JSON.stringify({
            matches: found.slice(0, limit),
            next_offset: found.length > limit ? offset + limit : null,
            scan_limit_reached: capped,
        });
    }
    throw new Error(`Unknown file tool: ${name}`);
}
//# sourceMappingURL=files.js.map