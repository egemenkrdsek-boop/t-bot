import http from 'node:http';
export { isPrivateOrLocalHost } from '../security/url.js';
export declare function validatePublicUrl(raw: string): URL;
/** The actual socket lookup validates every answer and pins the chosen address.
 * No preflight-DNS / later-fetch lookup gap is allowed. */
export declare const publicLookup: NonNullable<http.RequestOptions['lookup']>;
export interface PublicTextResponse {
    status: number;
    statusText: string;
    contentType: string;
    body: string;
    url: string;
}
/** Bounded public HTTP transport. Every redirect gets a new URL and socket check. */
export declare function fetchPublicText(raw: string, options?: {
    signal?: AbortSignal;
    headers?: Record<string, string>;
    maxBytes?: number;
}): Promise<PublicTextResponse>;
