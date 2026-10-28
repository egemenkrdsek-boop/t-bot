import { resolveProviderConfig } from './config.js';
import { fallbackModels, discoverModels } from './models.js';
import { PROVIDER_CATALOG, validateOpenRouterKey } from './providers.js';
import { getApiKey, prepareApiKey, setApiKey } from './secrets.js';
/**
 * Resolve the optional image provider used by the `image_generate` tool. The
 * CLI previously did this inline; the desktop host must pass the same context
 * into every turn or the tool fails despite a configured key.
 */
export async function resolveImageProviderConfig(config) {
    const candidates = [config.provider, 'openai', 'gemini', 'openrouter'];
    const seen = new Set();
    for (const provider of candidates) {
        if (seen.has(provider) || !['openai', 'gemini', 'openrouter'].includes(provider))
            continue;
        seen.add(provider);
        const apiKey = await getApiKey(provider);
        if (apiKey)
            return { provider: provider, apiKey };
    }
    return undefined;
}
/**
 * List models for the persisted provider or a provider selected in the UI.
 * A custom/local endpoint keeps its baseUrl, matching the CLI configuration
 * path instead of silently reverting to the public provider catalog.
 */
export async function listProviderModels(config, providerId, signal) {
    const provider = providerId && PROVIDER_CATALOG.some(item => item.id === providerId)
        ? providerId
        : config.provider;
    const selected = {
        ...config,
        provider,
        ...(provider === config.provider ? {} : { baseUrl: undefined }),
    };
    let resolved;
    try {
        resolved = await resolveProviderConfig(selected);
    }
    catch {
        resolved = { id: provider, model: selected.model, effort: 'medium' };
    }
    let models = fallbackModels(provider);
    try {
        models = await discoverModels(provider, resolved.apiKey, signal, resolved.baseUrl);
    }
    catch {
        // Offline or an invalid/unreachable endpoint keeps the deterministic list.
    }
    return {
        providers: PROVIDER_CATALOG,
        currentProvider: provider,
        currentModel: selected.model,
        models,
    };
}
/**
 * Store an API key with the same validation on every surface. OpenRouter keys
 * are verified before they can be persisted; other providers validate their
 * local format inside setApiKey.
 */
export async function storeProviderApiKey(provider, apiKey) {
    const prepared = prepareApiKey(apiKey);
    if (provider === 'openrouter')
        await validateOpenRouterKey(prepared);
    return await setApiKey(provider, apiKey);
}
//# sourceMappingURL=host-services.js.map