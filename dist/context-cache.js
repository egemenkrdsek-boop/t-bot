import { createHash } from 'node:crypto';
import { estimateTokens } from './token-optimizer.js';
function normalizeWorkspace(workspace) {
    return workspace.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
function normalizeRelPath(relPath) {
    return relPath.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/^\/+/, '');
}
function buildCacheKey(workspace, relPath) {
    return `${normalizeWorkspace(workspace)}::${normalizeRelPath(relPath)}`;
}
/**
 * Differential File Read Cache (FileReadCache).
 * Tracks SHA-256 content hashes, lines, and read line ranges (startLine, endLine, turnIndex)
 * to eliminate redundant full-file or overlapping slice reads across agent turns.
 */
export class ContextReadCache {
    entries = new Map();
    turnCounter = 0;
    checkAndRecordRead(workspace, relPath, fullContent, startLine, endLine, formattedSlice) {
        this.turnCounter++;
        const currentTurn = this.turnCounter;
        const key = buildCacheKey(workspace, relPath);
        const hash = createHash('sha256').update(fullContent, 'utf8').digest('hex');
        const lines = fullContent.length === 0 ? [] : fullContent.split(/\r?\n/);
        const totalLines = lines.length;
        const effStart = Math.max(1, startLine || 1);
        const effEnd = Math.max(effStart, endLine || totalLines || 1);
        const existing = this.entries.get(key);
        if (existing) {
            if (existing.hash === hash) {
                const recentReads = existing.reads.slice(-3);
                const coveredRecently = recentReads.some(r => r.startLine <= effStart &&
                    r.endLine >= effEnd &&
                    currentTurn - r.turnIndex <= 6);
                existing.reads.push({
                    startLine: effStart,
                    endLine: effEnd,
                    turnIndex: currentTurn,
                });
                if (existing.reads.length > 6) {
                    existing.reads.shift();
                }
                if (coveredRecently && totalLines > 40) {
                    const output = `[DİFERANSİYEL ÖNBELLEK İSABETİ: ${relPath} (L${effStart}-L${effEnd}) sha256:${hash.slice(0, 8)} — Dosya önceki okumadan beri değişmedi (${totalLines} satır). Bağlamdaki mevcut içeriği kullanın.]`;
                    const originalTokens = estimateTokens(formattedSlice);
                    const cachedTokens = estimateTokens(output);
                    const savedTokens = Math.max(0, originalTokens - cachedTokens);
                    return {
                        cached: true,
                        output,
                        savedTokens,
                    };
                }
                return {
                    cached: false,
                    output: formattedSlice,
                    savedTokens: 0,
                };
            }
            // File existed in cache but its content hash changed
            this.entries.set(key, {
                workspace: normalizeWorkspace(workspace),
                normalizedPath: normalizeRelPath(relPath),
                hash,
                lines,
                totalLines,
                reads: [{ startLine: effStart, endLine: effEnd, turnIndex: currentTurn }],
            });
            return {
                cached: false,
                output: `[GÜNCELLENMİŞ DOSYA: Önceki okumaya göre değişen satırlar mevcut]\n${formattedSlice}`,
                savedTokens: 0,
            };
        }
        this.entries.set(key, {
            workspace: normalizeWorkspace(workspace),
            normalizedPath: normalizeRelPath(relPath),
            hash,
            lines,
            totalLines,
            reads: [{ startLine: effStart, endLine: effEnd, turnIndex: currentTurn }],
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
            // Clear active read ranges so next read is never treated as a duplicate hit,
            // while preserving the previous hash to detect content modifications.
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
export const globalContextCache = new ContextReadCache();
//# sourceMappingURL=context-cache.js.map