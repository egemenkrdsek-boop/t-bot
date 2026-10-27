/** Model choices for setup. Discovery is best effort; fallback IDs stay usable offline. */
export interface ModelOption {
    id: string;
    label: string;
}
export declare function fallbackModels(provider: string): ModelOption[];
/** Read the official model catalog without exposing the key in URLs or errors. */
export declare function discoverModels(provider: string, apiKey?: string, signal?: AbortSignal): Promise<ModelOption[]>;
