/** A lost reply does not prove a desktop action was not executed. */
export async function executeDesktopRequest(request, transports, signal) {
    signal?.throwIfAborted();
    try {
        return await transports.daemon(request, signal);
    }
    catch (error) {
        await transports.close().catch(() => { });
        signal?.throwIfAborted();
        const message = error instanceof Error ? error.message : String(error);
        if (/ACİL DURDURMA|KILL-SWITCH/.test(message))
            throw error;
        if (!['windows', 'inspect', 'screenshot'].includes(String(request.action))) {
            throw new Error(`Desktop action outcome is unknown; it was not retried to avoid duplicate input: ${message}`);
        }
        return transports.standalone(request, signal);
    }
}
//# sourceMappingURL=desktop-request.js.map