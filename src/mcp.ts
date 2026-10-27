import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createVercelAdapter } from './mcp-local-vercel.js';
import type { McpService, McpServerDefinition } from './mcp-presets.js';
import type { ToolCall, ToolDefinition } from './types.js';

export interface McpConnection {
  service: McpService;
  definitions: ToolDefinition[];
  execute(call: ToolCall, signal?: AbortSignal): Promise<string>;
  close(): Promise<void>;
}

export interface McpOptions {
  signal?: AbortSignal;
  readOnly?: boolean;
  project?: string;
  team?: string;
  url?: string;
  command?: string;
  args?: string[];
}

export type McpServiceInput =
  | McpService
  | McpServerDefinition
  | { id?: string; name?: string; url?: string; command?: string; args?: string[]; [key: string]: unknown };

const TIMEOUT = 30_000;

export function parseStdioCommand(raw: string): { command: string; args: string[] } {
  const tokens: string[] = [];
  const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    if (match[1] !== undefined) tokens.push(match[1]);
    else if (match[2] !== undefined) tokens.push(match[2]);
    else tokens.push(match[0]);
  }
  const [command = '', ...args] = tokens;
  return { command, args };
}

export async function connectMcp(service: McpServiceInput, token?: string, options: McpOptions = {}): Promise<McpConnection> {
  let stdioUrl: string | undefined;
  let serviceName = 'mcp';

  if (typeof service === 'string') {
    serviceName = service;
    if (service.startsWith('stdio:')) {
      stdioUrl = service;
      serviceName = 'stdio';
    }
  } else if (service && typeof service === 'object') {
    if (typeof service.id === 'string') serviceName = service.id;
    else if (typeof service.name === 'string') serviceName = service.name;
    if (typeof service.url === 'string' && service.url.startsWith('stdio:')) {
      stdioUrl = service.url;
    }
  }

  if (!stdioUrl && typeof options.url === 'string' && options.url.startsWith('stdio:')) {
    stdioUrl = options.url;
  }

  const effectiveToken = token ?? '';
  if (!stdioUrl) {
    if (!effectiveToken || effectiveToken.length > 8192 || /[\r\n]/.test(effectiveToken)) throw new Error('Invalid MCP token.');
    if (options.project && !/^[A-Za-z0-9_-]{1,128}$/.test(options.project)) throw new Error('Invalid project scope.');
  }

  const client = new Client({ name: 'tbot', version: '1.0.0' }, { capabilities: {} });
  let adapter: Awaited<ReturnType<typeof createVercelAdapter>> | undefined;
  try {
    if (stdioUrl) {
      const { command, args } = parseStdioCommand(stdioUrl.slice('stdio:'.length).trim());
      if (!command) throw new Error('Invalid stdio MCP command.');
      const transport = new StdioClientTransport({ command, args });
      const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(TIMEOUT)]) : AbortSignal.timeout(TIMEOUT);
      const abort = () => { void client.close(); };
      signal.addEventListener('abort', abort, { once: true });
      try {
        await client.connect(transport);
        signal.throwIfAborted();
      } finally {
        signal.removeEventListener('abort', abort);
      }
    } else if (serviceName === 'supabase') {
      const url = new URL('https://mcp.supabase.com/mcp');
      if (options.project) url.searchParams.set('project_ref', options.project);
      if (options.readOnly !== false) url.searchParams.set('read_only', 'true');
      const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${effectiveToken}` }, redirect: 'error' }, fetch: (input, init) => {
        const target = new URL(typeof input === 'string' ? input : input.href);
        if (target.origin !== 'https://mcp.supabase.com') throw new Error('Unexpected MCP origin.');
        return fetch(input, { ...init, redirect: 'error' });
      } });
      const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(TIMEOUT)]) : AbortSignal.timeout(TIMEOUT);
      const abort = () => { void client.close(); };
      signal.addEventListener('abort', abort, { once: true });
      try { await client.connect(transport); signal.throwIfAborted(); } finally { signal.removeEventListener('abort', abort); }
    } else if (serviceName === 'github') {
      const url = new URL('https://api.githubcopilot.com/mcp/');
      const headers: Record<string, string> = {
        Authorization: `Bearer ${effectiveToken}`,
        'X-MCP-Tools': 'get_me,search_repositories,get_file_contents,list_branches,create_repository,create_branch,create_or_update_file,push_files,list_pull_requests,pull_request_read,create_pull_request,update_pull_request',
      };
      if (options.readOnly !== false) headers['X-MCP-Readonly'] = 'true';
      const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers, redirect: 'error' }, fetch: (input, init) => {
        const target = new URL(typeof input === 'string' ? input : input.href);
        if (target.origin !== 'https://api.githubcopilot.com') throw new Error('Unexpected MCP origin.');
        return fetch(input, { ...init, redirect: 'error' });
      } });
      const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(TIMEOUT)]) : AbortSignal.timeout(TIMEOUT);
      const abort = () => { void client.close(); };
      signal.addEventListener('abort', abort, { once: true });
      try { await client.connect(transport); signal.throwIfAborted(); } finally { signal.removeEventListener('abort', abort); }
    } else if (serviceName === 'vercel') {
      adapter = await createVercelAdapter(effectiveToken, { ...options, readOnly: options.readOnly !== false });
      await client.connect(adapter.clientTransport);
    } else throw new Error('Unsupported MCP service.');

    const all: Awaited<ReturnType<Client['listTools']>>['tools'] = [];
    let cursor: string | undefined; let pages = 0;
    do {
      if (++pages > 10) throw new Error('MCP manifest pagination limit exceeded.');
      const page = await client.listTools(cursor ? { cursor } : undefined, { signal: options.signal, timeout: TIMEOUT });
      all.push(...page.tools); cursor = page.nextCursor;
      if (all.length > 500) throw new Error('MCP tool limit exceeded.');
    } while (cursor);
    if (!all.length) throw new Error('MCP server returned no tools.');

    const map = new Map<string, string>();
    const safeService = serviceName.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 30) || 'mcp';
    const definitions: ToolDefinition[] = all.map(tool => {
      const hash = createHash('sha256').update(tool.name).digest('hex').slice(0, 12);
      const safe = tool.name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 35);
      const name = `mcp_${safeService}_${safe}_${hash}`;
      if (map.has(name) || !tool.name || JSON.stringify(tool.inputSchema).length > 32_000) throw new Error('Invalid MCP tool manifest.');
      map.set(name, tool.name);
      return { name, description: (tool.description || tool.name).slice(0, 4000), parameters: tool.inputSchema as Record<string, unknown> };
    });

    return {
      service: serviceName as McpService,
      definitions,
      async execute(call, signal) {
        const name = map.get(call.name);
        if (!name) return 'Unknown MCP tool.';
        try {
          const result = await client.callTool({ name, arguments: call.arguments }, undefined, { signal, timeout: TIMEOUT });
          const escapedToken = effectiveToken ? JSON.stringify(effectiveToken).slice(1, -1) : '';
          const serialized = escapedToken ? JSON.stringify(result).split(escapedToken).join('[REDACTED]') : JSON.stringify(result);
          return serialized.length > 24_000 ? `${serialized.slice(0, 24_000)}\n[Output truncated]` : serialized;
        } catch {
          return signal?.aborted ? 'MCP request cancelled.' : 'MCP request failed or timed out.';
        }
      },
      async close() {
        await client.close();
        await adapter?.server.close();
      },
    };
  } catch {
    await client.close().catch(() => {});
    await adapter?.server.close().catch(() => {});
    throw new Error(`${serviceName} MCP connection failed. Check token, permissions, scope and network.`);
  }
}
