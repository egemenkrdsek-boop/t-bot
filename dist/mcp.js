import { createHash } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createVercelAdapter } from './mcp-local-vercel.js';
import { isAllowedStdioCommand, stdioCommandAllowlist } from './mcp-config.js';
import { configDirectory } from './config.js';
let registeredStdioApprover;
/**
 * Hosts (desktop/main, CLI) register their approval dialog here. A stdio MCP
 * server is never spawned without either this callback, a per-call approver or
 * a persisted `stdioApproved` flag the user set explicitly.
 */
export function registerMcpStdioApproval(approver) {
    registeredStdioApprover = approver;
}
async function logMcpConnection(entry) {
    try {
        const directory = configDirectory();
        await mkdir(directory, { recursive: true, mode: 0o700 });
        // Command basename and argument count only: argv may contain tokens.
        await appendFile(join(directory, 'mcp-connections.log'), `${JSON.stringify({
            time: new Date().toISOString(), ...entry,
        })}\n`, { mode: 0o600 });
    }
    catch {
        // Connection logging must never block or leak into the tool result.
    }
}
const TIMEOUT = 30_000;
export function parseStdioCommand(raw) {
    const tokens = [];
    const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
    let match;
    while ((match = regex.exec(raw)) !== null) {
        if (match[1] !== undefined)
            tokens.push(match[1]);
        else if (match[2] !== undefined)
            tokens.push(match[2]);
        else
            tokens.push(match[0]);
    }
    const [command = '', ...args] = tokens;
    return { command, args };
}
export async function connectMcp(service, token, options = {}) {
    let stdioUrl;
    let serviceName = 'mcp';
    let stdioApproved = options.stdioApproved === true;
    if (typeof service === 'string') {
        serviceName = service;
        if (service.startsWith('stdio:')) {
            stdioUrl = service;
            serviceName = 'stdio';
        }
    }
    else if (service && typeof service === 'object') {
        if (typeof service.id === 'string')
            serviceName = service.id;
        else if (typeof service.name === 'string')
            serviceName = service.name;
        if (typeof service.url === 'string' && service.url.startsWith('stdio:')) {
            stdioUrl = service.url;
        }
        if (typeof service.stdioApproved === 'boolean') {
            stdioApproved = service.stdioApproved === true;
        }
    }
    if (!stdioUrl && typeof options.url === 'string' && options.url.startsWith('stdio:')) {
        stdioUrl = options.url;
    }
    const effectiveToken = token ?? '';
    if (!stdioUrl) {
        if (!effectiveToken || effectiveToken.length > 8192 || /[\r\n]/.test(effectiveToken))
            throw new Error('Invalid MCP token.');
        if (options.project && !/^[A-Za-z0-9_-]{1,128}$/.test(options.project))
            throw new Error('Invalid project scope.');
    }
    const client = new Client({ name: 'tbot', version: '1.0.0' }, { capabilities: {} });
    let adapter;
    try {
        if (stdioUrl) {
            const { command, args } = parseStdioCommand(stdioUrl.slice('stdio:'.length).trim());
            if (!command)
                throw new Error('Invalid stdio MCP command.');
            if (!isAllowedStdioCommand(command)) {
                await logMcpConnection({ service: serviceName, command: basename(command) || '(empty)', argumentCount: args.length, decision: 'denied-allowlist' });
                throw new Error(`MCP stdio command "${command}" is not allowlisted. Allowed launchers: ${stdioCommandAllowlist().join(', ')}.`);
            }
            const cwd = resolve(options.workspace || process.cwd());
            const approvalRequest = { service: serviceName, command, args, cwd };
            const approver = options.approve ?? registeredStdioApprover;
            let approved = stdioApproved;
            if (!approved && approver) {
                try {
                    approved = (await approver(approvalRequest)) === true;
                }
                catch {
                    approved = false;
                }
            }
            if (!approved) {
                await logMcpConnection({ service: serviceName, command: basename(command), argumentCount: args.length, cwd, decision: 'denied-approval' });
                throw new Error(approver
                    ? 'MCP stdio connection was not approved by the user.'
                    : 'MCP stdio servers require explicit user approval; automatic startup is disabled. Approve this connection in the host UI (registerMcpStdioApproval) or set stdioApproved for this service.');
            }
            await logMcpConnection({ service: serviceName, command: basename(command), argumentCount: args.length, cwd, decision: 'allowed' });
            const transport = new StdioClientTransport({ command, args, cwd });
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
        else if (serviceName === 'supabase') {
            const url = new URL('https://mcp.supabase.com/mcp');
            if (options.project)
                url.searchParams.set('project_ref', options.project);
            if (options.readOnly !== false)
                url.searchParams.set('read_only', 'true');
            const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${effectiveToken}` }, redirect: 'error' }, fetch: (input, init) => {
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
        else if (serviceName === 'github') {
            const url = new URL('https://api.githubcopilot.com/mcp/');
            const headers = {
                Authorization: `Bearer ${effectiveToken}`,
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
        else if (serviceName === 'vercel') {
            adapter = await createVercelAdapter(effectiveToken, { ...options, readOnly: options.readOnly !== false });
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
        const safeService = serviceName.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 18) || 'mcp';
        const definitions = all.map(tool => {
            const hash = createHash('sha256').update(tool.name).digest('hex').slice(0, 8);
            const safe = tool.name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 26);
            const name = `mcp_${safeService}_${safe}_${hash}`;
            if (map.has(name) || !tool.name || JSON.stringify(tool.inputSchema).length > 32_000)
                throw new Error('Invalid MCP tool manifest.');
            map.set(name, tool.name);
            return { name, description: (tool.description || tool.name).slice(0, 4000), parameters: tool.inputSchema };
        });
        return {
            service: serviceName,
            definitions,
            async execute(call, signal) {
                const name = map.get(call.name);
                if (!name)
                    return 'Unknown MCP tool.';
                try {
                    const result = await client.callTool({ name, arguments: call.arguments }, undefined, { signal, timeout: TIMEOUT });
                    const escapedToken = effectiveToken ? JSON.stringify(effectiveToken).slice(1, -1) : '';
                    const serialized = escapedToken ? JSON.stringify(result).split(escapedToken).join('[REDACTED]') : JSON.stringify(result);
                    return serialized.length > 24_000 ? `${serialized.slice(0, 24_000)}\n[Output truncated]` : serialized;
                }
                catch (err) {
                    if (signal?.aborted)
                        return 'MCP request cancelled.';
                    const detail = err instanceof Error ? err.message : String(err);
                    const safeDetail = effectiveToken ? detail.split(effectiveToken).join('[REDACTED]') : detail;
                    return `MCP request failed or timed out: ${safeDetail}`;
                }
            },
            async close() {
                await client.close();
                await adapter?.server.close();
            },
        };
    }
    catch (err) {
        await client.close().catch(() => { });
        await adapter?.server.close().catch(() => { });
        const detail = err instanceof Error ? err.message : String(err);
        const safeDetail = effectiveToken ? detail.split(effectiveToken).join('[REDACTED]') : detail;
        throw new Error(`${serviceName} MCP connection failed (${safeDetail}). Check token, permissions, scope and network.`);
    }
}
//# sourceMappingURL=mcp.js.map