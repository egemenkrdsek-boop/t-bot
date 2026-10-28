import { fetchPublicText, validatePublicUrl } from './public-network.js';
export { isPrivateOrLocalHost, validatePublicUrl } from './public-network.js';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
function decodeHtmlEntities(text) {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&mdash;/g, '—')
        .replace(/&ndash;/g, '–')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}
function stripTags(html) {
    return decodeHtmlEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}
/**
 * Cleanly unwrap DuckDuckGo redirection link if needed.
 */
function unwrapDuckDuckGoUrl(href) {
    try {
        if (href.startsWith('//')) {
            href = 'https:' + href;
        }
        const parsed = new URL(href, 'https://duckduckgo.com');
        const uddg = parsed.searchParams.get('uddg');
        if (uddg) {
            return decodeURIComponent(uddg);
        }
        return parsed.href;
    }
    catch {
        return href;
    }
}
/**
 * Query DuckDuckGo HTML search.
 */
async function searchDuckDuckGo(query, maxResults, signal) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const timeoutSignal = AbortSignal.timeout(12000);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const response = await fetchPublicText(url, {
        headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9,tr;q=0.8',
        },
        signal: combinedSignal,
    });
    if (response.status < 200 || response.status >= 300) {
        return [];
    }
    const html = response.body;
    const results = [];
    // Match result blocks in DuckDuckGo HTML
    // Result link: <a class="result__a" href="...">title</a>
    // Snippet: <a class="result__snippet" ...>snippet</a> or <div class="result__snippet">...</div>
    const linkRegex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRegex = /<(?:a|div)[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/gi;
    const links = [];
    let linkMatch;
    while ((linkMatch = linkRegex.exec(html)) !== null) {
        const rawHref = linkMatch[1];
        const rawTitle = linkMatch[2];
        links.push({
            href: unwrapDuckDuckGoUrl(rawHref),
            title: stripTags(rawTitle),
        });
        if (links.length >= maxResults)
            break;
    }
    const snippets = [];
    let snippetMatch;
    while ((snippetMatch = snippetRegex.exec(html)) !== null) {
        snippets.push(stripTags(snippetMatch[1]));
        if (snippets.length >= maxResults)
            break;
    }
    for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const snippet = snippets[i] || '(Açıklama bulunamadı)';
        if (link.href && link.title) {
            results.push({
                title: link.title,
                url: link.href,
                snippet,
            });
        }
    }
    return results;
}
/**
 * Fallback to Wikipedia Opensearch API.
 */
async function searchWikipedia(query, maxResults, signal) {
    const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=${maxResults}&namespace=0&format=json`;
    const timeoutSignal = AbortSignal.timeout(8000);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try {
        const response = await fetchPublicText(url, {
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
            signal: combinedSignal,
        });
        if (response.status < 200 || response.status >= 300)
            return [];
        const data = JSON.parse(response.body);
        if (!Array.isArray(data) || data.length < 4)
            return [];
        const titles = Array.isArray(data[1]) ? data[1] : [];
        const snippets = Array.isArray(data[2]) ? data[2] : [];
        const urls = Array.isArray(data[3]) ? data[3] : [];
        const results = [];
        for (let i = 0; i < titles.length && results.length < maxResults; i++) {
            if (titles[i] && urls[i]) {
                results.push({
                    title: String(titles[i]),
                    url: String(urls[i]),
                    snippet: String(snippets[i] || 'Wikipedia maddesi.'),
                });
            }
        }
        return results;
    }
    catch {
        return [];
    }
}
/**
 * Fallback to NPM Registry search API for dev/package queries.
 */
async function searchNpm(query, maxResults, signal) {
    const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${maxResults}`;
    const timeoutSignal = AbortSignal.timeout(8000);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try {
        const response = await fetchPublicText(url, {
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
            signal: combinedSignal,
        });
        if (response.status < 200 || response.status >= 300)
            return [];
        const data = JSON.parse(response.body);
        if (!data || !Array.isArray(data.objects))
            return [];
        const results = [];
        for (const obj of data.objects) {
            if (obj.package?.name) {
                results.push({
                    title: `NPM: ${obj.package.name}`,
                    url: obj.package.links?.npm || `https://www.npmjs.com/package/${obj.package.name}`,
                    snippet: obj.package.description || 'NPM paketi.',
                });
            }
            if (results.length >= maxResults)
                break;
        }
        return results;
    }
    catch {
        return [];
    }
}
/**
 * Performs a web search with parallel/fallback strategy across DuckDuckGo, Wikipedia, and NPM.
 */
