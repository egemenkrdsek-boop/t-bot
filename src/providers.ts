import type { Message, Provider, ProviderEvent, ToolCall, ToolDefinition } from './types.js';

export interface ProviderConfig { id: string; model: string; baseUrl?: string; apiKey?: string; timeoutMs?: number; }
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
] as const;

type Obj = Record<string, any>;
function safeUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Provider endpoint is invalid. Configure a valid HTTPS URL or localhost URL.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash) throw new Error('Endpoint must use HTTPS, or HTTP on localhost, and must not contain credentials, query or fragment.');
  return url;
}
function endpoint(base: string, path: string): string { const url = safeUrl(base); url.pathname = `${url.pathname.replace(/\/$/, '')}/${path}`; return url.toString(); }
function objectArgs(raw: string): Record<string, unknown> {
  const value: unknown = JSON.parse(raw || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Tool arguments must be a JSON object.');
  return value as Record<string, unknown>;
}
async function* sse(response: Response): AsyncGenerator<Obj> {
  if (!response.body) throw new Error('Provider returned an empty response stream.');
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let buffer = ''; let data: string[] = []; let frameSize = 0;
  const parse = (payload: string): Obj => payload === '[DONE]' ? { __done: true } : JSON.parse(payload) as Obj;
  try {
    while (true) {
      const { done, value } = await reader.read(); buffer += decoder.decode(value, { stream: !done });
      let match: RegExpExecArray | null;
      while ((match = /\r\n|\r|\n/.exec(buffer))) {
        // A CR at a chunk boundary may be the first half of CRLF.
        if (!done && match[0] === '\r' && match.index === buffer.length - 1) break;
        const line = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
        frameSize += line.length + match[0].length;
        if (frameSize > 4_000_000) throw new Error('Provider stream frame is too large.');
        if (!line) { if (data.length) yield parse(data.join('\n')); data = []; frameSize = 0; }
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (frameSize + buffer.length > 4_000_000) throw new Error('Provider stream frame is too large.');
      // An unterminated SSE event is discarded on EOF, per the event-stream protocol.
      if (done) break;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function imageParts(m: Message): Obj[] {
  return (m.images ?? []).map(image => ({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } }));
}
function openaiMessages(messages: Message[]): Obj[] {
  const result: Obj[] = []; let pendingImages: Obj[] = [];
  const flush = () => { if (pendingImages.length) { result.push({ role: 'user', content: [{ type: 'text', text: 'Images returned by the preceding tools:' }, ...pendingImages] }); pendingImages = []; } };
  for (const m of messages) {
    if (m.role !== 'tool') flush();
    if (m.role === 'tool') pendingImages.push(...imageParts(m));
    const parts = m.role === 'user' ? imageParts(m) : [];
    result.push({ role: m.role, content: parts.length ? [{ type: 'text', text: m.content }, ...parts] : m.content || (m.toolCalls?.length ? null : ''), ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}), ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) } : {}) });
  }
  flush(); return result;
}
function anthropicImages(m: Message): Obj[] { return (m.images ?? []).map(image => ({ type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } })); }
function geminiImages(m: Message): Obj[] { return (m.images ?? []).map(image => ({ inlineData: { mimeType: image.mimeType, data: image.data } })); }

