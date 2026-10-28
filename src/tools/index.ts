import type { ApprovalRequest, ToolCall, ToolDefinition } from '../types.js';
import type { McpConnection } from '../mcp.js';
import { fileToolDefinitions, handleFileTool } from './files.js';
import { shellToolDefinitions, handleShellTool } from './shell.js';
import { browserToolDefinitions, handleBrowserTool } from './browser.js';
import { computerToolDefinitions, handleComputerTool, executeComputerTool, closeIdleDesktopDaemon } from './computer.js';
import { gitToolDefinitions, handleGitTool } from './git.js';
import { imageToolDefinitions, handleImageTool, type ImageProviderConfig } from './image.js';
import { memoryToolDefinitions, handleMemoryTool, forgetFact } from '../memory.js';
import { WEB_TOOLS, executeWebTool } from './web.js';
import { WORKFLOW_TOOLS, executeWorkflowTool } from '../workflows.js';
import * as skillsMod from '../skills.js';
import * as subagentsMod from '../subagents.js';
import { globalGroundingLedger } from '../grounding.js';
import { redactSecrets } from '../sessions.js';

export interface ToolContext {
  workspace: string;
  approve: (request: ApprovalRequest) => Promise<boolean>;
  signal?: AbortSignal;
  mcpTools?: McpConnection[];
  imageProvider?: ImageProviderConfig;
  [key: string]: unknown;
}

