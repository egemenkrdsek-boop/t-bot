const FALLBACK = {
    openai: ['o3-mini', 'o1', 'o1-mini', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-5.1', 'gpt-5-mini', 'o3', 'o4-mini'],
    anthropic: ['claude-3-7-sonnet-latest', 'claude-3-5-sonnet-latest', 'claude-sonnet-4-20250514', 'claude-3-5-haiku-latest', 'claude-opus-5-5'],
    gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-4-argon', 'gemini-3.8-flash'],
    openrouter: ['openai/gpt-4o', 'openai/gpt-4.1', 'openai/o3-mini', 'openai/o1', 'anthropic/claude-3-7-sonnet-latest', 'anthropic/claude-3-5-sonnet-latest', 'google/gemini-2.5-pro', 'google/gemini-2.5-flash'],
    groq: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'],
    together: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'],
    deepseek: ['deepseek-chat', 'deepseek-reasoner'],
    xai: ['grok-4', 'grok-3-mini'],
    mistral: ['mistral-large-latest', 'mistral-small-latest'],
    fireworks: ['accounts/fireworks/models/llama-v3p3-70b-instruct'],
    cerebras: ['llama-3.3-70b'],
    ollama: [],
    lmstudio: [], custom: [],
};
export function fallbackModels(provider) {
    return (FALLBACK[provider] ?? []).map(id => ({ id, label: id }));
}
/** Read the official model catalog without exposing the key in URLs or errors. */
export async function discoverModels(provider, apiKey, signal, baseUrl) {
    signal?.throwIfAborted();
    const fallback = fallbackModels(provider);
    const urls = {
        openai: 'https://api.openai.com/v1/models',
        anthropic: 'https://api.anthropic.com/v1/models?limit=100',
        gemini: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
        openrouter: 'https://openrouter.ai/api/v1/models?supported_parameters=tools&output_modalities=text&sort=most-popular',
        ollama: 'http://localhost:11434/v1/models',
        lmstudio: 'http://localhost:1234/v1/models',
    };
    let url = urls[provider];
    if (baseUrl?.trim() && ['custom', 'ollama', 'lmstudio'].includes(provider)) {
        try {
            const parsed = new URL(baseUrl.trim());
            const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
            if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) || parsed.username || parsed.password || parsed.search || parsed.hash)
                return fallback;
            parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/models`;
            url = parsed.toString();
        }
        catch {
            return fallback;
        }
    }
    if (!url || (!apiKey && !['openrouter', 'ollama', 'lmstudio', 'custom'].includes(provider)))
        return fallback;
    try {
        const headers = { accept: 'application/json' };
        if (provider === 'anthropic') {
            headers['x-api-key'] = apiKey;
            headers['anthropic-version'] = '2023-06-01';
        }
        else if (provider === 'gemini')
            headers['x-goog-api-key'] = apiKey;
        else if (apiKey)
            headers.authorization = `Bearer ${apiKey}`;
        const response = await fetch(url, { headers, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000), redirect: 'error' });
        if (!response.ok)
            return fallback;
        const data = await response.json();
        if (!data || typeof data !== 'object')
            return fallback;
        const result = data;
        const entries = provider === 'gemini' ? result.models : result.data;
        if (!Array.isArray(entries))
            return fallback;
        const models = [];
        const seen = new Set();
        for (const raw of entries) {
            if (!raw || typeof raw !== 'object')
                continue;
            const item = raw;
            const rawId = provider === 'gemini' ? item.name : item.id;
            if (typeof rawId !== 'string')
                continue;
            const id = provider === 'gemini' ? rawId.replace(/^models\//, '') : rawId;
            if (!id || seen.has(id))
                continue;
            if (provider === 'gemini') {
                if (!Array.isArray(item.supportedGenerationMethods) || !item.supportedGenerationMethods.includes('generateContent') || !/^gemini-/.test(id) || /(?:image|tts|audio|live|embedding|robotics|computer-use)/i.test(id))
                    continue;
            }
            else if (provider === 'openai') {
                // Chat ve function-call destekli gerçek OpenAI model aileleri (o1, o3, o4, gpt-4, gpt-5, gpt-6 vb.)
                if (!/^(o1|o3|o4|gpt-4|gpt-5|gpt-6)/i.test(id) || /(?:audio|realtime|transcribe|tts|whisper|dall-e|embedding|moderation)/i.test(id))
                    continue;
            }
            else if (provider === 'anthropic') {
                if (!id.startsWith('claude-') || (typeof item.lifecycle === 'object' && item.lifecycle !== null && item.lifecycle.status === 'retired'))
                    continue;
            }
            else if (provider === 'openrouter') {
                if (!Array.isArray(item.supported_parameters) || !item.supported_parameters.includes('tools'))
                    continue;
                const arch = item.architecture;
                if (Array.isArray(arch?.output_modalities) && !arch.output_modalities.includes('text'))
                    continue;
            }
            seen.add(id);
            const display = typeof item.display_name === 'string' ? item.display_name : typeof item.name === 'string' && provider !== 'gemini' ? item.name : id;
            models.push({ id, label: display === id ? id : `${display} (${id})` });
            if (models.length >= 100)
                break;
        }
        return models.length ? models : fallback;
    }
    catch {
        signal?.throwIfAborted();
        return fallback;
    }
}
//# sourceMappingURL=models.js.map