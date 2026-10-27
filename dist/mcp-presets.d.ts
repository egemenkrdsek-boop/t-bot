/** Trusted integration targets; credentials are stored separately. */
export declare const MCP_PRESETS: readonly [{
    readonly id: "supabase";
    readonly label: "Supabase";
    readonly description: "Resmi Supabase MCP (hesap erişim tokenı / PAT)";
    readonly kind: "remote";
    readonly endpoint: "https://mcp.supabase.com/mcp";
}, {
    readonly id: "vercel";
    readonly label: "Vercel";
    readonly description: "Yerel TBot MCP adaptörü (Vercel API tokenı)";
    readonly kind: "local";
    readonly endpoint: null;
}];
export type McpService = (typeof MCP_PRESETS)[number]['id'];
