import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, lstat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { workspaceStatePath } from '../workspace-state.js';
import { redactSecrets } from '../security/redact.js';
const ARTIFACT_ID = /^art-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_ARTIFACTS = 160;
const DEFAULT_LINES = 400;
const MAX_LINES = 2_000;
function artifactDirectory(workspace) {
    return workspaceStatePath(workspace, '.tbot/artifacts');
}
function artifactFile(workspace, id) {
    if (!ARTIFACT_ID.test(id))
        throw new Error('Invalid artifact id');
    return join(artifactDirectory(workspace), `${id}.txt`);
}
async function pruneArtifacts(directory) {
    let entries;
    try {
        entries = await Promise.all((await readdir(directory))
            .filter(name => /^art-[0-9a-f-]{36}\.txt$/i.test(name))
            .map(async (name) => {
            const info = await stat(join(directory, name));
            return { name, size: info.size, mtime: info.mtimeMs };
        }));
    }
    catch {
        return;
    }
    entries.sort((a, b) => b.mtime - a.mtime);
    let total = 0;
    for (const [index, entry] of entries.entries()) {
        total += entry.size;
        if (index < MAX_ARTIFACTS && total <= MAX_TOTAL_BYTES)
            continue;
        await unlink(join(directory, entry.name)).catch(() => undefined);
    }
}
/**
 * Persist a large tool output outside the conversation. The model receives a
 * bounded summary plus this id, so the full result stays inspectable without
 * being resent on every turn. Credentials are redacted before persistence.
 */
export async function storeArtifact(workspace, tool, raw) {
    if (typeof raw !== 'string')
        throw new Error('Artifact content must be text');
    const redacted = redactSecrets(raw);
    const truncated = redacted.length > MAX_ARTIFACT_BYTES;
    const body = truncated
        ? `${redacted.slice(0, MAX_ARTIFACT_BYTES / 2)}\n\n[artifact middle omitted: ${redacted.length} bytes total]\n\n${redacted.slice(-MAX_ARTIFACT_BYTES / 2)}`
        : redacted;
    const directory = artifactDirectory(workspace);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    // Content addressing makes repeated identical tool output reuse one local
    // artifact instead of growing disk usage and handing the model a new id.
    const contentHash = createHash('sha256').update(body, 'utf8').digest('hex');
    const id = `art-${contentHash.slice(0, 8)}-${contentHash.slice(8, 12)}-4${contentHash.slice(13, 16)}-${'89ab'[Number.parseInt(contentHash[16], 16) & 3]}${contentHash.slice(17, 20)}-${contentHash.slice(20, 32)}`;
    const file = join(directory, `${id}.txt`);
    try {
        const existing = await stat(file);
        if (existing.isFile()) {
            await pruneArtifacts(directory);
            return { id, bytes: existing.size, sha256: contentHash, truncated };
        }
    }
    catch { /* publish below */ }
    const header = `# T Bot tool artifact\n# tool: ${String(tool).slice(0, 120)}\n# created: ${new Date().toISOString()}\n\n`;
    const bytes = Buffer.from(header + body, 'utf8');
    try {
        await writeFile(file, bytes, { mode: 0o600, flag: 'wx' });
    }
    catch (error) {
        // A concurrent writer may have published the same content first.
        if (error.code !== 'EEXIST')
            throw error;
        const existing = await stat(file);
        await pruneArtifacts(directory);
        return { id, bytes: existing.size, sha256: contentHash, truncated };
    }
    await pruneArtifacts(directory);
    return { id, bytes: bytes.length, sha256: contentHash, truncated };
}
export function artifactHint(artifact) {
    return `\n[Full output stored locally: artifact_read { "id": "${artifact.id}", "offset": 0, "limit": ${DEFAULT_LINES} } | ${artifact.bytes} bytes${artifact.truncated ? ', middle omitted' : ''}]`;
}
export const artifactToolDefinitions = [
    {
        name: 'artifact_read',
        description: 'Read a bounded slice of a large tool output saved by T Bot. Use offset/limit lines; the full artifact stays local.',
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Artifact id returned in a tool result, e.g. art-...' },
                offset: { type: 'integer', minimum: 0, description: 'Zero-based first line (default 0).' },
                limit: { type: 'integer', minimum: 1, maximum: MAX_LINES, description: `Maximum lines to return (default ${DEFAULT_LINES}).` },
            },
            required: ['id'],
            additionalProperties: false,
        },
    },
];
export async function handleArtifactTool(name, args, workspace) {
    if (name !== 'artifact_read')
        throw new Error(`Unknown artifact tool: ${name}`);
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id)
        throw new Error('id must be a non-empty string');
    const file = artifactFile(workspace, id);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_ARTIFACT_BYTES + 4096)
        throw new Error('Invalid artifact file');
    const text = await readFile(file, 'utf8');
    // Skip the fixed metadata header so offsets refer to tool-output lines.
    const bodyStart = text.indexOf('\n\n');
    const body = bodyStart >= 0 ? text.slice(bodyStart + 2) : text;
    const lines = body.split(/\r?\n/);
    const offset = typeof args.offset === 'number' && Number.isFinite(args.offset)
        ? Math.max(0, Math.floor(args.offset))
        : 0;
    const limit = typeof args.limit === 'number' && Number.isFinite(args.limit)
        ? Math.max(1, Math.min(MAX_LINES, Math.floor(args.limit)))
        : DEFAULT_LINES;
    const selected = lines.slice(offset, offset + limit);
    const hasMore = offset + selected.length < lines.length;
    return `[Artifact ${id} | lines ${offset}-${offset + selected.length - 1} of ${lines.length}${hasMore ? ' | more available' : ''}]\n${selected.join('\n')}`;
}
//# sourceMappingURL=artifacts.js.map