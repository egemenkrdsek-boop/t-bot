import type { ApprovalRequest, ToolDefinition } from '../types.js';
export interface ImageProviderConfig {
    provider: 'openai' | 'gemini' | 'openrouter';
    apiKey: string;
    model?: string;
}
export interface ImageToolContext {
    workspace: string;
    approve: (request: ApprovalRequest) => Promise<boolean>;
    imageProvider?: ImageProviderConfig;
    signal?: AbortSignal;
}
export declare const imageToolDefinitions: ToolDefinition[];
export declare const IMAGE_MODELS: {
    readonly openai: {
        readonly default: "gpt-image-2.5-flare";
        readonly choices: readonly ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2", "gpt-image-2-2026-04-21", "gpt-image-2.5-flare-2026-09-08", "gpt-image-2.5-sunburst-2026-09-08"];
    };
    readonly gemini: {
        readonly default: "gemini-3.1-flash-image";
        readonly choices: readonly ["gemini-nano-banana-2.1", "gemini-3.1-flash-image", "gemini-3.1-flash-lite-image", "gemini-3-pro-image", "gemini-2.5-flash-image"];
    };
    readonly openrouter: {
        readonly default: "google/gemini-3.1-flash-image";
        readonly choices: readonly ["google/gemini-3.1-flash-image", "google/gemini-3.1-flash-lite-image", "google/gemini-3-pro-image", "openai/gpt-5-image"];
    };
};
export declare function handleImageTool(name: string, args: Record<string, unknown>, context: ImageToolContext): Promise<string>;
