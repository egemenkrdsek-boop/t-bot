/**
 * Deterministic task contract derived from the current user request.
 *
 * This is deliberately conservative. It does not try to understand every
 * sentence; it records the few facts the turn loop can enforce: whether the
 * user asked for a change, whether verification is expected, and which risk
 * class the task belongs to. Ambiguous language stays with the model.
 */
export type TaskKind = 'conversation' | 'inspect' | 'edit' | 'browser' | 'computer' | 'mixed';
export type TaskRisk = 'low' | 'medium' | 'high';
export interface TaskContract {
    objective: string;
    kind: TaskKind;
    risk: TaskRisk;
    /** A file-changing outcome is expected. */
    requiresWrite: boolean;
    /** A declared verification command or diagnostics check is expected after the last write. */
    requiresVerification: boolean;
    /** Small-model profile: one action per turn and a narrow schema. */
    weakMode: boolean;
    /** Concrete, checkable outcomes shown to the model and the user. */
    acceptance: string[];
}
export interface TaskContractOptions {
    weakMode?: boolean;
    readOnly?: boolean;
    hasImages?: boolean;
}
/**
 * Build the contract for one turn. `readOnly` always wins: an investigator
 * cannot be given a write contract.
 */
export declare function buildTaskContract(message: string, options?: TaskContractOptions): TaskContract;
/** Compact, cache-friendly contract block for the system prompt. */
export declare function taskContractPrompt(contract: TaskContract): string;
