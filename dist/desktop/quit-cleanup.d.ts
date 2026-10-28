interface QuitEvent {
    preventDefault(): void;
}
interface QuitLifecycle {
    on(event: 'before-quit', listener: (event: QuitEvent) => void): unknown;
    quit(): void;
}
/** Run cleanup once on actual application quit, with a deadline for broken transports. */
export declare function registerDesktopQuitCleanup(lifecycle: QuitLifecycle, abort: () => void, cleanup: () => Promise<unknown>, timeoutMs?: number): void;
export {};