export function createProvider(config: ProviderConfig): Provider {
  const spec = PROVIDER_CATALOG.find(p => p.id === config.id);
  if (!spec) throw new Error(`Unknown provider: ${config.id}`);
  if (!config.model.trim()) throw new Error('A model is required.');
  if (spec.requiresApiKey && !config.apiKey?.trim()) throw new Error(`${spec.label} requires an API key.`);
  // Only custom and local providers accept an override; a stale endpoint must not receive another provider's key.
  const base = (['custom', 'ollama', 'lmstudio'].includes(spec.id) ? config.baseUrl?.trim() : undefined) || spec.baseUrl;
  if (!base) throw new Error('A custom endpoint is required.');
  safeUrl(base);
  return { id: spec.id, label: spec.label, async *stream(messages: Message[], tools: ToolDefinition[], options = {}): AsyncGenerator<ProviderEvent> {
    const signal = AbortSignal.any([options.signal ?? new AbortController().signal, AbortSignal.timeout(config.timeoutMs ?? 120_000)]);
    try {
      let url: string; let body: Obj; const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'text/event-stream' };
      if (spec.id === 'anthropic') {
        url = endpoint(base, 'messages'); headers['x-api-key'] = config.apiKey!; headers['anthropic-version'] = '2023-06-01';
        const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
        body = { model: config.model, max_tokens: 4096, stream: true, ...(system ? { system } : {}), messages: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'tool' ? 'user' : m.role, content: m.role === 'tool' ? [{ type: 'tool_result', tool_use_id: m.toolCallId, content: [{ type: 'text', text: m.content }, ...anthropicImages(m)] }] : [...(m.content ? [{ type: 'text', text: m.content }] : []), ...anthropicImages(m), ...(m.toolCalls ?? []).map(c => ({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments }))] })), ...(tools.length ? { tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}) };
      } else if (spec.id === 'gemini') {
        url = endpoint(base, `models/${encodeURIComponent(config.model)}:streamGenerateContent`) + '?alt=sse'; headers['x-goog-api-key'] = config.apiKey!;
        const names = new Map(messages.flatMap(m => (m.toolCalls ?? []).map(c => [c.id, c.name] as const)));
        body = { contents: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: m.role === 'tool' ? [{ functionResponse: { name: names.get(m.toolCallId ?? '') ?? '', response: { result: m.content } } }, ...geminiImages(m)] : [...(m.content ? [{ text: m.content }] : []), ...geminiImages(m), ...(m.toolCalls ?? []).map(c => ({ functionCall: { name: c.name, args: c.arguments }, ...(c.thoughtSignature ? { thoughtSignature: c.thoughtSignature } : {}) }))] })), ...(messages.some(m => m.role === 'system') ? { systemInstruction: { parts: [{ text: messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n') }] } } : {}), ...(tools.length ? { tools: [{ functionDeclarations: tools }] } : {}) };
      } else {
        url = endpoint(base, 'chat/completions'); if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
        body = { model: config.model, messages: openaiMessages(messages), stream: true, ...(tools.length ? { tools: tools.map(t => ({ type: 'function', function: t })) } : {}) };
      }
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error' });
      if (response.status === 401) {
        yield { type: 'error', code: 'authentication', error: `${spec.label} kimlik doğrulamayı kabul etmedi (HTTP 401). /config üzerinden bu sağlayıcının API anahtarını kontrol edin; varsa sağlayıcıya özel ortam değişkeni veya TBOT_API_KEY kullanılan anahtarı etkileyebilir.` };
        return;
      }
      if (!response.ok) throw new Error(`Provider request failed (HTTP ${response.status}).`);
      const pending = new Map<number, { id: string; name: string; args: string }>(); const complete: ToolCall[] = []; let inputTokens: number | undefined; let outputTokens: number | undefined; let finished = false; let toolFinish = false;
      for await (const chunk of sse(response)) {
        if (chunk.error || chunk.type === 'error') throw new Error('Provider reported a stream error.');
        if (spec.id === 'anthropic') {
          if (chunk.type === 'content_block_start' && chunk.content_block?.type === 'tool_use') pending.set(chunk.index, { id: chunk.content_block.id, name: chunk.content_block.name, args: '' });
          if (chunk.type === 'content_block_delta') { if (chunk.delta?.type === 'text_delta') yield { type: 'text', text: chunk.delta.text }; if (chunk.delta?.type === 'input_json_delta') { const call = pending.get(chunk.index); if (call) call.args += chunk.delta.partial_json; } }
          if (chunk.type === 'message_stop') finished = true;
          if (chunk.type === 'message_delta' && chunk.delta?.stop_reason === 'tool_use') toolFinish = true;
          if (chunk.type === 'message_start') inputTokens = chunk.message?.usage?.input_tokens;
          if (chunk.type === 'message_delta') outputTokens = chunk.usage?.output_tokens;
        } else if (spec.id === 'gemini') {
          for (const part of chunk.candidates?.[0]?.content?.parts ?? []) { if (typeof part.text === 'string') yield { type: 'text', text: part.text }; if (part.functionCall) { const args = part.functionCall.args ?? {}; if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be a JSON object.'); if (typeof part.functionCall.name !== 'string' || !part.functionCall.name) throw new Error('Incomplete tool call received.'); complete.push({ id: `call_${crypto.randomUUID()}`, name: part.functionCall.name, arguments: args, ...(typeof part.thoughtSignature === 'string' ? { thoughtSignature: part.thoughtSignature } : {}) }); } }
          if (chunk.candidates?.[0]?.finishReason === 'STOP') { finished = true; toolFinish = true; }
          inputTokens = chunk.usageMetadata?.promptTokenCount ?? inputTokens; outputTokens = chunk.usageMetadata?.candidatesTokenCount ?? outputTokens;
        } else {
          if (chunk.__done) finished = true;
          if (chunk.choices?.[0]?.finish_reason === 'tool_calls') toolFinish = true;
          const delta = chunk.choices?.[0]?.delta;
          if (typeof delta?.content === 'string') yield { type: 'text', text: delta.content };
          for (const part of delta?.tool_calls ?? []) { const current = pending.get(part.index) ?? { id: '', name: '', args: '' }; current.id += part.id ?? ''; current.name += part.function?.name ?? ''; current.args += part.function?.arguments ?? ''; pending.set(part.index, current); }
          inputTokens = chunk.usage?.prompt_tokens ?? inputTokens; outputTokens = chunk.usage?.completion_tokens ?? outputTokens;
        }
      }
      if ((pending.size || complete.length) && (!finished || !toolFinish)) throw new Error('Incomplete provider stream; tool calls were discarded.');
      if (!finished) throw new Error('Incomplete provider stream.');
      for (const call of pending.values()) { if (!call.id || !call.name) throw new Error('Incomplete tool call received.'); complete.push({ id: call.id, name: call.name, arguments: objectArgs(call.args) }); }
      if (complete.length) yield { type: 'tool_calls', calls: complete };
      if (inputTokens !== undefined || outputTokens !== undefined) yield { type: 'usage', inputTokens, outputTokens };
    } catch (error) { yield { type: 'error', error: options.signal?.aborted ? 'Request cancelled.' : signal.aborted ? 'Provider request timed out.' : error instanceof Error && /^(Provider|Incomplete|Tool arguments)/.test(error.message) ? error.message : 'Provider request failed or returned invalid data.' }; }
  } };
}

