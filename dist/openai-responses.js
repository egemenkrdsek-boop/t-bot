import { describeEffort } from './effort.js';
import { fetchWithRetry, sse } from './providers.js';
import { redactSecrets } from './security/redact.js';
function outputTokenLimit(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}
/**
 * A 400 is not automatically an unsupported /v1/responses endpoint: the request
 * itself may be invalid. Only fall back when the response clearly describes an
 * unknown/unsupported endpoint; otherwise surface the real provider error.
 */
async function describeResponsesFailure(response) {
    let raw = '';
    try {
        raw = (await response.text()).slice(0, 4000);
    }
    catch { /* body is optional */ }
    const detail = redactSecrets(raw).replace(/\s+/g, ' ').trim().slice(0, 300);
    const endpointPattern = /(?:invalid url|unknown (?:url|endpoint|route|path)|(?:url|endpoint|route|path)[^.]{0,80}(?:not found|unknown|unsupported|does not exist|not supported))/i;
    return { unsupported: response.status === 404 || endpointPattern.test(detail), detail };
}
/** Stateless Responses API adapter for models that require it for function calls. */
export function createOpenAIResponsesProvider(config) {
    return { id: 'openai', label: 'OpenAI', model: config.model, async *stream(messages, tools, options = {}) {
            const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(config.timeoutMs ?? 120_000)]) : AbortSignal.timeout(config.timeoutMs ?? 120_000);
            const maxOutput = outputTokenLimit(options.maxOutputTokens);
            try {
                const input = [];
                let pendingImages = [];
                const flushImages = () => { if (pendingImages.length) {
                    input.push({ role: 'user', content: [{ type: 'input_text', text: 'Images returned by the preceding tools:' }, ...pendingImages] });
                    pendingImages = [];
                } };
                for (const message of messages) {
                    if (message.role !== 'tool')
                        flushImages();
                    if (message.role === 'tool') {
                        input.push({ type: 'function_call_output', call_id: message.toolCallId, output: message.content });
                        if (message.images?.length)
                            pendingImages.push(...message.images.map(image => ({ type: 'input_image', image_url: `data:${image.mimeType};base64,${image.data}` })));
                    }
                    else if (message.role === 'assistant' && message.responseItems?.length)
                        input.push(...message.responseItems);
                    else if (message.role === 'assistant' && message.toolCalls?.length) {
                        if (message.content)
                            input.push({ role: 'assistant', content: message.content });
                        input.push(...message.toolCalls.map(call => ({ type: 'function_call', call_id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) })));
                    }
                    else if (message.role === 'user' && message.images?.length)
                        input.push({ role: 'user', content: [{ type: 'input_text', text: message.content }, ...message.images.map(image => ({ type: 'input_image', image_url: `data:${image.mimeType};base64,${image.data}` }))] });
                    else
                        input.push({ role: message.role, content: message.content });
                }
                flushImages();
                const effortFor = (model) => describeEffort('openai', model, options.effort ?? config.effort).effective;
                const responsesBody = (model) => {
                    const effort = effortFor(model);
                    return { model, input, store: false, stream: true, ...(effort ? { reasoning: { effort } } : {}), ...(maxOutput ? { max_output_tokens: maxOutput } : {}), ...(tools.length ? { tools: tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: false })) } : {}) };
                };
                const fallbackModel = (config.fallbackModel?.trim() || process.env.TBOT_FALLBACK_MODEL?.trim() || '').trim();
                let activeModel = config.model;
                let response = await fetchWithRetry('https://api.openai.com/v1/responses', { method: 'POST', headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(responsesBody(activeModel)), signal, redirect: 'error' }, { signal });
                if (response.status === 402 && fallbackModel && fallbackModel !== activeModel) {
                    await response.body?.cancel().catch(() => { });
                    const from = activeModel;
                    activeModel = fallbackModel;
                    config.onFallback?.({ provider: 'openai', from, to: activeModel, status: 402 });
                    console.warn(`[openai-responses] OpenAI: ${from} -> ${activeModel} (HTTP 402).`);
                    response = await fetchWithRetry('https://api.openai.com/v1/responses', { method: 'POST', headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(responsesBody(activeModel)), signal, redirect: 'error' }, { signal });
                }
                if (response.status === 401) {
                    yield { type: 'error', code: 'authentication', error: 'OpenAI kimlik doğrulamayı kabul etmedi (HTTP 401). /auth üzerinden API anahtarını kontrol edin.' };
                    return;
                }
                if (response.status === 402) {
                    yield { type: 'error', error: `OpenAI / ${activeModel}: kredi veya kota yetersiz (HTTP 402). /model ile başka bir model seçin veya sağlayıcı hesabınızın kredisini/kotasını kontrol edin.` };
                    return;
                }
                // /v1/responses 404 veya açıkça desteklenmeyen uç nokta hatasında standart
                // /v1/chat/completions SSE akışına fallback yap. Gerçek bir 400 gizlenmez.
                if (response.status === 404 || response.status === 400) {
                    const failure = await describeResponsesFailure(response);
                    if (!failure.unsupported) {
                        throw new Error(`Provider request failed (HTTP ${response.status})${failure.detail ? `: ${failure.detail}` : '.'}`);
                    }
                    console.warn(`[openai-responses] /v1/responses kullanılamıyor (HTTP ${response.status}${failure.detail ? `: ${failure.detail}` : ''}); chat/completions fallback başlatıldı.`);
                    const chatMessages = [];
                    let pendingImages = [];
                    const flushImages = () => {
                        if (pendingImages.length) {
                            chatMessages.push({
                                role: 'user',
                                content: [{ type: 'text', text: '[Canlı Ekran Görüntüsü]' }, ...pendingImages],
                            });
                            pendingImages = [];
                        }
                    };
                    for (const m of messages) {
                        if (m.role !== 'tool')
                            flushImages();
                        if (m.role === 'tool') {
                            chatMessages.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
                            if (m.images?.length) {
                                pendingImages.push(...m.images.map(image => ({
                                    type: 'image_url',
                                    image_url: { url: `data:${image.mimeType};base64,${image.data}` },
                                })));
                            }
                        }
                        else if (m.role === 'assistant') {
                            chatMessages.push({
                                role: 'assistant',
                                content: m.content || null,
                                ...(m.toolCalls?.length
                                    ? {
                                        tool_calls: m.toolCalls.map((c) => ({
                                            id: c.id,
                                            type: 'function',
                                            function: { name: c.name, arguments: JSON.stringify(c.arguments) },
                                        })),
                                    }
                                    : {}),
                            });
                        }
                        else if (m.role === 'user' && m.images?.length) {
                            chatMessages.push({
                                role: 'user',
                                content: [
                                    ...(m.content ? [{ type: 'text', text: m.content }] : []),
                                    ...m.images.map(image => ({
                                        type: 'image_url',
                                        image_url: { url: `data:${image.mimeType};base64,${image.data}` },
                                    })),
                                ],
                            });
                        }
                        else {
                            chatMessages.push({ role: m.role, content: m.content });
                        }
                    }
                    flushImages();
                    const chatBody = {
                        model: activeModel,
                        messages: chatMessages,
                        stream: true,
                        stream_options: { include_usage: true },
                        ...(maxOutput ? { max_completion_tokens: maxOutput } : {}),
                        ...(tools.length
                            ? {
                                tools: tools.map((t) => ({
                                    type: 'function',
                                    function: { name: t.name, description: t.description, parameters: t.parameters },
                                })),
                            }
                            : {}),
                    };
                    const chatRes = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            authorization: `Bearer ${config.apiKey}`,
                            'content-type': 'application/json',
                            accept: 'text/event-stream',
                        },
                        body: JSON.stringify(chatBody),
                        signal,
                        redirect: 'error',
                    }, { signal });
                    if (chatRes.status === 401) {
                        yield {
                            type: 'error',
                            code: 'authentication',
                            error: 'OpenAI kimlik doğrulamayı kabul etmedi (HTTP 401). /auth üzerinden API anahtarını kontrol edin.',
                        };
                        return;
                    }
                    if (chatRes.status === 402) {
                        yield {
                            type: 'error',
                            error: `OpenAI / ${activeModel}: kredi veya kota yetersiz (HTTP 402). /model ile başka bir model seçin veya sağlayıcı hesabınızın kredisini/kotasını kontrol edin.`,
                        };
                        return;
                    }
                    if (!chatRes.ok)
                        throw new Error(`Provider request failed (HTTP ${chatRes.status}).`);
                    if (!chatRes.body)
                        throw new Error('Provider returned an empty response stream.');
                    const toolCallsMap = new Map();
                    let chatUsage;
                    let chatFinished = false;
                    let safeToolFinish = false;
                    let chatTruncated = false;
                    for await (const payload of sse(chatRes.body)) {
                        if (payload === '[DONE]') {
                            chatFinished = true;
                            continue;
                        }
                        const parsed = JSON.parse(payload);
                        if (parsed.error || parsed.type === 'error')
                            throw new Error('Provider reported a stream error.');
                        if (parsed.usage)
                            chatUsage = parsed.usage;
                        const choice = parsed.choices?.[0];
                        if (!choice)
                            continue;
                        if (choice.finish_reason) {
                            safeToolFinish = ['stop', 'tool_calls'].includes(choice.finish_reason);
                            if (choice.finish_reason === 'length')
                                chatTruncated = true;
                        }
                        const delta = choice.delta;
                        if (delta?.content && typeof delta.content === 'string') {
                            yield { type: 'text', text: delta.content };
                        }
                        if (Array.isArray(delta?.tool_calls)) {
                            for (const tc of delta.tool_calls) {
                                const idx = typeof tc.index === 'number' ? tc.index : 0;
                                const existing = toolCallsMap.get(idx) || { id: '', name: '', args: '' };
                                if (tc.id)
                                    existing.id += tc.id;
                                if (tc.function?.name)
                                    existing.name += tc.function.name;
                                if (tc.function?.arguments)
                                    existing.args += tc.function.arguments;
                                toolCallsMap.set(idx, existing);
                            }
                        }
                    }
                    if (chatTruncated)
                        throw new Error('Provider response was truncated at the max output token limit; it was not treated as success.');
                    if (!chatFinished || (toolCallsMap.size && !safeToolFinish))
                        throw new Error('Incomplete provider stream; tool calls discarded.');
                    const resolvedCalls = [];
                    for (const tc of toolCallsMap.values()) {
                        if (!tc.name)
                            throw new Error('Incomplete tool call received.');
                        const parsedArgs = JSON.parse(tc.args || '{}');
                        if (!parsedArgs || typeof parsedArgs !== 'object' || Array.isArray(parsedArgs))
                            throw new Error('Tool arguments must be a JSON object.');
                        resolvedCalls.push({
                            id: tc.id || `call_${crypto.randomUUID()}`,
                            name: tc.name,
                            arguments: parsedArgs,
                        });
                    }
                    if (resolvedCalls.length) {
                        yield { type: 'tool_calls', calls: resolvedCalls };
                    }
                    if (chatUsage) {
                        const inputDetails = typeof chatUsage.prompt_tokens_details === 'object' && chatUsage.prompt_tokens_details !== null
                            ? chatUsage.prompt_tokens_details
                            : undefined;
                        const cachedTokens = typeof inputDetails?.cached_tokens === 'number' ? inputDetails.cached_tokens : undefined;
                        yield {
                            type: 'usage',
                            inputTokens: typeof chatUsage.prompt_tokens === 'number' ? chatUsage.prompt_tokens : undefined,
                            outputTokens: typeof chatUsage.completion_tokens === 'number' ? chatUsage.completion_tokens : undefined,
                            ...(cachedTokens !== undefined ? { cachedTokens } : {}),
                        };
                    }
                    return;
                }
                if (!response.ok)
                    throw new Error(`Provider request failed (HTTP ${response.status}).`);
                if (!response.body)
                    throw new Error('Provider returned an empty response stream.');
                let finished = false;
                const items = new Map();
                let usage;
                for await (const payload of sse(response.body)) {
                    if (!payload || payload === '[DONE]')
                        continue;
                    const event = JSON.parse(payload);
                    if (event.type === 'error' || event.type === 'response.failed')
                        throw new Error('Provider reported a stream error.');
                    if (event.type === 'response.incomplete') {
                        const reason = event.response?.incomplete_details?.reason;
                        throw new Error(reason === 'max_output_tokens'
                            ? 'Provider response was truncated at the max output token limit; it was not treated as success.'
                            : 'Incomplete provider stream.');
                    }
                    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string')
                        yield { type: 'text', text: event.delta };
                    if (event.type === 'response.output_item.done' && typeof event.output_index === 'number' && event.item && typeof event.item === 'object' && !Array.isArray(event.item))
                        items.set(event.output_index, event.item);
                    if (event.type === 'response.completed') {
                        if (event.response?.status !== 'completed')
                            throw new Error('Incomplete provider stream.');
                        finished = true;
                        usage = event.response.usage;
                    }
                }
                if (!finished)
                    throw new Error('Incomplete provider stream.');
                const responseItems = [...items.entries()].sort((a, b) => a[0] - b[0]).map(([, item]) => item);
                const calls = [];
                for (const item of responseItems)
                    if (item.type === 'function_call') {
                        if (typeof item.call_id !== 'string' || typeof item.name !== 'string' || typeof item.arguments !== 'string')
                            throw new Error('Incomplete tool call received.');
                        const args = JSON.parse(item.arguments);
                        if (!args || typeof args !== 'object' || Array.isArray(args))
                            throw new Error('Tool arguments must be a JSON object.');
                        calls.push({ id: item.call_id, name: item.name, arguments: args });
                    }
                yield { type: 'response_items', responseItems };
                if (calls.length)
                    yield { type: 'tool_calls', calls };
                if (usage) {
                    const inputDetails = typeof usage.input_tokens_details === 'object' && usage.input_tokens_details !== null
                        ? usage.input_tokens_details
                        : undefined;
                    const cachedTokens = typeof inputDetails?.cached_tokens === 'number' ? inputDetails.cached_tokens : undefined;
                    yield {
                        type: 'usage',
                        inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined,
                        outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined,
                        ...(cachedTokens !== undefined ? { cachedTokens } : {})
                    };
                }
            }
            catch (error) {
                const msg = error instanceof Error && error.message === 'Sağlayıcı akış çerçevesi çok büyük.'
                    ? 'Provider stream frame is too large.'
                    : error instanceof Error ? error.message : '';
                yield { type: 'error', error: options.signal?.aborted ? 'Request cancelled.' : signal.aborted ? 'Provider request timed out.' : /^(Provider|Incomplete|Tool arguments)/.test(msg) ? msg : 'Provider request failed or returned invalid data.' };
            }
        } };
}
//# sourceMappingURL=openai-responses.js.map