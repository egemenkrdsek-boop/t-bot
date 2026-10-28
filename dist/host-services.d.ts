/**
 * Capabilities shared by every T Bot surface. Keeping these here prevents the
 * CLI and the Electron host from growing different provider, image or key
 * behavior.
 */
import type { AppConfig } from './config.js';
import { discoverModels } from './models.js';
import { PROVIDER_CATALOG } from './providers.js';
import { type SecretStorageStatus } from './secrets.js';
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
export declare function resolveImageProviderConfig(config: AppConfig): Promise<ImageProviderConfig | undefined>;
/**
 * List models for the persisted provider or a provider selected in the UI.
 * A custom/local endpoint keeps its baseUrl, matching the CLI configuration
 * path instead of silently reverting to the public provider catalog.
 */
export declare function listProviderModels(config: AppConfig, providerId?: string, signal?: AbortSignal): Promise<ModelCatalog>;
/**
 * Store an API key with the same validation on every surface. OpenRouter keys
 * are verified before they can be persisted; other providers validate their
 * local format inside setApiKey.
 */
export declare function storeProviderApiKey(provider: string, apiKey: string): Promise<SecretStorageStatus>;
