const PROFILES = Object.freeze({
    small: Object.freeze({
        id: 'small',
        weak: true,
        maxRounds: 18,
        maxToolCalls: 24,
        maxCallsPerRound: 1,
        historyTokens: 16_000,
        reserveOutputTokens: 2_000,
        maxOutputTokens: 4_096,
        parallelReads: false,
    }),
    standard: Object.freeze({
        id: 'standard',
        weak: false,
        maxRounds: 36,
        maxToolCalls: 144,
        maxCallsPerRound: 4,
        historyTokens: 28_000,
        reserveOutputTokens: 4_000,
        maxOutputTokens: 8_192,
        parallelReads: false,
    }),
    reasoning: Object.freeze({
        id: 'reasoning',
        weak: false,
        maxRounds: 45,
        maxToolCalls: 240,
        maxCallsPerRound: 12,
        historyTokens: 40_000,
        reserveOutputTokens: 8_000,
        maxOutputTokens: 16_384,
        parallelReads: true,
    }),
});
/** Token-boundary small-model families. "flash" is intentionally absent. */
const WEAK_MARKER = /(?:^|[^a-z0-9])(?:mini|nano|micro|haiku|lite|light|small|tiny|weak|phi-?[34])(?:[^a-z0-9]|$)/i;
/** Explicit parameter count suffix (7b, 8b, 14b, 1.5b, ...). <=14B is small. */
const SIZE_SUFFIX = /(?:^|[^a-z0-9])(\d+(?:\.\d+)?)b(?:[^a-z0-9]|$)/i;
const SMALL_SIZE_LIMIT = 14;
/**
 * Frontier/reasoning families that benefit from the wider budget. A "mini"
 * sibling is still classified small by WEAK_MARKER before this pattern runs.
 */
const REASONING_MODEL = new RegExp([
    String.raw `(?:^|[\/])o(?:1|3|4)(?:[.\/-]|$)`,
    String.raw `(?:^|[\/])deepseek-(?:r1|reasoner)(?:[.\/-]|$)`,
    String.raw `(?:^|[\/])gpt-5-pro(?:[.\/-]|$)`,
    String.raw `(?:^|[\/])gpt-5(?:\.\d+)?(?:[.\/-]|$)`,
    String.raw `(?:^|[\/])gpt-6(?:[.\/-]|$)`,
    String.raw `(?:^|[\/])grok-4(?:[.\/-]|$)`,
    String.raw `claude-(?:opus-(?:4-[5-9]|5)|sonnet-5|fable-5|mythos-5)(?:[.\/-]|$)`,
    String.raw `gemini-(?:2\.5-pro|3-pro|4)(?:[.\/-]|$)`,
].join('|'), 'i');
function clone(profile) {
    return { ...profile };
}
function isWeakModel(id) {
    if (WEAK_MARKER.test(id))
        return true;
    const size = SIZE_SUFFIX.exec(id);
    if (!size)
        return false;
    const billions = Number(size[1]);
    return Number.isFinite(billions) && billions > 0 && billions <= SMALL_SIZE_LIMIT;
}
/**
 * Resolve the local budget profile for a provider/model pair.
 *
 * Precedence:
 * 1. explicit `weak` effort -> small
 * 2. `max`/`xhigh` effort -> reasoning
 * 3. `low`/`medium` effort -> standard
 * 4. model catalog (known small families and <=14B suffixes -> small,
 *    known frontier/reasoning families -> reasoning)
 * 5. unknown models -> standard
 *
 * Callers should pass `effort` only when the user explicitly selected one.
 * Passing the implicit default "medium" would promote a genuinely small model
 * to standard.
 */
export function resolveModelProfile(provider, model, effort) {
    // Provider is part of the contract for future provider-specific catalog
    // entries; today classification is driven by the normalized model id.
    void provider;
    const id = String(model || '').trim().toLowerCase();
    const level = String(effort || '').trim().toLowerCase();
    if (level === 'weak')
        return clone(PROFILES.small);
    if (level === 'max' || level === 'xhigh')
        return clone(PROFILES.reasoning);
    if (level === 'low' || level === 'medium')
        return clone(PROFILES.standard);
    if (isWeakModel(id))
        return clone(PROFILES.small);
    if (REASONING_MODEL.test(id))
        return clone(PROFILES.reasoning);
    return clone(PROFILES.standard);
}
//# sourceMappingURL=model-profile.js.map