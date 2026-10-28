import type { Session } from './sessions.js';
import type { AgentEvent, AgentInput, Message, Provider } from './types.js';
export type TurnMode = 'agent' | 'goal' | 'plan' | 'plan-apply' | 'ultracode' | 'subagents';
export interface TurnRunOptions {
    mode?: TurnMode;
    plan?: string;
    workerProvider?: Provider;
    session?: Session;
    workspace: string;
    onEvent?: (event: AgentEvent) => void;
}
export declare function runTurnMode(input: AgentInput, options: TurnRunOptions): Promise<Message[]>;
