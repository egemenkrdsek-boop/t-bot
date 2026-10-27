import type { AgentEvent, AgentInput, ApprovalRequest, Message, Provider, ToolCall, ToolDefinition } from './types.js';
export type SubagentInput = AgentInput & {
    workerProvider: Provider;
    session?: any;
};
export interface SubtaskItem {
    role: string;
    title: string;
    task: string;
}
/** Model çıktısından markdown veya ek metinleri temizleyip ilk [ ile son ] arasındaki JSON dizisini ayıklar. */
export declare function extractJsonArray(text: string): string;
/** Plan independent, read-only investigations with specialized Turkish subagents, then let the primary agent act. */
export declare function runSubagents(input: SubagentInput): Promise<Message[]>;
export declare const subagentToolDefinitions: ToolDefinition[];
export interface SubagentToolContext {
    workspace: string;
    provider?: Provider;
    onEvent?: (e: AgentEvent) => void;
    approve?: (request: ApprovalRequest) => Promise<boolean>;
    signal?: AbortSignal;
}
export declare function handleSubagentTool(call: ToolCall, ctx: SubagentToolContext): Promise<string>;
export declare function handleSubagentTool(name: string, args: Record<string, unknown>, ctx: SubagentToolContext): Promise<string>;
