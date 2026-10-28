import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

interface PackedFile {
  file: string;
  data: string;
  encoding: 'base64';
}

const SKIP_FILES = new Set(['.npmrc', 'id_rsa', 'id_ed25519', '.netrc', '.pypirc']);
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.tbot',
  '.next',
  'build',
  'out',
  '.cache',
  '.turbo',
  'coverage',
  '.vscode',
  '.idea',
]);

export async function packWorkspaceFiles(cwd: string = process.cwd()): Promise<PackedFile[]> {
  const packed: PackedFile[] = [];
  const MAX_FILES = 80;
  const MAX_FILE_SIZE = 250 * 1024; // 250 KB

  const isIgnored = (name: string): boolean => {
    const lower = name.toLowerCase();
    if (IGNORED_DIRS.has(name) || IGNORED_DIRS.has(lower)) return true;
    if (lower.startsWith('.env')) return true;
    if (SKIP_FILES.has(lower) || SKIP_FILES.has(name)) return true;
    if (lower.endsWith('.pem') || lower.endsWith('.key')) return true;
    return false;
  };

  async function walk(currentDir: string, relDir: string): Promise<void> {
    if (packed.length >= MAX_FILES) return;
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (packed.length >= MAX_FILES) break;
      if (entry.isSymbolicLink() || isIgnored(entry.name)) continue;

      const fullPath = path.join(currentDir, entry.name);
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      const posixRel = relPath.split(path.sep).join('/');

      try {
        const stats = await fs.lstat(fullPath);
        if (stats.isSymbolicLink()) continue;
        if (stats.isDirectory()) {
          await walk(fullPath, posixRel);
        } else if (stats.isFile()) {
          if (stats.size <= MAX_FILE_SIZE) {
            const content = await fs.readFile(fullPath);
            packed.push({
              file: posixRel,
              data: content.toString('base64'),
              encoding: 'base64',
            });
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  await walk(cwd, '');
  return packed;
}

/** Local TBot MCP server backed by selected Vercel REST endpoints, not Vercel's hosted MCP. */
export async function createVercelAdapter(token: string, options: { team?: string; project?: string; readOnly?: boolean; workspace?: string; signal?: AbortSignal }) {
  const valid = (value: string | undefined) => !value || /^[A-Za-z0-9_.-]{1,128}$/.test(value);
  if (!valid(options.team) || !valid(options.project)) throw new Error('Invalid Vercel team or project scope.');
  async function request(path: string, signal?: AbortSignal, body?: Record<string, unknown>): Promise<string> {
    const url = new URL(path, 'https://api.vercel.com');
    if (options.team) url.searchParams.set('teamId', options.team);
    const signals = [AbortSignal.timeout(30_000), ...(signal ? [signal] : [])];
    const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.any(signals) });
    if (!response.ok) throw new Error(`Vercel API HTTP ${response.status}`);
    if (!response.body) throw new Error('Empty Vercel API response.');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 1_000_000) throw new Error('Vercel API response too large.'); chunks.push(part.value); }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    return Buffer.concat(chunks).toString('utf8').split(token).join('[REDACTED]');
  }
  // Validate credentials during connection, before reporting the adapter as ready.
  await request('/v2/user', options.signal);
  const server = new Server({ name: 'tbot-vercel-rest-adapter', version: '1.0.0' }, { capabilities: { tools: {} } });
  const tools: Array<{name: string; description: string; inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties: boolean }}> = [
    { name: 'list_projects', description: 'List Vercel projects via TBot local REST adapter.', inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false } },
    { name: 'get_project', description: 'Get a Vercel project via TBot local REST adapter.', inputSchema: { type: 'object' as const, properties: { project: { type: 'string', description: 'Project ID or name.' } }, required: ['project'], additionalProperties: false } },
    { name: 'list_deployments', description: 'List Vercel deployments via TBot local REST adapter.', inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false } },
  ];
  if (options.readOnly === false) tools.push(
    { name: 'create_project', description: 'Create a Vercel project in the configured account/team.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, githubRepo: { type: 'string', description: 'Optional GitHub repository owner/name to connect.' } }, required: ['name'], additionalProperties: false } },
    {
      name: 'create_deployment',
      description: 'Create a Vercel deployment from workspace files, explicit base64 files, or GitHub repository. Preview by default; production only when specified. The response may be BUILDING, not ready.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project ID or name.' },
          target: { type: 'string', enum: ['preview', 'production'] },
          repoId: { type: 'string', description: 'GitHub numeric repository ID.' },
          ref: { type: 'string', description: 'Git reference.' },
          files: {
            type: 'array',
            description: 'Explicitly supplied base64 files; optional.',
            maxItems: 100,
            items: {
              type: 'object',
              properties: { file: { type: 'string' }, data: { type: 'string' } },
              required: ['file', 'data'],
              additionalProperties: false,
            },
          },
          auto_pack_workspace: {
            type: 'boolean',
            description: 'Automatically pack project files from workspace (excluding node_modules, .git, dist, .tbot, .env*, and files >250KB, max 80 files). Defaults to true.',
          },
        },
        required: ['project'],
        additionalProperties: false,
      },
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    try {
      const args = req.params.arguments ?? {};
      let path: string; let body: Record<string, unknown> | undefined;
      const only = (...keys: string[]) => { if (Object.keys(args).some(k => !keys.includes(k))) throw new Error('Invalid arguments.'); };
      const projectValue = (value: unknown) => {
        if (typeof value !== 'string' || !valid(value) || !value || (options.project && value !== options.project)) throw new Error('Project is invalid or outside the configured scope.');
        return value;
      };
      if (req.params.name === 'list_projects') { only(); path = options.project ? `/v9/projects/${encodeURIComponent(options.project)}` : '/v9/projects?limit=20'; }
      else if (req.params.name === 'list_deployments') { only(); path = `/v6/deployments?limit=20${options.project ? `&projectId=${encodeURIComponent(options.project)}` : ''}`; }
      else if (req.params.name === 'get_project') { only('project'); path = `/v9/projects/${encodeURIComponent(projectValue(args.project))}`; }
      else if (req.params.name === 'create_project' && options.readOnly === false) {
        only('name', 'githubRepo'); const name = projectValue(args.name); path = '/v11/projects'; body = { name };
        if (args.githubRepo !== undefined) {
          if (typeof args.githubRepo !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(args.githubRepo) || args.githubRepo.length > 200) throw new Error('Invalid arguments.');
          body.gitRepository = { type: 'github', repo: args.githubRepo };
        }
      } else if (req.params.name === 'create_deployment' && options.readOnly === false) {
        only('project', 'target', 'repoId', 'ref', 'files', 'auto_pack_workspace');
        const project = projectValue(args.project);
        if (args.target !== undefined && args.target !== 'preview' && args.target !== 'production') throw new Error('Invalid arguments.');
        body = { name: project, project, ...(args.target === 'production' ? { target: 'production' } : {}) };

        const hasFiles = Array.isArray(args.files) && args.files.length > 0;
        const autoPack = args.auto_pack_workspace === true || (
          args.auto_pack_workspace !== false && !hasFiles && args.repoId === undefined
        );

        if (autoPack) {
          const workspaceFiles = await packWorkspaceFiles(options.workspace || process.cwd());
          let combinedFiles = workspaceFiles;
          if (hasFiles) {
            let total = 0;
            const seen = new Set<string>();
            const explicit = (args.files as unknown[]).map((item: unknown) => {
              if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid arguments.');
              const f = item as Record<string, unknown>;
              if (Object.keys(f).some(k => !['file', 'data'].includes(k)) || typeof f.file !== 'string' || typeof f.data !== 'string' || f.file.length > 240 || !f.file || f.file.startsWith('/') || /[\\:\x00-\x1f]/.test(f.file) || f.file.split('/').some(part => !part || part === '.' || part === '..') || seen.has(f.file) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.data)) throw new Error('Invalid arguments.');
              seen.add(f.file);
              total += f.data.length;
              if (total > 25_000_000) throw new Error('Invalid arguments.');
              return { file: f.file, data: f.data, encoding: 'base64' as const };
            });
            combinedFiles = [...workspaceFiles.filter(wf => !explicit.some(ef => ef.file === wf.file)), ...explicit];
          }
          body.files = combinedFiles;
        } else if (hasFiles) {
          if (args.repoId !== undefined || args.ref !== undefined || (args.files as unknown[]).length > 100) throw new Error('Invalid arguments.');
          let total = 0; const seen = new Set<string>();
          body.files = (args.files as unknown[]).map((item: unknown) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid arguments.');
            const f = item as Record<string, unknown>;
            if (Object.keys(f).some(k => !['file', 'data'].includes(k)) || typeof f.file !== 'string' || typeof f.data !== 'string' || f.file.length > 240 || !f.file || f.file.startsWith('/') || /[\\:\x00-\x1f]/.test(f.file) || f.file.split('/').some(part => !part || part === '.' || part === '..') || seen.has(f.file) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.data)) throw new Error('Invalid arguments.');
            seen.add(f.file); total += f.data.length; if (total > 25_000_000) throw new Error('Invalid arguments.');
            return { file: f.file, data: f.data, encoding: 'base64' };
          });
        } else {
          if (typeof args.repoId !== 'string' || !/^\d{1,20}$/.test(args.repoId) || typeof args.ref !== 'string' || !args.ref || args.ref.length > 200 || /[\x00-\x20]/.test(args.ref)) throw new Error('Invalid arguments.');
          body.gitSource = { type: 'github', repoId: args.repoId, ref: args.ref };
        }
        path = '/v13/deployments';
      } else throw new Error('Unknown tool.');
      return { content: [{ type: 'text', text: await request(path, extra.signal, body) }] };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof Error && /^Vercel API HTTP \d+$|^Project is invalid|^Invalid arguments|^Unknown tool/.test(error.message) ? error.message : 'Vercel adapter request failed.' }] }; }
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  return { clientTransport, server };
}
