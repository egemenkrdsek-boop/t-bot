import type { AgentEvent, AgentInput, ImageAttachment, Message, ToolCall } from './types.js';
import type { Session } from './sessions.js';
export declare function screenshotImage(call: ToolCall, result: string, workspace: string): Promise<ImageAttachment | undefined>;
export interface AgentRunOptions {
    toolPolicy?: 'read-only' | 'all';
    maxRounds?: number;
    maxToolCalls?: number;
    session?: Session;
    activeSkills?: string[];
    workspace?: string;
    onEvent?: (event: AgentEvent) => void;
}
/** Run one user turn, returning the conversation including any native tool calls. */
export declare function runAgent(input: AgentInput, options?: AgentRunOptions): Promise<Message[]>;
