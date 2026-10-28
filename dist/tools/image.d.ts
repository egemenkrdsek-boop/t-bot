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
        readonly default: "dall-e-3";
        readonly choices: readonly ["dall-e-3", "dall-e-2", "gpt-image-1", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2", "gpt-image-2-2026-04-21", "gpt-image-2.5-flare-2026-09-08", "gpt-image-2.5-sunburst-2026-09-08"];
    };
    readonly gemini: {
        readonly default: "imagen-3.0-generate-002";
        readonly choices: readonly ["imagen-3.0-generate-002", "gemini-3.1-flash-image", "gemini-3.1-flash-lite-image", "gemini-3-pro-image", "gemini-2.5-flash-image", "gemini-nano-banana-2.1", "gemini-2.0-flash-preview-image-generation"];
    };
    readonly openrouter: {
        readonly default: "openai/dall-e-3";
        readonly choices: readonly ["openai/dall-e-3", "google/imagen-3.0-generate-002", "openai/gpt-image-1", "google/gemini-3.1-flash-image", "google/gemini-3.1-flash-lite-image", "google/gemini-3-pro-image", "openai/gpt-5-image", "google/gemini-2.0-flash-preview-image-generation"];
    };
};
export declare function handleImageTool(name: string, args: Record<string, unknown>, context: ImageToolContext): Promise<string>;
