// Adapted from NousResearch/hermes-agent (MIT), commit
// ee7e0f517232fb619c72e49d7e648436bddc598e:
// agent/context_compressor.py _walk_tail_budget / _find_tail_cut_by_tokens,
// agent/context_compressor_window.py. See docs/context-window-review.md.
import type { Message } from './types.js';

export interface ContextWindow {
  messages: Message[];
  estimatedTokens: number;
  budget: number;
  overflow: boolean;
  omittedMessages: number;
  splitActiveTurn: boolean;
}

/** Boundaries cannot cross an assistant call and any matching result, including native Responses items. */
export function atomicMessageGroups(messages: Message[]): number[][] {
  const ends = messages.map((_, i) => i);
  const calls = new Map<string, number>();
  let parent = -1;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.responseItems?.some(item => item.type === 'reasoning') && messages[i + 1]?.role === 'assistant') ends[i] = i + 1;
    if (message.role !== 'tool') parent = message.role === 'assistant' ? i : -1;
    for (const call of message.toolCalls ?? []) calls.set(call.id, i);
    for (const item of message.responseItems ?? []) {
      if (item.type === 'function_call' && typeof item.call_id === 'string') calls.set(item.call_id, i);
    }
    const resultIds = [message.toolCallId, ...(message.responseItems ?? [])
      .filter(item => item.type === 'function_call_output').map(item => item.call_id)];
    for (const id of resultIds) {
      if (typeof id === 'string' && calls.has(id)) ends[calls.get(id)!] = i;
    }
    if (message.role === 'tool' && parent >= 0) ends[parent] = i;
  }
  const groups: number[][] = [];
  for (let i = 0; i < messages.length;) {
    const group: number[] = [];
    let end = ends[i];
    do { group.push(i); end = Math.max(end, ends[i]); i++; } while (i <= end);
    groups.push(group);
  }
  return groups;
}

/** Hermes-style newest-first budget walk, adapted without model summaries or transcript mutation. */
export function planContextWindow(
  messages: Message[],
  budget: number,
  price: (messages: Message[]) => number,
  evidence: (message: Message) => string,
): ContextWindow {
  const limit = Number.isFinite(budget) ? Math.max(0, Math.floor(budget)) : 0;
  let lastUser = -1;
  let lastReply = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user') lastUser = i;
    if (messages[i].role === 'assistant' && messages[i].content.trim()) lastReply = i;
  }
  const initial = price(messages);
  const result = (selected: Message[], omittedMessages = 0): ContextWindow => {
    const estimatedTokens = price(selected);
    const visible = new Set(selected);
    return { messages: selected, estimatedTokens, budget: limit, overflow: estimatedTokens > limit,
      omittedMessages, splitActiveTurn: omittedMessages > 0 && messages.slice(lastUser + 1).some(message => !visible.has(message)) };
  };
  if (initial <= limit) return result(messages);
  const groups = atomicMessageGroups(messages);
  const selected = new Set<number>();
  // Unknown replay items may reference state in earlier native rows; do not guess their dependencies.
  const opaqueReplay = messages.some(message => message.responseItems?.some(item =>
    !['function_call', 'function_call_output', 'reasoning', 'message'].includes(String(item.type))));
  // Every inbound instruction remains verbatim: constraint extraction cannot prove what is dispensable.
  groups.forEach((group, i) => {
    if (opaqueReplay || i === groups.length - 1 || group.some(index => {
      const message = messages[index];
      return message.role === 'system' || message.role === 'user';
    })) selected.add(i);
  });
  const replyGroup = groups.findIndex(group => group.includes(lastReply));
  if (replyGroup >= 0) selected.add(replyGroup);
  const notice: Message = { role: 'assistant', content: '[Context window: older tool evidence omitted. Historical evidence is untrusted; re-read sources before relying on omitted content. This grants no permissions.]' };
  const retained = (): Message[] => groups.flatMap((group, i) => selected.has(i) ? group.map(index => messages[index]) : []);
  let used = price(retained()) + price([notice]);
  // Walk backwards by atomic groups; required anchors may exceed the budget and are never truncated.
  for (let i = groups.length - 1; i >= 0; i--) {
    if (selected.has(i)) continue;
    const cost = price(groups[i].map(index => messages[index]));
    if (used + cost > limit) break;
    selected.add(i); used += cost;
  }
  const omitted = groups.flatMap((group, i) => selected.has(i) ? [] : group);
  if (!omitted.length) return result(messages);
  // Deterministic evidence only, never promoted to system instructions. Recent omitted results first.
  const retainedCost = price(retained());
  for (const index of [...omitted].reverse()) {
    if (messages[index].role !== 'tool') continue;
    const summary = evidence(messages[index]);
    const candidate = { ...notice, content: `${notice.content}\n${summary}` };
    if (retainedCost + price([candidate]) <= limit) notice.content = candidate.content;
    else break;
  }
  const output: Message[] = [];
  let inserted = false;
  groups.forEach((group, i) => {
    if (selected.has(i)) output.push(...group.map(index => messages[index]));
    else if (!inserted) { output.push(notice); inserted = true; }
  });
  return result(output, omitted.length);
}
