import type { AgentEvent, AgentInput, ImageAttachment, Message, ToolCall } from './types.js';
import type { Session } from './sessions.js';
/**
 * Fast detection for simple greetings or casual smalltalk.
 * When true, bypasses repo-map, memory search, tool injection, and sets effort: low.
 */
export declare function isFastConversationalPrompt(input: string, hasImages: boolean): boolean;
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
/** Keep native Responses call items consistent with budgeted, normalized tool calls. */
export declare function reconcileResponseItems(items: Record<string, unknown>[], calls: ToolCall[]): Record<string, unknown>[];
/** Run one user turn, returning the conversation including any native tool calls. */
export declare function runAgent(input: AgentInput, options?: AgentRunOptions): Promise<Message[]>;
