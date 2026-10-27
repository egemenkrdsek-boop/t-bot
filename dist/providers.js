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
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Araç argümanları bir JSON nesnesi olmalıdır.');
    return value;
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
        return createOpenAIResponsesProvider({ model: config.model, apiKey: config.apiKey, effort: config.effort, timeoutMs: config.timeoutMs });
    return { id: spec.id, label: spec.label, async *stream(messages, tools, options = {}) {
            const signal = AbortSignal.any([options.signal ?? new AbortController().signal, AbortSignal.timeout(config.timeoutMs ?? 120_000)]);
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
                    let lastUserIndex = -1;
                    for (let i = nonSystem.length - 1; i >= 0; i--) {
                        if (nonSystem[i].role === 'user' || nonSystem[i].role === 'tool') {
                            lastUserIndex = i;
                            break;
                        }
                    }
                    const anthropicMessages = nonSystem.map((m, idx) => {
                        const isCacheTarget = idx === lastUserIndex;
                        if (m.role === 'tool') {
                            const toolResultBlocks = [{ type: 'text', text: m.content }, ...anthropicImages(m)];
                            return {
                                role: 'user',
                                content: [{
                                        type: 'tool_result',
                                        tool_use_id: m.toolCallId,
                                        content: toolResultBlocks,
                                        ...(isCacheTarget ? { cache_control: { type: 'ephemeral' } } : {})
                                    }]
                            };
                        }
                        const blocks = [
                            ...(m.content ? [{ type: 'text', text: m.content }] : []),
                            ...anthropicImages(m),
                            ...(m.toolCalls ?? []).map(c => ({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments }))
                        ];
                        if (isCacheTarget && blocks.length) {
                            blocks[blocks.length - 1].cache_control = { type: 'ephemeral' };
                        }
                        return { role: m.role, content: blocks };
                    });
                    body = {
                        model: config.model,
                        max_tokens: 8192,
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
                    body = { contents: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: m.role === 'tool' ? [{ functionResponse: { name: names.get(m.toolCallId ?? '') ?? '', response: { result: m.content } } }, ...geminiImages(m)] : [...(m.content ? [{ text: m.content }] : []), ...geminiImages(m), ...(m.toolCalls ?? []).map(c => ({ functionCall: { name: c.name, args: c.arguments }, ...(c.thoughtSignature ? { thoughtSignature: c.thoughtSignature } : {}) }))] })), ...(messages.some(m => m.role === 'system') ? { systemInstruction: { parts: [{ text: messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n') }] } } : {}), ...(tools.length ? { tools: [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }] } : {}) };
                }
                else {
                    url = endpoint(base, 'chat/completions');
                    if (config.apiKey)
                        headers.authorization = `Bearer ${config.apiKey}`;
                    const enableOpenRouterCache = spec.id === 'openrouter' && /^(?:anthropic|google)\//i.test(config.model.trim());
                    body = { model: config.model, messages: openaiMessages(messages, enableOpenRouterCache), stream: true, stream_options: { include_usage: true }, ...(tools.length ? { tools: tools.map(t => ({ type: 'function', function: t })) } : {}) };
                }
                const effort = describeEffort(spec.id, config.model, config.effort ?? 'medium');
                if (effort.effective) {
                    if (spec.id === 'anthropic')
                        body.output_config = { effort: effort.effective };
                    else if (spec.id === 'gemini')
                        body.generationConfig = { thinkingConfig: { thinkingLevel: effort.effective } };
                    else if (spec.id === 'openrouter')
                        body.reasoning = { effort: effort.effective };
                    else if (spec.id === 'openai')
                        body.reasoning_effort = effort.effective;
                }
                const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error' });
                if (response.status === 401) {
                    yield { type: 'error', code: 'authentication', error: `${spec.label} kimlik doğrulamayı kabul etmedi (HTTP 401). /auth üzerinden bu sağlayıcının API anahtarını kontrol edin; varsa sağlayıcıya özel ortam değişkeni veya TBOT_API_KEY kullanılan anahtarı etkileyebilir.` };
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
                            if (chunk.delta?.stop_reason === 'tool_use')
                                toolFinish = true;
                            else if (chunk.delta?.stop_reason === 'max_tokens' && pending.size === 0) {
                                finished = true;
                                toolFinish = true;
                            }
                        }
                        if (chunk.type === 'message_start') {
                            inputTokens = chunk.message?.usage?.input_tokens;
                            const cacheRead = chunk.message?.usage?.cache_read_input_tokens;
                            if (typeof cacheRead === 'number')
                                cachedTokens = (cachedTokens ?? 0) + cacheRead;
                        }
                        if (chunk.type === 'message_delta') {
                            outputTokens = chunk.usage?.output_tokens;
                            const cacheRead = chunk.usage?.cache_read_input_tokens;
                            if (typeof cacheRead === 'number')
                                cachedTokens = (cachedTokens ?? 0) + cacheRead;
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
                        if (chunk.candidates?.[0]?.finishReason === 'STOP') {
                            finished = true;
                            toolFinish = true;
                        }
                        inputTokens = chunk.usageMetadata?.promptTokenCount ?? inputTokens;
                        outputTokens = chunk.usageMetadata?.candidatesTokenCount ?? outputTokens;
                        if (typeof chunk.usageMetadata?.cachedContentTokenCount === 'number') {
                            cachedTokens = chunk.usageMetadata.cachedContentTokenCount;
                        }
                    }
                    else {
                        if (chunk.__done)
                            finished = true;
                        if (chunk.choices?.[0]?.finish_reason === 'tool_calls')
                            toolFinish = true;
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
                if ((pending.size || complete.length) && (!finished || !toolFinish))
                    throw new Error('Tamamlanmamış sağlayıcı akışı; araç çağrıları atıldı.');
                if (!finished)
                    throw new Error('Tamamlanmamış sağlayıcı akışı.');
                for (const call of pending.values()) {
                    if (!call.id || !call.name)
                        throw new Error('Eksik araç çağrısı alındı.');
                    complete.push({ id: call.id, name: call.name, arguments: objectArgs(call.args) });
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