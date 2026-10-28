/**
 * Enforced turn phases and completion gates.
 *
 * The system prompt already describes locate -> plan -> act -> verify ->
 * report. This module makes the important parts of that contract executable:
 * an inspection task cannot write, an edit task cannot silently finish
 * without changing a file, and a changed file cannot be declared successful
 * on the strength of a verification that ran before the last change.
 */
import type { ToolCall } from '../types.js';
import type { TaskContract } from './task-contract.js';
export type AgentPhase = 'intake' | 'locate' | 'plan' | 'act' | 'verify' | 'report';
export interface PhaseState {
    phase: AgentPhase;
    reads: number;
    writes: number;
    verificationAttempts: number;
    verificationPassed: boolean;
    /** Monotonic order of completed tool results. */
    sequence: number;
    /** Sequence of the last successful write, or 0 when nothing was written. */
    lastWriteSequence: number;
    /** Sequence of the last verification attempt, or 0 when none ran. */
    lastVerifySequence: number;
    /** Result of the most recent verification, never an OR of older results. */
    lastVerificationPassed: boolean;
    toolCalls: number;
}
export declare function createPhaseState(): PhaseState;
export declare function isReadTool(name: string): boolean;
export declare function isWriteTool(name: string): boolean;
export declare function isVerificationCall(name: string, args: Record<string, unknown>): boolean;
export declare function phaseLabel(phase: AgentPhase): string;
/**
 * A pre-execution gate. Returns an error string when the call must not run.
 * This is intentionally narrow: it blocks only violations that are provable
 * from the task kind and the current turn state.
 */
export declare function phaseViolation(state: PhaseState, call: ToolCall, contract: TaskContract, readOnly: boolean): string | undefined;
/** Update state only after a call actually produced a result. */
export declare function recordPhaseToolResult(state: PhaseState, call: ToolCall, ok: boolean): void;
/**
 * A final-answer gate. The agent may retry once with this correction. After
 * that retry the answer is allowed through so the user is never trapped in a
 * loop; the prompt still requires an explicit unverified statement.
 */
export declare function finalAnswerViolation(state: PhaseState, contract: TaskContract, finalText: string): string | undefined;
