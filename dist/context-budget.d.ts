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
export declare function resolveContextBudget(provider: string, model?: string): ContextBudget;
