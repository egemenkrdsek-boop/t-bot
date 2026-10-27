import type { ApprovalRequest, ToolCall, ToolDefinition } from '../types.js';
import type { McpConnection } from '../mcp.js';
import { fileToolDefinitions, handleFileTool } from './files.js';
import { shellToolDefinitions, handleShellTool } from './shell.js';
import { browserToolDefinitions, handleBrowserTool } from './browser.js';
import { computerToolDefinitions, handleComputerTool } from './computer.js';
import { gitToolDefinitions, handleGitTool } from './git.js';

export interface ToolContext { workspace: string; approve: (request: ApprovalRequest) => Promise<boolean>; signal?: AbortSignal; mcpTools?: McpConnection[] }
const localTools = [...fileToolDefinitions, ...shellToolDefinitions, ...browserToolDefinitions, ...computerToolDefinitions, ...gitToolDefinitions];
function remoteTools(connections: McpConnection[] = []): { definition: ToolDefinition; connection: McpConnection }[] {
  const all = connections.flatMap(connection => connection.definitions.map(definition => ({ definition, connection })));
  const counts = new Map<string, number>();
  for (const { definition } of all) counts.set(definition.name, (counts.get(definition.name) ?? 0) + 1);
  return all.filter(({ definition }) => /^mcp_[A-Za-z0-9_-]{1,60}$/.test(definition.name) && counts.get(definition.name) === 1 && !localTools.some(tool => tool.name === definition.name)).slice(0, 50);
}
export function getToolDefinitions(connections?: McpConnection[]): ToolDefinition[] { return [...localTools, ...remoteTools(connections).map(({ definition }) => definition)]; }
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, /token|secret|password|api.?key|authorization/i.test(key) ? '[redacted]' : redact(v)]));
  return value;
}
export async function executeTool(call: ToolCall, context: ToolContext): Promise<string> {
  try {
    context.signal?.throwIfAborted();
    const remote = remoteTools(context.mcpTools).find(item => item.definition.name === call.name);
    if (!getToolDefinitions(context.mcpTools).some(tool => tool.name === call.name)) return `Unknown tool: ${call.name}`;
    if (remote || ['file_write', 'file_patch', 'shell', 'computer', 'git_commit', 'browser_click', 'browser_fill', 'browser_navigate', 'browser_new_tab', 'browser_close_tab'].includes(call.name)) {
      const description = call.name === 'shell' ? 'Run this shell command with your user permissions; it can modify or delete files and access resources outside the workspace.' : `Allow ${call.name} with the supplied arguments.`;
      const approvalArgs = remote ? redact(call.arguments) as Record<string, unknown> : call.name === 'computer' && 'text' in call.arguments ? { ...call.arguments, text: '[redacted]' } : call.arguments;
      if (!await context.approve({ tool: call.name, description, arguments: approvalArgs })) return 'Tool action denied by user.';
      context.signal?.throwIfAborted();
    }
    if (remote) {
      const result = await remote.connection.execute(call, context.signal);
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

