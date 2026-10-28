/**
 * Public-web tools cannot reach local services, including through DNS or
 * IPv4-mapped IPv6. Only global unicast IPv6 (2000::/3) is accepted.
 */
export declare function isPrivateOrLocalHost(hostname: string): boolean;
/** Loopback only; `allowLocal` never unlocks private LAN or metadata ranges. */
export declare function isLoopback(hostname: string): boolean;
export interface PublicUrlOptions {
    /** Explicitly allow loopback targets (for example a local dev server). */
    allowLocal?: boolean;
}
/**
 * Validate a URL for a public-web request. Rejects non-HTTP(S) schemes,
 * embedded credentials, private/local/metadata hosts and any host name that
 * resolves (via DNS) to a private or local address.
 */
export declare function assertPublicHttpUrl(raw: string, options?: PublicUrlOptions): Promise<URL>;
