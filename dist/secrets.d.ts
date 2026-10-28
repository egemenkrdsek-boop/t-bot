export { redactSecrets } from './security/redact.js';
export type ProviderId = string;
export declare const secretCache: Map<string, string>;
export declare class SecretStorageError extends Error {
    readonly code: 'security' | 'encrypt' | 'decrypt' | 'read' | 'save';
    constructor(code: 'security' | 'encrypt' | 'decrypt' | 'read' | 'save');
}
export interface SecretStorageStatus {
    method: 'dpapi' | 'file';
    warning?: string;
}
export type ApiKeySource = 'saved' | 'provider-env' | 'generic-env' | 'missing';
export declare const normalizeKey: (key: string) => string;
export declare function prepareApiKey(key: string): string;
/**
 * Restrict a data directory to the current user, SYSTEM and Administrators.
 * Windows uses icacls with inheritance removed; Unix uses mode 0700.
 */
export declare function secureDataDirectory(directory: string): Promise<void>;
export declare function setApiKey(id: string, key: string): Promise<SecretStorageStatus>;
export declare function readSavedKey(id: string): Promise<string | undefined>;
export declare function getApiKey(id: string): Promise<string | undefined>;
export declare function getApiKeySource(id: string): Promise<ApiKeySource>;
export declare function deleteApiKey(id: string): Promise<void>;
export declare function getCustomSecret(name: string): Promise<string | undefined>;
export declare function setCustomSecret(name: string, value: string): Promise<void>;
export declare function deleteCustomSecret(name: string): Promise<void>;
export declare function getMcpSecret(service: string): Promise<string | undefined>;
export declare function setMcpSecret(service: string, token: string): Promise<SecretStorageStatus>;
export declare function deleteMcpSecret(service: string): Promise<void>;
export declare function hasMcpSecret(service: string): Promise<boolean>;
/**
 * Universal in-memory cached secret retrieval.
 * Returns in 0ms if already cached, otherwise resolves from DPAPI/disk and stores into secretCache.
 */
export declare function getSecret(key: string): Promise<string | undefined>;
export declare function setSecret(key: string, value: string): Promise<SecretStorageStatus>;
export declare function deleteSecret(key: string): Promise<void>;
