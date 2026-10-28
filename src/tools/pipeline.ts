import type { ToolCall, ToolDefinition } from '../types.js';
import { normalizeToolCall } from './index.js';
import { classifyToolEffect, type ToolEffect } from '../core/tool-effect.js';

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
export function canonicalizeToolCall(
  call: ToolCall,
  registry?: Map<string, ToolDefinition>
): CanonicalToolCall {
  const rawName = typeof call?.name === 'string' ? call.name : '';
  const rawArgs = ((call as unknown as { args?: Record<string, unknown> })?.args
    ?? call?.arguments
    ?? {}) as Record<string, unknown>;

  const normalized = normalizeToolCall(rawName, rawArgs);
  const definition = registry?.get(normalized.name);

  return {
    rawName,
    name: definition?.name ?? normalized.name,
    args: normalized.args,
    effect: classifyToolEffect(definition?.name ?? normalized.name, normalized.args),
  };
}