export async function performWebSearch(query, maxResults = 6, signal) {
    const limit = Math.max(1, Math.min(12, Number(maxResults) || 6));
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
        throw new Error('query parametresi boş olamaz.');
    }
    // Try DuckDuckGo first
    let results = [];
    try {
        results = await searchDuckDuckGo(trimmedQuery, limit, signal);
    }
    catch {
        results = [];
    }
    // If DuckDuckGo returned insufficient results, try Wikipedia and NPM in parallel
    if (results.length < limit) {
        const [wikiResults, npmResults] = await Promise.all([
            searchWikipedia(trimmedQuery, limit - results.length, signal),
            searchNpm(trimmedQuery, limit - results.length, signal),
        ]);
        const seenUrls = new Set(results.map(r => r.url));
        for (const item of [...wikiResults, ...npmResults]) {
            if (!seenUrls.has(item.url) && results.length < limit) {
                seenUrls.add(item.url);
                results.push(item);
            }
        }
    }
    if (results.length === 0) {
        return `"${trimmedQuery}" araması için sonuç bulunamadı. Lütfen sorguyu farklı kelimelerle tekrar deneyin.`;
    }
    const lines = [`Web Arama Sonuçları ("${trimmedQuery}"):`, ''];
    results.slice(0, limit).forEach((r, idx) => {
        lines.push(`${idx + 1}. [${r.title}](${r.url})`);
        lines.push(`   ${r.snippet}`);
        lines.push('');
    });
    return lines.join('\n').trim();
}
/**
 * Converts raw HTML into readable, clean Markdown text.
 */
export function htmlToCleanMarkdown(html) {
    if (!html)
        return '';
    let text = html;
    // 1. Remove unwanted noisy elements and scripts
    text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    text = text.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');
    text = text.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '');
    text = text.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '');
    text = text.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '');
    text = text.replace(/<head\b[^<]*(?:(?!<\/head>)<[^<]*)*<\/head>/gi, '');
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    // 2. Headings
    text = text.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_, c) => `\n\n# ${stripTags(c)}\n\n`);
    text = text.replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_, c) => `\n\n## ${stripTags(c)}\n\n`);
    text = text.replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_, c) => `\n\n### ${stripTags(c)}\n\n`);
    text = text.replace(/<h[4-6]\b[^>]*>([\s\S]*?)<\/h[4-6]>/gi, (_, c) => `\n\n#### ${stripTags(c)}\n\n`);
    // 3. Code blocks and inline code
    text = text.replace(/<pre\b[^>]*><code\b[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, c) => `\n\n\`\`\`\n${decodeHtmlEntities(c.replace(/<[^>]+>/g, '')).trim()}\n\`\`\`\n\n`);
    text = text.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => `\n\n\`\`\`\n${decodeHtmlEntities(c.replace(/<[^>]+>/g, '')).trim()}\n\`\`\`\n\n`);
    text = text.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, c) => ` \`${stripTags(c)}\` `);
    // 4. Links
    text = text.replace(/<a\b[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, content) => {
        const label = stripTags(content);
        if (!label)
            return '';
        return ` [${label}](${href.trim()}) `;
    });
    // 5. Lists and list items
    text = text.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, c) => `\n- ${stripTags(c)}`);
    // 6. Block elements and line breaks
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/p>/gi, '\n\n');
    text = text.replace(/<\/tr>/gi, '\n');
    text = text.replace(/<\/div>/gi, '\n');
    text = text.replace(/<\/article>/gi, '\n\n');
    text = text.replace(/<\/section>/gi, '\n\n');
    // 7. Strip any remaining tags
    text = text.replace(/<[^>]+>/g, '');
    // 8. Decode entities and normalize whitespace
    text = decodeHtmlEntities(text);
    const lines = text.split('\n').map(l => l.trimEnd());
    const cleanLines = [];
    let blankCount = 0;
    for (const line of lines) {
        if (!line.trim()) {
            if (++blankCount <= 2) {
                cleanLines.push('');
            }
        }
        else {
            blankCount = 0;
            cleanLines.push(line);
        }
    }
    return cleanLines.join('\n').trim();
}
/**
 * Downloads a web page or API endpoint, formatting JSON or converting HTML to clean Markdown.
 */
