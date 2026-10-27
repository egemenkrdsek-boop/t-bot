import type { AgentInput, Message, Provider } from './types.js';
export type UltracodeInput = AgentInput & {
    workerProvider: Provider;
};
/** Research independently, implement with the primary agent, then review read-only. */
export declare function runUltracode(input: UltracodeInput): Promise<Message[]>;
