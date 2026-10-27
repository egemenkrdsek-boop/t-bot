import { describeEffort } from './effort.js';
/** Stateless Responses API adapter for models that require it for function calls. */
export function createOpenAIResponsesProvider(config) {
    return { id: 'openai', label: 'OpenAI', async *stream(messages, tools, options = {}) {
            const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(config.timeoutMs ?? 120_000)]) : AbortSignal.timeout(config.timeoutMs ?? 120_000);
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
                const effort = describeEffort('openai', config.model, config.effort).effective;
                const body = { model: config.model, input, store: false, stream: true, ...(effort ? { reasoning: { effort } } : {}), ...(tools.length ? { tools: tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: false })) } : {}) };
                const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(body), signal, redirect: 'error' });
                if (response.status === 401) {
                    yield { type: 'error', code: 'authentication', error: 'OpenAI kimlik doğrulamayı kabul etmedi (HTTP 401). /auth üzerinden API anahtarını kontrol edin.' };
                    return;
                }
                if (!response.ok)
                    throw new Error(`Provider request failed (HTTP ${response.status}).`);
                if (!response.body)
                    throw new Error('Provider returned an empty response stream.');
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                let data = [];
                let frameSize = 0;
                let finished = false;
                const items = new Map();
                let usage;
                try {
                    while (true) {
                        const part = await reader.read();
                        buffer += decoder.decode(part.value, { stream: !part.done });
                        let match;
                        while ((match = /\r\n|\r|\n/.exec(buffer))) {
                            if (!part.done && match[0] === '\r' && match.index === buffer.length - 1)
                                break;
                            const line = buffer.slice(0, match.index);
                            buffer = buffer.slice(match.index + match[0].length);
                            frameSize += line.length + match[0].length;
                            if (frameSize > 4_000_000)
                                throw new Error('Provider stream frame is too large.');
                            if (line.startsWith('data:'))
                                data.push(line.slice(5).replace(/^ /, ''));
                            else if (!line) {
                                const payload = data.join('\n');
                                data = [];
                                frameSize = 0;
                                if (!payload || payload === '[DONE]')
                                    continue;
                                const event = JSON.parse(payload);
                                if (event.type === 'error' || event.type === 'response.failed' || event.type === 'response.incomplete')
                                    throw new Error('Provider reported a stream error.');
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
                        }
                        if (frameSize + buffer.length > 4_000_000)
                            throw new Error('Provider stream frame is too large.');
                        if (part.done)
                            break;
                    }
                }
                finally {
                    await reader.cancel().catch(() => { });
                    reader.releaseLock();
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
                if (usage)
                    yield { type: 'usage', inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined, outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined };
            }
            catch (error) {
                yield { type: 'error', error: options.signal?.aborted ? 'Request cancelled.' : signal.aborted ? 'Provider request timed out.' : error instanceof Error && /^(Provider|Incomplete|Tool arguments)/.test(error.message) ? error.message : 'Provider request failed or returned invalid data.' };
            }
        } };
}
//# sourceMappingURL=openai-responses.js.map