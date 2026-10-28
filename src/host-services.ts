/**
 * Capabilities shared by every T Bot surface. Keeping these here prevents the
 * CLI and the Electron host from growing different provider, image or key
 * behavior.
 */
import type { AppConfig } from './config.js';
import { resolveProviderConfig } from './config.js';
import { fallbackModels, discoverModels } from './models.js';
import { PROVIDER_CATALOG, validateOpenRouterKey } from './providers.js';
import { getApiKey, prepareApiKey, setApiKey, type SecretStorageStatus } from './secrets.js';
import type { ImageProviderConfig } from './tools/image.js';

export interface ModelCatalog {
  providers: typeof PROVIDER_CATALOG;
  currentProvider: string;
  currentModel: string;
  models: Awaited<ReturnType<typeof discoverModels>>;
}

/**
 * Resolve the optional image provider used by the `image_generate` tool. The
 * CLI previously did this inline; the desktop host must pass the same context
 * into every turn or the tool fails despite a configured key.
 */
export async function resolveImageProviderConfig(config: AppConfig): Promise<ImageProviderConfig | undefined> {
  const candidates = [config.provider, 'openai', 'gemini', 'openrouter'] as const;
  const seen = new Set<string>();
  for (const provider of candidates) {
    if (seen.has(provider) || !['openai', 'gemini', 'openrouter'].includes(provider)) continue;
    seen.add(provider);
    const apiKey = await getApiKey(provider);
    if (apiKey) return { provider: provider as ImageProviderConfig['provider'], apiKey };
  }
  return undefined;
}

/**
 * List models for the persisted provider or a provider selected in the UI.
 * A custom/local endpoint keeps its baseUrl, matching the CLI configuration
 * path instead of silently reverting to the public provider catalog.
 */
export async function listProviderModels(
  config: AppConfig,
  providerId?: string,
  signal?: AbortSignal
): Promise<ModelCatalog> {
  const provider = providerId && PROVIDER_CATALOG.some(item => item.id === providerId)
    ? providerId
    : config.provider;
  const selected: AppConfig = {
    ...config,
    provider,
    ...(provider === config.provider ? {} : { baseUrl: undefined }),
  };
  let resolved;
  try {
    resolved = await resolveProviderConfig(selected);
  } catch {
    resolved = { id: provider, model: selected.model, effort: 'medium' as const };
  }
  let models = fallbackModels(provider);
  try {
    models = await discoverModels(provider, resolved.apiKey, signal, resolved.baseUrl);
  } catch {
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
export async function storeProviderApiKey(provider: string, apiKey: string): Promise<SecretStorageStatus> {
  const prepared = prepareApiKey(apiKey);
  if (provider === 'openrouter') await validateOpenRouterKey(prepared);
  return await setApiKey(provider, apiKey);
}
