import type { ToolDefinition } from '../types.js';
export { isPrivateOrLocalHost, validatePublicUrl } from './public-network.js';
export interface SearchResultItem {
    title: string;
    url: string;
    snippet: string;
}
/**
 * Performs a web search with parallel/fallback strategy across DuckDuckGo, Wikipedia, and NPM.
 */
export declare function performWebSearch(query: string, maxResults?: number, signal?: AbortSignal): Promise<string>;
/**
 * Converts raw HTML into readable, clean Markdown text.
 */
export declare function htmlToCleanMarkdown(html: string): string;
/**
 * Downloads a web page or API endpoint, formatting JSON or converting HTML to clean Markdown.
 */
export declare function fetchUrlContent(rawUrl: string, maxChars?: number, signal?: AbortSignal): Promise<string>;
export declare const WEB_TOOLS: ToolDefinition[];
export declare function executeWebTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string>;
