/**
 * Single classification of what a tool call does to the machine.
 *
 * This lives in `core/` because phase gates, user constraints and the approval
 * layer all depend on it, while `core` may not import from `tools`. The module
 * is pure type/data logic and has no imports.
 */
export type ToolEffect = 'read' | 'write' | 'shell-write' | 'shell-read' | 'external' | 'observe';
/**
 * Shell commands that are known to write. Kept byte-compatible with the
 * previous constraint heuristic so behaviour does not change while the gates
 * move onto this module.
 */
export declare const SHELL_WRITE_PATTERN: RegExp;
/**
 * True when a shell command matches a known write pattern.
 *
 * Redirections to null devices (`>nul`, `>NUL`, `2>nul`, `>/dev/null`,
 * `2>/dev/null`) discard output; they are not file writes.
 */
export declare function shellWrites(command: string): boolean;
export declare function isWriteEffect(effect: ToolEffect): boolean;
export declare function isObservationEffect(effect: ToolEffect): boolean;
/**
 * Classify a canonical tool name (run `canonicalizeToolCall` first; aliases are
 * deliberately not resolved here so there is one alias table in the codebase).
 */
export declare function classifyToolEffect(name: string, args?: Record<string, unknown>): ToolEffect;
