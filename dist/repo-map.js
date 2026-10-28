import ts from 'typescript';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import { estimateTokens } from './token-optimizer.js';
const TS_JS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);
const SOURCE_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.go', '.rs', '.md',
]);
const IGNORED_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', '.tbot',
    'coverage', '.cache', '.turbo', 'out', 'target', '__pycache__', '.venv', 'venv',
]);
const repoMapCache = new Map();
function compactWhitespace(text, maxLen = 150) {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= maxLen)
        return cleaned;
    return `${cleaned.slice(0, maxLen - 3)}...`;
}
function hasExportModifier(node) {
    if (!ts.canHaveModifiers(node))
        return false;
    const modifiers = ts.getModifiers(node);
    if (!modifiers)
        return false;
    return modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword);
}
function getScriptKind(ext) {
    switch (ext) {
        case '.tsx':
            return ts.ScriptKind.TSX;
        case '.jsx':
            return ts.ScriptKind.JSX;
        case '.js':
        case '.mjs':
        case '.cjs':
            return ts.ScriptKind.JS;
        default:
            return ts.ScriptKind.TS;
    }
}
function extractTsJsAst(filePath, content, ext) {
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, getScriptKind(ext));
    const symbols = [];
    const imports = [];
    const exportsSet = new Set();
    const getRange = (node) => {
        const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
        return { startLine, endLine: Math.max(startLine, endLine) };
    };
    const visitTopLevel = (node) => {
        if (ts.isImportDeclaration(node)) {
            const spec = node.moduleSpecifier.getText(sourceFile).replace(/^['"]|['"]$/g, '');
            if (spec)
                imports.push(spec);
            return;
        }
        if (ts.isExportDeclaration(node)) {
            if (node.exportClause && ts.isNamedExports(node.exportClause)) {
                for (const el of node.exportClause.elements) {
                    exportsSet.add(el.name.getText(sourceFile));
                }
            }
            else if (node.moduleSpecifier) {
                const spec = node.moduleSpecifier.getText(sourceFile).replace(/^['"]|['"]$/g, '');
                exportsSet.add(`* from ${spec}`);
            }
            return;
        }
        if (ts.isExportAssignment(node)) {
            exportsSet.add('default');
            return;
        }
        if (ts.isFunctionDeclaration(node)) {
            const name = node.name ? node.name.getText(sourceFile) : 'default';
            const exported = hasExportModifier(node);
            if (exported)
                exportsSet.add(name);
            const { startLine, endLine } = getRange(node);
            const sigEnd = node.body ? node.body.getStart(sourceFile) : node.getEnd();
            const rawSig = content.slice(node.getStart(sourceFile), sigEnd).replace(/\{\s*$/, '');
            symbols.push({
                kind: 'function',
                name,
                signature: compactWhitespace(rawSig),
                startLine,
                endLine,
                exported,
            });
            return;
        }
        if (ts.isClassDeclaration(node)) {
            const name = node.name ? node.name.getText(sourceFile) : 'AnonymousClass';
            const exported = hasExportModifier(node);
            if (exported)
                exportsSet.add(name);
            const { startLine, endLine } = getRange(node);
            const nodeText = node.getText(sourceFile);
            const braceIdx = nodeText.indexOf('{');
            const headerSig = braceIdx !== -1 ? nodeText.slice(0, braceIdx) : nodeText;
            symbols.push({
                kind: 'class',
                name,
                signature: compactWhitespace(headerSig),
                startLine,
                endLine,
                exported,
            });
            for (const member of node.members) {
                if (ts.isMethodDeclaration(member) ||
                    ts.isConstructorDeclaration(member) ||
                    ts.isGetAccessorDeclaration(member) ||
                    ts.isSetAccessorDeclaration(member)) {
                    const memberName = ts.isConstructorDeclaration(member)
                        ? 'constructor'
                        : member.name?.getText(sourceFile) || 'anonymous';
                    const mRange = getRange(member);
                    const mSigEnd = member.body ? member.body.getStart(sourceFile) : member.getEnd();
                    const mRawSig = content.slice(member.getStart(sourceFile), mSigEnd).replace(/\{\s*$/, '');
                    symbols.push({
                        kind: 'method',
                        name: `${name}.${memberName}`,
                        signature: `  ${compactWhitespace(mRawSig, 130)}`,
                        startLine: mRange.startLine,
                        endLine: mRange.endLine,
                        exported,
                    });
                }
            }
            return;
        }
        if (ts.isInterfaceDeclaration(node)) {
            const name = node.name.getText(sourceFile);
            const exported = hasExportModifier(node);
            if (exported)
                exportsSet.add(name);
            const { startLine, endLine } = getRange(node);
            const memberNames = node.members
                .map(m => m.name?.getText(sourceFile))
                .filter((n) => Boolean(n))
                .slice(0, 8);
            const heritage = node.heritageClauses
                ? ' ' + node.heritageClauses.map(h => h.getText(sourceFile)).join(' ')
                : '';
            const prefix = `${exported ? 'export ' : ''}interface ${name}${heritage}`;
            const sig = memberNames.length
                ? `${prefix} { ${memberNames.join(', ')}${node.members.length > 8 ? ', ...' : ''} }`
                : prefix;
            symbols.push({
                kind: 'interface',
                name,
                signature: compactWhitespace(sig),
                startLine,
                endLine,
                exported,
            });
            return;
        }
        if (ts.isTypeAliasDeclaration(node)) {
            const name = node.name.getText(sourceFile);
            const exported = hasExportModifier(node);
            if (exported)
                exportsSet.add(name);
            const { startLine, endLine } = getRange(node);
            symbols.push({
                kind: 'type',
                name,
                signature: compactWhitespace(node.getText(sourceFile), 140),
                startLine,
                endLine,
                exported,
            });
            return;
        }
        if (ts.isEnumDeclaration(node)) {
            const name = node.name.getText(sourceFile);
            const exported = hasExportModifier(node);
            if (exported)
                exportsSet.add(name);
            const { startLine, endLine } = getRange(node);
            const members = node.members.map(m => m.name.getText(sourceFile)).slice(0, 8).join(', ');
            symbols.push({
                kind: 'enum',
                name,
                signature: compactWhitespace(`${exported ? 'export ' : ''}enum ${name} { ${members} }`),
                startLine,
                endLine,
                exported,
            });
            return;
        }
        if (ts.isVariableStatement(node)) {
            const exported = hasExportModifier(node);
            const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
            const kw = isConst ? 'const' : 'let';
            for (const decl of node.declarationList.declarations) {
                const name = decl.name.getText(sourceFile);
                const init = decl.initializer;
                const isFunc = Boolean(init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)));
                if (!exported && !isFunc)
                    continue;
                if (exported)
                    exportsSet.add(name);
                const { startLine, endLine } = getRange(node);
                let signature;
                if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
                    const bodyStart = init.body.getStart(sourceFile);
                    const fnHeader = content.slice(decl.getStart(sourceFile), bodyStart).replace(/=>\s*$/, '=>').trim();
                    signature = compactWhitespace(`${exported ? 'export ' : ''}${kw} ${fnHeader}`);
                    symbols.push({
                        kind: 'function',
                        name,
                        signature,
                        startLine,
                        endLine,
                        exported,
                    });
                }
                else {
                    const typeNode = decl.type ? `: ${decl.type.getText(sourceFile)}` : '';
                    signature = compactWhitespace(`${exported ? 'export ' : ''}${kw} ${name}${typeNode}`);
                    symbols.push({
                        kind: 'const',
                        name,
                        signature,
                        startLine,
                        endLine,
                        exported,
                    });
                }
            }
        }
    };
    ts.forEachChild(sourceFile, visitTopLevel);
    return {
        symbols,
        imports: Array.from(new Set(imports)),
        exports: Array.from(exportsSet),
    };
}
function extractPythonOutline(lines) {
    const symbols = [];
    const imports = [];
    const exports = [];
    let currentClass = null;
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith('#'))
            continue;
        const importMatch = /^(?:from\s+([A-Za-z0-9_.]+)\s+import\s+.+|import\s+([A-Za-z0-9_.,\s]+))$/.exec(trimmed);
        if (importMatch) {
            imports.push((importMatch[1] || importMatch[2]).trim());
            continue;
        }
        const defMatch = /^(\s*)(async\s+def|def|class)\s+([A-Za-z_][A-Za-z0-9_]*)\b(.*)$/.exec(raw);
        if (!defMatch)
            continue;
        const indent = defMatch[1].length;
        const kw = defMatch[2];
        const name = defMatch[3];
        if (currentClass && indent <= currentClass.indent) {
            currentClass = null;
        }
        // Collect multi-line signature until ':'
        let sigLines = raw.trim();
        let sigEndIdx = i;
        while (!sigLines.endsWith(':') && !sigLines.includes('):') && sigEndIdx + 1 < lines.length && sigEndIdx - i < 8) {
            sigEndIdx++;
            sigLines += ' ' + lines[sigEndIdx].trim();
        }
        const cleanSig = compactWhitespace(sigLines.replace(/:\s*$/, ''));
        // Find end of indented block
        let endLine = sigEndIdx + 1;
        for (let j = sigEndIdx + 1; j < lines.length; j++) {
            const nextTrim = lines[j].trim();
            if (!nextTrim || nextTrim.startsWith('#'))
                continue;
            const nextIndent = lines[j].match(/^\s*/)?.[0].length ?? 0;
            if (nextIndent <= indent)
                break;
            endLine = j + 1;
        }
        const exported = !name.startsWith('_');
        if (exported && indent === 0)
            exports.push(name);
        if (kw === 'class') {
            currentClass = { name, indent };
            symbols.push({
                kind: 'class',
                name,
                signature: cleanSig,
                startLine: i + 1,
                endLine,
                exported,
            });
        }
        else if (currentClass && indent > currentClass.indent) {
            symbols.push({
                kind: 'method',
                name: `${currentClass.name}.${name}`,
                signature: `  ${cleanSig}`,
                startLine: i + 1,
                endLine,
                exported,
            });
        }
        else {
            symbols.push({
                kind: 'function',
                name,
                signature: cleanSig,
                startLine: i + 1,
                endLine,
                exported,
            });
        }
    }
    return { symbols, imports: Array.from(new Set(imports)), exports };
}
function findBraceBlockEnd(lines, startIndex) {
    let depth = 0;
    let opened = false;
    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i];
        for (let c = 0; c < line.length; c++) {
            const ch = line[c];
            if (ch === '{') {
                depth++;
                opened = true;
            }
            else if (ch === '}') {
                depth--;
                if (opened && depth <= 0) {
                    return i + 1;
                }
            }
        }
        if (!opened && i > startIndex + 3)
            break;
    }
    return startIndex + 1;
}
function extractGoOutline(lines) {
    const symbols = [];
    const imports = [];
    const exports = [];
    let inImportBlock = false;
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed || trimmed.startsWith('//'))
            continue;
        if (trimmed.startsWith('import (')) {
            inImportBlock = true;
            continue;
        }
        if (inImportBlock) {
            if (trimmed === ')') {
                inImportBlock = false;
            }
            else {
                const pkg = trimmed.replace(/^['"`]|['"`]$/g, '').split(/\s+/).pop()?.replace(/['"`]/g, '');
                if (pkg)
                    imports.push(pkg);
            }
            continue;
        }
        const singleImport = /^import\s+(?:[A-Za-z0-9_.]+\s+)?"([^"]+)"/.exec(trimmed);
        if (singleImport) {
            imports.push(singleImport[1]);
            continue;
        }
        const funcMatch = /^func\s+(?:\(([^)]+)\)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(trimmed);
        if (funcMatch) {
            const receiver = funcMatch[1]?.trim();
            const name = funcMatch[2];
            const exported = /^[A-Z]/.test(name);
            if (exported && !receiver)
                exports.push(name);
            const endLine = findBraceBlockEnd(lines, i);
            const sig = compactWhitespace(trimmed.replace(/\{\s*$/, ''));
            const recvType = receiver ? receiver.split(/\s+/).pop()?.replace(/^\*/, '') : undefined;
            symbols.push({
                kind: recvType ? 'method' : 'function',
                name: recvType ? `${recvType}.${name}` : name,
                signature: sig,
                startLine: i + 1,
                endLine,
                exported,
            });
            continue;
        }
        const typeMatch = /^type\s+([A-Za-z_][A-Za-z0-9_]*)\s+(struct|interface|[^\s{]+)/.exec(trimmed);
        if (typeMatch) {
            const name = typeMatch[1];
            const kindSpec = typeMatch[2];
            const exported = /^[A-Z]/.test(name);
            if (exported)
                exports.push(name);
            const endLine = trimmed.includes('{') ? findBraceBlockEnd(lines, i) : i + 1;
            const kind = kindSpec === 'interface' ? 'interface' : kindSpec === 'struct' ? 'class' : 'type';
            symbols.push({
                kind,
                name,
                signature: compactWhitespace(trimmed.replace(/\{\s*$/, '')),
                startLine: i + 1,
                endLine,
                exported,
            });
        }
    }
    return { symbols, imports: Array.from(new Set(imports)), exports };
}
function extractRustOutline(lines) {
    const symbols = [];
    const imports = [];
    const exports = [];
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed || trimmed.startsWith('//'))
            continue;
        const useMatch = /^(?:pub\s+)?use\s+([^;]+);/.exec(trimmed);
        if (useMatch) {
            imports.push(useMatch[1].trim());
            continue;
        }
        const itemMatch = /^(pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?(fn|struct|enum|trait|impl|type|const)\s+(.+)$/.exec(trimmed);
        if (!itemMatch)
            continue;
        const exported = Boolean(itemMatch[1]);
        const kw = itemMatch[2];
        const rest = itemMatch[3];
        let name = '';
        if (kw === 'impl') {
            const implName = rest.replace(/<[^>]+>/g, '').split(/\{|where/)[0].trim();
            name = `impl ${implName}`;
        }
        else {
            const m = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(rest);
            name = m ? m[1] : kw;
        }
        if (exported && kw !== 'impl')
            exports.push(name);
        const hasBrace = trimmed.includes('{') || (i + 1 < lines.length && lines[i + 1].includes('{'));
        const endLine = hasBrace ? findBraceBlockEnd(lines, i) : i + 1;
        const sig = compactWhitespace(trimmed.replace(/\{\s*$/, ''));
        const kindMap = {
            fn: lines[i].startsWith('  ') || lines[i].startsWith('\t') ? 'method' : 'function',
            struct: 'class',
            enum: 'enum',
            trait: 'interface',
            impl: 'class',
            type: 'type',
            const: 'const',
        };
        symbols.push({
            kind: kindMap[kw] ?? 'const',
            name,
            signature: lines[i].startsWith('  ') ? `  ${sig}` : sig,
            startLine: i + 1,
            endLine,
            exported,
        });
    }
    return { symbols, imports: Array.from(new Set(imports)), exports };
}
function extractMarkdownOutline(lines) {
    const symbols = [];
    const headings = [];
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        if (/^\s*```/.test(raw)) {
            inFence = !inFence;
            continue;
        }
        if (inFence)
            continue;
        const m = /^(#{1,6})\s+(.+)$/.exec(raw.trim());
        if (m) {
            headings.push({ level: m[1].length, text: m[2].trim(), line: i + 1 });
        }
    }
    for (let i = 0; i < headings.length; i++) {
        const h = headings[i];
        let endLine = lines.length;
        for (let j = i + 1; j < headings.length; j++) {
            if (headings[j].level <= h.level) {
                endLine = Math.max(h.line, headings[j].line - 1);
                break;
            }
        }
        symbols.push({
            kind: 'const',
            name: h.text,
            signature: `${'#'.repeat(h.level)} ${h.text}`,
            startLine: h.line,
            endLine,
            exported: true,
        });
    }
    return { symbols, imports: [], exports: [] };
}
/**
 * Extracts AST symbols, line ranges [L<start>-L<end>], imports, exports, and a formatted outline.
 */
export function extractFileAstOutline(filePath, content) {
    const lines = content.length === 0 ? [] : content.split(/\r?\n/);
    const totalLines = lines.length;
    const ext = extname(filePath).toLowerCase();
    let extracted;
    if (TS_JS_EXTENSIONS.has(ext)) {
        extracted = extractTsJsAst(filePath, content, ext);
    }
    else if (ext === '.py') {
        extracted = extractPythonOutline(lines);
    }
    else if (ext === '.go') {
        extracted = extractGoOutline(lines);
    }
    else if (ext === '.rs') {
        extracted = extractRustOutline(lines);
    }
    else if (ext === '.md' || ext === '.markdown') {
        extracted = extractMarkdownOutline(lines);
    }
    else {
        extracted = extractTsJsAst(filePath, content, '.ts');
    }
    const { symbols, imports, exports } = extracted;
    const headerParts = [`File: ${filePath} (${totalLines} lines)`];
    if (imports.length > 0) {
        headerParts.push(`Imports (${imports.length}): ${imports.slice(0, 12).join(', ')}${imports.length > 12 ? ', ...' : ''}`);
    }
    if (exports.length > 0) {
        headerParts.push(`Exports (${exports.length}): ${exports.slice(0, 16).join(', ')}${exports.length > 16 ? ', ...' : ''}`);
    }
    if (symbols.length > 0) {
        const symbolLines = symbols.map(s => `  [L${s.startLine}-L${s.endLine}] ${s.signature}`);
        headerParts.push(`Outline (${symbols.length} symbols):\n${symbolLines.join('\n')}`);
    }
    else if (totalLines > 0) {
        const preview = lines
            .slice(0, Math.min(25, totalLines))
            .map((l, idx) => `  [L${idx + 1}] ${l}`)
            .join('\n');
        headerParts.push(`Preview:\n${preview}`);
    }
    return {
        totalLines,
        symbols,
        imports,
        exports,
        formatted: headerParts.join('\n'),
    };
}
/**
 * Detects overly broad or system directories (homedir, desktop root, AppData, etc.)
 * where generating an AST repository map would scan thousands of unrelated files.
 */
export function isBroadOrSystemWorkspace(ws) {
    if (!ws)
        return true;
    const resolved = resolve(ws).toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
    const home = homedir().toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
    // 1. Kullanıcının ana dizini (os.homedir())
    if (resolved === home)
        return true;
    // 2. Masaüstü kök dizini (Desktop / Masaüstü)
    if (resolved === `${home}/desktop` || resolved === `${home}/masaüstü`)
        return true;
    // 3. AppData / Local / Programs kurulu Electron dizini
    if (resolved.includes('/appdata/local/programs') || resolved.includes('/appdata/roaming')) {
        return true;
    }
    // 4. Sürücü kök dizini (C:, D:, /)
    if (/^[a-z]:$/i.test(resolved) || resolved === '')
        return true;
    return false;
}
async function collectWorkspaceSourceFiles(rootDir, maxFiles = 80, startMs = Date.now()) {
    const collected = [];
    const queue = [rootDir];
    while (queue.length > 0 && collected.length < maxFiles) {
        if (Date.now() - startMs > 250)
            break;
        const currentDir = queue.shift();
        let entries;
        try {
            entries = await readdir(currentDir, { withFileTypes: true });
        }
        catch {
            continue;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            if (collected.length >= maxFiles || Date.now() - startMs > 250)
                break;
            if (entry.name.startsWith('.') && entry.name !== '.env.example') {
                if (IGNORED_DIRS.has(entry.name))
                    continue;
            }
            const fullPath = join(currentDir, entry.name);
            if (entry.isDirectory()) {
                if (!IGNORED_DIRS.has(entry.name)) {
                    queue.push(fullPath);
                }
            }
            else if (entry.isFile()) {
                const ext = extname(entry.name).toLowerCase();
                if (SOURCE_EXTENSIONS.has(ext) && !entry.name.endsWith('.d.ts')) {
                    collected.push(fullPath);
                }
            }
        }
    }
    return collected;
}
/**
 * Builds a compact, query-ranked AST repository map within maxTokens budget.
 * Uses mtimeMs caching to avoid re-parsing unchanged files across turns.
 * Uses a cooperative 250ms traversal budget and skips oversized generated files.
 */
export async function buildWorkspaceRepoMap(workspace, query, maxTokens = 900) {
    if (!workspace || isBroadOrSystemWorkspace(workspace))
        return '';
    const startMs = Date.now();
    const files = await collectWorkspaceSourceFiles(workspace, 80, startMs);
    if (files.length === 0)
        return '';
    const keywords = (query ?? '')
        .toLowerCase()
        .split(/[^a-z0-9_çğıöşü]+/i)
        .filter(w => w.length >= 2);
    const rankedEntries = [];
    for (const absPath of files) {
        if (Date.now() - startMs > 250)
            break;
        let fileStat;
        try {
            fileStat = await stat(absPath);
        }
        catch {
            continue;
        }
        const relPath = relative(workspace, absPath).replace(/\\/g, '/');
        // A single generated source file must not defeat the map's time/memory budget.
        if (fileStat.size > 512 * 1024)
            continue;
        const cached = repoMapCache.get(absPath);
        let summary;
        let symbolNames;
        if (cached && cached.mtimeMs === fileStat.mtimeMs) {
            summary = cached.summary;
            symbolNames = cached.symbolNames;
        }
        else {
            let content = '';
            try {
                content = await readFile(absPath, 'utf8');
            }
            catch {
                continue;
            }
            const outline = extractFileAstOutline(relPath, content);
            const topSymbols = outline.symbols
                .filter(s => s.exported || s.kind !== 'method')
                .slice(0, 10)
                .map(s => `${s.name}[L${s.startLine}-${s.endLine}]`);
            summary = topSymbols.length > 0
                ? `${relPath} (${outline.totalLines}L): ${topSymbols.join(', ')}`
                : `${relPath} (${outline.totalLines}L)`;
            symbolNames = outline.symbols.map(s => s.name.toLowerCase());
            if (repoMapCache.size >= 256 && !repoMapCache.has(absPath)) {
                const oldest = repoMapCache.keys().next().value;
                if (oldest !== undefined)
                    repoMapCache.delete(oldest);
            }
            repoMapCache.set(absPath, {
                mtimeMs: fileStat.mtimeMs,
                summary,
                score: 0,
                symbolNames,
            });
        }
        let score = 0;
        const lowerPath = relPath.toLowerCase();
        for (const kw of keywords) {
            if (lowerPath.includes(kw))
                score += 5;
            if (symbolNames.some(sym => sym.includes(kw)))
                score += 3;
        }
        if (lowerPath.startsWith('src/'))
            score += 1;
        rankedEntries.push({ relPath, summary, score });
    }
    rankedEntries.sort((a, b) => b.score - a.score || a.relPath.localeCompare(b.relPath));
    const header = '[Workspace AST Repo Map]';
    const lines = [header];
    let usedTokens = estimateTokens(header);
    for (const item of rankedEntries) {
        const lineTokens = estimateTokens(item.summary) + 1;
        if (usedTokens + lineTokens > maxTokens)
            break;
        lines.push(`- ${item.summary}`);
        usedTokens += lineTokens;
    }
    return lines.length > 1 ? lines.join('\n') : '';
}
//# sourceMappingURL=repo-map.js.map