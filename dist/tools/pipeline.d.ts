import type { ToolCall, ToolDefinition } from '../types.js';
import { type ToolEffect } from '../core/tool-effect.js';
export interface CanonicalToolCall {
    /** Name exactly as the model sent it. */
    rawName: string;
    /** Canonical name after alias and argument normalization. */
    name: string;
    args: Record<string, unknown>;
    effect: ToolEffect;
}
/**
 * One canonicalization pass for a tool call.
 *
 * `normalizeToolCall` stays the single alias table. This wrapper never throws:
 * an unknown tool still gets a canonical shape so the dispatcher's registry
 * check can produce the actionable "Unknown tool" error instead of a generic
 * exception. Callers must pass the canonical name to every gate so aliases
 * cannot slip past phase or constraint checks.
 */
export declare function canonicalizeToolCall(call: ToolCall, registry?: Map<string, ToolDefinition>): CanonicalToolCall;
