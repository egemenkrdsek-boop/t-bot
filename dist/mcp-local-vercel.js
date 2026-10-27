import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
/** Local TBot MCP server backed by selected Vercel REST endpoints, not Vercel's hosted MCP. */
export async function createVercelAdapter(token, options) {
    const valid = (value) => !value || /^[A-Za-z0-9_.-]{1,128}$/.test(value);
    if (!valid(options.team) || !valid(options.project))
        throw new Error('Invalid Vercel team or project scope.');
    async function request(path, signal) {
        const url = new URL(path, 'https://api.vercel.com');
        if (options.team)
            url.searchParams.set('teamId', options.team);
        const signals = [AbortSignal.timeout(30_000), ...(signal ? [signal] : [])];
        const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.any(signals) });
        if (!response.ok)
            throw new Error(`Vercel API HTTP ${response.status}`);
        if (!response.body)
            throw new Error('Empty Vercel API response.');
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        try {
            while (true) {
                const part = await reader.read();
                if (part.done)
                    break;
                size += part.value.byteLength;
                if (size > 1_000_000)
                    throw new Error('Vercel API response too large.');
                chunks.push(part.value);
            }
        }
        finally {
            await reader.cancel().catch(() => { });
            reader.releaseLock();
        }
        return Buffer.concat(chunks).toString('utf8').split(token).join('[REDACTED]');
    }
    // Validate credentials during connection, before reporting the adapter as ready.
    await request('/v2/user', options.signal);
    const server = new Server({ name: 'tbot-vercel-rest-adapter', version: '1.0.0' }, { capabilities: { tools: {} } });
    const tools = [
        { name: 'list_projects', description: 'List Vercel projects via TBot local REST adapter.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_project', description: 'Get a Vercel project via TBot local REST adapter.', inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Project ID or name.' } }, required: ['project'], additionalProperties: false } },
        { name: 'list_deployments', description: 'List Vercel deployments via TBot local REST adapter.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    ];
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
    server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
        try {
            if (Object.keys(req.params.arguments ?? {}).some(k => k !== 'project') || (req.params.name !== 'get_project' && Object.keys(req.params.arguments ?? {}).length))
                throw new Error('Invalid arguments.');
            let path;
            if (req.params.name === 'list_projects')
                path = options.project ? `/v9/projects/${encodeURIComponent(options.project)}` : '/v9/projects?limit=20';
            else if (req.params.name === 'list_deployments')
                path = `/v6/deployments?limit=20${options.project ? `&projectId=${encodeURIComponent(options.project)}` : ''}`;
            else if (req.params.name === 'get_project') {
                const project = req.params.arguments?.project;
                if (typeof project !== 'string' || !valid(project) || !project || (options.project && project !== options.project))
                    throw new Error('Project is invalid or outside the configured scope.');
                path = `/v9/projects/${encodeURIComponent(project)}`;
            }
            else
                throw new Error('Unknown tool.');
            return { content: [{ type: 'text', text: await request(path, extra.signal) }] };
        }
        catch (error) {
            return { isError: true, content: [{ type: 'text', text: error instanceof Error && /^Vercel API HTTP \d+$|^Project is invalid|^Invalid arguments|^Unknown tool/.test(error.message) ? error.message : 'Vercel adapter request failed.' }] };
        }
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    return { clientTransport, server };
}
//# sourceMappingURL=mcp-local-vercel.js.map