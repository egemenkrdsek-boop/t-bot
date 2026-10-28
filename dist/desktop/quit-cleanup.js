/** Run cleanup once on actual application quit, with a deadline for broken transports. */
export function registerDesktopQuitCleanup(lifecycle, abort, cleanup, timeoutMs = 5_000) {
    let phase = 'idle';
    lifecycle.on('before-quit', event => {
        if (phase === 'complete')
            return;
        event.preventDefault();
        if (phase === 'cleaning')
            return;
        phase = 'cleaning';
        try {
            abort();
        }
        catch { /* Continue resource cleanup even if cancellation fails. */ }
        let deadline;
        const timeout = new Promise(resolve => { deadline = setTimeout(resolve, timeoutMs); });
        void Promise.race([Promise.resolve().then(cleanup).catch(() => undefined), timeout]).finally(() => {
            clearTimeout(deadline);
            phase = 'complete';
            lifecycle.quit();
        });
    });
}
//# sourceMappingURL=quit-cleanup.js.map