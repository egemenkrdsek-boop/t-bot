import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { estimateTokens, globalTokenTracker } from './token-optimizer.js';
function normalizeWorkspace(workspace) {
    const normalized = workspace.replace(/\\/g, '/').replace(/\/+$/, '');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
function normalizeRelPath(relPath) {
    return relPath.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/^\/+/, '');
}
function buildCacheKey(workspace, relPath) {
    return `${normalizeWorkspace(workspace)}::${normalizeRelPath(relPath)}`;
}
const MAX_CACHEABLE_CONTENT_CHARS = 150 * 1024; // 150 KB bellek koruma sınırı
const MAX_CACHE_ENTRIES = 64;
/**
 * Line-based Differential Unified Diff Engine.
 * Produces standard @@ -L...,... +L...,... @@ diff blocks with context lines.
 */
export function computeUnifiedLineDiff(prevContent, newContent, contextLines = 2) {
    if (prevContent === newContent)
        return '';
    const oldLines = prevContent.length === 0 ? [] : prevContent.split(/\r?\n/);
    const newLines = newContent.length === 0 ? [] : newContent.split(/\r?\n/);
    // 1. Ortak önek (common prefix)
    let prefix = 0;
    while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
        prefix++;
    }
    // 2. Ortak sonek (common suffix)
    let oldSuffix = oldLines.length - 1;
    let newSuffix = newLines.length - 1;
    while (oldSuffix >= prefix && newSuffix >= prefix && oldLines[oldSuffix] === newLines[newSuffix]) {
        oldSuffix--;
        newSuffix--;
    }
    const midOld = oldLines.slice(prefix, oldSuffix + 1);
    const midNew = newLines.slice(prefix, newSuffix + 1);
    const ops = [];
    if (midOld.length * midNew.length > 2_000_000) {
        for (let i = 0; i < midOld.length; i++) {
            ops.push({ type: 'delete', line: midOld[i], oldIndex: prefix + i, newIndex: -1 });
        }
        for (let j = 0; j < midNew.length; j++) {
            ops.push({ type: 'insert', line: midNew[j], oldIndex: -1, newIndex: prefix + j });
        }
    }
    else {
        const m = midOld.length;
        const n = midNew.length;
        const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
        for (let i = 0; i < m; i++) {
            for (let j = 0; j < n; j++) {
                if (midOld[i] === midNew[j]) {
                    dp[i + 1][j + 1] = dp[i][j] + 1;
                }
                else {
                    dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
                }
            }
        }
        let i = m;
        let j = n;
        const revOps = [];
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && midOld[i - 1] === midNew[j - 1]) {
                revOps.push({ type: 'common', line: midOld[i - 1], oldIndex: prefix + i - 1, newIndex: prefix + j - 1 });
                i--;
                j--;
            }
            else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                revOps.push({ type: 'insert', line: midNew[j - 1], oldIndex: -1, newIndex: prefix + j - 1 });
                j--;
            }
            else if (i > 0) {
                revOps.push({ type: 'delete', line: midOld[i - 1], oldIndex: prefix + i - 1, newIndex: -1 });
                i--;
            }
        }
        revOps.reverse();
        ops.push(...revOps);
    }
    const changeIndices = [];
    for (let idx = 0; idx < ops.length; idx++) {
        if (ops[idx].type !== 'common') {
            changeIndices.push(idx);
        }
    }
    if (changeIndices.length === 0 && prefix === oldLines.length && prefix === newLines.length) {
        return '';
    }
    const groups = [];
    let curGroup = null;
    for (const cIdx of changeIndices) {
        const minOp = Math.max(0, cIdx - contextLines);
        const maxOp = Math.min(ops.length - 1, cIdx + contextLines);
        if (!curGroup) {
            curGroup = { startOp: minOp, endOp: maxOp };
        }
        else if (minOp <= curGroup.endOp + 1) {
            curGroup.endOp = Math.max(curGroup.endOp, maxOp);
        }
        else {
            groups.push(curGroup);
            curGroup = { startOp: minOp, endOp: maxOp };
        }
    }
    if (curGroup) {
        groups.push(curGroup);
    }
    const hunks = [];
    // Source positions immediately before each operation. Insert/delete-only
    // hunks need both cursors even when one side has no indexed operation.
    const oldPositions = [];
    const newPositions = [];
    let oldPosition = prefix;
    let newPosition = prefix;
    for (const op of ops) {
        oldPositions.push(oldPosition);
        newPositions.push(newPosition);
        if (op.type !== 'insert')
            oldPosition++;
        if (op.type !== 'delete')
            newPosition++;
    }
    for (const group of groups) {
        const hunkLines = [];
        let oldCount = 0;
        let newCount = 0;
        const prefixContextCount = group.startOp === 0 ? Math.min(contextLines, prefix) : 0;
        const oldStart = oldPositions[group.startOp] + 1 - prefixContextCount;
        const newStart = newPositions[group.startOp] + 1 - prefixContextCount;
        for (let p = prefix - prefixContextCount; p < prefix; p++) {
            oldCount++;
            newCount++;
            hunkLines.push(` ${oldLines[p]}`);
        }
        for (let opIdx = group.startOp; opIdx <= group.endOp; opIdx++) {
            const op = ops[opIdx];
            if (op.type === 'common') {
                oldCount++;
                newCount++;
                hunkLines.push(` ${op.line}`);
            }
            else if (op.type === 'delete') {
                oldCount++;
                hunkLines.push(`-${op.line}`);
            }
            else if (op.type === 'insert') {
                newCount++;
                hunkLines.push(`+${op.line}`);
            }
        }
        if (group.endOp === ops.length - 1) {
            const suffixContextCount = Math.min(contextLines, oldLines.length - (oldSuffix + 1));
            for (let s = oldSuffix + 1; s < oldSuffix + 1 + suffixContextCount; s++) {
                oldCount++;
                newCount++;
                hunkLines.push(` ${oldLines[s]}`);
            }
        }
        const header = `@@ -${oldCount ? oldStart : oldStart - 1},${oldCount} +${newCount ? newStart : newStart - 1},${newCount} @@`;
        hunks.push(`${header}\n${hunkLines.join('\n')}`);
    }
    return hunks.join('\n');
}
/**
 * Differential File Read Cache (FileReadCache).
 * Tracks SHA-256 content hashes, lines, and read line ranges (startLine, endLine, turnIndex)
 * to eliminate redundant full-file or overlapping slice reads across agent turns,
 * and produces unified line diffs when files are modified.
 */
