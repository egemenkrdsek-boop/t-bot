/** Trusted integration targets; credentials are stored separately. */
export const MCP_PRESETS = [
    { id: 'supabase', label: 'Supabase', description: 'Resmi Supabase MCP (hesap erişim tokenı / PAT)', kind: 'remote', endpoint: 'https://mcp.supabase.com/mcp' },
    { id: 'github', label: 'GitHub', description: 'Resmi GitHub MCP (kişisel erişim tokenı / PAT)', kind: 'remote', endpoint: 'https://api.githubcopilot.com/mcp/' },
    { id: 'vercel', label: 'Vercel', description: 'Yerel TBot MCP adaptörü (Vercel API tokenı)', kind: 'local', endpoint: null },
];
//# sourceMappingURL=mcp-presets.js.map