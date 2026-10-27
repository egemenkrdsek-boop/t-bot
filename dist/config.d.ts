import { type EffortLevel } from './effort.js';
export type WorkspacePermission = 'ask' | 'allow';
export interface AppConfig {
    provider: string;
    model: string;
    baseUrl?: string;
    workspacePermissions: Record<string, WorkspacePermission>;
    efforts?: Record<string, EffortLevel>;
    telegramBotToken?: boolean;
    telegramAllowedChatIds?: string[];
}
export type Config = AppConfig;
export interface ResolvedProviderConfig {
    id: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
    effort: EffortLevel;
}
export declare const configDirectory: () => string;
export declare const DEFAULT_CONFIG: AppConfig;
export declare function normalizeConfig(input: Partial<AppConfig> | Record<string, unknown>): AppConfig;
export declare function loadConfig(): Promise<AppConfig>;
export declare function saveConfig(config: AppConfig): Promise<void>;
export declare function getWorkspacePermission(config: AppConfig, workspace: string): WorkspacePermission;
export declare function setWorkspacePermission(config: AppConfig, workspace: string, permission: WorkspacePermission): void;
export declare function getEffort(config: AppConfig, provider?: string, model?: string): EffortLevel;
export declare function setEffort(config: AppConfig, level: EffortLevel, provider?: string, model?: string): void;
export declare function resolveProviderConfig(config: AppConfig, _workspace?: string): Promise<ResolvedProviderConfig>;
