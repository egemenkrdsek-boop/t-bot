import { describeEffort } from './effort.js';
import { createOpenAIResponsesProvider } from './openai-responses.js';
export const PROVIDER_CATALOG = [
    { id: 'gemini', label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', requiresApiKey: true },
    { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', requiresApiKey: true },
    { id: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', requiresApiKey: true },
    { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', requiresApiKey: true },
    { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', requiresApiKey: true },
    { id: 'together', label: 'Together AI', baseUrl: 'https://api.together.xyz/v1', requiresApiKey: true },
    { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', requiresApiKey: true },
    { id: 'xai', label: 'xAI', baseUrl: 'https://api.x.ai/v1', requiresApiKey: true },
    { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', requiresApiKey: true },
    { id: 'fireworks', label: 'Fireworks', baseUrl: 'https://api.fireworks.ai/inference/v1', requiresApiKey: true },
    { id: 'cerebras', label: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', requiresApiKey: true },
    { id: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434/v1', requiresApiKey: false },
    { id: 'lmstudio', label: 'LM Studio', baseUrl: 'http://localhost:1234/v1', requiresApiKey: false },
    { id: 'custom', label: 'Custom OpenAI compatible', baseUrl: '', requiresApiKey: false },
];
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 10_000;
function isRetryableStatus(status) {
    return status === 408 || status === 429 || (status >= 500 && status <= 599);
}
/** Parse Retry-After as seconds or an HTTP date; returns milliseconds. */
export function parseRetryAfter(value) {
    if (!value)
        return undefined;
    const trimmed = value.trim();
    if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
        const ms = Number(trimmed) * 1000;
        return Number.isFinite(ms) ? Math.max(0, ms) : undefined;
    }
    const at = Date.parse(trimmed);
    return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}
function retryDelayMs(attempt, base, max, retryAfter) {
    // A server-provided delay wins, but remains bounded so a hostile or buggy
    // Retry-After cannot stall the turn indefinitely.
    if (retryAfter !== undefined)
        return Math.min(max, retryAfter);
    const exponential = Math.min(max, base * 2 ** attempt);
    const jitter = Math.random() * Math.min(250, exponential / 2);
    return Math.min(max, exponential + jitter);
}
function sleep(ms, signal) {
    if (ms <= 0)
        return Promise.resolve();
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
            return;
        }
        let timer;
        const finish = (error) => {
            if (timer)
                clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            if (error === undefined)
                resolve();
            else
                reject(error);
        };
        const onAbort = () => finish(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
        timer = setTimeout(() => finish(), ms);
        signal?.addEventListener('abort', onAbort, { once: true });
        // Re-check after subscribing: an abort may race with the listener setup.
        if (signal?.aborted)
            finish(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    });
}
/**
 * Fetch with a bounded retry for 408/429/5xx and network failures. Retries
 * stop when the caller aborts or the request timeout fires. Once a response
 * body starts streaming the caller never re-issues the request.
 */
export async function fetchWithRetry(input, init = {}, options = {}) {
    const maxRetries = Math.max(0, Math.min(5, Math.floor(options.maxRetries ?? 2)));
    const base = Math.max(0, options.baseDelayMs ?? RETRY_BASE_DELAY_MS);
    const max = Math.max(base, options.maxDelayMs ?? RETRY_MAX_DELAY_MS);
    const signal = options.signal ?? init.signal ?? undefined;
    let attempt = 0;
    for (;;) {
        signal?.throwIfAborted();
        let response;
        try {
            response = await fetch(input, init);
        }
        catch (error) {
            if (signal?.aborted || attempt >= maxRetries)
                throw error;
            await sleep(retryDelayMs(attempt, base, max), signal);
            attempt++;
            continue;
        }
        if (response.ok || !isRetryableStatus(response.status))
            return response;
        if (attempt >= maxRetries)
            return response;
        // Release the failed body before reusing the connection.
        await response.body?.cancel().catch(() => { });
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
        await sleep(retryDelayMs(attempt, base, max, retryAfter), signal);
        attempt++;
    }
}
function outputTokenLimit(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}
function safeUrl(value) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new Error('Sağlayıcı uç noktası geçersiz. Geçerli bir HTTPS veya localhost URL\'si yapılandırın.');
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash)
        throw new Error('Uç nokta HTTPS (veya localhost üzerinde HTTP) kullanmalı; kimlik bilgisi, sorgu parametresi veya parça içermemelidir.');
    return url;
}
function endpoint(base, path) { const url = safeUrl(base); url.pathname = `${url.pathname.replace(/\/$/, '')}/${path}`; return url.toString(); }
function objectArgs(raw) {
    const value = JSON.parse(raw || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Araç argümanları bir JSON nesnesi olmalıdır.');
    }
    return value;
}
/**
 * Deterministic JSON Repair Engine for LLM tool call arguments.
 * Repairs markdown code blocks, unescaped newlines/tabs inside string literals,
 * trailing commas before closing braces/brackets, and unclosed quotes/brackets/braces.
 * Compatibility utility only: executable streamed calls must use strict JSON parsing.
 */
export function repairJsonArgs(raw) {
    if (!raw || !raw.trim())
        return {};
    let cleaned = raw.trim();
    // 1. Clean leading/trailing markdown code fences (```json ... ``` or ``` ... ```)
    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    }
    // If there is preamble text before the first '{', slice from the first '{'
    const firstBrace = cleaned.indexOf('{');
    if (firstBrace !== -1) {
        cleaned = cleaned.slice(firstBrace);
    }
    // 2. Character-by-character state machine for string literals:
    // Escapes unescaped newlines (\n, \r) and tabs (\t) into \n, \r, \t.
    // Also detects and closes unclosed string literals at EOF.
    let inString = false;
    let escaped = false;
    let pass1 = '';
    for (let i = 0; i < cleaned.length; i++) {
        const ch = cleaned[i];
        if (inString) {
            if (escaped) {
                pass1 += ch;
                escaped = false;
            }
            else if (ch === '\\') {
                pass1 += ch;
                escaped = true;
            }
            else if (ch === '"') {
                inString = false;
                pass1 += ch;
            }
            else if (ch === '\n') {
                pass1 += '\\n';
            }
            else if (ch === '\r') {
                pass1 += '\\r';
            }
            else if (ch === '\t') {
                pass1 += '\\t';
            }
            else {
                pass1 += ch;
            }
        }
        else {
            if (ch === '"') {
                inString = true;
            }
            pass1 += ch;
        }
    }
    if (inString) {
        if (escaped)
            pass1 += '\\';
        pass1 += '"';
    }
    // 3. Remove trailing commas before closing braces/brackets (, } -> }, , ] -> ])
    // and 4. Stack tracking for auto-closing unclosed brackets/braces
    let inStr = false;
    let esc = false;
    const stack = [];
    let pass2 = '';
    for (let i = 0; i < pass1.length; i++) {
        const ch = pass1[i];
        if (inStr) {
            pass2 += ch;
            if (esc) {
                esc = false;
            }
            else if (ch === '\\') {
                esc = true;
            }
            else if (ch === '"') {
                inStr = false;
            }
        }
        else {
            if (ch === '"') {
                inStr = true;
                pass2 += ch;
            }
            else if (ch === '{') {
                stack.push('}');
                pass2 += ch;
            }
            else if (ch === '[') {
                stack.push(']');
                pass2 += ch;
            }
            else if (ch === '}') {
                if (stack.length > 0 && stack[stack.length - 1] === '}') {
                    stack.pop();
                }
                pass2 += ch;
            }
            else if (ch === ']') {
                if (stack.length > 0 && stack[stack.length - 1] === ']') {
                    stack.pop();
                }
                pass2 += ch;
            }
            else if (ch === ',') {
                // Look ahead: skip whitespace to check if followed by '}' or ']'
                let j = i + 1;
                while (j < pass1.length && /\s/.test(pass1[j])) {
                    j++;
                }
                if (j < pass1.length && (pass1[j] === '}' || pass1[j] === ']')) {
                    continue; // omit trailing comma
                }
                pass2 += ch;
            }
            else {
                pass2 += ch;
            }
        }
    }
    if (inStr) {
        if (esc)
            pass2 += '\\';
        pass2 += '"';
    }
    // Remove any trailing comma at the end of input before closing stack braces
    let trimmed = pass2.trimEnd();
    while (trimmed.endsWith(',')) {
        trimmed = trimmed.slice(0, -1).trimEnd();
    }
    // Close remaining open brackets and braces in LIFO order
    while (stack.length > 0) {
        trimmed += stack.pop();
    }
    try {
        const parsed = JSON.parse(trimmed || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Araç argümanları bir JSON nesnesi olmalıdır.');
        }
        return parsed;
    }
    catch {
        throw new Error('Araç argümanları bir JSON nesnesi olmalıdır.');
    }
}
export async function* sse(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let data = [];
    let frameSize = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            let match;
            while ((match = /\r\n|\r|\n/.exec(buffer))) {
                // A CR at a chunk boundary may be the first half of CRLF.
                if (!done && match[0] === '\r' && match.index === buffer.length - 1)
                    break;
                const line = buffer.slice(0, match.index);
                buffer = buffer.slice(match.index + match[0].length);
                frameSize += line.length + match[0].length;
                if (frameSize > 4_000_000)
                    throw new Error('Sağlayıcı akış çerçevesi çok büyük.');
                if (!line) {
                    if (data.length)
                        yield data.join('\n');
                    data = [];
                    frameSize = 0;
                }
                else if (line.startsWith('data:'))
                    data.push(line.slice(5).replace(/^ /, ''));
            }
            if (frameSize + buffer.length > 4_000_000)
                throw new Error('Sağlayıcı akış çerçevesi çok büyük.');
            // An unterminated SSE event is discarded on EOF, per the event-stream protocol.
            if (done)
                break;
        }
    }
    finally {
        await reader.cancel().catch(() => { });
        reader.releaseLock();
    }
}
function imageParts(m) {
    return (m.images ?? []).map(image => ({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } }));
}
function openaiMessages(messages, enableSystemCacheControl = false) {
    const result = [];
    let pendingImages = [];
    const flush = () => { if (pendingImages.length) {
        result.push({ role: 'user', content: [{ type: 'text', text: 'Images returned by the preceding tools:' }, ...pendingImages] });
        pendingImages = [];
    } };
    for (const m of messages) {
        if (m.role !== 'tool')
            flush();
        if (m.role === 'tool')
            pendingImages.push(...imageParts(m));
        if (m.role === 'system' && enableSystemCacheControl && m.content) {
            result.push({
                role: 'system',
                content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }],
            });
            continue;
        }
        const parts = m.role === 'user' ? imageParts(m) : [];
        result.push({ role: m.role, content: parts.length ? [{ type: 'text', text: m.content }, ...parts] : m.content || (m.toolCalls?.length ? null : ''), ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}), ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) } : {}) });
    }
    flush();
    return result;
}
function anthropicImages(m) { return (m.images ?? []).map(image => ({ type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } })); }
function geminiImages(m) { return (m.images ?? []).map(image => ({ inlineData: { mimeType: image.mimeType, data: image.data } })); }
export function createProvider(config) {
    const spec = PROVIDER_CATALOG.find(p => p.id === config.id);
    if (!spec)
        throw new Error(`Bilinmeyen sağlayıcı: ${config.id}`);
    if (!config.model.trim())
        throw new Error('Bir model belirtilmelidir.');
    if (spec.requiresApiKey && !config.apiKey?.trim())
        throw new Error(`${spec.label} için bir API anahtarı gereklidir.`);
    // Only custom and local providers accept an override; a stale endpoint must not receive another provider's key.
    const base = (['custom', 'ollama', 'lmstudio'].includes(spec.id) ? config.baseUrl?.trim() : undefined) || spec.baseUrl;
    if (!base)
        throw new Error('Özel bir uç nokta gereklidir.');
    safeUrl(base);
    if (spec.id === 'openai' && /^gpt-6(?:\.1)?-(?:astra|sol|terra|luna)(?:-|$)/i.test(config.model))
        return createOpenAIResponsesProvider({ model: config.model, apiKey: config.apiKey, effort: config.effort, timeoutMs: config.timeoutMs, fallbackModel: config.fallbackModel, onFallback: config.onFallback });
    return { id: spec.id, label: spec.label, model: config.model, async *stream(messages, tools, options = {}) {
            const signal = AbortSignal.any([options.signal ?? new AbortController().signal, AbortSignal.timeout(config.timeoutMs ?? 120_000)]);
            const maxOutput = outputTokenLimit(options.maxOutputTokens);
            try {
                let url;
                let body;
                const headers = { 'content-type': 'application/json', accept: 'text/event-stream' };
                if (spec.id === 'anthropic') {
                    url = endpoint(base, 'messages');
                    headers['x-api-key'] = config.apiKey;
                    headers['anthropic-version'] = '2023-06-01';
                    headers['anthropic-beta'] = 'prompt-caching-2024-07-31';
                    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
                    const nonSystem = messages.filter(m => m.role !== 'system');
                    const anthropicMessages = [];
                    for (const m of nonSystem) {
                        if (m.role === 'tool') {
                            const toolResultBlocks = [{ type: 'text', text: m.content }, ...anthropicImages(m)];
                            const toolResultPart = {
                                type: 'tool_result',
                                tool_use_id: m.toolCallId,
                                content: toolResultBlocks,
                            };
                            const last = anthropicMessages[anthropicMessages.length - 1];
                            if (last && last.role === 'user' && Array.isArray(last.content)) {
                                last.content.push(toolResultPart);
                            }
                            else {
                                anthropicMessages.push({
                                    role: 'user',
                                    content: [toolResultPart],
                                });
                            }
                        }
                        else {
                            const blocks = [
                                ...(m.content ? [{ type: 'text', text: m.content }] : []),
                                ...anthropicImages(m),
                                ...(m.toolCalls ?? []).map(c => ({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments })),
                            ];
                            const role = m.role === 'assistant' ? 'assistant' : 'user';
                            const last = anthropicMessages[anthropicMessages.length - 1];
                            if (last && last.role === role && Array.isArray(last.content)) {
                                last.content.push(...blocks);
                            }
                            else {
                                anthropicMessages.push({ role, content: blocks });
                            }
                        }
                    }
                    // Cache target: en son user mesajının son içeriğine ephemeral cache ekle
                    for (let i = anthropicMessages.length - 1; i >= 0; i--) {
                        if (anthropicMessages[i].role === 'user' && Array.isArray(anthropicMessages[i].content) && anthropicMessages[i].content.length > 0) {
                            anthropicMessages[i].content[anthropicMessages[i].content.length - 1].cache_control = { type: 'ephemeral' };
                            break;
                        }
                    }
                    body = {
                        model: config.model,
                        max_tokens: maxOutput ?? 8192,
                        stream: true,
                        ...(system ? { system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] } : {}),
                        messages: anthropicMessages,
                        ...(tools.length ? {
                            tools: tools.map((t, idx) => ({
                                name: t.name,
                                description: t.description,
                                input_schema: t.parameters,
                                ...(idx === tools.length - 1 ? { cache_control: { type: 'ephemeral' } } : {})
                            }))
                        } : {})
                    };
                }
                else if (spec.id === 'gemini') {
                    url = endpoint(base, `models/${encodeURIComponent(config.model)}:streamGenerateContent`) + '?alt=sse';
                    headers['x-goog-api-key'] = config.apiKey;
                    const names = new Map(messages.flatMap(m => (m.toolCalls ?? []).map(c => [c.id, c.name])));
                    const geminiContents = [];
                    for (const m of messages.filter(msg => msg.role !== 'system')) {
                        if (m.role === 'tool') {
                            const toolName = names.get(m.toolCallId ?? '') ?? '';
                            const functionResponsePart = {
                                functionResponse: {
                                    name: toolName,
                                    response: { result: m.content },
                                },
                            };
                            const last = geminiContents[geminiContents.length - 1];
                            if (last && last.role === 'user' && Array.isArray(last.parts) && last.parts.every((p) => 'functionResponse' in p)) {
                                last.parts.push(functionResponsePart);
                            }
                            else {
                                geminiContents.push({
                                    role: 'user',
                                    parts: [functionResponsePart],
                                });
                            }
                            if (m.images?.length) {
                                geminiContents.push({
                                    role: 'user',
                                    parts: [
                                        { text: '[Canlı Ekran Görüntüsü - Ekrandaki öğeleri ve koordinatları inceleyerek odaklanın]' },
                                        ...geminiImages(m),
                                    ],
                                });
                            }
                        }
                        else if (m.role === 'assistant') {
                            const parts = [
                                ...(m.content ? [{ text: m.content }] : []),
                                ...(m.toolCalls ?? []).map(c => ({
                                    functionCall: { name: c.name, args: c.arguments },
                                    ...(c.thoughtSignature ? { thoughtSignature: c.thoughtSignature } : {}),
                                })),
                            ];
                            const last = geminiContents[geminiContents.length - 1];
                            if (last && last.role === 'model') {
                                last.parts.push(...parts);
                            }
                            else {
                                geminiContents.push({ role: 'model', parts });
                            }
                        }
                        else {
                            const parts = [
                                ...(m.content ? [{ text: m.content }] : []),
                                ...geminiImages(m),
                            ];
                            const last = geminiContents[geminiContents.length - 1];
                            if (last && last.role === 'user' && Array.isArray(last.parts) && !last.parts.some((p) => 'functionResponse' in p)) {
                                last.parts.push(...parts);
                            }
                            else {
                                geminiContents.push({ role: 'user', parts });
                            }
                        }
                    }
                    body = {
                        contents: geminiContents,
                        ...(messages.some(m => m.role === 'system')
                            ? { systemInstruction: { parts: [{ text: messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n') }] } }
                            : {}),
                        ...(tools.length
                            ? { tools: [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }] }
                            : {}),
                    };
                }
                else {
                    url = endpoint(base, 'chat/completions');
                    if (config.apiKey)
                        headers.authorization = `Bearer ${config.apiKey}`;
                    const enableOpenRouterCache = spec.id === 'openrouter' && /^(?:anthropic|google)\//i.test(config.model.trim());
                    body = { model: config.model, messages: openaiMessages(messages, enableOpenRouterCache), stream: true, stream_options: { include_usage: true }, ...(tools.length ? { tools: tools.map(t => ({ type: 'function', function: t })) } : {}) };
                    if (maxOutput) {
                        // OpenAI moved chat output caps to max_completion_tokens; compatible
                        // providers still use the classic max_tokens field.
                        if (spec.id === 'openai')
                            body.max_completion_tokens = maxOutput;
                        else
                            body.max_tokens = maxOutput;
                    }
                }
                const requestedEffort = options.effort ?? config.effort ?? 'medium';
                const applyEffort = (model) => {
                    const effort = describeEffort(spec.id, model, requestedEffort);
                    if (!effort.effective)
                        return;
                    if (spec.id === 'anthropic')
                        body.output_config = { effort: effort.effective };
                    else if (spec.id === 'gemini')
                        body.generationConfig = { ...(body.generationConfig ?? {}), thinkingConfig: { thinkingLevel: effort.effective } };
                    else if (spec.id === 'openrouter')
                        body.reasoning = { effort: effort.effective };
                    else if (spec.id === 'openai')
                        body.reasoning_effort = effort.effective;
                    else if (spec.id === 'deepseek')
                        body.reasoning_effort = effort.effective;
                };
                applyEffort(config.model);
                if (maxOutput && spec.id === 'gemini') {
                    body.generationConfig = { ...(body.generationConfig ?? {}), maxOutputTokens: maxOutput };
                }
                const fallbackModel = (config.fallbackModel?.trim() || process.env.TBOT_FALLBACK_MODEL?.trim() || '').trim();
                let activeModel = config.model;
                let response = await fetchWithRetry(url, { method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error' }, { signal });
                // HTTP 402 and model-level 404 are not retried (402 must never be retried:
                // the account has no credit). If a fallback model is configured, switch
                // exactly once; otherwise return an actionable provider/model error.
                if ((response.status === 402 || response.status === 404) && fallbackModel && fallbackModel !== config.model) {
                    const from = activeModel;
                    await response.body?.cancel().catch(() => { });
                    activeModel = fallbackModel;
                    if (spec.id === 'gemini')
                        url = endpoint(base, `models/${encodeURIComponent(activeModel)}:streamGenerateContent`) + '?alt=sse';
                    else
                        body.model = activeModel;
                    // Effort support is model-specific; clear fields written for the first model.
                    delete body.output_config;
                    delete body.reasoning;
                    delete body.reasoning_effort;
                    if (body.generationConfig)
                        delete body.generationConfig.thinkingConfig;
                    applyEffort(fallbackModel);
                    if (maxOutput && spec.id === 'gemini') {
                        body.generationConfig = { ...(body.generationConfig ?? {}), maxOutputTokens: maxOutput };
                    }
                    config.onFallback?.({ provider: spec.id, from, to: fallbackModel, status: response.status });
                    console.warn(`[sağlayıcı] ${spec.label}: ${from} -> ${fallbackModel} (HTTP ${response.status}).`);
                    response = await fetchWithRetry(url, { method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error' }, { signal });
                }
                if (response.status === 401) {
                    yield { type: 'error', code: 'authentication', error: `${spec.label} kimlik doğrulamayı kabul etmedi (HTTP 401). /auth üzerinden bu sağlayıcının API anahtarını kontrol edin; varsa sağlayıcıya özel ortam değişkeni veya TBOT_API_KEY kullanılan anahtarı etkileyebilir.` };
                    return;
                }
                if (response.status === 402) {
                    yield { type: 'error', error: `${spec.label} / ${activeModel}: kredi veya kota yetersiz (HTTP 402). /model ile başka bir model seçin veya sağlayıcı hesabınızın kredisini/kotasını kontrol edin.` };
                    return;
                }
                if (response.status === 404) {
                    yield { type: 'error', error: `${spec.label} / ${activeModel}: model bulunamadı veya bu hesap için erişilemiyor (HTTP 404). /model ile geçerli bir model seçin.` };
                    return;
                }
                if (!response.ok)
                    throw new Error(`Sağlayıcı isteği başarısız oldu (HTTP ${response.status}).`);
                if (!response.body)
                    throw new Error('Sağlayıcı Boş Yanıt Döndürdü.');
                const pending = new Map();
                const complete = [];
                let inputTokens;
                let outputTokens;
                let cachedTokens;
                let finished = false;
                let toolFinish = false;
                let truncated = false;
                for await (const payload of sse(response.body)) {
                    const chunk = payload === '[DONE]' ? { __done: true } : JSON.parse(payload);
                    if (chunk.error || chunk.type === 'error')
                        throw new Error('Sağlayıcı bir akış hatası bildirdi.');
                    if (spec.id === 'anthropic') {
                        if (chunk.type === 'content_block_start' && chunk.content_block?.type === 'tool_use')
                            pending.set(chunk.index, { id: chunk.content_block.id, name: chunk.content_block.name, args: '' });
                        if (chunk.type === 'content_block_delta') {
                            if (chunk.delta?.type === 'text_delta')
                                yield { type: 'text', text: chunk.delta.text };
                            if (chunk.delta?.type === 'input_json_delta') {
                                const call = pending.get(chunk.index);
                                if (call)
                                    call.args += chunk.delta.partial_json;
                            }
                        }
                        if (chunk.type === 'message_stop')
                            finished = true;
                        if (chunk.type === 'message_delta') {
                            if (chunk.delta?.stop_reason) {
                                toolFinish = chunk.delta.stop_reason === 'tool_use';
                                if (chunk.delta.stop_reason === 'max_tokens')
                                    truncated = true;
                            }
                        }
                        if (chunk.type === 'message_start') {
                            const usage = chunk.message?.usage;
                            inputTokens = typeof usage?.input_tokens === 'number'
                                ? usage.input_tokens + (typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0) +
                                    (typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0)
                                : undefined;
                            const cacheRead = chunk.message?.usage?.cache_read_input_tokens;
                            if (typeof cacheRead === 'number')
                                cachedTokens = cacheRead;
                        }
                        if (chunk.type === 'message_delta') {
                            outputTokens = chunk.usage?.output_tokens;
                            const cacheRead = chunk.usage?.cache_read_input_tokens;
                            if (typeof cacheRead === 'number')
                                cachedTokens = cacheRead;
                        }
                    }
                    else if (spec.id === 'gemini') {
                        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
                            if (typeof part.text === 'string')
                                yield { type: 'text', text: part.text };
                            if (part.functionCall) {
                                const args = part.functionCall.args ?? {};
                                if (!args || typeof args !== 'object' || Array.isArray(args))
                                    throw new Error('Araç argümanları bir JSON nesnesi olmalıdır.');
                                if (typeof part.functionCall.name !== 'string' || !part.functionCall.name)
                                    throw new Error('Eksik araç çağrısı alındı.');
                                complete.push({ id: `call_${crypto.randomUUID()}`, name: part.functionCall.name, arguments: args, ...(typeof part.thoughtSignature === 'string' ? { thoughtSignature: part.thoughtSignature } : {}) });
                            }
                        }
                        const geminiFinish = chunk.candidates?.[0]?.finishReason;
                        if (geminiFinish === 'STOP') {
                            finished = true;
                            toolFinish = true;
                        }
                        if (geminiFinish === 'MAX_TOKENS')
                            truncated = true;
                        inputTokens = chunk.usageMetadata?.promptTokenCount ?? inputTokens;
                        outputTokens = chunk.usageMetadata?.candidatesTokenCount ?? outputTokens;
                        if (typeof chunk.usageMetadata?.cachedContentTokenCount === 'number') {
                            cachedTokens = chunk.usageMetadata.cachedContentTokenCount;
                        }
                    }
                    else {
                        if (chunk.__done)
                            finished = true;
                        const chatFinish = chunk.choices?.[0]?.finish_reason;
                        if (chatFinish) {
                            toolFinish = ['tool_calls', 'stop'].includes(chatFinish);
                            if (chatFinish === 'length')
                                truncated = true;
                        }
                        const delta = chunk.choices?.[0]?.delta;
                        if (typeof delta?.content === 'string')
                            yield { type: 'text', text: delta.content };
                        for (const part of delta?.tool_calls ?? []) {
                            const current = pending.get(part.index) ?? { id: '', name: '', args: '' };
                            current.id += part.id ?? '';
                            current.name += part.function?.name ?? '';
                            current.args += part.function?.arguments ?? '';
                            pending.set(part.index, current);
                        }
                        inputTokens = chunk.usage?.prompt_tokens ?? inputTokens;
                        outputTokens = chunk.usage?.completion_tokens ?? outputTokens;
                        if (typeof chunk.usage?.prompt_tokens_details?.cached_tokens === 'number') {
                            cachedTokens = chunk.usage.prompt_tokens_details.cached_tokens;
                        }
                        else if (typeof chunk.usage?.cache_read_input_tokens === 'number') {
                            cachedTokens = chunk.usage.cache_read_input_tokens;
                        }
                    }
                }
                // A complete argument object is not proof that the provider finished its turn.
                // Never repair or release executable calls after EOF or an unsafe finish reason.
                // A max-token stop means the answer is incomplete even if the transport ended cleanly.
                if (truncated) {
                    throw new Error('Sağlayıcı yanıtı max_tokens çıktı sınırında kesildi; yanıt eksik ve başarı sayılmadı. Daha büyük bir çıktı bütçesi veya daha küçük bir istek kullanın.');
                }
                if (!finished)
                    throw new Error('Tamamlanmamış sağlayıcı akışı; araç çağrıları atıldı.');
                if ((pending.size || complete.length) && !toolFinish) {
                    throw new Error('Tamamlanmamış araç çağrısı; sağlayıcı güvenli bitiş nedeni bildirmedi.');
                }
                for (const call of pending.values()) {
                    if (!call.name)
                        throw new Error('Eksik araç çağrısı alındı.');
                    complete.push({ id: call.id || `call_${crypto.randomUUID()}`, name: call.name, arguments: objectArgs(call.args) });
                }
                if (complete.length)
                    yield { type: 'tool_calls', calls: complete };
                if (inputTokens !== undefined || outputTokens !== undefined || cachedTokens !== undefined)
                    yield { type: 'usage', inputTokens, outputTokens, ...(cachedTokens !== undefined ? { cachedTokens } : {}) };
            }
            catch (error) {
                yield { type: 'error', error: options.signal?.aborted ? 'İstek iptal edildi.' : signal.aborted ? 'Sağlayıcı İsteği Zaman Aşımına Uğradı.' : error instanceof Error && /^(Sağlayıcı|Tamamlanmamış|Eksik|Araç|Bilinmeyen|Bir model|Özel bir|Uç nokta|Provider|Incomplete|Tool arguments)/.test(error.message) ? error.message : 'Sağlayıcı isteği başarısız oldu veya geçersiz veri döndürdü.' };
            }
        } };
}
/** Validate an OpenRouter key without exposing the response body or credentials. */
export async function validateOpenRouterKey(key, signal) {
    signal?.throwIfAborted();
    try {
        const response = await fetch('https://openrouter.ai/api/v1/key', {
            headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
            redirect: 'error',
        });
        if (response.status === 401 || response.status === 403)
            throw new Error('OpenRouter anahtarı kabul edilmedi. Normal bir OpenRouter API anahtarı kullanın.');
        if (!response.ok)
            throw new Error('OpenRouter anahtarı doğrulanamadı.');
        const payload = await response.json();
        if (!payload || typeof payload !== 'object' || Array.isArray(payload))
            throw new Error('OpenRouter anahtarı doğrulanamadı.');
        const data = payload.data;
        if (!data || typeof data !== 'object' || Array.isArray(data))
            throw new Error('OpenRouter anahtarı doğrulanamadı.');
        const flags = data;
        if (flags.is_management_key === true || flags.is_provisioning_key === true)
            throw new Error('Yönetim anahtarı yerine normal bir OpenRouter API anahtarı kullanın.');
    }
    catch (error) {
        signal?.throwIfAborted();
        if (error instanceof Error && (error.message === 'OpenRouter anahtarı kabul edilmedi. Normal bir OpenRouter API anahtarı kullanın.' || error.message === 'Yönetim anahtarı yerine normal bir OpenRouter API anahtarı kullanın.'))
            throw error;
        throw new Error('OpenRouter anahtarı doğrulanamadı.');
    }
}
//# sourceMappingURL=providers.js.map