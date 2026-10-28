import type { AgentEvent, ApprovalRequest, Message, Provider } from './types.js';
import { logo } from './logo.js';
export { logo };
export interface HudConfig {
    model?: string;
    provider?: Provider | string;
    effort?: string;
    yolo?: boolean;
    workspace?: string;
    mcpCount?: number;
}
/**
 * Tekilleştirilmiş Zarif Cyber-Zen HUD Çubuğu:
 * ╭─[ Model: ... │ Efor: ... │ Tasarruf: %XX ▰▱ (Y Tok) │ Doğrulama: Doğrulandı │ Bellek: XX MB ● (Sistem: %YY) │ Bot: Aktif / Pasif ]─╮
 */
export declare function renderHudBar(config: HudConfig): string;
export interface EventPrinterOptions {
    interactive: boolean;
    getHudConfig: () => HudConfig;
    write?: (text: string) => void;
}
export interface EventPrinter {
    emit: (event: AgentEvent) => void;
    finishStream: () => void;
    startThinking: (label?: string) => void;
    stopThinking: () => void;
    stopSpinner: () => void;
}
export declare const TOOL_TITLE_MAP: Record<string, string>;
export declare function formatToolTitle(toolName: string): string;
/**
 * Sıfır-Kırpışmalı (DEC ?2026h/?2026l), Sıfır-Taşmalı (truncateAnsi),
 * Görsel Görev Ağacı ve Ultracode Stepper destekli Cyber-Zen EventPrinter.
 */
export declare function createEventPrinter(options: EventPrinterOptions): EventPrinter;
/** Print comprehensive help menu with modern cyber-minimalist categories. */
export declare function printHelp(): void;
export interface TuiOptions {
    workspace: string;
    provider: Provider;
    model: string;
    history: Message[];
    onSubmit: (message: string, emit: (event: AgentEvent) => void, approve: (request: ApprovalRequest) => Promise<boolean>, signal: AbortSignal) => Promise<Message[]>;
    onCommand?: (command: string, setYolo: (enabled: boolean) => void) => Promise<string | undefined>;
    yolo?: boolean;
    modeStatus?: () => string;
    onWorkflow?: (command: string, input: string, emit: (event: AgentEvent) => void, approve: (request: ApprovalRequest) => Promise<boolean>, signal: AbortSignal, suspendUi: <T>(action: () => Promise<T>) => Promise<T>) => Promise<void>;
}
export declare function startTui(options: TuiOptions): Promise<void>;
