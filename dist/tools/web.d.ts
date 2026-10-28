import type { ToolDefinition } from '../types.js';
/**
 * SSRF Protection: Checks if a hostname resolves to a local or private network address.
 * Blocks localhost, 127.0.0.1, 169.254.169.254, 10.x, 192.168.x, 172.16-31.x, IPv6 loopback/link-local.
 */
export declare function isPrivateOrLocalHost(hostname: string): boolean;
/**
 * Validates and ensures an HTTP/HTTPS URL does not target private or loopback networks.
 */
export declare function validatePublicUrl(rawUrl: string): URL;
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
