import dns from 'node:dns';
import { isIP } from 'node:net';

/** Additional host names that must never be reachable from public-web tools. */
const METADATA_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'metadata',
]);

/**
 * Public-web tools cannot reach local services, including through DNS or
 * IPv4-mapped IPv6. Only global unicast IPv6 (2000::/3) is accepted.
 */
export function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host === 'ip6-localhost' || host === 'ip6-loopback' || METADATA_HOSTS.has(host)) return true;
  const family = isIP(host);
  if (family === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19));
  }
  if (family === 6) {
    // Only global unicast 2000::/3 is accepted. This also excludes mapped,
    // compatible, unique-local, multicast, link-local and translation addresses.
    const canonical = new URL(`http://[${host}]/`).hostname.slice(1, -1);
    const first = parseInt(canonical.split(':')[0], 16);
    // Block transition mechanisms which may encode otherwise prohibited IPv4.
    return !(first >= 0x2000 && first <= 0x3fff) || canonical.startsWith('2002:') ||
      canonical.startsWith('2001:0:') || canonical.startsWith('2001::') || canonical.startsWith('2001:db8:');
  }
  return /^\d+$|^0x[0-9a-f]+$/i.test(host);
}

/** Loopback only; `allowLocal` never unlocks private LAN or metadata ranges. */
export function isLoopback(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === 'ip6-localhost' || host === 'ip6-loopback') return true;
  if (isIP(host) === 4) return host.startsWith('127.');
  if (isIP(host) === 6) return host === '::1';
  return false;
}

function lookupAll(hostname: string): Promise<Array<{ address: string; family: number }>> {
  return new Promise((resolvePromise, reject) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) reject(new Error(`[SSRF protection] Unable to resolve host: ${hostname}`));
      else resolvePromise(addresses as Array<{ address: string; family: number }>);
    });
  });
}

export interface PublicUrlOptions {
  /** Explicitly allow loopback targets (for example a local dev server). */
  allowLocal?: boolean;
}

/**
 * Validate a URL for a public-web request. Rejects non-HTTP(S) schemes,
 * embedded credentials, private/local/metadata hosts and any host name that
 * resolves (via DNS) to a private or local address.
 */
export async function assertPublicHttpUrl(raw: string, options: PublicUrlOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`[SSRF protection] Invalid URL: ${String(raw).slice(0, 200)}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('[SSRF protection] Only public HTTP(S) URLs are allowed');
  }
  if (url.username || url.password) {
    throw new Error('[SSRF protection] URLs with embedded credentials are not allowed');
  }
  const allowLocal = options.allowLocal === true;
  const host = url.hostname.replace(/^\[|\]$/g, '');

  if (isPrivateOrLocalHost(host)) {
    if (allowLocal && isLoopback(host)) return url;
    throw new Error(`[SSRF protection] Blocked private or local host: ${host}`);
  }

  // Public IP literals need no DNS; host names are resolved and every answer checked.
  if (isIP(host) === 0) {
    const addresses = await lookupAll(host);
    if (!addresses.length) throw new Error(`[SSRF protection] Host did not resolve: ${host}`);
    for (const { address } of addresses) {
      if (isPrivateOrLocalHost(address) && !(allowLocal && isLoopback(address))) {
        throw new Error(`[SSRF protection] Host resolves to a private or local address: ${address}`);
      }
    }
  }
  return url;
}