export class ContextReadCache {
    entries = new Map();
    turnCounter = 0;
    /** Discard coverage unless the actual source text survived request compression. */
    retainVisibleReads(messages) {
        const outputs = messages.filter(message => message.role === 'tool').map(message => {
            try {
                const parsed = JSON.parse(message.content);
                return typeof parsed.content === 'string' ? parsed.content : message.content;
            }
            catch {
                return message.content;
            }
        });
        for (const entry of this.entries.values()) {
            entry.reads = entry.reads.filter(read => read.output && outputs.some(output => output.includes(read.output)));
        }
    }
    checkAndRecordRead(workspace, relPath, fullContent, startLine, endLine, formattedSlice) {
        this.turnCounter++;
        const currentTurn = this.turnCounter;
        const key = buildCacheKey(workspace, relPath);
        // Never retain unbounded full-file line arrays for oversized reads.
        if (fullContent.length > MAX_CACHEABLE_CONTENT_CHARS) {
            this.entries.delete(key);
            return { cached: false, output: formattedSlice, savedTokens: 0 };
        }
        if (!this.entries.has(key) && this.entries.size >= MAX_CACHE_ENTRIES) {
            const oldest = this.entries.keys().next().value;
            if (oldest !== undefined)
                this.entries.delete(oldest);
        }
        const hash = createHash('sha256').update(fullContent, 'utf8').digest('hex');
        // Only the count is retained; keeping a full line array per entry doubled
        // the cache's memory footprint without a reader.
        const totalLines = fullContent.length === 0 ? 0 : (fullContent.match(/\r?\n/g)?.length ?? 0) + 1;
        const effStart = Math.max(1, startLine || 1);
        const effEnd = Math.max(effStart, endLine || totalLines || 1);
        const existing = this.entries.get(key);
        if (existing) {
            if (existing.hash === hash) {
                const recentReads = existing.reads.slice(-3);
                const coveredRecently = recentReads.some(r => r.startLine <= effStart &&
                    r.endLine >= effEnd &&
                    currentTurn - r.turnIndex <= 2);
                if (coveredRecently && totalLines > 40) {
                    const output = `[DİFERANSİYEL ÖNBELLEK İSABETİ: ${relPath} (L${effStart}-L${effEnd}) sha256:${hash.slice(0, 8)} — Dosya önceki okumadan beri değişmedi (${totalLines} satır). Bağlamdaki mevcut içeriği kullanın.]`;
                    const originalTokens = estimateTokens(formattedSlice);
                    const cachedTokens = estimateTokens(output);
                    const savedTokens = Math.max(0, originalTokens - cachedTokens);
                    if (savedTokens > 0) {
                        globalTokenTracker.recordContextCacheSaving(savedTokens);
                        return { cached: true, output, savedTokens };
                    }
                }
                // A cache reference is not a physical read. Only actual contents refresh
                // coverage, so compression can never leave an indefinitely reused stub.
                existing.reads.push({ startLine: effStart, endLine: effEnd, turnIndex: currentTurn, output: formattedSlice });
                if (existing.reads.length > 6)
                    existing.reads.shift();
                return {
                    cached: false,
                    output: formattedSlice,
                    savedTokens: 0,
                };
            }
            // Dosya önbellekte vardı fakat içeriği (hash) değişti
            const readRecently = existing.reads.some(r => currentTurn - r.turnIndex <= 2);
            const isFullRead = effStart === 1 && effEnd >= totalLines;
            // A whole-file diff is reconstructible only after the whole prior version
            // was actually shown. Overlap alone can hide newly requested source lines.
            const previouslyReadFullFile = existing.reads.some(r => r.startLine === 1 && r.endLine >= existing.totalLines);
            if (readRecently && isFullRead && previouslyReadFullFile && existing.lastContent) {
                const diffOutput = computeUnifiedLineDiff(existing.lastContent, fullContent, 2);
                if (diffOutput && diffOutput.length < formattedSlice.length * 0.65) {
                    const fullTokens = estimateTokens(formattedSlice);
                    const output = `[DİFERANSİYEL DIFF ÖNBELLEĞİ: ${relPath} — Dosya önceki okumaya göre güncellendi. Değişen satır blokları:]\n${diffOutput}`;
                    const diffTokens = estimateTokens(output);
                    const savedTokens = Math.max(0, fullTokens - diffTokens);
                    if (savedTokens > 0) {
                        existing.hash = hash;
                        existing.totalLines = totalLines;
                        existing.lastContent = fullContent.length <= MAX_CACHEABLE_CONTENT_CHARS ? fullContent : undefined;
                        existing.reads = [];
                        globalTokenTracker.recordContextCacheSaving(savedTokens);
                        return {
                            cached: true,
                            output,
                            savedTokens,
                        };
                    }
                }
            }
            // Diff %65'ten büyükse veya uygulanamadıysa tam içerik güncellenir
            this.entries.set(key, {
                workspace: normalizeWorkspace(workspace),
                normalizedPath: normalizeRelPath(relPath),
                hash,
                totalLines,
                lastContent: fullContent.length <= MAX_CACHEABLE_CONTENT_CHARS ? fullContent : undefined,
                reads: [{ startLine: effStart, endLine: effEnd, turnIndex: currentTurn, output: formattedSlice }],
            });
            return {
                cached: false,
                output: `[GÜNCELLENMİŞ DOSYA: Önceki okumaya göre değişen satırlar mevcut]\n${formattedSlice}`,
                savedTokens: 0,
            };
        }
        // İlk defa okunuyor
        this.entries.set(key, {
            workspace: normalizeWorkspace(workspace),
            normalizedPath: normalizeRelPath(relPath),
            hash,
            totalLines,
            lastContent: fullContent.length <= MAX_CACHEABLE_CONTENT_CHARS ? fullContent : undefined,
            reads: [{ startLine: effStart, endLine: effEnd, turnIndex: currentTurn, output: formattedSlice }],
        });
        return {
            cached: false,
            output: formattedSlice,
            savedTokens: 0,
        };
    }
    invalidateFile(workspace, relPath) {
        const key = buildCacheKey(workspace, relPath);
        const existing = this.entries.get(key);
        if (existing) {
            existing.reads = [];
        }
    }
    clearWorkspace(workspace) {
        if (!workspace) {
            this.entries.clear();
            this.turnCounter = 0;
            return;
        }
        const normWs = normalizeWorkspace(workspace);
        for (const [key, entry] of this.entries.entries()) {
            if (entry.workspace === normWs) {
                this.entries.delete(key);
            }
        }
    }
}
export { ContextReadCache as FileReadCache };
const readCacheScope = new AsyncLocalStorage();
export function withContextReadCache(action) {
    return readCacheScope.run(new ContextReadCache(), action);
}
// Legacy tool imports resolve to the cache owned by their current agent invocation.
export const globalContextCache = new Proxy(new ContextReadCache(), {
    get(fallback, key) {
        const cache = readCacheScope.getStore() ?? fallback;
        const value = Reflect.get(cache, key);
        return typeof value === 'function' ? value.bind(cache) : value;
    },
});
//# sourceMappingURL=context-cache.js.map