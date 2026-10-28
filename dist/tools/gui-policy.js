/**
 * Shared GUI observation policy.
 *
 * The default is intentionally cheap: after a click/type/key action the model
 * receives the page or window state, not a full DOM/UIA scan plus screenshot.
 * Screenshots remain explicit tools (`browser_screenshot`, computer screenshot)
 * or `observe: "visual"` when visual confirmation is genuinely needed.
 */
export const GUI_WARM_IDLE_MS = 10 * 60_000;
export const MAX_BATCH_STEPS = 12;
export function parseGuiObservation(value) {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return text === 'none' || text === 'state' || text === 'visual' ? text : undefined;
}
/** `auto_screenshot` is a backward-compatible alias for visual observation. */
export function guiObservation(args) {
    const explicit = parseGuiObservation(args.observe);
    if (explicit)
        return explicit;
    return args.auto_screenshot === true ? 'visual' : 'state';
}
export function isComputerObservationAction(action) {
    return action === 'inspect' || action === 'windows' || action === 'screenshot';
}
export function isComputerMutationAction(action) {
    return ['focus', 'click', 'type', 'key', 'scroll', 'open', 'move', 'drag'].includes(action);
}
export function validateBatchSteps(value, allowed) {
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error('steps must be a non-empty array');
    }
    if (value.length > MAX_BATCH_STEPS) {
        throw new Error(`steps is limited to ${MAX_BATCH_STEPS} actions per batch`);
    }
    return value.map((step, index) => {
        if (!step || typeof step !== 'object' || Array.isArray(step)) {
            throw new Error(`step ${index + 1} must be an object`);
        }
        const action = typeof step.action === 'string'
            ? String(step.action).trim().toLowerCase()
            : '';
        if (!allowed.includes(action)) {
            throw new Error(`step ${index + 1} has unsupported action "${action}"`);
        }
        return { ...step, action };
    });
}
export function compactStateText(kind, title, target) {
    return `${kind === 'page' ? 'Page' : 'Window'}: ${title || '(untitled)'} (${target || 'unknown'})`;
}
//# sourceMappingURL=gui-policy.js.map