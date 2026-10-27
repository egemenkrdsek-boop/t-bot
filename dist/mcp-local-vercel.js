import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
/** Local TBot MCP server backed by selected Vercel REST endpoints, not Vercel's hosted MCP. */
export async function createVercelAdapter(token, options) {
    const valid = (value) => !value || /^[A-Za-z0-9_.-]{1,128}$/.test(value);
    if (!valid(options.team) || !valid(options.project))
        throw new Error('Invalid Vercel team or project scope.');
    async function request(path, signal, body) {
        const url = new URL(path, 'https://api.vercel.com');
        if (options.team)
            url.searchParams.set('teamId', options.team);
        const signals = [AbortSignal.timeout(30_000), ...(signal ? [signal] : [])];
        const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.any(signals) });
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
    if (options.readOnly === false)
        tools.push({ name: 'create_project', description: 'Create a Vercel project in the configured account/team.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, githubRepo: { type: 'string', description: 'Optional GitHub repository owner/name to connect.' } }, required: ['name'], additionalProperties: false } }, { name: 'create_deployment', description: 'Create a Vercel deployment from an explicit GitHub repository and ref or explicitly supplied small base64 files. Preview by default; production only when specified. The response may be BUILDING, not ready.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, target: { type: 'string', enum: ['preview', 'production'] }, repoId: { type: 'string', description: 'GitHub numeric repository ID.' }, ref: { type: 'string', description: 'Git reference.' }, files: { type: 'array', description: 'Explicitly supplied base64 files; never automatically reads the workspace.', maxItems: 100, items: { type: 'object', properties: { file: { type: 'string' }, data: { type: 'string' } }, required: ['file', 'data'], additionalProperties: false } } }, required: ['project'], additionalProperties: false } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
    server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
        try {
            const args = req.params.arguments ?? {};
            let path;
            let body;
            const only = (...keys) => { if (Object.keys(args).some(k => !keys.includes(k)))
                throw new Error('Invalid arguments.'); };
            const projectValue = (value) => {
                if (typeof value !== 'string' || !valid(value) || !value || (options.project && value !== options.project))
                    throw new Error('Project is invalid or outside the configured scope.');
                return value;
            };
            if (req.params.name === 'list_projects') {
                only();
                path = options.project ? `/v9/projects/${encodeURIComponent(options.project)}` : '/v9/projects?limit=20';
            }
            else if (req.params.name === 'list_deployments') {
                only();
                path = `/v6/deployments?limit=20${options.project ? `&projectId=${encodeURIComponent(options.project)}` : ''}`;
            }
            else if (req.params.name === 'get_project') {
                only('project');
                path = `/v9/projects/${encodeURIComponent(projectValue(args.project))}`;
            }
            else if (req.params.name === 'create_project' && options.readOnly === false) {
                only('name', 'githubRepo');
                const name = projectValue(args.name);
                path = '/v11/projects';
                body = { name };
                if (args.githubRepo !== undefined) {
                    if (typeof args.githubRepo !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(args.githubRepo) || args.githubRepo.length > 200)
                        throw new Error('Invalid arguments.');
                    body.gitRepository = { type: 'github', repo: args.githubRepo };
                }
            }
            else if (req.params.name === 'create_deployment' && options.readOnly === false) {
                only('project', 'target', 'repoId', 'ref', 'files');
                const project = projectValue(args.project);
                if (args.target !== undefined && args.target !== 'preview' && args.target !== 'production')
                    throw new Error('Invalid arguments.');
                body = { name: project, project, ...(args.target === 'production' ? { target: 'production' } : {}) };
                if (args.files !== undefined) {
                    if (args.repoId !== undefined || args.ref !== undefined || !Array.isArray(args.files) || !args.files.length || args.files.length > 100)
                        throw new Error('Invalid arguments.');
                    let total = 0;
                    const seen = new Set();
                    body.files = args.files.map((item) => {
                        if (!item || typeof item !== 'object' || Array.isArray(item))
                            throw new Error('Invalid arguments.');
                        const f = item;
                        if (Object.keys(f).some(k => !['file', 'data'].includes(k)) || typeof f.file !== 'string' || typeof f.data !== 'string' || f.file.length > 240 || !f.file || f.file.startsWith('/') || /[\\:\x00-\x1f]/.test(f.file) || f.file.split('/').some(part => !part || part === '.' || part === '..') || seen.has(f.file) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.data))
                            throw new Error('Invalid arguments.');
                        seen.add(f.file);
                        total += f.data.length;
                        if (total > 1_000_000)
                            throw new Error('Invalid arguments.');
                        return { file: f.file, data: f.data, encoding: 'base64' };
                    });
                }
                else {
                    if (typeof args.repoId !== 'string' || !/^\d{1,20}$/.test(args.repoId) || typeof args.ref !== 'string' || !args.ref || args.ref.length > 200 || /[\x00-\x20]/.test(args.ref))
                        throw new Error('Invalid arguments.');
                    body.gitSource = { type: 'github', repoId: args.repoId, ref: args.ref };
                }
                path = '/v13/deployments';
            }
            else
                throw new Error('Unknown tool.');
            return { content: [{ type: 'text', text: await request(path, extra.signal, body) }] };
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