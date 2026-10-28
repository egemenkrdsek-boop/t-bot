import type { AgentEvent } from './types.js';
interface CliEventPrinter {
    emit: (event: AgentEvent) => void;
    /** Flush the final line so a redirected stdout never ends mid-block. */
    finish: () => void;
}
/**
 * One ordered stdout stream for assistant text with explicit block boundaries.
 * Control lines (tool/status/error) stay on stderr for piping, but stdout gets a
 * newline before and after them so separate assistant turns cannot concatenate.
 */
export declare function createCliEventPrinter(writeOut?: (text: string) => void, writeErr?: (text: string) => void): CliEventPrinter;
export declare function main(argv: string[]): Promise<void>;
export {};
