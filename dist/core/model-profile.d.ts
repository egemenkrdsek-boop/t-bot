/**
 * Model budget profiles.
 *
 * The profile is a local working-set policy, not a provider hard limit. Small
 * models get one tool call per round and a tight history; standard models get
 * a few parallel calls; reasoning/tool-heavy models get the full budget.
 *
 * Classification deliberately avoids treating a bare "flash" marker as weak:
 * DeepSeek v4.1 Flash-class models are tool-capable and must keep the standard
 * or reasoning budget. Only explicit size markers (7b/8b/14b...), known small
 * families (mini/nano/haiku/lite/small) and an explicit weak request select
 * the small profile. Unknown large models fall back to standard.
 */
export type ProfileId = 'small' | 'standard' | 'reasoning';
export interface ModelProfile {
    id: ProfileId;
    /** True only for the small profile; callers use this for narrow tool surfaces. */
    weak: boolean;
    maxRounds: number;
    maxToolCalls: number;
    maxCallsPerRound: number;
    /** Estimated tokens available to history after system/tool schemas. */
    historyTokens: number;
    reserveOutputTokens: number;
    /** Upper bound for the provider's output/max token request. */
    maxOutputTokens: number;
    /** Whether read-only tools may be dispatched in parallel. */
    parallelReads: boolean;
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
export declare function resolveModelProfile(provider: string, model?: string, effort?: string): ModelProfile;