export function isToolResultOk(name: string, output: string): boolean {
  if (typeof output !== 'string') return false;
  const trimmed = output.trimStart();
  if (
    trimmed.startsWith('Tool error:') ||
    trimmed.startsWith('Araç Hatası:') ||
    trimmed.startsWith('Araç hatası:') ||
    trimmed.startsWith('Tool action denied') ||
    trimmed.startsWith('Tool denied:') ||
    trimmed.startsWith('Araç reddedildi') ||
    trimmed.startsWith('Unknown tool:')
  ) {
    return false;
  }
  if (trimmed.startsWith('{') && /"ok"\s*:\s*false/.test(trimmed)) {
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

/**
 * Fuzzy Tool and Argument Normalization (Aliases).
 * Maps tool nicknames (cat, grep, ls, bash, search_web, todo, etc.) and
 * argument aliases (filePath, cmd, q, startLine, oldText, etc.) to canonical contracts.
 */
export function normalizeToolCall(
  name: string,
  rawArgs: Record<string, unknown>
): { name: string; args: Record<string, unknown> } {
  const toolAliases: Record<string, string> = {
    read_file: 'file_read',
    read: 'file_read',
    cat: 'file_read',
    view_file: 'file_read',

    write_file: 'file_write',
    create_file: 'file_write',
    save_file: 'file_write',

    edit_file: 'file_patch',
    patch_file: 'file_patch',
    replace_in_file: 'file_patch',
    modify_file: 'file_patch',

    list_dir: 'file_list',
    dir_list: 'file_list',
    ls: 'file_list',
    list_files: 'file_list',

    find_files: 'file_glob',
    glob: 'file_glob',

    grep: 'file_search',
    code_search: 'file_search',
    search_files: 'file_search',
    ripgrep: 'file_search',

    outline: 'file_outline',
    ast_outline: 'file_outline',
    symbols: 'file_outline',

    run_command: 'shell',
    execute_command: 'shell',
    bash: 'shell',
    terminal: 'shell',
    cmd: 'shell',
    powershell: 'shell',
    exec: 'shell',

    desktop: 'computer',
    desktop_action: 'computer',
    os_control: 'computer',
    mouse_click: 'computer',
    keyboard_type: 'computer',
    open_app: 'computer',
    take_screenshot: 'computer',
    screen_capture: 'computer',
    desktop_click: 'computer',
    desktop_type: 'computer',

    navigate: 'browser_navigate',
    open_url: 'browser_open',
    web_open: 'browser_open',

    search_web: 'web_search',
    google: 'web_search',
    internet_search: 'web_search',

    fetch_url: 'url_fetch',
    read_url: 'url_fetch',
    http_get: 'url_fetch',

    todo: 'todo_manage',
    todos: 'todo_manage',
    task_tracker: 'todo_manage',

    goal: 'goal_manage',
    goals: 'goal_manage',
  };

  const safeName = typeof name === 'string' ? name : '';
  const normalizedName = toolAliases[safeName] ?? safeName;
  const args = { ...(rawArgs || {}) };

  if (normalizedName.startsWith('file_')) {
    // path alias
    const pathVal = args.path ?? args.filePath ?? args.file_path ?? args.file ?? args.filename ?? args.target_file;
    if (pathVal !== undefined) {
      args.path = pathVal;
    }
    // start_line alias
    const startLineVal = args.start_line ?? args.startLine ?? args.line_start;
    if (startLineVal !== undefined) {
      args.start_line = startLineVal;
    }
    // end_line alias
    const endLineVal = args.end_line ?? args.endLine ?? args.line_end;
    if (endLineVal !== undefined) {
      args.end_line = endLineVal;
    }
    // old_text alias
    const oldTextVal = args.old_text ?? args.oldText ?? args.search ?? args.target ?? args.find;
    if (oldTextVal !== undefined) {
      args.old_text = oldTextVal;
    }
    // new_text alias
    const newTextVal = args.new_text ?? args.newText ?? args.replace ?? args.replacement;
    if (newTextVal !== undefined) {
      args.new_text = newTextVal;
    }
  } else if (normalizedName === 'shell') {
    const cmdVal = args.command ?? args.cmd ?? args.script ?? args.commandLine;
    if (cmdVal !== undefined) {
      args.command = cmdVal;
    }
  } else if (normalizedName === 'web_search') {
    const queryVal = args.query ?? args.q ?? args.search_query;
    if (queryVal !== undefined) {
      args.query = queryVal;
    }
  } else if (normalizedName === 'url_fetch') {
    const urlVal = args.url ?? args.target_url ?? args.link;
    if (urlVal !== undefined) {
      args.url = urlVal;
    }
  } else if (normalizedName === 'computer') {
    if (name === 'mouse_click' || name === 'desktop_click') {
      args.action = args.action ?? 'click';
    } else if (name === 'keyboard_type' || name === 'desktop_type') {
      args.action = args.action ?? 'type';
    } else if (name === 'open_app') {
      args.action = args.action ?? 'open';
    } else if (name === 'take_screenshot' || name === 'screen_capture') {
      args.action = args.action ?? 'screenshot';
    }
  } else if (normalizedName === 'browser_navigate' || normalizedName === 'browser_open') {
    const urlVal = args.url ?? args.target_url ?? args.link;
    if (urlVal !== undefined) {
      args.url = urlVal;
    }
  }

  return { name: normalizedName, args };
}

const fallbackMemoryForgetDefinition: ToolDefinition = {
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

function getSkillDefs(): ToolDefinition[] {
  try {
    const defs = (skillsMod as any).skillToolDefinitions;
    return Array.isArray(defs) ? defs : [];
  } catch {
    return [];
  }
}

function getSubagentDefs(): ToolDefinition[] {
  try {
    const defs = (subagentsMod as any).subagentToolDefinitions;
    return Array.isArray(defs) ? defs : [];
  } catch {
    return [];
  }
}

function buildLocalToolDefinitions(): ToolDefinition[] {
  const memoryDefs = memoryToolDefinitions.some(t => t.name === 'memory_forget')
    ? memoryToolDefinitions
    : [...memoryToolDefinitions, fallbackMemoryForgetDefinition];

  const all: ToolDefinition[] = [
    ...fileToolDefinitions,
    ...shellToolDefinitions,
    ...browserToolDefinitions,
    ...computerToolDefinitions,
    ...gitToolDefinitions,
    ...imageToolDefinitions,
    ...memoryDefs,
    ...WEB_TOOLS,
    ...WORKFLOW_TOOLS,
    ...getSkillDefs(),
    ...getSubagentDefs(),
  ];

  const seen = new Set<string>();
  return all.filter(tool => {
    if (!tool || typeof tool.name !== 'string' || seen.has(tool.name)) return false;
    seen.add(tool.name);
    return true;
  });
}

export const localToolDefinitions: ToolDefinition[] = buildLocalToolDefinitions();
export const toolDefinitions = localToolDefinitions;

function syncLocalTools(): ToolDefinition[] {
  const current = buildLocalToolDefinitions();
  if (current.length !== localToolDefinitions.length || current.some((t, i) => localToolDefinitions[i]?.name !== t.name)) {
    localToolDefinitions.splice(0, localToolDefinitions.length, ...current);
  }
  return localToolDefinitions;
}

type RemoteTool = { definition: ToolDefinition; connection: McpConnection };

function remoteTools(connections: McpConnection[] = []): RemoteTool[] {
  const local = syncLocalTools();
  const all = connections.flatMap(connection => connection.definitions.map(definition => ({ definition, connection })));
  const counts = new Map<string, number>();
  for (const { definition } of all) counts.set(definition.name, (counts.get(definition.name) ?? 0) + 1);
  return all.filter(({ definition }) => /^mcp_[A-Za-z0-9_-]{1,80}$/.test(definition.name) && counts.get(definition.name) === 1 && !local.some(tool => tool.name === definition.name));
}

const priority = /(?:create_repository|create_branch|push_files|create_pull_request|merge_pull_request|create_project|create_deployment|deploy_edge_function|apply_migration)/i;

function featuredTools(connections?: McpConnection[]): RemoteTool[] {
  const all = remoteTools(connections);
  const groups = new Map<McpConnection, RemoteTool[]>();
  for (const item of all) {
    const group = groups.get(item.connection) ?? [];
    group.push(item);
    groups.set(item.connection, group);
  }
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
  'web_search',
  'url_fetch',
]);

export function getToolDefinitions(
  connectionsOrPolicy?: McpConnection[] | 'all' | 'read-only',
  policy: 'all' | 'read-only' = 'all'
): ToolDefinition[] {
  let connections: McpConnection[] | undefined;
  let effectivePolicy: 'all' | 'read-only' = policy;

  if (typeof connectionsOrPolicy === 'string') {
    effectivePolicy = connectionsOrPolicy;
    connections = undefined;
  } else if (Array.isArray(connectionsOrPolicy)) {
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

function redact(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        /token|secret|password|api.?key|authorization|credential|private.?key/i.test(key) ||
        (key.toLowerCase() === 'data' && typeof v === 'string' && v.length > 500)
          ? '[redacted]'
          : redact(v),
      ])
    );
  }
  return value;
}

