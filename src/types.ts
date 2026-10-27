import type { McpConnection } from './mcp.js';
import type { ImageProviderConfig } from './tools/image.js';

/** Shared contracts for the local T Bot agent. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  thoughtSignature?: string;
}
export interface ImageAttachment { mimeType: 'image/png'; data: string; }
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
export type ProviderEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_calls'; calls: ToolCall[]; responseItems?: Record<string, unknown>[] }
  | { type: 'response_items'; responseItems: Record<string, unknown>[] }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number }
  | { type: 'error'; error: string; code?: 'authentication' };
export interface Provider {
  id: string;
  label: string;
  stream(messages: Message[], tools: ToolDefinition[], options?: { signal?: AbortSignal }): AsyncIterable<ProviderEvent>;
}
export interface ApprovalRequest {
  tool: string;
  description: string;
  arguments: Record<string, unknown>;
}
export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_start'; call: ToolCall }
  | { type: 'tool_end'; call: ToolCall; result: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number }
  | { type: 'error'; error: string; code?: 'authentication' }
  | { type: 'status'; message: string };
export interface AgentInput {
  message: string;
  history: Message[];
  provider: Provider;
  workspace: string;
  onEvent: (event: AgentEvent) => void;
  approve: (request: ApprovalRequest) => Promise<boolean>;
  signal?: AbortSignal;
  mcpTools?: McpConnection[];
  imageProvider?: ImageProviderConfig;
}

