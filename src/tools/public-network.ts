import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

/** Public-web tools cannot reach local services, including through DNS or IPv4-mapped IPv6. */
export function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host === 'ip6-localhost' || host === 'ip6-loopback' || host === 'metadata.google.internal') return true;
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

export function validatePublicUrl(raw: string): URL {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Only public HTTP(S) URLs without embedded credentials are allowed');
  }
  if (isPrivateOrLocalHost(url.hostname)) throw new Error(`[SSRF protection] Blocked private or local host: ${url.hostname}`);
  return url;
}

/** The actual socket lookup validates every answer and pins the chosen address.
 * No preflight-DNS / later-fetch lookup gap is allowed. */
export const publicLookup: NonNullable<http.RequestOptions['lookup']> = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error, '', 4);
    if (!addresses.length || addresses.some(({ address }) => isPrivateOrLocalHost(address))) {
      return callback(new Error('[SSRF protection] DNS resolved to a private or local address'), '', 4);
    }
    const family = typeof options === 'number' ? options : options.family;
    const selected = addresses.find(address => !family || address.family === Number(family));
    if (!selected) return callback(new Error('No matching public IP address'), '', 4);
    if (typeof options === 'object' && options.all) callback(null, [selected] as any);
    else callback(null, selected.address, selected.family);
  });
};

export interface PublicTextResponse { status: number; statusText: string; contentType: string; body: string; url: string }

/** Bounded public HTTP transport. Every redirect gets a new URL and socket check. */
export async function fetchPublicText(raw: string, options: {
  signal?: AbortSignal; headers?: Record<string, string>; maxBytes?: number;
} = {}): Promise<PublicTextResponse> {
  let url = validatePublicUrl(raw);
  const timeout = AbortSignal.timeout(12_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const maxBytes = options.maxBytes ?? 2_000_000;
  for (let redirects = 0; ; redirects++) {
    signal.throwIfAborted();
    const response = await new Promise<PublicTextResponse & { location?: string }>((resolve, reject) => {
      const transport = url.protocol === 'https:' ? https : http;
      const request = transport.request(url, {
        method: 'GET', headers: { ...options.headers, 'Accept-Encoding': 'identity' },
        lookup: publicLookup, agent: false, signal,
      }, incoming => {
        const status = incoming.statusCode ?? 0;
        const location = incoming.headers.location;
        if ([301, 302, 303, 307, 308].includes(status) && location) {
          incoming.destroy();
          resolve({ status, statusText: incoming.statusMessage ?? '', contentType: '', body: '', url: url.href, location });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        incoming.on('error', reject);
        incoming.on('aborted', () => reject(new Error('Public response ended prematurely')));
        incoming.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            const error = new Error(`Public response exceeds ${maxBytes} bytes`);
            incoming.destroy(error);
            request.destroy(error);
            reject(error);
          } else chunks.push(chunk);
        });
        incoming.on('end', () => resolve({ status, statusText: incoming.statusMessage ?? '',
          contentType: String(incoming.headers['content-type'] ?? ''),
          body: Buffer.concat(chunks).toString('utf8'), url: url.href }));
      });
      request.on('error', reject);
      request.end();
    });
    if (!response.location) return response;
    if (redirects >= 5) throw new Error('Too many public URL redirects');
    url = validatePublicUrl(new URL(response.location, url).href);
  }
}
