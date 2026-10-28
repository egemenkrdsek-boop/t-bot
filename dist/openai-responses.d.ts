import type { Provider } from './types.js';
import { type EffortLevel } from './effort.js';
interface Config {
    model: string;
    apiKey: string;
    effort?: EffortLevel;
    timeoutMs?: number;
    fallbackModel?: string;
    onFallback?: (info: {
        provider: string;
        from: string;
        to: string;
        status: number;
    }) => void;
}
/** Stateless Responses API adapter for models that require it for function calls. */
export declare function createOpenAIResponsesProvider(config: Config): Provider;
export {};
