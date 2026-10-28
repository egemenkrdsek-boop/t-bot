import type { EffortLevel } from './effort.js';
import type { McpConnection } from './mcp.js';
import type { ImageProviderConfig } from './tools/image.js';
/** Shared contracts for the local T Bot agent. */
export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    thoughtSignature?: string;
}
export interface ImageAttachment {
    mimeType: 'image/png' | 'image/jpeg';
    data: string;
}
export interface Message {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    images?: ImageAttachment[];
    toolCallId?: string;
    toolCalls?: ToolCall[];
    responseItems?: Record<string, unknown>[];
}
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}
export type ProviderEvent = {
    type: 'text';
    text: string;
} | {
    type: 'tool_calls';
    calls: ToolCall[];
    responseItems?: Record<string, unknown>[];
} | {
    type: 'response_items';
    responseItems: Record<string, unknown>[];
} | {
    type: 'usage';
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    savedTokens?: number;
    savingsPercent?: number;
} | {
    type: 'error';
    error: string;
    code?: 'authentication';
};
export type StreamEvent = ProviderEvent;
export interface ProviderStreamOptions {
    signal?: AbortSignal;
    effort?: EffortLevel;
}
export interface Provider {
    id: string;
    label: string;
    stream(messages: Message[], tools: ToolDefinition[], options?: ProviderStreamOptions): AsyncIterable<ProviderEvent>;
}
export interface ApprovalRequest {
    tool: string;
    description: string;
    arguments: Record<string, unknown>;
}
export type AgentEvent = {
    type: 'text';
    text: string;
} | {
    type: 'tool_start';
    call: ToolCall;
} | {
    type: 'tool_end';
    call: ToolCall;
    result: string;
} | {
    type: 'usage';
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    savedTokens?: number;
    savingsPercent?: number;
} | {
    type: 'error';
    error: string;
    code?: 'authentication';
} | {
    type: 'status';
    message: string;
};
export interface AgentInput {
    /** Internal host identity for background process handles, never a model parameter. */
    processOwner?: string;
    message: string;
    images?: ImageAttachment[];
    history: Message[];
    provider: Provider;
    workspace: string;
    onEvent: (event: AgentEvent) => void;
    approve: (request: ApprovalRequest) => Promise<boolean>;
    signal?: AbortSignal;
    mcpTools?: McpConnection[];
    imageProvider?: ImageProviderConfig;
}
export interface Config {
    provider: string;
    model: string;
    baseUrl?: string;
    workspacePermissions: Record<string, 'ask' | 'allow'>;
    efforts?: Record<string, EffortLevel>;
    telegramBotToken?: boolean;
    telegramAllowedChatIds?: string[];
}
export interface TokenSavingsReport {
    totalRawTokens: number;
    totalSentInputTokens: number;
    totalOutputTokens: number;
    totalCachedTokens: number;
    totalPrunedSchemaTokens: number;
    totalCompressedHistoryTokens: number;
    totalSavedTokens: number;
    savingsPercent: number;
    turnsCount: number;
    turnSavedTokens?: number;
    turnCachedTokens?: number;
}
export interface GroundingStatus {
    verified: boolean;
    inspectedCount: number;
    modifiedCount: number;
    verifiedCommands: number;
    warnings: string[];
}
