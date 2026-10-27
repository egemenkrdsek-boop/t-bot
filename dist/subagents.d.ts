import type { AgentInput, Message, Provider } from './types.js';
export type SubagentInput = AgentInput & {
    workerProvider: Provider;
};
/** Plan independent, read-only investigations, then let the primary agent act. */
export declare function runSubagents(input: SubagentInput): Promise<Message[]>;
