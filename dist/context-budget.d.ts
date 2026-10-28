/**
 * Local context budgets. These are optimization targets, not provider hard
 * limits: sending the entire supported window is slow, expensive and often
 * lowers instruction adherence. The values are intentionally conservative and
 * can be raised per profile without changing the agent loop.
 */
import { type ModelProfile } from './core/model-profile.js';
export interface ContextBudget extends ModelProfile {
    provider: string;
    model: string;
    /** Absolute request text cap in characters (defensive input bound). */
    maxInputChars: number;
}
export declare function resolveContextBudget(provider: string, model?: string, effort?: string): ContextBudget;
