interface DesktopTransports {
    daemon(request: Record<string, unknown>, signal?: AbortSignal): Promise<string>;
    standalone(request: Record<string, unknown>, signal?: AbortSignal): Promise<string>;
    close(): Promise<void>;
}
/** A lost reply does not prove a desktop action was not executed. */
export declare function executeDesktopRequest(request: Record<string, unknown>, transports: DesktopTransports, signal?: AbortSignal): Promise<string>;
export {};
