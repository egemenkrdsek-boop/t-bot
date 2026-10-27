import { fileToolDefinitions, handleFileTool } from './files.js';
import { shellToolDefinitions, handleShellTool } from './shell.js';
import { browserToolDefinitions, handleBrowserTool } from './browser.js';
import { computerToolDefinitions, handleComputerTool } from './computer.js';
import { gitToolDefinitions, handleGitTool } from './git.js';
import { imageToolDefinitions, handleImageTool } from './image.js';
import { memoryToolDefinitions, handleMemoryTool, forgetFact } from '../memory.js';
import * as skillsMod from '../skills.js';
import * as subagentsMod from '../subagents.js';
import { globalGroundingLedger } from '../grounding.js';
import { redactSecrets } from '../sessions.js';
export function isToolResultOk(name, output) {
    if (typeof output !== 'string')
        return false;
    const trimmed = output.trimStart();
    if (trimmed.startsWith('Tool error:') ||
        trimmed.startsWith('Araç Hatası:') ||
        trimmed.startsWith('Araç hatası:') ||
        trimmed.startsWith('Tool action denied') ||
        trimmed.startsWith('Tool denied:') ||
        trimmed.startsWith('Araç reddedildi') ||
        trimmed.startsWith('Unknown tool:')) {
        return false;
    }
    if (/"ok"\s*:\s*false/.test(output)) {
        return false;
    }
    if (name === 'shell') {
        if (output.includes('Timed out') || output.includes('Aborted')) {
            return false;
        }
        const exitMatch = output.match(/Exit code:\s*(\d+)/i);
        if (exitMatch && Number(exitMatch[1]) !== 0) {
            return false;
        }
        if (/Exit code:\s*(?:-\d+|signal\b)/i.test(output)) {
            return false;
        }
    }
    return true;
}
// Normalize GroundingLedger.recordToolResult so both (name, args, output, ok) and (name, args, { ok, output }, workspace) work seamlessly
const ledgerProto = Object.getPrototypeOf(globalGroundingLedger);
if (ledgerProto && typeof ledgerProto.recordToolResult === 'function' && !ledgerProto.__wrappedRecordToolResult) {
    const origRecord = ledgerProto.recordToolResult;
    ledgerProto.recordToolResult = function (toolName, args, resultOrOutput, okOrWorkspace, maybeWorkspace) {
        const rawOutput = typeof resultOrOutput === 'string' ? resultOrOutput : (resultOrOutput?.output ?? '');
        const rawOk = typeof resultOrOutput === 'string'
            ? typeof okOrWorkspace === 'boolean'
                ? okOrWorkspace
                : true
            : Boolean(resultOrOutput?.ok);
        const ok = rawOk && isToolResultOk(toolName, rawOutput);
        const ws = typeof okOrWorkspace === 'string'
            ? okOrWorkspace
            : typeof maybeWorkspace === 'string'
                ? maybeWorkspace
                : this.workspace;
        const fnStr = Function.prototype.toString.call(origRecord);
        const fnHead = fnStr.slice(0, 200);
        if (/\(\s*[^,]+,\s*[^,]+,\s*result\b/.test(fnHead) && !fnStr.includes('typeof result')) {
            return origRecord.call(this, toolName, args, { ok, output: rawOutput }, ws);
        }
        return origRecord.call(this, toolName, args, rawOutput, ok, ws);
    };
    Object.defineProperty(ledgerProto, '__wrappedRecordToolResult', { value: true, enumerable: false });
}
const fallbackMemoryForgetDefinition = {
    name: 'memory_forget',
    description: 'Remove a saved fact or preference from persistent memory by key.',
    parameters: {
        type: 'object',
        properties: {
            key: { type: 'string', description: 'Identifier or key of the fact to remove' },
        },
        required: ['key'],
        additionalProperties: false,
    },
};
function getSkillDefs() {
    try {
        const defs = skillsMod.skillToolDefinitions;
        return Array.isArray(defs) ? defs : [];
    }
    catch {
        return [];
    }
}
function getSubagentDefs() {
    try {
        const defs = subagentsMod.subagentToolDefinitions;
        return Array.isArray(defs) ? defs : [];
    }
    catch {
        return [];
    }
}
function buildLocalToolDefinitions() {
    const memoryDefs = memoryToolDefinitions.some(t => t.name === 'memory_forget')
        ? memoryToolDefinitions
        : [...memoryToolDefinitions, fallbackMemoryForgetDefinition];
    const all = [
        ...fileToolDefinitions,
        ...shellToolDefinitions,
        ...browserToolDefinitions,
        ...computerToolDefinitions,
        ...gitToolDefinitions,
        ...imageToolDefinitions,
        ...memoryDefs,
        ...getSkillDefs(),
        ...getSubagentDefs(),
    ];
    const seen = new Set();
    return all.filter(tool => {
        if (!tool || typeof tool.name !== 'string' || seen.has(tool.name))
            return false;
        seen.add(tool.name);
        return true;
    });
}
export const localToolDefinitions = buildLocalToolDefinitions();
export const toolDefinitions = localToolDefinitions;
function syncLocalTools() {
    const current = buildLocalToolDefinitions();
    if (current.length !== localToolDefinitions.length || current.some((t, i) => localToolDefinitions[i]?.name !== t.name)) {
        localToolDefinitions.splice(0, localToolDefinitions.length, ...current);
    }
    return localToolDefinitions;
}
function remoteTools(connections = []) {
    const local = syncLocalTools();
    const all = connections.flatMap(connection => connection.definitions.map(definition => ({ definition, connection })));
    const counts = new Map();
    for (const { definition } of all)
        counts.set(definition.name, (counts.get(definition.name) ?? 0) + 1);
    return all.filter(({ definition }) => /^mcp_[A-Za-z0-9_-]{1,80}$/.test(definition.name) && counts.get(definition.name) === 1 && !local.some(tool => tool.name === definition.name));
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
    'file_glob',
    'file_search',
    'file_outline',
    'git_status',
    'git_diff',
    'git_log',
    'memory_recall',
    'process_list',
    'process_output',
    'skill_list',
    'delegate_task',
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
    const local = syncLocalTools();
    const all = remoteTools(connections);
    const definitions = [
        ...local,
        ...(all.length ? catalogTools : []),
        ...featuredTools(connections).map(({ definition }) => ({ ...definition, description: definition.description.slice(0, 600) })),
    ];
    if (effectivePolicy === 'read-only') {
        return definitions.filter(tool => READ_ONLY_TOOLS.has(tool.name));
    }
    return definitions;
}
function redact(value) {
    if (typeof value === 'string')
        return redactSecrets(value);
    if (Array.isArray(value))
        return value.map(redact);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, v]) => [
            key,
            /token|secret|password|api.?key|authorization|credential|private.?key/i.test(key) ||
                (key.toLowerCase() === 'data' && typeof v === 'string' && v.length > 500)
                ? '[redacted]'
                : redact(v),
        ]));
    }
    return value;
}
export const APPROVAL_REQUIRED_TOOLS = [
    'browser_click',
    'browser_fill',
    'file_write',
    'file_patch',
    'shell',
    'process_stop',
    'git_add',
    'git_commit',
    'git_branch',
    'git_push',
    'computer',
];
export async function executeTool(call, context) {
    const args = (call.args || call.arguments || {});
    call.args = args;
    call.arguments = args;
    if (context.workspace) {
        globalGroundingLedger.workspace = context.workspace;
    }
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
            globalGroundingLedger.recordToolResult(call.name, call.arguments, output, isToolResultOk(call.name, output));
            return output;
        }
        let actualCall = call;
        let actualArgs = args;
        if (call.name === 'mcp_call') {
            if (typeof args.name !== 'string' || !args.arguments || typeof args.arguments !== 'object' || Array.isArray(args.arguments)) {
                const err = 'Tool error: mcp_call requires a catalog tool name and arguments object.';
                globalGroundingLedger.recordToolResult(call.name, call.arguments, err, false);
                return err;
            }
            actualArgs = args.arguments;
            actualCall = { ...call, name: args.name, arguments: actualArgs };
            actualCall.args = actualArgs;
        }
        const remote = (call.name === 'mcp_call' ? allRemote : featuredTools(context.mcpTools)).find(item => item.definition.name === actualCall.name);
        if ((!remote && call.name === 'mcp_call') || !getToolDefinitions(context.mcpTools).some(tool => tool.name === call.name)) {
            const err = `Unknown tool: ${call.name}`;
            globalGroundingLedger.recordToolResult(call.name, call.arguments, err, false);
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
                globalGroundingLedger.recordToolResult(call.name, call.arguments, denied, false);
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
        else if (call.name === 'delegate_task' || getSubagentDefs().some(tool => tool.name === call.name)) {
            const handler = subagentsMod.handleSubagentTool;
            if (typeof handler !== 'function') {
                throw new Error(`Subagent tool handler is not available for ${call.name}`);
            }
            output = await handler(actualCall, context);
        }
        else if (call.name === 'skill_create' || call.name === 'skill_list' || call.name.startsWith('skill_') || getSkillDefs().some(tool => tool.name === call.name)) {
            const handler = skillsMod.handleSkillTool;
            if (typeof handler !== 'function') {
                throw new Error(`Skill tool handler is not available for ${call.name}`);
            }
            output = await handler(actualCall, context);
        }
        else if (call.name.startsWith('memory_')) {
            try {
                output = await handleMemoryTool(call.name, actualArgs, context);
            }
            catch (err) {
                if (call.name === 'memory_forget' && err instanceof Error && err.message.startsWith('Unknown memory tool:')) {
                    const key = typeof actualArgs.key === 'string' ? actualArgs.key.trim() : '';
                    if (!key)
                        throw new Error('Parameter "key" is required.');
                    const removed = await forgetFact(context.workspace, key);
                    output = removed ? `Removed from memory: ${key}` : `Memory key not found: ${key}`;
                }
                else {
                    throw err;
                }
            }
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
        globalGroundingLedger.recordToolResult(call.name, call.arguments, output, isToolResultOk(call.name, output));
        if (actualCall.name !== call.name) {
            globalGroundingLedger.recordToolResult(actualCall.name, actualArgs, output, isToolResultOk(actualCall.name, output));
        }
        return output;
    }
    catch (error) {
        const err = `Tool error: ${error instanceof Error ? error.message : String(error)}`;
        try {
            globalGroundingLedger.recordToolResult(call.name, call.arguments, err, isToolResultOk(call.name, err));
        }
        catch { /* ignore */ }
        return err;
    }
}
//# sourceMappingURL=index.js.map