import { readFile, writeFile, mkdir, rename, unlink, copyFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { withFileLock } from './lock.js';
import { workspaceStatePath } from './workspace-state.js';
const VALID_CATEGORIES = new Set([
    'architecture',
    'convention',
    'bugfix',
    'preference',
    'environment',
]);
const MAX_MEMORY_CONTEXT_CHARS = 2400;
const MAX_CONSTITUTION_CHARS = 1800;
const CONSTITUTION_FILES = ['AGENTS.md', 'CLAUDE.md', '.tbot/rules.md'];
/**
 * Technical Turkish/English synonym groups for high-accuracy cross-lingual BM25 retrieval.
 */
const TECHNICAL_SYNONYM_GROUPS = [
    // Auth / Login / Authorization
    ['auth', 'authentication', 'authorization', 'login', 'giris', 'yetki', 'yetkilendirme', 'jwt', 'token', 'session', 'oturum', 'oauth', 'password', 'sifre', 'bearer'],
    // Database / Storage / ORM
    ['db', 'database', 'veritabani', 'sql', 'nosql', 'postgres', 'postgresql', 'prisma', 'supabase', 'sqlite', 'mysql', 'orm', 'migration', 'goc', 'depolama', 'storage', 'schema'],
    // Testing / Verification / QA
    ['test', 'testing', 'dogrulama', 'kontrol', 'jest', 'vitest', 'mocha', 'playwright', 'unit', 'integration', 'assertion', 'assert', 'qa', 'audit', 'denetim'],
    // UI / Frontend / Theme
    ['ui', 'gui', 'tui', 'frontend', 'arayuz', 'on yuz', 'tema', 'theme', 'css', 'tailwind', 'style', 'stil', 'component', 'bilesen', 'layout', 'duzen', 'markup'],
    // Backend / Server / API
    ['backend', 'server', 'sunucu', 'api', 'endpoint', 'servis', 'service', 'rest', 'http', 'route', 'yonlendirme', 'controller', 'arka yuz'],
    // Performance / Memory / Resource
    ['perf', 'performance', 'performans', 'ram', 'bellek', 'memory', 'cpu', 'hiz', 'speed', 'optimizasyon', 'optimization', 'token', 'cache', 'onbellek', 'leak', 'sizinti'],
    // Config / Environment
    ['config', 'configuration', 'yapilandirma', 'ayar', 'ayarlar', 'env', 'environment', 'ortam', 'degisken', 'options', 'settings'],
    // Git / VCS
    ['git', 'commit', 'branch', 'dal', 'repo', 'repository', 'depo', 'merge', 'pr', 'pull request'],
    // Build / Package / Dependency
    ['build', 'compile', 'derle', 'derleme', 'package', 'paket', 'bundle', 'bundler', 'tsc', 'npm', 'pnpm', 'yarn', 'dependency', 'bagimlilik'],
    // Error / Bug / Debug / Fix
    ['error', 'err', 'bug', 'hata', 'sorun', 'problem', 'fix', 'cozum', 'duzeltme', 'debug', 'ayiklama', 'crash', 'exception', 'istisna'],
];
function normalizeWord(word) {
    return word
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ı/g, 'i')
        .trim();
}
const SYNONYM_MAP = new Map();
for (const group of TECHNICAL_SYNONYM_GROUPS) {
    const normalizedWords = group.map(normalizeWord);
    for (const word of normalizedWords) {
        let set = SYNONYM_MAP.get(word);
        if (!set) {
            set = new Set();
            SYNONYM_MAP.set(word, set);
        }
        for (const syn of normalizedWords) {
            if (syn !== word) {
                set.add(syn);
            }
        }
    }
}
function getSynonyms(token) {
    const norm = normalizeWord(token);
    return SYNONYM_MAP.get(norm) ?? SYNONYM_MAP.get(token.toLowerCase());
}
function getProjectMemoryPath(workspace) {
    // The backup and lock are also writable state, so check their final entries.
    for (const suffix of ['.lock', '.bak'])
        workspaceStatePath(workspace, `.tbot/memory.json${suffix}`);
    return workspaceStatePath(workspace, '.tbot/memory.json');
}
function getGlobalMemoryPath() {
    const base = process.env.APPDATA || (process.platform === 'win32'
        ? join(homedir(), 'AppData', 'Roaming')
        : join(homedir(), '.config'));
    return join(base, 'TBot', 'memory.json');
}
function normalizeTags(tags) {
    if (Array.isArray(tags)) {
        const cleaned = tags
            .filter((t) => typeof t === 'string')
            .map(t => t.trim())
            .filter(Boolean);
        return cleaned.length > 0 ? Array.from(new Set(cleaned)) : undefined;
    }
    if (typeof tags === 'string' && tags.trim()) {
        const cleaned = tags
            .split(',')
            .map(t => t.trim())
            .filter(Boolean);
        return cleaned.length > 0 ? Array.from(new Set(cleaned)) : undefined;
    }
    return undefined;
}
function normalizeCategory(category) {
    if (typeof category === 'string') {
        const clean = category.trim().toLowerCase();
        if (VALID_CATEGORIES.has(clean))
            return clean;
    }
    return undefined;
}
async function backupCorruptMemoryFile(filePath, rawContent) {
    const bakPath = `${filePath}.bak`;
    try {
        await copyFile(filePath, bakPath);
    }
    catch {
        if (rawContent !== undefined) {
            await writeFile(bakPath, rawContent, 'utf8').catch(() => undefined);
        }
    }
}
async function readMemoryFile(filePath) {
    let raw;
    try {
        raw = await readFile(filePath, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
    if (!raw.trim()) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed
                .filter(item => item &&
                typeof item.key === 'string' &&
                typeof item.value === 'string' &&
                (item.scope === 'project' || item.scope === 'global') &&
                typeof item.updatedAt === 'string')
                .map(item => {
                const category = normalizeCategory(item.category);
                const tags = normalizeTags(item.tags);
                return {
                    key: item.key,
                    value: item.value,
                    scope: item.scope,
                    updatedAt: item.updatedAt,
                    ...(category ? { category } : {}),
                    ...(tags ? { tags } : {}),
                };
            });
        }
        await backupCorruptMemoryFile(filePath, raw);
        return [];
    }
    catch {
        await backupCorruptMemoryFile(filePath, raw);
        return [];
    }
}
/** Serialize the entire read/modify/write transaction to avoid losing concurrent facts. */
async function updateMemoryFile(filePath, update) {
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
    await withFileLock(`${filePath}.lock`, async () => {
        const entries = await readMemoryFile(filePath);
        const updated = update(entries);
        if (updated === entries)
            return;
        const tmpPath = `${filePath}.${randomUUID()}.tmp`;
        try {
            await writeFile(tmpPath, JSON.stringify(updated, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
            await rename(tmpPath, filePath);
        }
        finally {
            await unlink(tmpPath).catch(() => undefined);
        }
    });
}
/**
 * Persists a key-value fact into project or global memory with optional category and tags.
 */
export async function rememberFact(workspace, key, value, scope, category, tags) {
    const cleanKey = key.trim();
    const cleanVal = value.trim();
    if (!cleanKey)
        throw new Error('Memory key cannot be empty.');
    if (!cleanVal)
        throw new Error('Memory value cannot be empty.');
    const targetScope = scope === 'global' ? 'global' : 'project';
    const filePath = targetScope === 'global' ? getGlobalMemoryPath() : getProjectMemoryPath(workspace);
    await updateMemoryFile(filePath, entries => {
        const existingIdx = entries.findIndex(e => e.key.toLowerCase() === cleanKey.toLowerCase());
        const existing = existingIdx >= 0 ? entries[existingIdx] : undefined;
        const resolvedCategory = normalizeCategory(category) ?? existing?.category;
        const resolvedTags = normalizeTags(tags) ?? existing?.tags;
        const entry = {
            key: cleanKey,
            value: cleanVal,
            scope: targetScope,
            updatedAt: new Date().toISOString(),
            ...(resolvedCategory ? { category: resolvedCategory } : {}),
            ...(resolvedTags ? { tags: resolvedTags } : {}),
        };
        if (existingIdx >= 0) {
            entries[existingIdx] = entry;
        }
        else {
            entries.push(entry);
        }
        return [...entries];
    });
    return `Saved to ${targetScope} memory: ${cleanKey}`;
}
function tokenizeText(text) {
    return text
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .map(t => t.trim())
        .filter(t => t.length >= 2);
}
function countTermOccurrencesWithSynonyms(haystackTokens, rawHaystack, queryToken, synonyms) {
    let count = 0;
    const normQt = normalizeWord(queryToken);
    for (const token of haystackTokens) {
        const normToken = normalizeWord(token);
        if (token === queryToken || normToken === normQt) {
            count += 1;
        }
        else if (token.includes(queryToken) ||
            normToken.includes(normQt) ||
            (normQt.length >= 4 && normQt.includes(normToken))) {
            count += 0.6;
        }
        else if (synonyms && (synonyms.has(normToken) || synonyms.has(token.toLowerCase()))) {
            // Technical synonym match (e.g. auth <-> yetkilendirme / jwt / login)
            count += 0.85;
        }
    }
    if (count === 0) {
        const normHaystack = normalizeWord(rawHaystack);
        if (rawHaystack.includes(queryToken) || normHaystack.includes(normQt)) {
            count = 0.5;
        }
        else if (synonyms) {
            for (const syn of synonyms) {
                if (normHaystack.includes(syn)) {
                    count = 0.45;
                    break;
                }
            }
        }
    }
    return count;
}
/**
 * Recalls facts from project and global memory, with BM25/TF lexical overlap,
 * Turkish/English technical synonym expansion, and recency scoring.
 * Project entries take precedence over global entries with identical keys.
 */
export async function recallFacts(workspace, query) {
    const [projectEntries, globalEntries] = await Promise.all([
        readMemoryFile(getProjectMemoryPath(workspace)),
        readMemoryFile(getGlobalMemoryPath()),
    ]);
    const map = new Map();
    for (const entry of globalEntries) {
        map.set(entry.key.toLowerCase(), entry);
    }
    for (const entry of projectEntries) {
        map.set(entry.key.toLowerCase(), entry);
    }
    const all = Array.from(map.values());
    if (all.length === 0)
        return [];
    if (!query || !query.trim()) {
        all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return all;
    }
    const rawQuery = query.trim().toLowerCase();
    const queryTokens = tokenizeText(rawQuery);
    if (queryTokens.length === 0) {
        const normRawQuery = normalizeWord(rawQuery);
        const filtered = all.filter(e => {
            const k = normalizeWord(e.key);
            const v = normalizeWord(e.value);
            const c = normalizeWord(e.category ?? '');
            const t = (e.tags ?? []).map(normalizeWord).join(' ');
            return (k.includes(normRawQuery) ||
                v.includes(normRawQuery) ||
                c.includes(normRawQuery) ||
                t.includes(normRawQuery));
        });
        filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return filtered;
    }
    // Prepare document representations for BM25 scoring
    const docs = all.map(entry => {
        const keyLower = entry.key.toLowerCase();
        const valLower = entry.value.toLowerCase();
        const catLower = (entry.category ?? '').toLowerCase();
        const tagsLower = (entry.tags ?? []).map(t => t.toLowerCase()).join(' ');
        const keyTokens = tokenizeText(keyLower);
        const valTokens = tokenizeText(valLower);
        const catTokens = tokenizeText(catLower);
        const tagTokens = tokenizeText(tagsLower);
        const docLen = Math.max(1, keyTokens.length * 2 + valTokens.length + catTokens.length + tagTokens.length * 2);
        return {
            entry,
            keyLower,
            valLower,
            catLower,
            tagsLower,
            keyTokens,
            valTokens,
            catTokens,
            tagTokens,
            docLen,
        };
    });
    const N = docs.length;
    const avgDocLen = docs.reduce((sum, d) => sum + d.docLen, 0) / Math.max(1, N);
    const k1 = 1.2;
    const b = 0.75;
    // Compute IDF per query token (taking synonyms into account for doc frequency)
    const idfMap = new Map();
    for (const qt of queryTokens) {
        const synonyms = getSynonyms(qt);
        const normQt = normalizeWord(qt);
        let df = 0;
        for (const d of docs) {
            let matches = d.keyLower.includes(qt) ||
                d.valLower.includes(qt) ||
                d.catLower.includes(qt) ||
                d.tagsLower.includes(qt) ||
                normalizeWord(d.keyLower).includes(normQt) ||
                normalizeWord(d.valLower).includes(normQt);
            if (!matches && synonyms) {
                for (const syn of synonyms) {
                    if (normalizeWord(d.keyLower).includes(syn) ||
                        normalizeWord(d.valLower).includes(syn) ||
                        normalizeWord(d.catLower).includes(syn) ||
                        normalizeWord(d.tagsLower).includes(syn)) {
                        matches = true;
                        break;
                    }
                }
            }
            if (matches) {
                df++;
            }
        }
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        idfMap.set(qt, Math.max(0.1, idf));
    }
    const now = Date.now();
    const scored = [];
    for (const d of docs) {
        let lexicalScore = 0;
        // Exact phrase match bonus
        if (d.keyLower.includes(rawQuery))
            lexicalScore += 5.0;
        if (d.tagsLower && d.tagsLower.includes(rawQuery))
            lexicalScore += 3.5;
        if (d.catLower && d.catLower.includes(rawQuery))
            lexicalScore += 3.0;
        if (d.valLower.includes(rawQuery))
            lexicalScore += 2.5;
        for (const qt of queryTokens) {
            const synonyms = getSynonyms(qt);
            const idf = idfMap.get(qt) ?? 0.5;
            const tfKey = countTermOccurrencesWithSynonyms(d.keyTokens, d.keyLower, qt, synonyms) * 3.0;
            const tfTags = countTermOccurrencesWithSynonyms(d.tagTokens, d.tagsLower, qt, synonyms) * 2.5;
            const tfCat = countTermOccurrencesWithSynonyms(d.catTokens, d.catLower, qt, synonyms) * 2.0;
            const tfVal = countTermOccurrencesWithSynonyms(d.valTokens, d.valLower, qt, synonyms) * 1.0;
            const weightedTf = tfKey + tfTags + tfCat + tfVal;
            if (weightedTf > 0) {
                const normTf = (weightedTf * (k1 + 1)) /
                    (weightedTf + k1 * (1 - b + b * (d.docLen / Math.max(1, avgDocLen))));
                lexicalScore += idf * normTf;
            }
        }
        if (lexicalScore <= 0)
            continue;
        // Recency bonus based on updatedAt
        const parsedTime = Date.parse(d.entry.updatedAt);
        const ageDays = Number.isFinite(parsedTime)
            ? Math.max(0, (now - parsedTime) / 86_400_000)
            : 365;
        const recencyBonus = 0.35 / (1 + ageDays / 14);
        const scopeBonus = d.entry.scope === 'project' ? 0.15 : 0;
        scored.push({
            entry: d.entry,
            score: lexicalScore + recencyBonus + scopeBonus,
        });
    }
    scored.sort((a, b) => {
        if (Math.abs(b.score - a.score) > 1e-6) {
            return b.score - a.score;
        }
        return b.entry.updatedAt.localeCompare(a.entry.updatedAt);
    });
    return scored.map(s => s.entry);
}
/**
 * Technical synonym expanded BM25 memory retrieval alias for recallFacts.
 */
export const recallMemories = recallFacts;
/**
 * Removes a fact by key from project and/or global memory.
 */
export async function forgetFact(workspace, key, scope) {
    const cleanKey = key.trim().toLowerCase();
    if (!cleanKey)
        return false;
    const projectPath = getProjectMemoryPath(workspace);
    const globalPath = getGlobalMemoryPath();
    let removed = false;
    const paths = [
        ...(!scope || scope === 'project' ? [projectPath] : []),
        ...(!scope || scope === 'global' ? [globalPath] : []),
    ];
    for (const filePath of paths) {
        await updateMemoryFile(filePath, entries => {
            const filtered = entries.filter(entry => entry.key.toLowerCase() !== cleanKey);
            if (filtered.length === entries.length)
                return entries;
            removed = true;
            return filtered;
        });
    }
    return removed;
}
async function loadProjectConstitution(workspace) {
    for (const relPath of CONSTITUTION_FILES) {
        try {
            const fullPath = workspaceStatePath(workspace, relPath);
            const raw = await readFile(fullPath, 'utf8');
            const trimmed = raw.trim();
            if (trimmed) {
                const snippet = trimmed.length > MAX_CONSTITUTION_CHARS
                    ? `${trimmed.slice(0, MAX_CONSTITUTION_CHARS - 3)}...`
                    : trimmed;
                return `[Proje Anayasası / Kuralları]\n${snippet}`;
            }
        }
        catch {
            // Continue checking next constitution candidate
        }
    }
    return '';
}
function formatFactLine(f) {
    const catPrefix = f.category ? `[${f.category}] ` : '';
    const tagSuffix = f.tags?.length ? ` [tags: ${f.tags.join(', ')}]` : '';
    return `- ${catPrefix}${f.key}: ${f.value}${tagSuffix}`;
}
/**
 * Builds a rich memory context (max 2400 chars) for prompt injection,
 * including automatic discovery of AGENTS.md, CLAUDE.md, or .tbot/rules.md.
 * Returns empty string "" if neither rules nor facts exist.
 */
export async function buildMemoryContext(workspace, userQuery) {
    const [constitutionBlock, initialFacts] = await Promise.all([
        loadProjectConstitution(workspace),
        recallFacts(workspace, userQuery),
    ]);
    let facts = initialFacts;
    if (!facts.length && userQuery) {
        facts = await recallFacts(workspace);
    }
    if (!constitutionBlock && !facts.length)
        return '';
    const sections = [];
    let remainingBudget = MAX_MEMORY_CONTEXT_CHARS;
    if (constitutionBlock) {
        // Reserve at least 550 chars for memory facts if facts exist
        const maxConstitutionSection = facts.length > 0
            ? Math.min(constitutionBlock.length, MAX_MEMORY_CONTEXT_CHARS - 550)
            : Math.min(constitutionBlock.length, MAX_MEMORY_CONTEXT_CHARS);
        const trimmedConstitution = constitutionBlock.length > maxConstitutionSection
            ? `${constitutionBlock.slice(0, maxConstitutionSection - 3)}...`
            : constitutionBlock;
        sections.push(trimmedConstitution);
        remainingBudget -= trimmedConstitution.length + (facts.length > 0 ? 2 : 0);
    }
    if (facts.length > 0 && remainingBudget > 30) {
        const header = '[Memory Context]';
        const lines = [header];
        let currentLength = header.length;
        for (const f of facts) {
            const line = formatFactLine(f);
            if (currentLength + 1 + line.length > remainingBudget) {
                const rem = remainingBudget - (currentLength + 1);
                if (rem > 15) {
                    lines.push(`${line.slice(0, rem - 3)}...`);
                }
                break;
            }
            lines.push(line);
            currentLength += 1 + line.length;
        }
        if (lines.length > 1) {
            sections.push(lines.join('\n'));
        }
    }
    if (sections.length === 0)
        return '';
    const combined = sections.join('\n\n');
    return combined.length > MAX_MEMORY_CONTEXT_CHARS
        ? combined.slice(0, MAX_MEMORY_CONTEXT_CHARS)
        : combined;
}
export const memoryToolDefinitions = [
    {
        name: 'memory_save',
        description: 'Save a persistent key-value fact, architecture note, bugfix, or user preference to memory (project or global scope).',
        parameters: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Identifier or topic for the fact' },
                value: { type: 'string', description: 'Fact or instruction to remember' },
                scope: {
                    type: 'string',
                    enum: ['project', 'global'],
                    description: 'Storage scope: "project" (current workspace) or "global" (all projects). Defaults to "project".',
                },
                category: {
                    type: 'string',
                    enum: ['architecture', 'convention', 'bugfix', 'preference', 'environment'],
                    description: 'Optional category of the memory fact.',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional keywords or tags for BM25 retrieval.',
                },
            },
            required: ['key', 'value'],
            additionalProperties: false,
        },
    },
    {
        name: 'memory_recall',
        description: 'Recall saved persistent facts and preferences matching an optional search query.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Optional keyword or topic to search for' },
            },
            additionalProperties: false,
        },
    },
    {
        name: 'memory_forget',
        description: 'Delete a saved fact from persistent memory by key.',
        parameters: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Exact key of the memory fact to remove' },
                scope: {
                    type: 'string',
                    enum: ['project', 'global'],
                    description: 'Optional scope to delete from ("project" or "global"). If omitted, deletes from both.',
                },
            },
            required: ['key'],
            additionalProperties: false,
        },
    },
];
export async function handleMemoryTool(nameOrCall, argsOrCtx, maybeCtx) {
    let name;
    let args;
    let ctx;
    if (typeof nameOrCall === 'string') {
        name = nameOrCall;
        args = argsOrCtx || {};
        ctx = typeof maybeCtx === 'string'
            ? { workspace: maybeCtx }
            : maybeCtx || { workspace: process.cwd() };
    }
    else {
        name = nameOrCall.name;
        args = nameOrCall.arguments || (nameOrCall.args ?? {});
        ctx = typeof argsOrCtx === 'string'
            ? { workspace: argsOrCtx }
            : argsOrCtx || { workspace: process.cwd() };
    }
    if (ctx.signal?.aborted)
        throw new Error('Operation cancelled');
    if (name === 'memory_save') {
        const key = typeof args.key === 'string' ? args.key.trim() : '';
        const value = typeof args.value === 'string' ? args.value.trim() : '';
        const scope = args.scope === 'global' ? 'global' : 'project';
        const category = normalizeCategory(args.category);
        const tags = normalizeTags(args.tags);
        if (!key)
            throw new Error('Parameter "key" is required.');
        if (!value)
            throw new Error('Parameter "value" is required.');
        return await rememberFact(ctx.workspace, key, value, scope, category, tags);
    }
    if (name === 'memory_recall') {
        const query = typeof args.query === 'string' ? args.query.trim() : undefined;
        const facts = await recallFacts(ctx.workspace, query);
        if (!facts.length) {
            return query ? `No memories found matching "${query}".` : 'No saved memories found.';
        }
        return facts
            .map(f => {
            const cat = f.category ? `[${f.category}] ` : '';
            const tags = f.tags?.length ? ` (tags: ${f.tags.join(', ')})` : '';
            return `[${f.scope}] ${cat}${f.key}: ${f.value}${tags}`;
        })
            .join('\n');
    }
    if (name === 'memory_forget') {
        const key = typeof args.key === 'string' ? args.key.trim() : '';
        if (!key)
            throw new Error('Parameter "key" is required.');
        const scope = args.scope === 'global'
            ? 'global'
            : args.scope === 'project'
                ? 'project'
                : undefined;
        const removed = await forgetFact(ctx.workspace, key, scope);
        return removed
            ? `Removed from memory: ${key}`
            : `Memory key not found: ${key}`;
    }
    throw new Error(`Unknown memory tool: ${name}`);
}
//# sourceMappingURL=memory.js.map