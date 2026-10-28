/**
 * Local context budgets. These are optimization targets, not provider hard
 * limits: sending the entire supported window is slow, expensive and often
 * lowers instruction adherence. The values are intentionally conservative and
 * can be raised per profile without changing the agent loop.
 */
import { resolveModelProfile, type ModelProfile } from './core/model-profile.js';

export interface ContextBudget extends ModelProfile {
  provider: string;
  model: string;
  /** Absolute request text cap in characters (defensive input bound). */
  maxInputChars: number;
}

export function resolveContextBudget(provider: string, model = '', effort?: string): ContextBudget {
  const id = String(provider || '').toLowerCase();
  const name = String(model || '').toLowerCase();
  const profile = resolveModelProfile(id, name, effort);

  // Local runtime capacity is tighter than a hosted provider.
  let historyTokens = profile.historyTokens;
  if (id === 'ollama' || id === 'lmstudio') {
    historyTokens = Math.min(historyTokens, profile.weak ? 14_000 : 24_000);
  }

  return {
    ...profile,
    provider: id,
    model: name,
    historyTokens,
    maxInputChars: Math.max(90_000, historyTokens * 4),
  };
}
