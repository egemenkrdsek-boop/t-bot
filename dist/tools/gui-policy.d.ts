/**
 * Shared GUI observation policy.
 *
 * The default is intentionally cheap: after a click/type/key action the model
 * receives the page or window state, not a full DOM/UIA scan plus screenshot.
 * Screenshots remain explicit tools (`browser_screenshot`, computer screenshot)
 * or `observe: "visual"` when visual confirmation is genuinely needed.
 */
export type GuiObservation = 'none' | 'state' | 'visual';
export declare const GUI_WARM_IDLE_MS: number;
export declare const MAX_BATCH_STEPS = 12;
export declare function parseGuiObservation(value: unknown): GuiObservation | undefined;
/** `auto_screenshot` is a backward-compatible alias for visual observation. */
export declare function guiObservation(args: Record<string, unknown>): GuiObservation;
export declare function isComputerObservationAction(action: string): boolean;
export declare function isComputerMutationAction(action: string): boolean;
export interface BatchStep {
    action: string;
    [key: string]: unknown;
}
export declare function validateBatchSteps(value: unknown, allowed: readonly string[]): BatchStep[];
export declare function compactStateText(kind: 'page' | 'window', title: string, target: string): string;
