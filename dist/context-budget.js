/**
 * Local context budgets. These are optimization targets, not provider hard
 * limits: sending the entire supported window is slow, expensive and often
 * lowers instruction adherence. The values are intentionally conservative and
 * can be raised per profile without changing the agent loop.
 */
import { resolveModelProfile } from './core/model-profile.js';
export function resolveContextBudget(provider, model = '', effort) {
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
//# sourceMappingURL=context-budget.js.map