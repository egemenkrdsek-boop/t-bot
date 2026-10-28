interface QuitEvent { preventDefault(): void }
interface QuitLifecycle {
  on(event: 'before-quit', listener: (event: QuitEvent) => void): unknown;
  quit(): void;
}

/** Run cleanup once on actual application quit, with a deadline for broken transports. */
export function registerDesktopQuitCleanup(
  lifecycle: QuitLifecycle,
  abort: () => void,
  cleanup: () => Promise<unknown>,
  timeoutMs = 5_000,
): void {
  let phase: 'idle' | 'cleaning' | 'complete' = 'idle';
  lifecycle.on('before-quit', event => {
    if (phase === 'complete') return;
    event.preventDefault();
    if (phase === 'cleaning') return;
    phase = 'cleaning';
    try { abort(); } catch { /* Continue resource cleanup even if cancellation fails. */ }
    let deadline: ReturnType<typeof setTimeout>;
    const timeout = new Promise<void>(resolve => { deadline = setTimeout(resolve, timeoutMs); });
    void Promise.race([Promise.resolve().then(cleanup).catch(() => undefined), timeout]).finally(() => {
      clearTimeout(deadline);
      phase = 'complete';
      lifecycle.quit();
    });
  });
}
