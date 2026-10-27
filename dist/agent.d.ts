import type { AgentInput, Message } from './types.js';
export interface AgentRunOptions {
    toolPolicy?: 'read-only';
    maxRounds?: number;
    maxToolCalls?: number;
}
/** Run one user turn, returning the conversation including any native tool calls. */
export declare function runAgent(input: AgentInput, options?: AgentRunOptions): Promise<Message[]>;
