/** Trusted integration targets; credentials are stored separately. */
export const MCP_PRESETS = [
    { id: 'supabase', label: 'Supabase', description: 'Resmi Supabase MCP (Hesap Erişim Tokenı / PAT)', kind: 'remote', endpoint: 'https://mcp.supabase.com/mcp' },
    { id: 'github', label: 'GitHub', description: 'Resmi GitHub MCP (Kişisel Erişim Tokenı / PAT)', kind: 'remote', endpoint: 'https://api.githubcopilot.com/mcp/' },
    { id: 'vercel', label: 'Vercel', description: 'Yerel T Bot MCP Adaptörü (Vercel API Tokenı)', kind: 'local', endpoint: null },
];
//# sourceMappingURL=mcp-presets.js.map