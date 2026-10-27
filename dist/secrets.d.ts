export type ProviderId = string;
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
export declare function setApiKey(id: string, key: string): Promise<SecretStorageStatus>;
export declare function readSavedKey(id: string): Promise<string | undefined>;
export declare function getApiKey(id: string): Promise<string | undefined>;
export declare function getApiKeySource(id: string): Promise<ApiKeySource>;
export declare function deleteApiKey(id: string): Promise<void>;
export declare function getSecret(id: ProviderId | string): Promise<string | undefined>;
export declare function setSecret(id: ProviderId | string, key: string): Promise<SecretStorageStatus>;
export declare function deleteSecret(id: ProviderId | string): Promise<void>;
export declare function getCustomSecret(name: string): Promise<string | undefined>;
export declare function setCustomSecret(name: string, value: string): Promise<void>;
export declare function deleteCustomSecret(name: string): Promise<void>;
