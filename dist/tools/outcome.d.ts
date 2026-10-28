/**
 * Structured tool result plus the legacy text contract.
 *
 * Surfaces can read `ok`/`status`/`durationMs` directly while the model keeps
 * receiving the same string shape as before. Failures always render with the
 * `Tool error:` prefix that `isToolResultOk` recognises.
 */
export interface ToolOutcome {
    ok: boolean;
    status: string;
    summary: string;
    detail?: string;
    data?: unknown;
    error?: string;
    durationMs?: number;
}
export interface ToolOutcomeOptions {
    status?: string;
    detail?: string;
    data?: unknown;
    durationMs?: number;
}
export declare function okOutcome(summary: string, options?: ToolOutcomeOptions): ToolOutcome;
export declare function errorOutcome(error: string, options?: ToolOutcomeOptions & {
    summary?: string;
}): ToolOutcome;
export declare function renderOutcome(outcome: ToolOutcome): string;
