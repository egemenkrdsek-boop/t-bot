interface QuitEvent {
    preventDefault(): void;
}
interface QuitLifecycle {
    on(event: 'before-quit', listener: (event: QuitEvent) => void): unknown;
    quit(): void;
}
type MaybePromise = void | Promise<unknown>;
/**
 * Run cleanup once on actual application quit. The active turn gets a bounded
 * chance to flush pending checkpoints before cancellation, and its own settled
 * promise is awaited (bounded) so partial messages reach disk.
 */
export declare function registerDesktopQuitCleanup(lifecycle: QuitLifecycle, abort: () => MaybePromise, cleanup: () => Promise<unknown>, timeoutMs?: number, flush?: () => MaybePromise, flushTimeoutMs?: number, abortTimeoutMs?: number): void;
export {};