export async function fetchUrlContent(rawUrl, maxChars = 12000, signal) {
    const urlObj = validatePublicUrl(rawUrl);
    const limit = Math.max(100, Math.min(100000, Number(maxChars) || 12000));
    const timeoutSignal = AbortSignal.timeout(12000);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const response = await fetchPublicText(urlObj.toString(), {
        headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8',
        },
        signal: combinedSignal,
    });
    if (response.status < 200 || response.status >= 300) {
        throw new Error(`URL indirme başarısız oldu (HTTP ${response.status}: ${response.statusText}): ${rawUrl}`);
    }
    const contentType = response.contentType.toLowerCase();
    const rawBody = response.body;
    let formatted = '';
    if (contentType.includes('application/json') || rawBody.trimStart().startsWith('{') || rawBody.trimStart().startsWith('[')) {
        try {
            const parsed = JSON.parse(rawBody);
            formatted = JSON.stringify(parsed, null, 2);
        }
        catch {
            formatted = rawBody;
        }
    }
    else if (contentType.includes('text/html') || /<html\b|<body\b|<div\b/i.test(rawBody)) {
        formatted = htmlToCleanMarkdown(rawBody);
    }
    else {
        formatted = rawBody.trim();
    }
    if (formatted.length > limit) {
        return `${formatted.slice(0, limit)}\n\n[... Çıktı ${formatted.length} karakterden ${limit} karakter sınırına budandı]`;
    }
    return formatted || '(İçerik boş)';
}
export const WEB_TOOLS = [
    {
        name: 'web_search',
        description: 'Search the public web using DuckDuckGo, Wikipedia, and NPM open APIs without an API key. Returns clean titles, URLs, and snippets. SSRF protected.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'The search query or keywords.' },
                max_results: { type: 'integer', minimum: 1, maximum: 12, description: 'Maximum number of results to return (default 6, max 12).' },
            },
            required: ['query'],
            additionalProperties: false,
        },
    },
    {
        name: 'url_fetch',
        description: 'Fetch and extract readable content from a public URL. Automatically converts HTML to clean Markdown and pretty-prints JSON. SSRF protected.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'The public HTTP/HTTPS URL to download.' },
                max_chars: { type: 'integer', minimum: 100, maximum: 100000, description: 'Maximum characters of text to return (default 12000).' },
            },
            required: ['url'],
            additionalProperties: false,
        },
    },
];
export async function executeWebTool(name, args, signal) {
    if (name === 'web_search') {
        const query = String(args.query || args.q || '').trim();
        const maxResults = typeof args.max_results === 'number' ? args.max_results : 6;
        return await performWebSearch(query, maxResults, signal);
    }
    if (name === 'url_fetch') {
        const targetUrl = String(args.url || args.target_url || '').trim();
        const maxChars = typeof args.max_chars === 'number' ? args.max_chars : 12000;
        return await fetchUrlContent(targetUrl, maxChars, signal);
    }
    throw new Error(`Bilinmeyen web aracı: ${name}`);
}
//# sourceMappingURL=web.js.map