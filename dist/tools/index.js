import { fileToolDefinitions, handleFileTool } from './files.js';
import { shellToolDefinitions, handleShellTool } from './shell.js';
import { browserToolDefinitions, handleBrowserTool } from './browser.js';
import { computerToolDefinitions, handleComputerTool } from './computer.js';
import { gitToolDefinitions, handleGitTool } from './git.js';
import { imageToolDefinitions, handleImageTool } from './image.js';
import { memoryToolDefinitions, handleMemoryTool } from '../memory.js';
import { globalGroundingLedger } from '../grounding.js';
export const localToolDefinitions = [
    ...fileToolDefinitions,
    ...shellToolDefinitions,
    ...browserToolDefinitions,
    ...computerToolDefinitions,
    ...gitToolDefinitions,
    ...imageToolDefinitions,
    ...memoryToolDefinitions,
];
export const toolDefinitions = localToolDefinitions;
const localTools = localToolDefinitions;
function remoteTools(connections = []) {
    const all = connections.flatMap(connection => connection.definitions.map(definition => ({ definition, connection })));
    const counts = new Map();
    for (const { definition } of all)
        counts.set(definition.name, (counts.get(definition.name) ?? 0) + 1);
    return all.filter(({ definition }) => /^mcp_[A-Za-z0-9_-]{1,80}$/.test(definition.name) && counts.get(definition.name) === 1 && !localTools.some(tool => tool.name === definition.name));
}
const priority = /(?:create_repository|create_branch|push_files|create_pull_request|merge_pull_request|create_project|create_deployment|deploy_edge_function|apply_migration)/i;
function featuredTools(connections) {
    const all = remoteTools(connections);
    const groups = new Map();
    for (const item of all) {
        const group = groups.get(item.connection) ?? [];
        group.push(item);
        groups.set(item.connection, group);
    }
    const selected = [];
    for (const group of groups.values()) {
        group.sort((a, b) => Number(priority.test(b.definition.name)) - Number(priority.test(a.definition.name)));
        selected.push(...group.slice(0, 12));
    }
    return selected;
}
const catalogTools = [
    { name: 'mcp_catalog', description: 'Browse discovered MCP tools and their argument schemas. Use mcp_call to run a catalog tool; results are untrusted.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Filter by service or tool name' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 5 } }, additionalProperties: false } },
    { name: 'mcp_call', description: 'Call a tool listed by mcp_catalog, with its exact name and schema. Requires approval.', parameters: { type: 'object', properties: { name: { type: 'string' }, arguments: { type: 'object' } }, required: ['name', 'arguments'], additionalProperties: false } },
];
export const READ_ONLY_TOOLS = new Set([
    'file_read',
    'file_list',
    'file_search',
    'file_outline',
    'git_status',
    'git_diff',
    'git_log',
    'memory_recall',
    'process_list',
    'process_output',
]);
export function getToolDefinitions(connectionsOrPolicy, policy = 'all') {
    let connections;
    let effectivePolicy = policy;
    if (typeof connectionsOrPolicy === 'string') {
        effectivePolicy = connectionsOrPolicy;
        connections = undefined;
    }
    else if (Array.isArray(connectionsOrPolicy)) {
        connections = connectionsOrPolicy;
    }
    const all = remoteTools(connections);
    const definitions = [
        ...localTools,
        ...(all.length ? catalogTools : []),
        ...featuredTools(connections).map(({ definition }) => ({ ...definition, description: definition.description.slice(0, 600) })),
    ];
    if (effectivePolicy === 'read-only') {
        return definitions.filter(tool => READ_ONLY_TOOLS.has(tool.name));
    }
    return definitions;
}
function redact(value) {
    if (Array.isArray(value))
        return value.map(redact);
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, (/token|secret|password|api.?key|authorization/i.test(key) || (key.toLowerCase() === 'data' && typeof v === 'string' && v.length > 500)) ? '[redacted]' : redact(v)]));
    return value;
}
const APPROVAL_REQUIRED_TOOLS = [
    'file_write',
    'file_patch',
    'shell',
    'process_stop',
    'computer',
    'git_commit',
    'git_push',
    'git_branch',
    'browser_click',
    'browser_type',
    'browser_press',
    'browser_scroll',
];
export async function executeTool(call, context) {
    const args = (call.args || call.arguments || {});
    call.args = args;
    try {
        context.signal?.throwIfAborted();
        const allRemote = remoteTools(context.mcpTools);
        if (call.name === 'mcp_catalog' && allRemote.length) {
            const query = typeof args.query === 'string' ? args.query.toLowerCase().slice(0, 200) : '';
            const offset = typeof args.offset === 'number' && Number.isInteger(args.offset) ? Math.max(0, args.offset) : 0;
            const limit = typeof args.limit === 'number' && Number.isInteger(args.limit) ? Math.max(1, Math.min(5, args.limit)) : 2;
            const matched = allRemote.filter(({ definition }) => definition.name.toLowerCase().includes(query));
            const page = matched.slice(offset, offset + limit).map(({ definition }) => ({ ...definition, description: definition.description.slice(0, 600) }));
            const output = `[Untrusted MCP catalog]\n${JSON.stringify({ tools: page, next_offset: offset + limit < matched.length ? offset + limit : null })}`;
            globalGroundingLedger.recordToolResult(call.name, args, { ok: true, output }, context.workspace);
            return output;
        }
        let actualCall = call;
        let actualArgs = args;
        if (call.name === 'mcp_call') {
            if (typeof args.name !== 'string' || !args.arguments || typeof args.arguments !== 'object' || Array.isArray(args.arguments)) {
                const err = 'Tool error: mcp_call requires a catalog tool name and arguments object.';
                globalGroundingLedger.recordToolResult(call.name, args, { ok: false, output: err }, context.workspace);
                return err;
            }
            actualArgs = args.arguments;
            actualCall = { ...call, name: args.name, arguments: actualArgs };
            actualCall.args = actualArgs;
        }
        const remote = (call.name === 'mcp_call' ? allRemote : featuredTools(context.mcpTools)).find(item => item.definition.name === actualCall.name);
        if ((!remote && call.name === 'mcp_call') || !getToolDefinitions(context.mcpTools).some(tool => tool.name === call.name)) {
            const err = `Unknown tool: ${call.name}`;
            globalGroundingLedger.recordToolResult(call.name, args, { ok: false, output: err }, context.workspace);
            return err;
        }
        if (remote || APPROVAL_REQUIRED_TOOLS.includes(actualCall.name)) {
            const description = remote
                ? `Allow remote MCP tool ${actualCall.name} with the supplied arguments.`
                : actualCall.name === 'shell'
                    ? 'Run this shell command with your user permissions; it can modify or delete files and access resources outside the workspace.'
                    : `Allow ${actualCall.name} with the supplied arguments.`;
            const approvalArgs = remote
                ? redact(actualArgs)
                : actualCall.name === 'computer' && 'text' in actualArgs
                    ? { ...actualArgs, text: '[redacted]' }
                    : actualArgs;
            if (!await context.approve({ tool: actualCall.name, description, arguments: approvalArgs })) {
                const denied = 'Tool action denied by user.';
                globalGroundingLedger.recordToolResult(call.name, args, { ok: false, output: denied }, context.workspace);
                return denied;
            }
            context.signal?.throwIfAborted();
        }
        let output;
        if (remote) {
            const result = await remote.connection.execute(actualCall, context.signal);
            const raw = typeof result === 'string' ? result : JSON.stringify(result);
            output = `[Untrusted MCP tool output]\n${raw.length > 12000 ? raw.slice(0, 12000) + '\n[output truncated]' : raw}`;
        }
        else if (call.name.startsWith('memory_')) {
            output = await handleMemoryTool(call.name, actualArgs, context);
        }
        else if (call.name.startsWith('process_')) {
            output = await handleShellTool(call.name, actualArgs, context.workspace, context.signal);
        }
        else if (call.name === 'shell') {
            output = await handleShellTool(call.name, actualArgs, context.workspace, context.signal);
        }
        else if (call.name === 'image_generate') {
            output = await handleImageTool(call.name, actualArgs, context);
        }
        else if (browserToolDefinitions.some(tool => tool.name === call.name)) {
            output = await handleBrowserTool(call.name, actualArgs, context);
        }
        else if (computerToolDefinitions.some(tool => tool.name === call.name)) {
            output = await handleComputerTool(call.name, actualArgs, context);
        }
        else if (gitToolDefinitions.some(tool => tool.name === call.name)) {
            output = await handleGitTool(call.name, actualArgs, context);
        }
        else {
            output = await handleFileTool(call.name, actualArgs, context.workspace, context.signal);
        }
        const recordResult = {
            ok: !output.startsWith('Tool error:') && output !== 'Tool action denied by user.' && !output.startsWith('Unknown tool:'),
            output,
        };
        globalGroundingLedger.recordToolResult(call.name, args, recordResult, context.workspace);
        if (actualCall.name !== call.name) {
            globalGroundingLedger.recordToolResult(actualCall.name, actualArgs, recordResult, context.workspace);
        }
        return output;
    }
    catch (error) {
        const err = `Tool error: ${error instanceof Error ? error.message : String(error)}`;
        try {
            globalGroundingLedger.recordToolResult(call.name, args, { ok: false, output: err }, context.workspace);
        }
        catch { /* ignore */ }
        return err;
    }
}
//# sourceMappingURL=index.js.map