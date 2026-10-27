import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createVercelAdapter } from './mcp-local-vercel.js';
const TIMEOUT = 30_000;
export async function connectMcp(service, token, options = {}) {
    if (!token || token.length > 8192 || /[\r\n]/.test(token))
        throw new Error('Invalid MCP token.');
    if (options.project && !/^[A-Za-z0-9_-]{1,128}$/.test(options.project))
        throw new Error('Invalid project scope.');
    const client = new Client({ name: 'tbot', version: '1.0.0' }, { capabilities: {} });
    let adapter;
    try {
        if (service === 'supabase') {
            const url = new URL('https://mcp.supabase.com/mcp');
            if (options.project)
                url.searchParams.set('project_ref', options.project);
            if (options.readOnly !== false)
                url.searchParams.set('read_only', 'true');
            const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' }, fetch: (input, init) => {
                    const target = new URL(typeof input === 'string' ? input : input.href);
                    if (target.origin !== 'https://mcp.supabase.com')
                        throw new Error('Unexpected MCP origin.');
                    return fetch(input, { ...init, redirect: 'error' });
                } });
            const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(TIMEOUT)]) : AbortSignal.timeout(TIMEOUT);
            const abort = () => { void client.close(); };
            signal.addEventListener('abort', abort, { once: true });
            try {
                await client.connect(transport);
                signal.throwIfAborted();
            }
            finally {
                signal.removeEventListener('abort', abort);
            }
        }
        else if (service === 'github') {
            const url = new URL('https://api.githubcopilot.com/mcp/');
            const headers = {
                Authorization: `Bearer ${token}`,
                'X-MCP-Tools': 'get_me,search_repositories,get_file_contents,list_branches,create_repository,create_branch,create_or_update_file,push_files,list_pull_requests,pull_request_read,create_pull_request,update_pull_request',
            };
            if (options.readOnly !== false)
                headers['X-MCP-Readonly'] = 'true';
            const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers, redirect: 'error' }, fetch: (input, init) => {
                    const target = new URL(typeof input === 'string' ? input : input.href);
                    if (target.origin !== 'https://api.githubcopilot.com')
                        throw new Error('Unexpected MCP origin.');
                    return fetch(input, { ...init, redirect: 'error' });
                } });
            const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(TIMEOUT)]) : AbortSignal.timeout(TIMEOUT);
            const abort = () => { void client.close(); };
            signal.addEventListener('abort', abort, { once: true });
            try {
                await client.connect(transport);
                signal.throwIfAborted();
            }
            finally {
                signal.removeEventListener('abort', abort);
            }
        }
        else if (service === 'vercel') {
            adapter = await createVercelAdapter(token, { ...options, readOnly: options.readOnly !== false });
            await client.connect(adapter.clientTransport);
        }
        else
            throw new Error('Unsupported MCP service.');
        const all = [];
        let cursor;
        let pages = 0;
        do {
            if (++pages > 10)
                throw new Error('MCP manifest pagination limit exceeded.');
            const page = await client.listTools(cursor ? { cursor } : undefined, { signal: options.signal, timeout: TIMEOUT });
            all.push(...page.tools);
            cursor = page.nextCursor;
            if (all.length > 500)
                throw new Error('MCP tool limit exceeded.');
        } while (cursor);
        if (!all.length)
            throw new Error('MCP server returned no tools.');
        const map = new Map();
        const definitions = all.map(tool => {
            const hash = createHash('sha256').update(tool.name).digest('hex').slice(0, 12);
            const safe = tool.name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 35);
            const name = `mcp_${service}_${safe}_${hash}`;
            if (map.has(name) || !tool.name || JSON.stringify(tool.inputSchema).length > 32_000)
                throw new Error('Invalid MCP tool manifest.');
            map.set(name, tool.name);
            return { name, description: (tool.description || tool.name).slice(0, 4000), parameters: tool.inputSchema };
        });
        return { service, definitions, async execute(call, signal) {
                const name = map.get(call.name);
                if (!name)
                    return 'Unknown MCP tool.';
                try {
                    const result = await client.callTool({ name, arguments: call.arguments }, undefined, { signal, timeout: TIMEOUT });
                    const escapedToken = JSON.stringify(token).slice(1, -1);
                    const serialized = JSON.stringify(result).split(escapedToken).join('[REDACTED]');
                    return serialized.length > 24_000 ? `${serialized.slice(0, 24_000)}\n[Output truncated]` : serialized;
                }
                catch {
                    return signal?.aborted ? 'MCP request cancelled.' : 'MCP request failed or timed out.';
                }
            }, async close() { await client.close(); await adapter?.server.close(); } };
    }
    catch {
        await client.close().catch(() => { });
        await adapter?.server.close().catch(() => { });
        throw new Error(`${service} MCP connection failed. Check token, permissions, scope and network.`);
    }
}
//# sourceMappingURL=mcp.js.map