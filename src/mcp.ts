import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createVercelAdapter } from './mcp-local-vercel.js';
import type { McpService } from './mcp-presets.js';
import type { ToolCall, ToolDefinition } from './types.js';

export interface McpConnection { service: McpService; definitions: ToolDefinition[]; execute(call: ToolCall, signal?: AbortSignal): Promise<string>; close(): Promise<void> }
export interface McpOptions { signal?: AbortSignal; readOnly?: boolean; project?: string; team?: string }
const TIMEOUT = 30_000;
export async function connectMcp(service: McpService, token: string, options: McpOptions = {}): Promise<McpConnection> {
  if (!token || token.length > 8192 || /[\r\n]/.test(token)) throw new Error('Invalid MCP token.');
  if (options.project && !/^[A-Za-z0-9_-]{1,128}$/.test(options.project)) throw new Error('Invalid project scope.');
  const client = new Client({ name: 'tbot', version: '1.0.0' }, { capabilities: {} });
  let adapter: Awaited<ReturnType<typeof createVercelAdapter>> | undefined;
  try {
    if (service === 'supabase') {
      const url = new URL('https://mcp.supabase.com/mcp');
      if (options.project) url.searchParams.set('project_ref', options.project);
      if (options.readOnly) url.searchParams.set('read_only', 'true');
      const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' }, fetch: (input, init) => {
        const target = new URL(typeof input === 'string' ? input : input.href);
        if (target.origin !== 'https://mcp.supabase.com') throw new Error('Unexpected MCP origin.');
        return fetch(input, { ...init, redirect: 'error' });
      } });
      const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(TIMEOUT)]) : AbortSignal.timeout(TIMEOUT);
      const abort = () => { void client.close(); };
      signal.addEventListener('abort', abort, { once: true });
      try { await client.connect(transport); signal.throwIfAborted(); } finally { signal.removeEventListener('abort', abort); }
    } else if (service === 'vercel') {
      adapter = await createVercelAdapter(token, options);
      await client.connect(adapter.clientTransport);
    } else throw new Error('Unsupported MCP service.');
    const all: Awaited<ReturnType<Client['listTools']>>['tools'] = [];
    let cursor: string | undefined; let pages = 0;
    do {
      if (++pages > 10) throw new Error('MCP manifest pagination limit exceeded.');
      const page = await client.listTools(cursor ? { cursor } : undefined, { signal: options.signal, timeout: TIMEOUT });
      all.push(...page.tools); cursor = page.nextCursor;
      if (all.length > 50) throw new Error('MCP tool limit exceeded.');
    } while (cursor);
    const map = new Map<string, string>();
    const definitions: ToolDefinition[] = all.map(tool => {
      const hash = createHash('sha256').update(tool.name).digest('hex').slice(0, 12);
      const safe = tool.name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 35);
      const name = `mcp_${service}_${safe}_${hash}`;
      if (map.has(name) || !tool.name || JSON.stringify(tool.inputSchema).length > 32_000) throw new Error('Invalid MCP tool manifest.');
      map.set(name, tool.name);
      return { name, description: (tool.description || tool.name).slice(0, 4000), parameters: tool.inputSchema as Record<string, unknown> };
    });
    return { service, definitions, async execute(call, signal) {
      const name = map.get(call.name);
      if (!name) return 'Unknown MCP tool.';
      try {
        const result = await client.callTool({ name, arguments: call.arguments }, undefined, { signal, timeout: TIMEOUT });
        const escapedToken = JSON.stringify(token).slice(1, -1);
        const serialized = JSON.stringify(result).split(escapedToken).join('[REDACTED]');
        return serialized.length > 24_000 ? `${serialized.slice(0, 24_000)}\n[Output truncated]` : serialized;
      } catch { return signal?.aborted ? 'MCP request cancelled.' : 'MCP request failed or timed out.'; }
    }, async close() { await client.close(); await adapter?.server.close(); } };
  } catch {
    await client.close().catch(() => {}); await adapter?.server.close().catch(() => {});
    throw new Error(`${service} MCP connection failed. Check token, permissions, scope and network.`);
  }
}
