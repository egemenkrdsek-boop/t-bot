interface QuitEvent { preventDefault(): void }
interface QuitLifecycle {
  on(event: 'before-quit', listener: (event: QuitEvent) => void): unknown;
  quit(): void;
}

type MaybePromise = void | Promise<unknown>;

function isThenable(value: unknown): value is Promise<unknown> {
  return Boolean(value) && typeof (value as Promise<unknown>).then === 'function';
}

/** Invoke immediately; return a promise only when the action is asynchronous. */
function invoke(action: (() => MaybePromise) | undefined): Promise<unknown> | undefined {
  if (!action) return undefined;
  try {
    const result = action();
    return isThenable(result) ? result : undefined;
  } catch {
    return undefined;
  }
}

function withDeadline(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>(resolve => { deadline = setTimeout(resolve, timeoutMs); });
  return Promise.race([promise.catch(() => undefined), timeout]).finally(() => { clearTimeout(deadline); }) as Promise<void>;
}

/**
 * Run cleanup once on actual application quit. The active turn gets a bounded
 * chance to flush pending checkpoints before cancellation, and its own settled
 * promise is awaited (bounded) so partial messages reach disk.
 */
export function registerDesktopQuitCleanup(
  lifecycle: QuitLifecycle,
  abort: () => MaybePromise,
  cleanup: () => Promise<unknown>,
  timeoutMs = 5_000,
  flush?: () => MaybePromise,
  flushTimeoutMs = 3_000,
  abortTimeoutMs = 2_000,
): void {
  let phase: 'idle' | 'flushing' | 'cleaning' | 'complete' = 'idle';
  lifecycle.on('before-quit', event => {
    if (phase === 'complete') return;
    event.preventDefault();
    if (phase !== 'idle') return;
    phase = 'flushing';
    void (async () => {
      // Flush pending checkpoint writes before cancelling the turn.
      const flushing = invoke(flush);
      if (flushing) await withDeadline(flushing, flushTimeoutMs);
      const aborting = invoke(abort);
      if (aborting) await withDeadline(aborting, abortTimeoutMs);
      phase = 'cleaning';
      await withDeadline(Promise.resolve().then(cleanup).catch(() => undefined), timeoutMs);
      phase = 'complete';
      lifecycle.quit();
    })();
  });
}
