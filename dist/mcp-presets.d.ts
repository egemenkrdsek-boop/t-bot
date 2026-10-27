/** Trusted integration targets; credentials are stored separately. */
export declare const MCP_PRESETS: readonly [{
    readonly id: "supabase";
    readonly label: "Supabase";
    readonly description: "Resmi Supabase MCP (Hesap Erişim Tokenı / PAT)";
    readonly kind: "remote";
    readonly endpoint: "https://mcp.supabase.com/mcp";
}, {
    readonly id: "github";
    readonly label: "GitHub";
    readonly description: "Resmi GitHub MCP (Kişisel Erişim Tokenı / PAT)";
    readonly kind: "remote";
    readonly endpoint: "https://api.githubcopilot.com/mcp/";
}, {
    readonly id: "vercel";
    readonly label: "Vercel";
    readonly description: "Yerel T Bot MCP Adaptörü (Vercel API Tokenı)";
    readonly kind: "local";
    readonly endpoint: null;
}];
export type McpService = (typeof MCP_PRESETS)[number]['id'];
export interface McpServerDefinition {
    id: string;
    name?: string;
    label?: string;
    description?: string;
    kind?: 'remote' | 'local' | 'stdio';
    endpoint?: string | null;
    url?: string | null;
    command?: string;
    args?: string[];
}
