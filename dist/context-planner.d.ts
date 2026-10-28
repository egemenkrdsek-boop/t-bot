/**
 * Turn-level context budget planning.
 *
 * The provider's advertised window is not the target. T Bot deliberately
 * sends a smaller working set so small models stay focused and large models
 * do not pay for stale evidence. This planner makes the trade-off explicit
 * and leaves the history window to the Hermes-style compressor.
 */
import type { ContextBudget } from './context-budget.js';
export interface TurnBudgetPlan {
    /** Tokens available to conversation history after system and tool schemas. */
    historyTokens: number;
    /** Estimated system + tool-schema cost already reserved. */
    fixedTokens: number;
    /** Output tokens the provider may generate. */
    reservedOutputTokens: number;
    /** True when fixed costs already meet or exceed the local history target. */
    overBudget: boolean;
    /** Human-readable explanation for status surfaces. */
    note: string;
}
export declare function planTurnBudget(budget: ContextBudget, fixedTokens: number): TurnBudgetPlan;