export const APPROVAL_REQUIRED_TOOLS = [
  'shell',
  'file_write',
  'file_patch',
  'process_stop',
  'process_write',
  'git_add',
  'git_commit',
  'git_branch',
  'git_push',
];

let activeKillSwitchCallback: ((reason: string) => void) | null = null;

export function registerGuiKillSwitch(cb: ((reason: string) => void) | null): void {
  activeKillSwitchCallback = cb;
}

export function triggerGuiKillSwitch(reason: string): void {
  if (activeKillSwitchCallback) {
    try {
      activeKillSwitchCallback(reason);
    } catch {
      // ignore
    }
  }
}

export async function executeTool(call: ToolCall, context: ToolContext): Promise<string> {
  const rawArgs = ((call as unknown as { args?: Record<string, unknown> }).args || call.arguments || {}) as Record<string, unknown>;
  const normalized = normalizeToolCall(call.name, rawArgs);
  const toolName = normalized.name;
  const args = normalized.args;
  const activeCall: ToolCall = {
    ...call,
    name: toolName,
    arguments: args,
  };
  (activeCall as unknown as { args: Record<string, unknown> }).args = args;
  if (context.workspace) {
    globalGroundingLedger.workspace = context.workspace;
  }

  try {
    context.signal?.throwIfAborted();
    const allRemote = remoteTools(context.mcpTools);
    if (toolName === 'mcp_catalog' && allRemote.length) {
      const query = typeof args.query === 'string' ? args.query.toLowerCase().slice(0, 200) : '';
      const offset = typeof args.offset === 'number' && Number.isInteger(args.offset) ? Math.max(0, args.offset) : 0;
      const limit = typeof args.limit === 'number' && Number.isInteger(args.limit) ? Math.max(1, Math.min(5, args.limit)) : 2;
      const matched = allRemote.filter(({ definition }) => definition.name.toLowerCase().includes(query));
      const page = matched.slice(offset, offset + limit).map(({ definition }) => ({ ...definition, description: definition.description.slice(0, 600) }));
      const output = `[Untrusted MCP catalog]\n${JSON.stringify({ tools: page, next_offset: offset + limit < matched.length ? offset + limit : null })}`;
      globalGroundingLedger.recordToolResult(toolName, args, output as any, isToolResultOk(toolName, output) as any);
      return output;
    }

    let actualCall = activeCall;
    let actualArgs = args;
    if (toolName === 'mcp_call') {
      if (typeof args.name !== 'string' || !args.arguments || typeof args.arguments !== 'object' || Array.isArray(args.arguments)) {
        const err = 'Tool error: mcp_call requires a catalog tool name and arguments object.';
        globalGroundingLedger.recordToolResult(toolName, args, err as any, false as any);
        return err;
      }
      actualArgs = args.arguments as Record<string, unknown>;
      actualCall = { ...call, name: args.name, arguments: actualArgs };
      (actualCall as unknown as { args: Record<string, unknown> }).args = actualArgs;
    }

    const remote = (toolName === 'mcp_call' ? allRemote : featuredTools(context.mcpTools)).find(item => item.definition.name === actualCall.name);
    if ((!remote && toolName === 'mcp_call') || !getToolDefinitions(context.mcpTools).some(tool => tool.name === toolName)) {
      const err = `Unknown tool: ${toolName}`;
      globalGroundingLedger.recordToolResult(toolName, args, err as any, false as any);
      return err;
    }

    const isGuiTool = actualCall.name === 'computer' || actualCall.name.startsWith('browser_');
    // GUI access can submit forms, send messages and operate terminals. Default
    // to the same approval boundary as shell; trusted/YOLO callers may approve.
    const requireGuiApproval = process.env.TBOT_REQUIRE_GUI_APPROVAL !== 'false';
    const isApprovalRequired = remote || APPROVAL_REQUIRED_TOOLS.includes(actualCall.name) || (isGuiTool && requireGuiApproval);

    if (isApprovalRequired) {
      const description = remote
        ? `Allow remote MCP tool ${actualCall.name} with the supplied arguments.`
        : actualCall.name === 'shell'
          ? 'Run this shell command with your user permissions; it can modify or delete files and access resources outside the workspace.'
          : `Allow ${actualCall.name} with the supplied arguments.`;
      const approvalArgs = remote
        ? redact(actualArgs) as Record<string, unknown>
        : actualCall.name === 'computer' && 'text' in actualArgs
          ? { ...actualArgs, text: '[redacted]' }
          : actualArgs;
      if (!await context.approve({ tool: actualCall.name, description, arguments: approvalArgs })) {
        const denied = 'Tool action denied by user.';
        globalGroundingLedger.recordToolResult(toolName, args, denied as any, false as any);
        return denied;
      }
      context.signal?.throwIfAborted();
    }

    let output: string;
    if (remote) {
      const result = await remote.connection.execute(actualCall, context.signal);
      const raw = typeof result === 'string' ? result : JSON.stringify(result);
      output = `[Untrusted MCP tool output]\n${raw.length > 12000 ? raw.slice(0, 12000) + '\n[output truncated]' : raw}`;
    } else if (toolName === 'delegate_task' || getSubagentDefs().some(tool => tool.name === toolName)) {
      const handler = (subagentsMod as any).handleSubagentTool;
      if (typeof handler !== 'function') {
        throw new Error(`Subagent tool handler is not available for ${toolName}`);
      }
      output = await handler(actualCall, context);
    } else if (toolName === 'skill_create' || toolName === 'skill_list' || toolName.startsWith('skill_') || getSkillDefs().some(tool => tool.name === toolName)) {
      const handler = (skillsMod as any).handleSkillTool;
      if (typeof handler !== 'function') {
        throw new Error(`Skill tool handler is not available for ${toolName}`);
      }
      output = await handler(actualCall, context);
    } else if (toolName.startsWith('memory_')) {
      try {
        output = await handleMemoryTool(toolName, actualArgs, context);
      } catch (err) {
        if (toolName === 'memory_forget' && err instanceof Error && err.message.startsWith('Unknown memory tool:')) {
          const key = typeof actualArgs.key === 'string' ? actualArgs.key.trim() : '';
          if (!key) throw new Error('Parameter "key" is required.');
          const removed = await forgetFact(context.workspace, key);
          output = removed ? `Removed from memory: ${key}` : `Memory key not found: ${key}`;
        } else {
          throw err;
        }
      }
    } else if (toolName === 'web_search' || toolName === 'url_fetch') {
      output = `[Untrusted web content]\n${await executeWebTool(toolName, actualArgs, context.signal)}`;
    } else if (toolName === 'todo_manage' || toolName === 'goal_manage') {
      output = await executeWorkflowTool(toolName, actualArgs, context.workspace);
    } else if (toolName.startsWith('process_')) {
      output = await handleShellTool(toolName, actualArgs, context.workspace, context.signal);
    } else if (toolName === 'shell') {
      output = await handleShellTool(toolName, actualArgs, context.workspace, context.signal);
    } else if (toolName === 'image_generate') {
      output = await handleImageTool(toolName, actualArgs, context);
    } else if (browserToolDefinitions.some(tool => tool.name === toolName)) {
      output = await handleBrowserTool(toolName, actualArgs, context);
    } else if (computerToolDefinitions.some(tool => tool.name === toolName)) {
      output = await handleComputerTool(toolName, actualArgs, context);
    } else if (gitToolDefinitions.some(tool => tool.name === toolName)) {
      output = await handleGitTool(toolName, actualArgs, context);
    } else {
      output = await handleFileTool(toolName, actualArgs, context.workspace, context.signal);
    }

    globalGroundingLedger.recordToolResult(toolName, args, output as any, isToolResultOk(toolName, output) as any);
    if (actualCall.name !== toolName) {
      globalGroundingLedger.recordToolResult(actualCall.name, actualArgs, output as any, isToolResultOk(actualCall.name, output) as any);
    }
    if (typeof output === 'string' && (output.includes('[ACİL DURDURMA') || output.includes('KULLANICI ACİL DURDURMA'))) {
      triggerGuiKillSwitch(output);
    }
    return output;
  } catch (error) {
    const err = `Tool error: ${error instanceof Error ? error.message : String(error)}`;
    if (err.includes('[ACİL DURDURMA') || err.includes('KULLANICI ACİL DURDURMA')) {
      triggerGuiKillSwitch(err);
    }
    try {
      globalGroundingLedger.recordToolResult(toolName, args, err as any, isToolResultOk(toolName, err) as any);
    } catch { /* ignore */ }
    return err;
  }
}

export { executeComputerTool, closeIdleDesktopDaemon, handleComputerTool } from './computer.js';
