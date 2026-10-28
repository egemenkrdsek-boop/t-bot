import type { Message, ToolDefinition } from './types.js';
export declare const stringTokenCache: Map<string, number>;
export declare const messageTokenCache: WeakMap<Message, {
    contentRef: string;
    tokens: number;
}>;
export declare const toolTokenCache: WeakMap<ToolDefinition, number>;
export declare const compressedToolOutputCache: WeakMap<Message, {
    content: string;
    summary: string;
}>;
/**
 * Fast, dependency-free BPE token estimator with 600-entry LRU memoization and charCodeAt fast-paths.
 * Mimics modern LLM tokenizers (cl100k_base / o200k / Llama / Claude).
 */
export declare function estimateTokens(text: string): number;
/**
 * Calculates estimated token count across messages, tool calls, response items, system prompt and tool definitions.
 * Uses WeakMap memoization on Message and ToolDefinition objects.
 */
export declare function estimateMessagesTokens(messages: Message[], systemPrompt?: string, tools?: ToolDefinition[]): number;
/** Always preserved core tools that must never be pruned. */
export declare const CORE_TOOLS: Set<string>;
/**
 * Sticky intent groups activated during the current session.
 * Once an intent group is activated, it stays active for the rest of the session
 * so the `tools` array prefix remains stable and never invalidates the provider Prompt Cache.
 */
export declare const activeIntentGroups: Set<string>;
export declare function resetActiveIntentGroups(): void;
/**
 * Compresses both `tool.description` and nested `parameters.properties.*.description` fields,
 * caching the minified ToolDefinition in a WeakMap.
 */
export declare function minifyToolSchema(tool: ToolDefinition): ToolDefinition;
/**
 * Prunes conditional heavy tool definitions with Prompt-Cache-safe sticky activation
 * and deep schema minification.
 */
export declare function pruneToolDefinitions(tools: ToolDefinition[], userQuery: string, activeSkills?: string[], history?: Message[]): {
    tools: ToolDefinition[];
    savedTokens: number;
    prunedCount: number;
};
/**
 * Smart tool output truncation:
 * - Strips ANSI escape sequences and carriage-return (\r) spinner lines.
 * - For `shell` and `process_output` exceeding `maxChars`: keeps first 1,400 chars + middle error/warning lines (up to 1,600 chars) + last 3,500 chars (preserving Exit code & stack trace).
 * - For `git_diff`: collapses lockfiles and dist/ diff blocks into a 1-line placeholder before applying `maxChars`.
 */
export declare function smartTruncateToolOutput(toolName: string, output: string, maxChars?: number): {
    text: string;
    savedTokens: number;
};
/**
 * Epoch-based conversation history compression with WeakMap memoization on older tool messages
 * so the Prompt Cache prefix stays stable across turns.
 */
export declare function compressConversationHistory(messages: Message[], maxTokenBudget?: number): {
    messages: Message[];
    savedTokens: number;
};
export interface TokenSavingsReport {
    totalRawTokens: number;
    totalSentInputTokens: number;
    totalUncachedInputTokens: number;
    totalOutputTokens: number;
    totalCachedTokens: number;
    totalPrunedSchemaTokens: number;
    totalCompressedHistoryTokens: number;
    totalContextCacheSavedTokens: number;
    totalSavedTokens: number;
    turnSavedTokens: number;
    turnCachedTokens: number;
    cachedTokens: number;
    savedTokens: number;
    savingsPercent: number;
    turnsCount: number;
}
export declare class TokenSessionTracker {
    private totalRawTokens;
    private totalSentInputTokens;
    private totalUncachedInputTokens;
    private totalOutputTokens;
    private totalCachedTokens;
    private totalPrunedSchemaTokens;
    private totalCompressedHistoryTokens;
    private totalContextCacheSavedTokens;
    private pendingContextCacheSavedTokens;
    private lastTurnSavedTokens;
    private lastTurnCachedTokens;
    private turnsCount;
    recordContextCacheSaving(savedTokens: number): void;
    recordTurn(data: {
        rawTokens: number;
        sentInputTokens: number;
        outputTokens: number;
        cachedTokens?: number;
        prunedSchemaTokens?: number;
        compressedHistoryTokens?: number;
    }): TokenSavingsReport;
    getSavingsPercentage(): number;
    getReport(): TokenSavingsReport;
    reset(): void;
}
export declare const globalTokenTracker: TokenSessionTracker;
