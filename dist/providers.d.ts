import type { Provider } from './types.js';
import { type EffortLevel } from './effort.js';
export interface ProviderConfig {
    id: string;
    model: string;
    baseUrl?: string;
    apiKey?: string;
    timeoutMs?: number;
    effort?: EffortLevel;
    /**
     * Optional one-shot model switch on HTTP 402/404. The config layer owns
     * reading config.fallbackModel / TBOT_FALLBACK_MODEL and passing it here.
     */
    fallbackModel?: string;
    /** Invoked once when fallbackModel is used; the caller can surface a status. */
    onFallback?: (info: {
        provider: string;
        from: string;
        to: string;
        status: number;
    }) => void;
}
export declare const PROVIDER_CATALOG: readonly [{
    readonly id: "gemini";
    readonly label: "Gemini";
    readonly baseUrl: "https://generativelanguage.googleapis.com/v1beta";
    readonly requiresApiKey: true;
}, {
    readonly id: "openai";
    readonly label: "OpenAI";
    readonly baseUrl: "https://api.openai.com/v1";
    readonly requiresApiKey: true;
}, {
    readonly id: "anthropic";
    readonly label: "Anthropic";
    readonly baseUrl: "https://api.anthropic.com/v1";
    readonly requiresApiKey: true;
}, {
    readonly id: "openrouter";
    readonly label: "OpenRouter";
    readonly baseUrl: "https://openrouter.ai/api/v1";
    readonly requiresApiKey: true;
}, {
    readonly id: "groq";
    readonly label: "Groq";
    readonly baseUrl: "https://api.groq.com/openai/v1";
    readonly requiresApiKey: true;
}, {
    readonly id: "together";
    readonly label: "Together AI";
    readonly baseUrl: "https://api.together.xyz/v1";
    readonly requiresApiKey: true;
}, {
    readonly id: "deepseek";
    readonly label: "DeepSeek";
    readonly baseUrl: "https://api.deepseek.com/v1";
    readonly requiresApiKey: true;
}, {
    readonly id: "xai";
    readonly label: "xAI";
    readonly baseUrl: "https://api.x.ai/v1";
    readonly requiresApiKey: true;
}, {
    readonly id: "mistral";
    readonly label: "Mistral";
    readonly baseUrl: "https://api.mistral.ai/v1";
    readonly requiresApiKey: true;
}, {
    readonly id: "fireworks";
    readonly label: "Fireworks";
    readonly baseUrl: "https://api.fireworks.ai/inference/v1";
    readonly requiresApiKey: true;
}, {
    readonly id: "cerebras";
    readonly label: "Cerebras";
    readonly baseUrl: "https://api.cerebras.ai/v1";
    readonly requiresApiKey: true;
}, {
    readonly id: "ollama";
    readonly label: "Ollama";
    readonly baseUrl: "http://localhost:11434/v1";
    readonly requiresApiKey: false;
}, {
    readonly id: "lmstudio";
    readonly label: "LM Studio";
    readonly baseUrl: "http://localhost:1234/v1";
    readonly requiresApiKey: false;
}, {
    readonly id: "custom";
    readonly label: "Custom OpenAI compatible";
    readonly baseUrl: "";
    readonly requiresApiKey: false;
}];
/** Retry policy for the initial HTTP request (before any stream body is read). */
export interface FetchRetryOptions {
    signal?: AbortSignal | null;
    /** Additional attempts after the first one. Default 2 (three attempts total). */
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
}
/** Parse Retry-After as seconds or an HTTP date; returns milliseconds. */
export declare function parseRetryAfter(value: string | null): number | undefined;
/**
 * Fetch with a bounded retry for 408/429/5xx and network failures. Retries
 * stop when the caller aborts or the request timeout fires. Once a response
 * body starts streaming the caller never re-issues the request.
 */
export declare function fetchWithRetry(input: string | URL | Request, init?: RequestInit, options?: FetchRetryOptions): Promise<Response>;
/**
 * Deterministic JSON Repair Engine for LLM tool call arguments.
 * Repairs markdown code blocks, unescaped newlines/tabs inside string literals,
 * trailing commas before closing braces/brackets, and unclosed quotes/brackets/braces.
 * Compatibility utility only: executable streamed calls must use strict JSON parsing.
 */
export declare function repairJsonArgs(raw: string): Record<string, unknown>;
export declare function sse(body: ReadableStream<Uint8Array>): AsyncGenerator<string>;
export declare function createProvider(config: ProviderConfig): Provider;
/** Validate an OpenRouter key without exposing the response body or credentials. */
export declare function validateOpenRouterKey(key: string, signal?: AbortSignal): Promise<void>;
