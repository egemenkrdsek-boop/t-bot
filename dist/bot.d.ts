import type { Config } from './types.js';
import type { Session } from './sessions.js';
import type { SkillId } from './skills.js';
import type { McpConnection } from './mcp.js';
/**
 * Options required to initialize and run the zero-backend Telegram Bot Bridge.
 */
export interface TelegramBridgeOptions {
    config: Config;
    session: Session;
    workspace: string;
    getYolo: () => boolean;
    /** Retained for host compatibility; skills are resolved per user message. */
    activeSkills?: SkillId[];
    onLog?: (text: string) => void;
    mcpTools?: McpConnection[];
}
/**
 * Splits text into chunks conforming to Telegram's 4096 character limit and sends each chunk.
 */
export declare function sendTelegramMessage(token: string, chatId: string, text: string, replyMarkup?: Record<string, unknown>): Promise<void>;
/**
 * Sends a photo to a Telegram chat using native FormData, Blob, and fs.readFile.
 */
export declare function sendTelegramPhoto(token: string, chatId: string, filePath: string, caption?: string): Promise<boolean>;
/**
 * Scans workspace directories for screenshots and generated images created during a run turn.
 */
export declare function collectGeneratedImages(workspace: string, startTime: number): Promise<string[]>;
/**
 * Starts the Zero-Backend Local Telegram Bot Gateway Bridge.
 */
export declare function startTelegramBotBridge(options: {
    config: Config;
    session: Session;
    workspace: string;
    getYolo: () => boolean;
    /** Retained for host compatibility; skills are resolved per user message. */
    activeSkills?: SkillId[];
    onLog?: (text: string) => void;
    mcpTools?: McpConnection[];
}): Promise<{
    ok: boolean;
    username?: string;
    error?: string;
}>;
/**
 * Gracefully stops the Telegram Bot Gateway Bridge and releases resources.
 */
export declare function stopTelegramBotBridge(): void;
/**
 * Returns the current runtime status of the Telegram Bot Gateway Bridge.
 */
export declare function getTelegramBotStatus(): {
    running: boolean;
    username?: string;
    allowedChats: string[];
    handledCount: number;
};
/**
 * Checks whether the Telegram Bot Bridge is actively running.
 */
export declare function isTelegramBotRunning(): boolean;
