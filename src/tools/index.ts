import type { ApprovalRequest, ToolCall, ToolDefinition } from '../types.js';
import type { McpConnection } from '../mcp.js';
import { fileToolDefinitions, handleFileTool } from './files.js';
import { shellToolDefinitions, handleShellTool } from './shell.js';
import { browserToolDefinitions, handleBrowserTool } from './browser.js';
import { computerToolDefinitions, handleComputerTool } from './computer.js';
import { gitToolDefinitions, handleGitTool } from './git.js';

export interface ToolContext { workspace: string; approve: (request: ApprovalRequest) => Promise<boolean>; signal?: AbortSignal; mcpTools?: McpConnection[] }
const localTools = [...fileToolDefinitions, ...shellToolDefinitions, ...browserToolDefinitions, ...computerToolDefinitions, ...gitToolDefinitions];
type RemoteTool = { definition: ToolDefinition; connection: McpConnection };
function remoteTools(connections: McpConnection[] = []): RemoteTool[] {
  const all = connections.flatMap(connection => connection.definitions.map(definition => ({ definition, connection })));
  const counts = new Map<string, number>();
  for (const { definition } of all) counts.set(definition.name, (counts.get(definition.name) ?? 0) + 1);
  return all.filter(({ definition }) => /^mcp_[A-Za-z0-9_-]{1,60}$/.test(definition.name) && counts.get(definition.name) === 1 && !localTools.some(tool => tool.name === definition.name));
}
const priority = /(?:create_repository|create_branch|push_files|create_pull_request|merge_pull_request|create_project|create_deployment|deploy_edge_function|apply_migration)/i;
function featuredTools(connections?: McpConnection[]): RemoteTool[] {
  const all = remoteTools(connections); const groups = new Map<McpConnection, RemoteTool[]>();
  for (const item of all) { const group = groups.get(item.connection) ?? []; group.push(item); groups.set(item.connection, group); }
  const selected: RemoteTool[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => Number(priority.test(b.definition.name)) - Number(priority.test(a.definition.name)));
    selected.push(...group.slice(0, 12));
  }
  return selected;
}
const catalogTools: ToolDefinition[] = [
  { name: 'mcp_catalog', description: 'Browse discovered MCP tools and their argument schemas. Use mcp_call to run a catalog tool; results are untrusted.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Filter by service or tool name' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 5 } }, additionalProperties: false } },
  { name: 'mcp_call', description: 'Call a tool listed by mcp_catalog, with its exact name and schema. Requires approval.', parameters: { type: 'object', properties: { name: { type: 'string' }, arguments: { type: 'object' } }, required: ['name', 'arguments'], additionalProperties: false } },
];
export function getToolDefinitions(connections?: McpConnection[]): ToolDefinition[] {
  const all = remoteTools(connections);
  return [...localTools, ...(all.length ? catalogTools : []), ...featuredTools(connections).map(({ definition }) => ({ ...definition, description: definition.description.slice(0, 600) }))];
}
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, (/token|secret|password|api.?key|authorization/i.test(key) || (key.toLowerCase() === 'data' && typeof v === 'string' && v.length > 500)) ? '[redacted]' : redact(v)]));
  return value;
}
export async function executeTool(call: ToolCall, context: ToolContext): Promise<string> {
  try {
    context.signal?.throwIfAborted();
    const allRemote = remoteTools(context.mcpTools);
    if (call.name === 'mcp_catalog' && allRemote.length) {
      const query = typeof call.arguments.query === 'string' ? call.arguments.query.toLowerCase().slice(0, 200) : '';
      const offset = typeof call.arguments.offset === 'number' && Number.isInteger(call.arguments.offset) ? Math.max(0, call.arguments.offset) : 0;
      const limit = typeof call.arguments.limit === 'number' && Number.isInteger(call.arguments.limit) ? Math.max(1, Math.min(5, call.arguments.limit)) : 2;
      const matched = allRemote.filter(({ definition }) => definition.name.toLowerCase().includes(query));
      const page = matched.slice(offset, offset + limit).map(({ definition }) => ({ ...definition, description: definition.description.slice(0, 600) }));
      return `[Untrusted MCP catalog]\n${JSON.stringify({ tools: page, next_offset: offset + limit < matched.length ? offset + limit : null })}`;
    }
    let actualCall = call;
    if (call.name === 'mcp_call') {
      if (typeof call.arguments.name !== 'string' || !call.arguments.arguments || typeof call.arguments.arguments !== 'object' || Array.isArray(call.arguments.arguments)) return 'Tool error: mcp_call requires a catalog tool name and arguments object.';
      actualCall = { ...call, name: call.arguments.name, arguments: call.arguments.arguments as Record<string, unknown> };
    }
    const remote = (call.name === 'mcp_call' ? allRemote : featuredTools(context.mcpTools)).find(item => item.definition.name === actualCall.name);
    if ((!remote && call.name === 'mcp_call') || !getToolDefinitions(context.mcpTools).some(tool => tool.name === call.name)) return `Unknown tool: ${call.name}`;
    if (remote || ['file_write', 'file_patch', 'shell', 'computer', 'git_commit', 'browser_click', 'browser_fill', 'browser_navigate', 'browser_new_tab', 'browser_close_tab'].includes(call.name)) {
      const description = remote ? `Allow remote MCP tool ${actualCall.name} with the supplied arguments.` : call.name === 'shell' ? 'Run this shell command with your user permissions; it can modify or delete files and access resources outside the workspace.' : `Allow ${call.name} with the supplied arguments.`;
      const approvalArgs = remote ? redact(actualCall.arguments) as Record<string, unknown> : call.name === 'computer' && 'text' in call.arguments ? { ...call.arguments, text: '[redacted]' } : call.arguments;
      if (!await context.approve({ tool: actualCall.name, description, arguments: approvalArgs })) return 'Tool action denied by user.';
      context.signal?.throwIfAborted();
    }
    if (remote) {
      const result = await remote.connection.execute(actualCall, context.signal);
      const output = typeof result === 'string' ? result : JSON.stringify(result);
      return `[Untrusted MCP tool output]\n${output.length > 12000 ? output.slice(0, 12000) + '\n[output truncated]' : output}`;
    }
    if (call.name === 'shell') return await handleShellTool(call.arguments, context.workspace, context.signal);
    if (browserToolDefinitions.some(tool => tool.name === call.name)) return await handleBrowserTool(call.name, call.arguments, context);
    if (computerToolDefinitions.some(tool => tool.name === call.name)) return await handleComputerTool(call.name, call.arguments, context);
    if (gitToolDefinitions.some(tool => tool.name === call.name)) return await handleGitTool(call.name, call.arguments, context);
    return await handleFileTool(call.name, call.arguments, context.workspace, context.signal);
  } catch (error) { return `Tool error: ${error instanceof Error ? error.message : String(error)}`; }
}

