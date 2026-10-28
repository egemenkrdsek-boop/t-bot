import type { Message, Provider, ProviderEvent, ProviderStreamOptions, ToolDefinition, ToolCall } from './types.js';
import { describeEffort, type EffortLevel } from './effort.js';
import { sse } from './providers.js';

type Item = Record<string, unknown>;
type ResponseMessage = Message & { responseItems?: Item[] };
interface Config { model: string; apiKey: string; effort?: EffortLevel; timeoutMs?: number }

/** Stateless Responses API adapter for models that require it for function calls. */
export function createOpenAIResponsesProvider(config: Config): Provider {
  return { id: 'openai', label: 'OpenAI', model: config.model, async *stream(messages, tools: ToolDefinition[], options: ProviderStreamOptions = {}): AsyncGenerator<ProviderEvent> {
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(config.timeoutMs ?? 120_000)]) : AbortSignal.timeout(config.timeoutMs ?? 120_000);
    try {
      const input: Item[] = []; let pendingImages: Item[] = [];
      const flushImages = () => { if (pendingImages.length) { input.push({ role: 'user', content: [{ type: 'input_text', text: 'Images returned by the preceding tools:' }, ...pendingImages] }); pendingImages = []; } };
      for (const message of messages as ResponseMessage[]) {
        if (message.role !== 'tool') flushImages();
        if (message.role === 'tool') {
          input.push({ type: 'function_call_output', call_id: message.toolCallId, output: message.content });
          if (message.images?.length) pendingImages.push(...message.images.map(image => ({ type: 'input_image', image_url: `data:${image.mimeType};base64,${image.data}` })));
        } else if (message.role === 'assistant' && message.responseItems?.length) input.push(...message.responseItems);
        else if (message.role === 'assistant' && message.toolCalls?.length) {
          if (message.content) input.push({ role: 'assistant', content: message.content });
          input.push(...message.toolCalls.map(call => ({ type: 'function_call', call_id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) })));
        } else if (message.role === 'user' && message.images?.length) input.push({ role: 'user', content: [{ type: 'input_text', text: message.content }, ...message.images.map(image => ({ type: 'input_image', image_url: `data:${image.mimeType};base64,${image.data}` }))] });
        else input.push({ role: message.role, content: message.content });
      }
      flushImages();
      const effort = describeEffort('openai', config.model, options.effort ?? config.effort).effective;
      const body = { model: config.model, input, store: false, stream: true, ...(effort ? { reasoning: { effort } } : {}), ...(tools.length ? { tools: tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: false })) } : {}) };
      let response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(body), signal, redirect: 'error' });
      if (response.status === 401) { yield { type: 'error', code: 'authentication', error: 'OpenAI kimlik doğrulamayı kabul etmedi (HTTP 401). /auth üzerinden API anahtarını kontrol edin.' }; return; }

      // /v1/responses 404 veya 400 dönerse standart /v1/chat/completions SSE akışına otomatik fallback yap
      if (response.status === 404 || response.status === 400) {
        await response.body?.cancel();
        const chatMessages: Item[] = [];
        let pendingImages: Item[] = [];
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
          if (m.role !== 'tool') flushImages();
          if (m.role === 'tool') {
            chatMessages.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
            if (m.images?.length) {
              pendingImages.push(...m.images.map(image => ({
                type: 'image_url',
                image_url: { url: `data:${image.mimeType};base64,${image.data}` },
              })));
            }
          } else if (m.role === 'assistant') {
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
          } else if (m.role === 'user' && m.images?.length) {
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
          } else {
            chatMessages.push({ role: m.role, content: m.content });
          }
        }
        flushImages();

        const chatBody = {
          model: config.model,
          messages: chatMessages,
          stream: true,
          stream_options: { include_usage: true },
          ...(tools.length
            ? {
                tools: tools.map((t) => ({
                  type: 'function',
                  function: { name: t.name, description: t.description, parameters: t.parameters },
                })),
              }
            : {}),
        };

        const chatRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            'content-type': 'application/json',
            accept: 'text/event-stream',
          },
          body: JSON.stringify(chatBody),
          signal,
          redirect: 'error',
        });

        if (chatRes.status === 401) {
          yield {
            type: 'error',
            code: 'authentication',
            error: 'OpenAI kimlik doğrulamayı kabul etmedi (HTTP 401). /auth üzerinden API anahtarını kontrol edin.',
          };
          return;
        }
        if (!chatRes.ok) throw new Error(`Provider request failed (HTTP ${chatRes.status}).`);
        if (!chatRes.body) throw new Error('Provider returned an empty response stream.');

        const toolCallsMap = new Map<number, { id: string; name: string; args: string }>();
        let chatUsage: Item | undefined;
        let chatFinished = false;
        let safeToolFinish = false;

        for await (const payload of sse(chatRes.body)) {
          if (payload === '[DONE]') { chatFinished = true; continue; }
          const parsed = JSON.parse(payload);
          if (parsed.error || parsed.type === 'error') throw new Error('Provider reported a stream error.');
          if (parsed.usage) chatUsage = parsed.usage;
          const choice = parsed.choices?.[0];
          if (!choice) continue;
          if (choice.finish_reason) safeToolFinish = ['stop', 'tool_calls'].includes(choice.finish_reason);
          const delta = choice.delta;
          if (delta?.content && typeof delta.content === 'string') {
            yield { type: 'text', text: delta.content };
          }
          if (Array.isArray(delta?.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = typeof tc.index === 'number' ? tc.index : 0;
              const existing = toolCallsMap.get(idx) || { id: '', name: '', args: '' };
              if (tc.id) existing.id += tc.id;
              if (tc.function?.name) existing.name += tc.function.name;
              if (tc.function?.arguments) existing.args += tc.function.arguments;
              toolCallsMap.set(idx, existing);
            }
          }
        }

        if (!chatFinished || (toolCallsMap.size && !safeToolFinish)) throw new Error('Incomplete provider stream; tool calls discarded.');
        const resolvedCalls: ToolCall[] = [];
        for (const tc of toolCallsMap.values()) {
          if (!tc.name) throw new Error('Incomplete tool call received.');
          const parsedArgs: unknown = JSON.parse(tc.args || '{}');
          if (!parsedArgs || typeof parsedArgs !== 'object' || Array.isArray(parsedArgs)) throw new Error('Tool arguments must be a JSON object.');
          resolvedCalls.push({
            id: tc.id || `call_${crypto.randomUUID()}`,
            name: tc.name,
            arguments: parsedArgs as Record<string, unknown>,
          });
        }

        if (resolvedCalls.length) {
          yield { type: 'tool_calls', calls: resolvedCalls };
        }
        if (chatUsage) {
          const inputDetails = typeof chatUsage.prompt_tokens_details === 'object' && chatUsage.prompt_tokens_details !== null
            ? (chatUsage.prompt_tokens_details as Record<string, unknown>)
            : undefined;
          const cachedTokens = typeof inputDetails?.cached_tokens === 'number' ? inputDetails.cached_tokens : undefined;
          yield {
            type: 'usage',
            inputTokens: typeof chatUsage.prompt_tokens === 'number' ? chatUsage.prompt_tokens : undefined,
            outputTokens: typeof chatUsage.completion_tokens === 'number' ? chatUsage.completion_tokens : undefined,
            ...(cachedTokens !== undefined ? { cachedTokens } : {}),
          } as ProviderEvent;
        }
        return;
      }

      if (!response.ok) throw new Error(`Provider request failed (HTTP ${response.status}).`);
      if (!response.body) throw new Error('Provider returned an empty response stream.');
      let finished = false; const items = new Map<number, Item>(); let usage: Item | undefined;
      for await (const payload of sse(response.body)) {
        if (!payload || payload === '[DONE]') continue;
        const event = JSON.parse(payload) as { type?: string; delta?: unknown; output_index?: unknown; item?: unknown; response?: { status?: string; usage?: Item }; error?: unknown };
        if (event.type === 'error' || event.type === 'response.failed' || event.type === 'response.incomplete') throw new Error('Provider reported a stream error.');
        if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') yield { type: 'text', text: event.delta };
        if (event.type === 'response.output_item.done' && typeof event.output_index === 'number' && event.item && typeof event.item === 'object' && !Array.isArray(event.item)) items.set(event.output_index, event.item as Item);
        if (event.type === 'response.completed') { if (event.response?.status !== 'completed') throw new Error('Incomplete provider stream.'); finished = true; usage = event.response.usage; }
      }
      if (!finished) throw new Error('Incomplete provider stream.');
      const responseItems = [...items.entries()].sort((a, b) => a[0] - b[0]).map(([, item]) => item);
      const calls: ToolCall[] = [];
      for (const item of responseItems) if (item.type === 'function_call') {
        if (typeof item.call_id !== 'string' || typeof item.name !== 'string' || typeof item.arguments !== 'string') throw new Error('Incomplete tool call received.');
        const args: unknown = JSON.parse(item.arguments);
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be a JSON object.');
        calls.push({ id: item.call_id, name: item.name, arguments: args as Record<string, unknown> });
      }
      yield { type: 'response_items', responseItems };
      if (calls.length) yield { type: 'tool_calls', calls };
      if (usage) {
        const inputDetails = typeof usage.input_tokens_details === 'object' && usage.input_tokens_details !== null
          ? (usage.input_tokens_details as Record<string, unknown>)
          : undefined;
        const cachedTokens = typeof inputDetails?.cached_tokens === 'number' ? inputDetails.cached_tokens : undefined;
        yield {
          type: 'usage',
          inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined,
          outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined,
          ...(cachedTokens !== undefined ? { cachedTokens } : {})
        } as ProviderEvent;
      }
    } catch (error) {
      const msg = error instanceof Error && error.message === 'Sağlayıcı akış çerçevesi çok büyük.'
        ? 'Provider stream frame is too large.'
        : error instanceof Error ? error.message : '';
      yield { type: 'error', error: options.signal?.aborted ? 'Request cancelled.' : signal.aborted ? 'Provider request timed out.' : /^(Provider|Incomplete|Tool arguments)/.test(msg) ? msg : 'Provider request failed or returned invalid data.' };
    }
  } };
}
