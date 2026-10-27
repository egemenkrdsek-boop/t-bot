import type { Message, ToolDefinition } from './types.js';
/**
 * Fast, dependency-free BPE token estimator.
 * Mimics modern LLM tokenizers (cl100k_base / o200k / Llama / Claude)
 * taking into account punctuation, code syntax, indentation, and Turkish/multibyte Unicode characters.
 */
export declare function estimateTokens(text: string): number;
/**
 * Calculates estimated token count across messages, tool calls, response items, system prompt and tool definitions.
 */
export declare function estimateMessagesTokens(messages: Message[], systemPrompt?: string, tools?: ToolDefinition[]): number;
/** Always preserved core tools that must never be pruned. */
export declare const CORE_TOOLS: Set<string>;
/**
 * Prunes conditional heavy tool definitions and compresses descriptions.
 * Yields significant token savings (often 40-70% of schema tokens).
 */
export declare function pruneToolDefinitions(tools: ToolDefinition[], userQuery: string, activeSkills?: string[], history?: Message[]): {
    tools: ToolDefinition[];
    savedTokens: number;
    prunedCount: number;
};
/**
 * Compresses conversation history to fit budget while preserving:
 * - Full output of latest tool batch (MAX_TOOL_RESULT_CHARS = 12_000)
 * - Structural evidence of older tool outputs
 * - Images only in the latest 2 messages
 * - Initial user goal summary when dropping overflow turns
 */
export declare function compressConversationHistory(messages: Message[], maxTokenBudget?: number): {
    messages: Message[];
    savedTokens: number;
};
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
}
export declare class TokenSessionTracker {
    private totalRawTokens;
    private totalSentInputTokens;
    private totalOutputTokens;
    private totalCachedTokens;
    private totalPrunedSchemaTokens;
    private totalCompressedHistoryTokens;
    private turnsCount;
    recordTurn(data: {
        rawTokens: number;
        sentInputTokens: number;
        outputTokens: number;
        cachedTokens?: number;
        prunedSchemaTokens?: number;
        compressedHistoryTokens?: number;
    }): TokenSavingsReport;
    getReport(): TokenSavingsReport;
    reset(): void;
}
export declare const globalTokenTracker: TokenSessionTracker;
