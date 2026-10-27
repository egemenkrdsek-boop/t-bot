import type { ApprovalRequest, ToolCall, ToolDefinition } from '../types.js';
import { fileToolDefinitions, handleFileTool } from './files.js';
import { shellToolDefinitions, handleShellTool } from './shell.js';
import { browserToolDefinitions, handleBrowserTool } from './browser.js';
import { computerToolDefinitions, handleComputerTool } from './computer.js';
import { gitToolDefinitions, handleGitTool } from './git.js';

export interface ToolContext { workspace: string; approve: (request: ApprovalRequest) => Promise<boolean>; signal?: AbortSignal }
export function getToolDefinitions(): ToolDefinition[] { return [...fileToolDefinitions, ...shellToolDefinitions, ...browserToolDefinitions, ...computerToolDefinitions, ...gitToolDefinitions]; }
export async function executeTool(call: ToolCall, context: ToolContext): Promise<string> {
  try {
    context.signal?.throwIfAborted();
    if (!getToolDefinitions().some(tool => tool.name === call.name)) return `Unknown tool: ${call.name}`;
    if (['file_write', 'file_patch', 'shell', 'computer', 'git_commit', 'browser_click', 'browser_fill', 'browser_navigate', 'browser_new_tab', 'browser_close_tab'].includes(call.name)) {
      const description = call.name === 'shell' ? 'Run this shell command with your user permissions; it can modify or delete files and access resources outside the workspace.' : `Allow ${call.name} with the supplied arguments.`;
      const approvalArgs = call.name === 'computer' && 'text' in call.arguments ? { ...call.arguments, text: '[redacted]' } : call.arguments;
      if (!await context.approve({ tool: call.name, description, arguments: approvalArgs })) return 'Tool action denied by user.';
      context.signal?.throwIfAborted();
    }
    if (call.name === 'shell') return await handleShellTool(call.arguments, context.workspace, context.signal);
    if (browserToolDefinitions.some(tool => tool.name === call.name)) return await handleBrowserTool(call.name, call.arguments, context);
    if (computerToolDefinitions.some(tool => tool.name === call.name)) return await handleComputerTool(call.name, call.arguments, context);
    if (gitToolDefinitions.some(tool => tool.name === call.name)) return await handleGitTool(call.name, call.arguments, context);
    return await handleFileTool(call.name, call.arguments, context.workspace, context.signal);
  } catch (error) { return `Tool error: ${error instanceof Error ? error.message : String(error)}`; }
}

