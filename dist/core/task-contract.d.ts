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
    /** Previous turn's contract, used by "continue" / "devam et". */
    previousContract?: TaskContract;
}
/**
 * Build the contract for one turn. `readOnly` and an explicit no-write
 * boundary always win: an investigator cannot be given a write contract.
 */
export declare function buildTaskContract(message: string, options?: TaskContractOptions): TaskContract;
/** Compact, cache-friendly contract block for the system prompt. */
export declare function taskContractPrompt(contract: TaskContract): string;
