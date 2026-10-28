function isThenable(value) {
    return Boolean(value) && typeof value.then === 'function';
}
/** Invoke immediately; return a promise only when the action is asynchronous. */
function invoke(action) {
    if (!action)
        return undefined;
    try {
        const result = action();
        return isThenable(result) ? result : undefined;
    }
    catch {
        return undefined;
    }
}
function withDeadline(promise, timeoutMs) {
    let deadline;
    const timeout = new Promise(resolve => { deadline = setTimeout(resolve, timeoutMs); });
    return Promise.race([promise.catch(() => undefined), timeout]).finally(() => { clearTimeout(deadline); });
}
/**
 * Run cleanup once on actual application quit. The active turn gets a bounded
 * chance to flush pending checkpoints before cancellation, and its own settled
 * promise is awaited (bounded) so partial messages reach disk.
 */
export function registerDesktopQuitCleanup(lifecycle, abort, cleanup, timeoutMs = 5_000, flush, flushTimeoutMs = 3_000, abortTimeoutMs = 2_000) {
    let phase = 'idle';
    lifecycle.on('before-quit', event => {
        if (phase === 'complete')
            return;
        event.preventDefault();
        if (phase !== 'idle')
            return;
        phase = 'flushing';
        void (async () => {
            // Flush pending checkpoint writes before cancelling the turn.
            const flushing = invoke(flush);
            if (flushing)
                await withDeadline(flushing, flushTimeoutMs);
            const aborting = invoke(abort);
            if (aborting)
                await withDeadline(aborting, abortTimeoutMs);
            phase = 'cleaning';
            await withDeadline(Promise.resolve().then(cleanup).catch(() => undefined), timeoutMs);
            phase = 'complete';
            lifecycle.quit();
        })();
    });
}
//# sourceMappingURL=quit-cleanup.js.map