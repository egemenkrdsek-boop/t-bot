import type { Message } from './types.js';
export interface ContextWindow {
    messages: Message[];
    estimatedTokens: number;
    budget: number;
    overflow: boolean;
    omittedMessages: number;
    splitActiveTurn: boolean;
}
/** Boundaries cannot cross an assistant call and any matching result, including native Responses items. */
export declare function atomicMessageGroups(messages: Message[]): number[][];
/** Hermes-style newest-first budget walk, adapted without model summaries or transcript mutation. */
export declare function planContextWindow(messages: Message[], budget: number, price: (messages: Message[]) => number, evidence: (message: Message) => string): ContextWindow;
