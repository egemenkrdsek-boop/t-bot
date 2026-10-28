/**
 * Shell commands that are known to write. Kept byte-compatible with the
 * previous constraint heuristic so behaviour does not change while the gates
 * move onto this module.
 */
export const SHELL_WRITE_PATTERN = /(?:^|[^<>\-=])>{1,2}|set-content|out-file|add-content|remove-item|\b(?:rm|del|erase|mv|move|copy|cp|tee|sed\s+-i)\b/iu;
const READ_TOOLS = new Set([
    'file_read',
    'file_outline',
    'file_list',
    'file_glob',
    'file_search',
    'artifact_read',
    'git_status',
    'git_diff',
    'git_log',
    'memory_recall',
    'process_list',
    'process_output',
    'skill_list',
    'checkpoint_list',
    'mcp_catalog',
    'diagnostics',
]);
const WRITE_TOOLS = new Set([
    'file_write',
    'file_patch',
    'file_delete',
    'file_rename',
    'file_move',
    'checkpoint_restore',
    'skill_create',
    'image_generate',
    'memory_save',
    'memory_forget',
    'git_add',
    'git_commit',
    'git_branch',
]);
const SHELL_WRITE_TOOLS = new Set([
    'process_start',
    'process_write',
    'process_stop',
]);
const EXTERNAL_TOOLS = new Set([
    'web_search',
    'url_fetch',
    'git_push',
    'delegate_task',
    'mcp_call',
]);
/** Browser actions that only observe the page. Everything else mutates it. */
const BROWSER_OBSERVE = new Set([
    'browser_inspect',
    'browser_tabs',
    'browser_screenshot',
    'browser_wait_for',
    'browser_read',
    'browser_console',
]);
const GUI_OBSERVE_ACTIONS = new Set([
    'inspect',
    'windows',
    'screenshot',
    'wait',
    'wait_for_window',
    'list',
]);
function commandOf(args) {
    const value = args.command ?? args.cmd ?? args.script ?? args.commandLine;
    return typeof value === 'string' ? value : '';
}
/**
 * True when a shell command matches a known write pattern.
 *
 * Redirections to null devices (`>nul`, `>NUL`, `2>nul`, `>/dev/null`,
 * `2>/dev/null`) discard output; they are not file writes.
 */
export function shellWrites(command) {
    const withoutDiscardedOutput = String(command ?? '')
        // Output discarding: >nul, >NUL, 2>nul, >/dev/null, 2>/dev/null.
        .replace(/(?:^|\s)[12]?&?>{1,2}\s*(?:nul|\/dev\/null)(?=\s|$|&|\|)/giu, ' ')
        // File-descriptor duplication (2>&1) is not a file write either.
        .replace(/(?:^|\s)\d*>&\d+(?=\s|$|&|\|)/gu, ' ');
    return SHELL_WRITE_PATTERN.test(withoutDiscardedOutput.toLowerCase());
}
export function isWriteEffect(effect) {
    return effect === 'write' || effect === 'shell-write';
}
export function isObservationEffect(effect) {
    return effect === 'read' || effect === 'observe' || effect === 'shell-read';
}
/**
 * Classify a canonical tool name (run `canonicalizeToolCall` first; aliases are
 * deliberately not resolved here so there is one alias table in the codebase).
 */
export function classifyToolEffect(name, args = {}) {
    const tool = String(name ?? '');
    const callArgs = args && typeof args === 'object' ? args : {};
    if (tool === 'shell') {
        return shellWrites(commandOf(callArgs)) ? 'shell-write' : 'shell-read';
    }
    if (tool === 'project_verify')
        return 'shell-read';
    if (SHELL_WRITE_TOOLS.has(tool))
        return 'shell-write';
    if (READ_TOOLS.has(tool))
        return 'read';
    if (WRITE_TOOLS.has(tool))
        return 'write';
    if (tool === 'todo_manage') {
        return String(callArgs.action ?? '').toLowerCase() === 'list' ? 'read' : 'write';
    }
    if (tool === 'goal_manage') {
        return String(callArgs.action ?? '').toLowerCase() === 'status' ? 'read' : 'write';
    }
    if (EXTERNAL_TOOLS.has(tool))
        return 'external';
    if (tool === 'computer' || tool === 'computer_batch') {
        if (tool === 'computer_batch')
            return 'write';
        const action = String(callArgs.action ?? 'screenshot').toLowerCase();
        return GUI_OBSERVE_ACTIONS.has(action) ? 'observe' : 'write';
    }
    if (tool.startsWith('browser_')) {
        return BROWSER_OBSERVE.has(tool) ? 'observe' : 'write';
    }
    if (tool.startsWith('mcp_'))
        return 'external';
    // Unknown names are treated as mutating unless they belong to a read family.
    // The registry rejects unknown names before execution; this fallback only
    // keeps a stray caller from being classified as harmless.
    if (tool.startsWith('skill_') || tool.startsWith('memory_') || tool.startsWith('checkpoint_')) {
        return 'write';
    }
    return 'write';
}
//# sourceMappingURL=tool-effect.js.map