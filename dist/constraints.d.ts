import type { ToolCall } from './types.js';
export type ConstraintKind = 'forbid-path' | 'only-path' | 'forbid-command' | 'forbid-tool' | 'no-write' | 'no-command' | 'allow-path' | 'release';
export interface Constraint {
    kind: ConstraintKind;
    value: string;
    source: string;
}
/**
 * Extract only unambiguous constraints. A sentence such as "don't forget to
 * run tests" is deliberately not treated as "do not run tests".
 */
export declare function extractConstraints(text: string): Constraint[];
/** Merge constraints from oldest to newest; later explicit releases win. */
export declare function collectConstraints(userMessages: readonly string[]): Constraint[];
/**
 * Return an actionable error when a proposed call violates a hard boundary.
 * The caller must not execute the tool when this returns a string.
 */
export declare function constraintViolation(call: ToolCall, constraints: readonly Constraint[], workspace: string): string | undefined;
/** Compact, stable prompt section. No user quotes are needed here. */
export declare function constraintPrompt(constraints: readonly Constraint[]): string;
