import { fileToolDefinitions, handleFileTool } from './files.js';
import { shellToolDefinitions, handleShellTool, SHELL_EXIT_MARKER } from './shell.js';
import { artifactToolDefinitions, handleArtifactTool } from './artifacts.js';
import { verifyToolDefinitions, handleVerifyTool } from './verify.js';
import { isSensitivePath, resolveWorkspacePath } from '../security/paths.js';
import { browserToolDefinitions, handleBrowserTool } from './browser.js';
import { computerToolDefinitions, handleComputerTool } from './computer.js';
import { gitToolDefinitions, handleGitTool, buildGitApprovalPreview } from './git.js';
import { imageToolDefinitions, handleImageTool } from './image.js';
import { memoryToolDefinitions, handleMemoryTool, forgetFact, requiresGlobalMemoryApproval } from '../memory.js';
import { WEB_TOOLS, executeWebTool } from './web.js';
import { WORKFLOW_TOOLS, executeWorkflowTool } from '../workflows.js';
import * as skillsMod from '../skills.js';
import * as subagentsMod from '../subagents.js';
import { globalGroundingLedger } from '../grounding.js';
import { redactSecrets } from '../sessions.js';
import { checkpointToolDefinitions, handleCheckpointTool } from '../checkpoints.js';
import { diagnosticsToolDefinitions, handleDiagnosticsTool } from './diagnostics.js';
import { capabilitiesAllowed } from '../security/capabilities.js';
import { currentTaintLedger, taintedArgument } from '../security/taint.js';
import { pruneScreenshots } from './screenshot-store.js';
import { uniqueToolDefinitions } from './registry.js';
import { buildWorkspacePack } from '../mcp-local-vercel.js';
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
    if (trimmed.startsWith('{') && /"ok"\s*:\s*false/.test(trimmed)) {
        return false;
    }
    if (name === 'shell' || name === 'run_command' || name === 'execute_command') {
        if (output.includes('Timed out') || output.includes('Aborted')) {
            return false;
        }
        // The unique marker is appended last, so it is authoritative. Fall back to
        // the LAST "Exit code:" line, never the first.
        const markers = [...output.matchAll(new RegExp(`\\[${SHELL_EXIT_MARKER}:\\s*(-?\\d+|signal)\\]`, 'gi'))];
        const lastMarker = markers.length ? markers[markers.length - 1][1].trim() : undefined;
        if (lastMarker !== undefined)
            return lastMarker === '0';
        const exits = [...output.matchAll(/Exit code:\s*(-?\d+)/gi)];
        const lastExit = exits.length ? exits[exits.length - 1][1] : undefined;
        if (lastExit !== undefined)
            return Number(lastExit) === 0;
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
export function normalizeToolCall(name, rawArgs) {
    const toolAliases = {
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
    }
    else if (normalizedName === 'shell') {
        const cmdVal = args.command ?? args.cmd ?? args.script ?? args.commandLine;
        if (cmdVal !== undefined) {
            args.command = cmdVal;
        }
    }
    else if (normalizedName === 'web_search') {
        const queryVal = args.query ?? args.q ?? args.search_query;
        if (queryVal !== undefined) {
            args.query = queryVal;
        }
    }
    else if (normalizedName === 'url_fetch') {
        const urlVal = args.url ?? args.target_url ?? args.link;
        if (urlVal !== undefined) {
            args.url = urlVal;
        }
    }
    else if (normalizedName === 'computer') {
        if (name === 'mouse_click' || name === 'desktop_click') {
            args.action = args.action ?? 'click';
        }
        else if (name === 'keyboard_type' || name === 'desktop_type') {
            args.action = args.action ?? 'type';
        }
        else if (name === 'open_app') {
            args.action = args.action ?? 'open';
        }
        else if (name === 'take_screenshot' || name === 'screen_capture') {
            args.action = args.action ?? 'screenshot';
        }
    }
    else if (normalizedName === 'browser_navigate' || normalizedName === 'browser_open') {
        const urlVal = args.url ?? args.target_url ?? args.link;
        if (urlVal !== undefined) {
            args.url = urlVal;
        }
    }
    return { name: normalizedName, args };
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
        ...artifactToolDefinitions,
        ...verifyToolDefinitions,
        ...diagnosticsToolDefinitions,
        ...checkpointToolDefinitions,
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
    return uniqueToolDefinitions(all);
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
    'artifact_read',
    'git_status',
    'git_diff',
    'git_log',
    'memory_recall',
    'process_list',
    'process_output',
    'skill_list',
    'delegate_task',
    'web_search',
    'diagnostics',
    'checkpoint_list',
    'browser_read',
    'browser_wait_for',
    'browser_console',
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
    // Local definitions come first, so a remote tool can never shadow one.
    const definitions = uniqueToolDefinitions([
        ...local,
        ...(all.length ? catalogTools : []),
        ...featuredTools(connections).map(({ definition }) => ({ ...definition, description: definition.description.slice(0, 600) })),
    ]);
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
const FILE_READ_PATH_TOOLS = new Set(['file_read', 'file_outline', 'file_list', 'file_glob', 'file_search']);
const FILE_WRITE_PATH_TOOLS = new Set(['file_write', 'file_patch']);
const TERMINAL_TARGET = /terminal|console|command prompt|cmd(?:\.exe)?\b|powershell|pwsh|bash|wsl|shell/i;
/**
 * Approval text for the local Vercel adapter's `create_deployment`. Shows the
 * exact workspace pack (files, byte count, digest) and how many credential
 * files the shared denylist excluded. It never sends file contents.
 */
async function describeVercelDeployment(args, workspace) {
    if (args.auto_pack_workspace === true) {
        const pack = await buildWorkspacePack(workspace);
        const names = pack.files.map(file => file.file);
        const shown = names.slice(0, 40);
        const skipped = pack.sensitiveSkipped;
        return {
            text: [
                `auto_pack_workspace is ON: ${pack.files.length} file(s), ${pack.bytes} byte(s), sha256 ${pack.digest}.`,
                `Files: ${shown.join(', ') || '(none)'}${names.length > shown.length ? ` … (+${names.length - shown.length} more)` : ''}`,
                `Sensitive files excluded: ${skipped.length}${skipped.length ? ` (${skipped.slice(0, 20).join(', ')}${skipped.length > 20 ? ' …' : ''})` : ''}.`,
                skipped.length
                    ? '[Sensitive path warning: credential-like files were found and excluded from the upload. Confirm that the listed files are the complete intended payload.]'
                    : '',
            ].filter(Boolean).join('\n'),
        };
    }
    const files = Array.isArray(args.files) ? args.files : [];
    if (files.length) {
        const names = [];
        const sensitive = [];
        let base64Chars = 0;
        for (const item of files) {
            if (!item || typeof item !== 'object')
                continue;
            const record = item;
            const file = typeof record.file === 'string' ? record.file : '(invalid)';
            names.push(file);
            if (typeof record.data === 'string')
                base64Chars += record.data.length;
            if (isSensitivePath(file))
                sensitive.push(file);
        }
        if (sensitive.length) {
            return { blocked: `Tool error: refusing to upload protected paths: ${sensitive.join(', ')}. Remove them or upload explicit non-sensitive files.` };
        }
        return {
            text: `Explicit files: ${files.length} file(s), ${base64Chars} base64 character(s).\nFiles: ${names.slice(0, 40).join(', ')}${names.length > 40 ? ` … (+${names.length - 40} more)` : ''}`,
        };
    }
    if (typeof args.repoId === 'string') {
        return { text: `Git source: repoId ${args.repoId}, ref ${String(args.ref ?? '')}.` };
    }
    return { text: 'No files, git source or auto_pack_workspace was supplied; the deployment will be rejected unless a source is provided.' };
}
export const APPROVAL_REQUIRED_TOOLS = [
    'shell',
    'file_write',
    'file_patch',
    'skill_create',
    'process_stop',
    'process_write',
    'git_add',
    'git_commit',
    'git_branch',
    'git_push',
    'url_fetch',
    'project_verify',
    'checkpoint_restore',
    'browser_download',
    'browser_upload',
];
let activeKillSwitchCallback = null;
export function registerGuiKillSwitch(cb) {
    activeKillSwitchCallback = cb;
}
export function triggerGuiKillSwitch(reason) {
    if (activeKillSwitchCallback) {
        try {
            activeKillSwitchCallback(reason);
        }
        catch {
            // ignore
        }
    }
}
export async function executeTool(call, context) {
    const rawArgs = (call.args || call.arguments || {});
    // C2/TODO(D1): remove this second normalization once agent.ts sends the
    // canonical call produced by canonicalizeToolCall(). Kept now so aliases
    // outside the agent path behave exactly as before.
    const normalized = normalizeToolCall(call.name, rawArgs);
    const toolName = normalized.name;
    const args = normalized.args;
    const activeCall = {
        ...call,
        name: toolName,
        arguments: args,
    };
    activeCall.args = args;
    if (context.workspace) {
        globalGroundingLedger.workspace = context.workspace;
    }
    try {
        context.signal?.throwIfAborted();
        if (!capabilitiesAllowed(toolName, context.capabilities)) {
            const err = `Tool denied: capability policy does not allow ${toolName}.`;
            globalGroundingLedger.recordToolResult(toolName, args, err, false);
            return err;
        }
        const allRemote = remoteTools(context.mcpTools);
        if (toolName === 'mcp_catalog' && allRemote.length) {
            const query = typeof args.query === 'string' ? args.query.toLowerCase().slice(0, 200) : '';
            const offset = typeof args.offset === 'number' && Number.isInteger(args.offset) ? Math.max(0, args.offset) : 0;
            const limit = typeof args.limit === 'number' && Number.isInteger(args.limit) ? Math.max(1, Math.min(5, args.limit)) : 2;
            const matched = allRemote.filter(({ definition }) => definition.name.toLowerCase().includes(query));
            const page = matched.slice(offset, offset + limit).map(({ definition }) => ({ ...definition, description: definition.description.slice(0, 600) }));
            const output = `[Untrusted MCP catalog]\n${JSON.stringify({ tools: page, next_offset: offset + limit < matched.length ? offset + limit : null })}`;
            globalGroundingLedger.recordToolResult(toolName, args, output, isToolResultOk(toolName, output));
            return output;
        }
        let actualCall = activeCall;
        let actualArgs = args;
        if (toolName === 'mcp_call') {
            if (typeof args.name !== 'string' || !args.arguments || typeof args.arguments !== 'object' || Array.isArray(args.arguments)) {
                const err = 'Tool error: mcp_call requires a catalog tool name and arguments object.';
                globalGroundingLedger.recordToolResult(toolName, args, err, false);
                return err;
            }
            actualArgs = args.arguments;
            actualCall = { ...call, name: args.name, arguments: actualArgs };
            actualCall.args = actualArgs;
        }
        const remote = (toolName === 'mcp_call' ? allRemote : featuredTools(context.mcpTools)).find(item => item.definition.name === actualCall.name);
        if ((!remote && toolName === 'mcp_call') || !getToolDefinitions(context.mcpTools).some(tool => tool.name === toolName)) {
            const err = `Unknown tool: ${toolName}`;
            globalGroundingLedger.recordToolResult(toolName, args, err, false);
            return err;
        }
        // Protected-path policy: reads need approval, writes are refused outright.
        let sensitiveReadPath;
        if (typeof actualArgs.path === 'string' && (FILE_READ_PATH_TOOLS.has(toolName) || FILE_WRITE_PATH_TOOLS.has(toolName))) {
            try {
                const resolved = await resolveWorkspacePath(context.workspace, actualArgs.path);
                if (FILE_WRITE_PATH_TOOLS.has(toolName) && isSensitivePath(resolved)) {
                    const err = `Tool error: Refusing to write to a protected path: ${actualArgs.path}`;
                    globalGroundingLedger.recordToolResult(toolName, args, err, false);
                    return err;
                }
                if (FILE_READ_PATH_TOOLS.has(toolName) && isSensitivePath(resolved))
                    sensitiveReadPath = resolved;
            }
            catch { /* Path resolution errors are surfaced by the tool handler. */ }
        }
        const isGuiTool = actualCall.name === 'computer' || actualCall.name === 'computer_batch' ||
            actualCall.name === 'browser_batch' || actualCall.name.startsWith('browser_');
        // Observations are read-only from the user's perspective. Requiring an
        // approval for every inspect is a major source of GUI latency. Explicit
        // screenshots still use the normal GUI approval boundary.
        const guiAction = String(actualArgs.action ?? '').toLowerCase();
        const isGuiObservation = actualCall.name === 'browser_inspect' ||
            actualCall.name === 'browser_read' ||
            actualCall.name === 'browser_console' ||
            actualCall.name === 'browser_wait_for' ||
            (actualCall.name === 'browser_tabs' && (!guiAction || guiAction === 'list')) ||
            (actualCall.name === 'computer' && (guiAction === 'inspect' || guiAction === 'windows' || guiAction === 'wait_for_window'));
        // Shell is already approval-gated, but a command that names a credential
        // file deserves an explicit warning in the approval prompt. This is a
        // high-signal heuristic, not a complete parser.
        const sensitiveShellCommand = toolName === 'shell' && typeof actualArgs.command === 'string' &&
            /(?:^|[\\/\s"'`])(?:\.env(?:\.[\w.-]+)?|\.ssh[\\/]|id_rsa|id_ed25519|credentials|secrets?\.(?:json|ya?ml|txt)|\.pem|\.p12|\.pfx)\b/i.test(actualArgs.command);
        // GUI access can submit forms, send messages and operate terminals. Default
        // to the same approval boundary as shell; trusted/YOLO callers may approve.
        const requireGuiApproval = process.env.TBOT_REQUIRE_GUI_APPROVAL !== 'false';
        const guiNeedsApproval = isGuiTool && requireGuiApproval && !isGuiObservation;
        const tainted = taintedArgument(actualArgs);
        const taintSensitive = tainted !== undefined && (APPROVAL_REQUIRED_TOOLS.includes(actualCall.name) ||
            isGuiTool ||
            actualCall.name === 'mcp_call' ||
            actualCall.name === 'mcp_catalog');
        if (taintSensitive && process.env.TBOT_TAINT_STRICT === 'true') {
            const err = 'Tool error: this call repeats text from an untrusted web/MCP/browser result and strict taint policy blocked it. Ask the user to confirm the exact action.';
            globalGroundingLedger.recordToolResult(toolName, args, err, false);
            return err;
        }
        // Git writes show staged paths and a diff summary before approval, and a
        // credential file in the range is refused before the prompt is shown.
        let gitPreview;
        if (!remote && (actualCall.name === 'git_add' || actualCall.name === 'git_commit' || actualCall.name === 'git_push')) {
            try {
                gitPreview = await buildGitApprovalPreview(actualCall.name, actualArgs, context.workspace, context.signal);
            }
            catch (error) {
                const err = `Tool error: ${error instanceof Error ? error.message : String(error)}`;
                globalGroundingLedger.recordToolResult(toolName, args, err, false);
                return err;
            }
            if (gitPreview?.blocked) {
                globalGroundingLedger.recordToolResult(toolName, args, gitPreview.blocked, false);
                return gitPreview.blocked;
            }
        }
        // Global memory is a cross-workspace instruction vector; it is fail-closed
        // without an explicit approval even when GUI/YOLO policy bypasses prompts.
        const globalMemoryNeedsApproval = requiresGlobalMemoryApproval(actualCall.name, actualArgs);
        const isApprovalRequired = remote || APPROVAL_REQUIRED_TOOLS.includes(actualCall.name) ||
            guiNeedsApproval || sensitiveReadPath !== undefined || taintSensitive || globalMemoryNeedsApproval;
        // The Vercel adapter is remote from the dispatcher's point of view, so its
        // approval text is enriched here instead of in the MCP layer.
        let vercelPreview;
        if (remote && remote.connection.service === 'vercel' && remote.definition.name.includes('create_deployment')) {
            try {
                vercelPreview = await describeVercelDeployment(actualArgs, context.workspace);
            }
            catch (error) {
                const err = `Tool error: ${error instanceof Error ? error.message : String(error)}`;
                globalGroundingLedger.recordToolResult(toolName, args, err, false);
                return err;
            }
            if (vercelPreview.blocked) {
                globalGroundingLedger.recordToolResult(toolName, args, vercelPreview.blocked, false);
                return vercelPreview.blocked;
            }
        }
        if (isApprovalRequired) {
            const description = remote
                ? `Allow remote MCP tool ${actualCall.name} with the supplied arguments.`
                : actualCall.name === 'shell'
                    ? 'Run this shell command with your user permissions; it can modify or delete files and access resources outside the workspace.'
                    : actualCall.name === 'url_fetch'
                        ? `Download this URL from the public internet: ${String(actualArgs.url ?? actualArgs.target_url ?? '').slice(0, 2000)}`
                        : actualCall.name === 'project_verify'
                            ? `Run the project's declared verification scripts: ${Array.isArray(actualArgs.commands) ? actualArgs.commands.join(', ') : 'typecheck/check/lint/test (auto-detected)'}. The scripts execute with your user permissions.`
                            : actualCall.name === 'skill_create'
                                ? `Save ${actualArgs.scope === 'global' ? 'global instructions for future tasks across workspaces' : 'project instructions for future tasks'}; review the complete skill content before approving.`
                                : globalMemoryNeedsApproval
                                    ? `Save "${String(actualArgs.key ?? '').slice(0, 200)}" to GLOBAL memory. Global memory persists across workspaces and can act as a persistent instruction vector; review the exact key and value before approving.`
                                    : sensitiveReadPath !== undefined
                                        ? `Read the protected file "${String(actualArgs.path)}"; it may contain credentials or private keys.`
                                        : `Allow ${actualCall.name} with the supplied arguments.`;
            const approvalDescription = [
                description,
                vercelPreview?.text ? `[Vercel deployment preview]\n${vercelPreview.text}` : '',
                gitPreview?.description ? `[Git preview]\n${gitPreview.description}` : '',
                sensitiveShellCommand ? '[Sensitive path warning: this command references a credential-like file. Confirm that reading or changing it is intended.]' : '',
                taintSensitive ? '[Untrusted content warning: this argument repeats text from a web, MCP, browser or desktop result. Confirm it matches your intent.]' : '',
            ].filter(Boolean).join('\n');
            // Show the actual text that will be typed (truncated, never masked) so the
            // user can review what will be submitted.
            const approvalArgs = remote
                ? redact(actualArgs)
                : actualCall.name === 'computer' && 'text' in actualArgs
                    ? { ...actualArgs, text: String(actualArgs.text).slice(0, 2000) }
                    : { ...actualArgs };
            // Typing into a terminal (or submitting with Enter) is a second, higher
            // risk action; the renderer can require an extra confirmation for it.
            if (actualCall.name === 'computer' &&
                (actualArgs.press_enter === true || TERMINAL_TARGET.test(String(actualArgs.target ?? actualArgs.handle ?? '')))) {
                approvalArgs.requires_second_approval = true;
            }
            if (!await context.approve({ tool: actualCall.name, description: approvalDescription, arguments: approvalArgs })) {
                const denied = 'Tool action denied by user.';
                globalGroundingLedger.recordToolResult(toolName, args, denied, false);
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
        else if (toolName === 'delegate_task' || getSubagentDefs().some(tool => tool.name === toolName)) {
            const handler = subagentsMod.handleSubagentTool;
            if (typeof handler !== 'function') {
                throw new Error(`Subagent tool handler is not available for ${toolName}`);
            }
            output = await handler(actualCall, context);
        }
        else if (toolName === 'skill_create' || toolName === 'skill_list' || toolName.startsWith('skill_') || getSkillDefs().some(tool => tool.name === toolName)) {
            const handler = skillsMod.handleSkillTool;
            if (typeof handler !== 'function') {
                throw new Error(`Skill tool handler is not available for ${toolName}`);
            }
            output = await handler(actualCall, context);
        }
        else if (toolName.startsWith('memory_')) {
            try {
                // `approvedGlobal` is only set after the approval gate above succeeded;
                // rememberFact() still rejects unapproved global writes (fail-closed).
                output = await handleMemoryTool(toolName, actualArgs, globalMemoryNeedsApproval ? { ...context, approvedGlobal: true } : context);
            }
            catch (err) {
                if (toolName === 'memory_forget' && err instanceof Error && err.message.startsWith('Unknown memory tool:')) {
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
        else if (toolName === 'web_search' || toolName === 'url_fetch') {
            output = `[Untrusted web content]\n${await executeWebTool(toolName, actualArgs, context.signal)}`;
        }
        else if (toolName === 'artifact_read') {
            output = await handleArtifactTool(toolName, actualArgs, context.workspace);
        }
        else if (toolName === 'project_verify') {
            output = await handleVerifyTool(toolName, actualArgs, context.workspace, context.signal, context.processOwner);
        }
        else if (toolName === 'diagnostics') {
            output = await handleDiagnosticsTool(toolName, actualArgs, context.workspace, context.signal);
        }
        else if (toolName === 'checkpoint_list' || toolName === 'checkpoint_restore') {
            output = await handleCheckpointTool(toolName, actualArgs, context.workspace);
        }
        else if (toolName === 'todo_manage' || toolName === 'goal_manage') {
            output = await executeWorkflowTool(toolName, actualArgs, context.workspace);
        }
        else if (toolName.startsWith('process_')) {
            output = await handleShellTool(toolName, actualArgs, context.workspace, context.signal, context.processOwner);
        }
        else if (toolName === 'shell') {
            output = await handleShellTool(toolName, actualArgs, context.workspace, context.signal, context.processOwner);
        }
        else if (toolName === 'image_generate') {
            output = await handleImageTool(toolName, actualArgs, context);
        }
        else if (browserToolDefinitions.some(tool => tool.name === toolName)) {
            output = await handleBrowserTool(toolName, actualArgs, context);
        }
        else if (computerToolDefinitions.some(tool => tool.name === toolName)) {
            output = await handleComputerTool(toolName, actualArgs, context);
        }
        else if (gitToolDefinitions.some(tool => tool.name === toolName)) {
            output = await handleGitTool(toolName, actualArgs, context);
        }
        else {
            output = await handleFileTool(toolName, actualArgs, context.workspace, context.signal);
        }
        currentTaintLedger().record(toolName, output);
        if (actualCall.name !== toolName)
            currentTaintLedger().record(actualCall.name, output);
        globalGroundingLedger.recordToolResult(toolName, args, output, isToolResultOk(toolName, output));
        if (actualCall.name !== toolName) {
            globalGroundingLedger.recordToolResult(actualCall.name, actualArgs, output, isToolResultOk(actualCall.name, output));
        }
        if (typeof output === 'string' && (output.includes('[ACİL DURDURMA') || output.includes('KULLANICI ACİL DURDURMA'))) {
            triggerGuiKillSwitch(output);
        }
        if (isGuiTool) {
            void pruneScreenshots(context.workspace).catch(() => undefined);
        }
        return output;
    }
    catch (error) {
        const err = `Tool error: ${error instanceof Error ? error.message : String(error)}`;
        if (err.includes('[ACİL DURDURMA') || err.includes('KULLANICI ACİL DURDURMA')) {
            triggerGuiKillSwitch(err);
        }
        try {
            globalGroundingLedger.recordToolResult(toolName, args, err, isToolResultOk(toolName, err));
        }
        catch { /* ignore */ }
        return err;
    }
}
export { executeComputerTool, closeIdleDesktopDaemon, handleComputerTool } from './computer.js';
//# sourceMappingURL=index.js.map