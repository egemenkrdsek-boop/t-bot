import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { assertPublicHttpUrl, isPrivateOrLocalHost } from '../security/url.js';

export { isPrivateOrLocalHost } from '../security/url.js';

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
  let url = await assertPublicHttpUrl(raw);
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
    url = await assertPublicHttpUrl(new URL(response.location, url).href);
  }
}
