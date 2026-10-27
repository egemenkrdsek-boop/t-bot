export interface SecretStorageStatus {
    method: 'dpapi' | 'file';
    warning?: string;
}
export declare function setApiKey(id: string, key: string): Promise<SecretStorageStatus>;
export declare function getApiKey(id: string): Promise<string | undefined>;
export declare function deleteApiKey(id: string): Promise<void>;
