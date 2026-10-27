import type { Message, Provider, ProviderEvent, ToolDefinition, ToolCall } from './types.js';
import { describeEffort, type EffortLevel } from './effort.js';
import { sse } from './providers.js';

type Item = Record<string, unknown>;
type ResponseMessage = Message & { responseItems?: Item[] };
interface Config { model: string; apiKey: string; effort?: EffortLevel; timeoutMs?: number }

/** Stateless Responses API adapter for models that require it for function calls. */
export function createOpenAIResponsesProvider(config: Config): Provider {
  return { id: 'openai', label: 'OpenAI', async *stream(messages, tools: ToolDefinition[], options = {}): AsyncGenerator<ProviderEvent> {
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
      const effort = describeEffort('openai', config.model, config.effort).effective;
      const body = { model: config.model, input, store: false, stream: true, ...(effort ? { reasoning: { effort } } : {}), ...(tools.length ? { tools: tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: false })) } : {}) };
      const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(body), signal, redirect: 'error' });
      if (response.status === 401) { yield { type: 'error', code: 'authentication', error: 'OpenAI kimlik doğrulamayı kabul etmedi (HTTP 401). /auth üzerinden API anahtarını kontrol edin.' }; return; }
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
