import type { AgentInput, Message } from './types.js';
/** Run one user turn, returning the conversation including any native tool calls. */
export declare function runAgent(input: AgentInput): Promise<Message[]>;
