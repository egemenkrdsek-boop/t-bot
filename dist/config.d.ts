export type WorkspacePermission = 'ask' | 'allow';
export interface AppConfig {
    provider: string;
    model: string;
    baseUrl?: string;
    workspacePermissions: Record<string, WorkspacePermission>;
}
export interface ResolvedProviderConfig {
    id: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
}
export declare const configDirectory: () => string;
export declare function loadConfig(): Promise<AppConfig>;
export declare function saveConfig(config: AppConfig): Promise<void>;
export declare function getWorkspacePermission(config: AppConfig, workspace: string): WorkspacePermission;
export declare function setWorkspacePermission(config: AppConfig, workspace: string, permission: WorkspacePermission): void;
export declare function resolveProviderConfig(config: AppConfig, _workspace?: string): Promise<ResolvedProviderConfig>;
