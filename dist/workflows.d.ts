import type { AgentInput, Message } from './types.js';
export interface Goal {
    id: string;
    objective: string;
    status: 'active' | 'paused' | 'completed' | 'cancelled';
    createdAt: string;
    updatedAt: string;
    revision?: string;
    lastResult?: string;
    lastRun?: 'finished' | 'interrupted' | 'error';
    notes?: string[];
}
export interface RunGoalOptions {
    session?: any;
    maxAutonomousSteps?: number;
}
export declare function getGoal(workspace: string): Promise<Goal | undefined>;
export declare function startGoal(workspace: string, objective: string): Promise<Goal>;
export declare const pauseGoal: (workspace: string) => Promise<Goal>;
export declare const resumeGoal: (workspace: string) => Promise<Goal>;
export declare const cancelGoal: (workspace: string) => Promise<Goal>;
export declare const completeGoal: (workspace: string) => Promise<Goal>;
/** Çok Adımlı Otonom Hedef Döngüsü (Autonomous Goal Loop) */
export declare function runGoal(input: AgentInput, runner?: (input: AgentInput) => Promise<Message[]>, options?: RunGoalOptions): Promise<Message[]>;
/** Planning is a provider-only call: no tools are exposed or executed. */
export declare function planTask(input: AgentInput): Promise<Message[]>;
/** Call only after the user explicitly chooses to execute the displayed plan. */
export declare function executePlan(input: AgentInput, plan: string, runner?: (input: AgentInput) => Promise<Message[]>): Promise<Message[]>;
