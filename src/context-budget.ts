/**
 * Local context budgets. These are optimization targets, not provider hard
 * limits: sending the entire supported window is slow, expensive and often
 * lowers instruction adherence. The values are intentionally conservative and
 * can be raised per provider/model without changing the agent loop.
 */
export interface ContextBudget {
  provider: string;
  model: string;
  /** Small models need a tighter, more explicit working set. */
  weak: boolean;
  /** Estimated tokens available to conversation history after system/tools. */
  historyTokens: number;
  /** Absolute request text cap in characters (defensive input bound). */
  maxInputChars: number;
  maxRounds: number;
  maxToolCalls: number;
  maxCallsPerRound: number;
  reserveOutputTokens: number;
}

const WEAK_MODEL =
  /(?:mini|small|flash(?!-thinking)|haiku|nano|lite|3\.5|7b|8b|9b|14b|1\.5b|2b|3b|4b|qwen2\.5|phi-?[34])/i;
const LONG_CONTEXT_MODEL =
  /(?:gemini|claude|gpt-6|gpt-5|o[34]|deepseek|kimi|qwen|grok|llama-?4|mistral-large)/i;

export function resolveContextBudget(provider: string, model = ''): ContextBudget {
  const id = String(provider || '').toLowerCase();
  const name = String(model || '').toLowerCase();
  const weak = WEAK_MODEL.test(name) || WEAK_MODEL.test(id);

  // Local budgets are deliberately smaller than the advertised windows.
  let historyTokens = weak ? 18_000 : 28_000;
  if (!weak && (id === 'gemini' || id === 'anthropic')) historyTokens = 44_000;
  if (!weak && id === 'openai' && LONG_CONTEXT_MODEL.test(name)) historyTokens = 40_000;
  if (id === 'ollama' || id === 'lmstudio') historyTokens = weak ? 14_000 : 24_000;

  return {
    provider: id,
    model: name,
    weak,
    historyTokens,
    maxInputChars: Math.max(90_000, historyTokens * 4),
    maxRounds: weak ? 32 : 45,
    maxToolCalls: weak ? 80 : 90,
    maxCallsPerRound: 12,
    reserveOutputTokens: weak ? 2_000 : 4_000,
  };
}
