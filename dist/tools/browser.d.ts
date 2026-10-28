import type { ToolDefinition } from '../types.js';
export interface FallbackElementMeta {
    role: string;
    text: string;
    ariaLabel: string;
    name: string;
    tag: string;
    href: string;
    cssPath: string;
    placeholder: string;
}
export declare const lastElementMap: Map<string, FallbackElementMeta>;
export interface DialogRecord {
    type: string;
    message: string;
    timestamp: number;
}
export declare const lastDialogHistory: DialogRecord[];
export declare function resetIdleTimer(): void;
export declare function closeIdleBrowser(idleThresholdMs?: number): Promise<void>;
export declare const browserToolDefinitions: ToolDefinition[];
export declare function updateLiveBrowserHud(page: any, stepText: string): Promise<void>;
export declare function checkUserAborted(page: any): Promise<void>;
export declare function highlightElementSpotlight(page: any, locator: any, ref?: string): Promise<void>;
export interface InspectedElement {
    ref: string;
    selector: string;
    tag: string;
    role: string;
    ariaLabel: string;
    name: string;
    placeholder: string;
    href: string;
    cssPath: string;
    text: string;
    label: string;
    type?: string;
    inViewport: boolean;
}
export declare function inspectPageElements(page: any, maxChars?: number): Promise<{
    text: string;
    items: InspectedElement[];
}>;
export declare function captureAnnotatedScreenshotAndElements(page: any, workspace: string): Promise<{
    screenshotPath: string;
    title: string;
    url: string;
    elementSummary: string;
}>;
export declare function ensureBrowser(options?: {
    headless?: boolean;
}): Promise<any>;
export declare function safeUrl(raw: string): string;
export declare function closeBrowser(): Promise<void>;
/**
 * Resilient element resolver with SPA stale reference recovery.
 * Resolves by ref attribute, and falls back to semantic metadata (aria-label, name, text, cssPath).
 */
export declare function resolveElementLocator(page: any, rawSelectorOrRef: string): Promise<{
    locator: any;
    ref: string;
}>;
export declare function handleBrowserTool(name: string, args: Record<string, unknown>, options: {
    workspace: string;
    signal?: AbortSignal;
}): Promise<string>;
export declare const executeBrowserTool: typeof handleBrowserTool;
