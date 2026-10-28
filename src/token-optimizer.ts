import type { Message, ToolDefinition } from './types.js';
import { planContextWindow, type ContextWindow } from './context-window.js';

// Pre-compiled BPE approximation regex moved outside estimateTokens for zero re-compilation overhead
const tokenRegex = /'s|'t|'re|'ve|'m|'ll|'d|\p{Lu}\p{Ll}+|\p{Lu}+(?!\p{Ll})|\p{Ll}+|\p{L}+|\p{N}+|===|!==|==|!=|<=|>=|=>|->|\+\+|--|&&|\|\||\+=|-=|\*=|\/=|::|[{}()[\].,;:<>+\-=*\/\\|!@#$%^&~?`"']|\r\n|\r|\n|\s+|\P{M}\p{M}+|[^\s\p{L}\p{N}]/gu;

const MAX_STRING_CACHE_SIZE = 600;
export const stringTokenCache = new Map<string, number>();
export const messageTokenCache = new WeakMap<Message, { contentRef: string; tokens: number }>();
export const toolTokenCache = new WeakMap<ToolDefinition, number>();
const minifiedToolCache = new WeakMap<ToolDefinition, ToolDefinition>();
export const compressedToolOutputCache = new WeakMap<Message, { content: string; summary: string }>();

/**
 * The LRU key is a 64-bit FNV-style fingerprint plus the length, not the text
 * itself. Keeping full strings as Map keys retained megabytes of duplicated
 * source/evidence in the heap.
 */
function tokenCacheKey(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 + code, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(36)}.${(h2 >>> 0).toString(36)}.${text.length.toString(36)}`;
}

/**
 * Fast, dependency-free BPE token estimator with 600-entry LRU memoization and charCodeAt fast-paths.
 * Mimics modern LLM tokenizers (cl100k_base / o200k / Llama / Claude).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  if (text.length <= 24_000) {
    const cached = stringTokenCache.get(text);
    if (cached !== undefined) {
      // Refresh LRU order
      stringTokenCache.delete(text);
      stringTokenCache.set(text, cached);
      return cached;
    }
  }

  tokenRegex.lastIndex = 0;
  let tokens = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    const chunk = match[0];
    const len = chunk.length;
    const firstCode = chunk.charCodeAt(0);

    // 1. Whitespace / Indentation fast check via charCodeAt (' ', '\t', '\n', '\r', NBSP)
    if (
      firstCode === 32 ||
      firstCode === 9 ||
      firstCode === 10 ||
      firstCode === 13 ||
      firstCode === 160
    ) {
      let newlines = 0;
      let trailingSpaces = 0;
      for (let i = 0; i < len; i++) {
        const c = chunk.charCodeAt(i);
        if (c === 10) {
          newlines++;
          trailingSpaces = 0;
        } else if (c !== 13) {
          trailingSpaces++;
        }
      }
      if (newlines > 0) {
        tokens += newlines + (trailingSpaces > 0 ? Math.ceil(trailingSpaces / 4) : 0);
      } else {
        tokens += Math.max(1, Math.ceil(len / 4));
      }
      continue;
    }

    // 2. Numbers ('0'..'9')
    if (firstCode >= 48 && firstCode <= 57) {
      tokens += Math.max(1, Math.ceil(len / 2.7));
      continue;
    }

    // 3. Punctuation / Code operators via ASCII ranges (excluding contractions like 's, 't, 're)
    const isAsciiPunct =
      (firstCode >= 33 && firstCode <= 47) ||
      (firstCode >= 58 && firstCode <= 64) ||
      (firstCode >= 91 && firstCode <= 96) ||
      (firstCode >= 123 && firstCode <= 126);

    if (isAsciiPunct && !(firstCode === 39 && len > 1 && chunk.charCodeAt(1) >= 97)) {
      tokens += len <= 3 ? 1 : Math.ceil(len / 2);
      continue;
    }

    // 4. Words / Letters: detect multibyte / Turkish characters via charCodeAt (> 127)
    let multibyteCount = 0;
    for (let i = 0; i < len; i++) {
      if (chunk.charCodeAt(i) > 127) {
        multibyteCount++;
      }
    }
    const turkishExtra = multibyteCount > 0 ? multibyteCount * 0.45 : 0;
    tokens += Math.max(1, Math.ceil(len / 3.7 + turkishExtra));
  }

  if (text.length <= 24_000) {
    if (stringTokenCache.size >= MAX_STRING_CACHE_SIZE) {
      const oldestKey = stringTokenCache.keys().next().value;
      if (oldestKey !== undefined) {
        stringTokenCache.delete(oldestKey);
      }
    }
    stringTokenCache.set(text, tokens);
  }

  return tokens;
}

function estimateSingleToolTokens(tool: ToolDefinition): number {
  const cached = toolTokenCache.get(tool);
  if (cached !== undefined) return cached;

  let t = 12 + estimateTokens(tool.name);
  if (tool.description) t += estimateTokens(tool.description);
  if (tool.parameters) t += estimateTokens(JSON.stringify(tool.parameters));

  toolTokenCache.set(tool, t);
  return t;
}

/**
 * Calculates estimated token count across messages, tool calls, response items, system prompt and tool definitions.
 * Uses WeakMap memoization on Message and ToolDefinition objects.
 */
export function estimateMessagesTokens(
  messages: Message[],
  systemPrompt?: string,
  tools?: ToolDefinition[]
): number {
  let total = 0;

  if (systemPrompt) {
    total += estimateTokens(systemPrompt) + 4;
  }

  for (const message of messages) {
    const cachedMsg = messageTokenCache.get(message);
    // Attachments, calls and native response items may change independently of content.
    if (cachedMsg && cachedMsg.contentRef === message.content &&
      !message.images?.length && !message.toolCalls?.length && !message.toolCallId && !message.responseItems?.length) {
      total += cachedMsg.tokens;
      continue;
    }

    let msgTokens = 4; // message role wrapper overhead
    if (message.content) {
      msgTokens += estimateTokens(message.content);
    }
    if (message.images?.length) {
      msgTokens += message.images.length * 256;
    }
    if (message.toolCalls?.length) {
      for (const call of message.toolCalls) {
        msgTokens += 8 + estimateTokens(call.name);
        if (call.arguments) {
          msgTokens += estimateTokens(JSON.stringify(call.arguments));
        }
        if (call.id) {
          msgTokens += estimateTokens(call.id);
        }
      }
    }
    if (message.toolCallId) {
      msgTokens += estimateTokens(message.toolCallId) + 2;
    }
    if (message.responseItems?.length) {
      msgTokens += estimateTokens(JSON.stringify(message.responseItems));
    }

    if (!message.images?.length && !message.toolCalls?.length && !message.toolCallId && !message.responseItems?.length) {
      messageTokenCache.set(message, { contentRef: message.content, tokens: msgTokens });
    } else {
      messageTokenCache.delete(message);
    }
    total += msgTokens;
  }

  if (tools?.length) {
    for (const tool of tools) {
      total += estimateSingleToolTokens(tool);
    }
  }

  return total;
}

/** Always preserved core tools that must never be pruned. */
export const CORE_TOOLS = new Set([
  'file_read',
  'file_outline',
  'file_patch',
  'file_write',
  'file_search',
  'file_glob',
  'shell',
  'memory_recall',
  'delegate_task',
  'todo_manage',
  'goal_manage',
  'diagnostics',
  'checkpoint_list',
  // Configured services must remain discoverable even without a service-name keyword.
  'mcp_catalog',
  'mcp_call',
]);

/**
 * Sticky intent groups activated during the current session.
 * Once an intent group is activated, it stays active for the rest of the session
 * so the `tools` array prefix remains stable and never invalidates the provider Prompt Cache.
 */
export const activeIntentGroups = new Set<string>();

export function resetActiveIntentGroups(): void {
  activeIntentGroups.clear();
}

const INTENT_GROUP_KEYWORDS: Record<string, string[]> = {
  git: [
    'git', 'commit', 'branch', 'push', 'pull', 'merge', 'diff',
    'status', 'stash', 'checkout', 'rebase', 'log', 'repo', 'pr',
  ],
  process: [
    'process', 'process_write', 'arka plan', 'arkaplan', 'background', 'daemon',
    'sunucu', 'server', 'serve', 'pid', 'kill', 'stop', 'port', 'watch',
    'job', 'stdin', 'stdout', 'interactive', 'etkileşimli', 'input stream',
    'npm run', 'npm', 'dev', 'start', 'başlat', 'baslat', 'çalıştır', 'calistir',
    'uygulama çalıştır', 'uygulama başlat', 'run dev', 'dev server',
  ],
  memory: [
    'hatırla', 'hatirla', 'unut', 'hafıza', 'hafiza', 'bellek',
    'memory', 'remember', 'forget', 'tercih', 'preference', 'not al',
  ],
  skill: [
    'skill', 'beceri', 'yetenek', 'şablon', 'sablon', 'workflow',
    'skill_create', 'skill_list',
  ],
  browser: [
    'web', 'tarayıcı', 'tarayici', 'url', 'http', 'https', 'localhost',
    'scrape', 'sayfa', 'browser', 'ui testi', 'site', 'playwright', 'dom',
    'araştır', 'arastir', 'search', 'fetch', 'google', 'dokümantasyon',
    'documentation', 'internette ara', 'link', 'web_search', 'url_fetch',
    'aç', 'uygulama', 'program', 'gui', 'arayüz', 'buton', 'düğme',
    'dropdown', 'drop-down', 'scroll', 'focused', 'press', 'enter', 'select option',
    'kaydır', 'kaydir', 'tuş', 'tus', 'açılır', 'acilir',
    'tıkla', 'tikla', 'ekbanda', 'ekrandaki', 'form', 'giriş yap', 'login', 'sekme', 'tab', 'izle', 'gör',
  ],
  computer: [
    'masaüstü', 'masaustu', 'ekran', 'pencere', 'mouse', 'fare',
    'klavye', 'desktop', 'screen', 'window', 'click', 'screenshot', 'computer',
    'aç', 'uygulama', 'program', 'gui', 'arayüz', 'buton', 'düğme',
    'tıkla', 'tikla', 'ekbanda', 'ekrandaki', 'form', 'giriş yap', 'login', 'sekme', 'tab', 'izle', 'gör',
  ],
  image: [
    'görsel', 'gorsel', 'resim', 'logo', 'ikon', 'icon',
    'çiz', 'ciz', 'image', 'picture', 'draw', 'banner',
  ],
  mcp: [
    'github', 'supabase', 'vercel', 'deploy', 'database',
    'veritabanı', 'veritabani', 'postgres', 'sql', 'mcp', 'migration',
  ],
};

function classifyToolIntentGroup(toolName: string): string | null {
  if (CORE_TOOLS.has(toolName) || toolName === 'todo_manage' || toolName === 'goal_manage') return 'core';
  if (toolName.startsWith('git_')) return 'git';
  if (toolName.startsWith('process_') || toolName === 'process_write') return 'process';
  if (toolName === 'memory_save' || toolName === 'memory_forget' || toolName.startsWith('memory_')) return 'memory';
  if (toolName === 'skill_create' || toolName === 'skill_list' || toolName.startsWith('skill_')) return 'skill';
  if (
    toolName === 'web_search' ||
    toolName === 'url_fetch' ||
    toolName === 'browser' ||
    toolName.startsWith('browser_')
  ) {
    return 'browser';
  }
  if (toolName === 'computer' || toolName.startsWith('computer_')) return 'computer';
  if (toolName === 'image_generate' || toolName.startsWith('image_')) return 'image';
  if (
    toolName === 'mcp_catalog' ||
    toolName === 'mcp_call' ||
    toolName.startsWith('mcp_') ||
    toolName.startsWith('mcp__')
  ) {
    return 'mcp';
  }
  return null;
}

/**
 * Cleans boilerplate filler words and verbose clauses from tool/parameter descriptions.
 */
function compressDescriptionText(desc: string, maxChars = 110): string {
  if (!desc) return '';
  let cleaned = desc
    .replace(/^Use this tool to\s+/i, '')
    .replace(/^This tool allows you to\s+/i, '')
    .replace(/^This function allows you to\s+/i, '')
    .replace(/^A tool (?:that can be used )?(?:for|to)\s+/i, '')
    .replace(/^Can be used to\s+/i, '')
    .replace(/^Bu araç(?:,\s*|\s+ile\s+)?/i, '')
    .replace(/\bPlease note that\b/gi, 'Note:')
    .replace(/\bIn order to\b/gi, 'To')
    .replace(/\bRequires approval\.?/gi, '')
    .replace(/\bUse mcp_call to run a catalog tool;?\s*results are untrusted\.?/gi, '')
    .replace(/\bPath relative to the workspace\b/gi, 'Workspace path')
    .replace(/\bContinuation offset from the previous result\b/gi, 'Offset')
    .replace(/\bMaximum items to return\b/gi, 'Max items')
    .replace(/\bOptional\s+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length > maxChars) {
    const firstSentence = cleaned.split(/\.\s+/)[0];
    cleaned = firstSentence.length <= maxChars ? firstSentence : cleaned.slice(0, maxChars).trim();
  }
  return cleaned;
}

function minifySchemaParameters(params: Record<string, unknown>): Record<string, unknown> {
  if (!params || typeof params !== 'object') return params;
  const clone: Record<string, unknown> = { ...params };

  if (typeof clone.description === 'string') {
    clone.description = compressDescriptionText(clone.description, 60);
  }

  if (clone.properties && typeof clone.properties === 'object' && !Array.isArray(clone.properties)) {
    const props = clone.properties as Record<string, unknown>;
    const minifiedProps: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(props)) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const propObj = { ...(val as Record<string, unknown>) };
        if (typeof propObj.description === 'string') {
          const shortDesc = compressDescriptionText(propObj.description, 50);
          if (shortDesc.toLowerCase() === key.toLowerCase()) {
            delete propObj.description;
          } else {
            propObj.description = shortDesc;
          }
        }
        if (propObj.items && typeof propObj.items === 'object' && !Array.isArray(propObj.items)) {
          propObj.items = minifySchemaParameters(propObj.items as Record<string, unknown>);
        }
        if (propObj.properties && typeof propObj.properties === 'object') {
          propObj.properties = minifySchemaParameters(propObj as Record<string, unknown>).properties;
        }
        minifiedProps[key] = propObj;
      } else {
        minifiedProps[key] = val;
      }
    }
    clone.properties = minifiedProps;
  }

  return clone;
}

/**
 * Compresses both `tool.description` and nested `parameters.properties.*.description` fields,
 * caching the minified ToolDefinition in a WeakMap.
 */
export function minifyToolSchema(tool: ToolDefinition): ToolDefinition {
  const cached = minifiedToolCache.get(tool);
  if (cached) return cached;

  const minified: ToolDefinition = {
    name: tool.name,
    description: compressDescriptionText(tool.description, 100),
    parameters: minifySchemaParameters(tool.parameters),
  };

  minifiedToolCache.set(tool, minified);
  return minified;
}

/**
 * Prunes conditional heavy tool definitions with Prompt-Cache-safe sticky activation
 * and deep schema minification.
 */
export function pruneToolDefinitions(
  tools: ToolDefinition[],
  userQuery: string,
  activeSkills: string[] = [],
  history: Message[] = [],
  intentGroups: Set<string> = activeIntentGroups
): { tools: ToolDefinition[]; savedTokens: number; prunedCount: number } {
  const originalTokens = tools.reduce((acc, t) => acc + estimateSingleToolTokens(t), 0);

  const recentHistoryTexts = history.slice(-4).map(m => m.content || '').join(' ');
  const combinedContext = `${userQuery} ${recentHistoryTexts}`.toLowerCase();
  const skillsSet = new Set(activeSkills.map(s => s.toLowerCase()));

  // Check intent groups from current query, recent messages, and active skills
  for (const [group, keywords] of Object.entries(INTENT_GROUP_KEYWORDS)) {
    if (keywords.some(kw => combinedContext.includes(kw))) {
      intentGroups.add(group);
    }
  }

  for (const skill of skillsSet) {
    if (skill.includes('browser') || skill.includes('web') || skill.includes('playwright')) {
      intentGroups.add('browser');
    }
    if (skill.includes('computer') || skill.includes('desktop')) {
      intentGroups.add('computer');
    }
    if (skill.includes('image')) {
      intentGroups.add('image');
    }
    if (skill.includes('git') || skill.includes('pr') || skill.includes('review')) {
      intentGroups.add('git');
    }
    if (skill.includes('mcp') || skill.includes('github') || skill.includes('supabase')) {
      intentGroups.add('mcp');
    }
    if (skill.includes('skill')) {
      intentGroups.add('skill');
    }
  }

  // Also activate groups for any tool already called in conversation history
  for (const msg of history) {
    if (msg.toolCalls?.length) {
      for (const tc of msg.toolCalls) {
        const grp = classifyToolIntentGroup(tc.name);
        if (grp && grp !== 'core') {
          intentGroups.add(grp);
        }
      }
    }
  }

  // Check service-specific remote MCP names in context
  for (const tool of tools) {
    if (tool.name.startsWith('mcp_') || tool.name.startsWith('mcp__')) {
      const serviceName = tool.name.startsWith('mcp__')
        ? tool.name.split('__')[1]?.toLowerCase()
        : tool.name.split('_')[1]?.toLowerCase();
      if (serviceName && serviceName !== 'catalog' && serviceName !== 'call' && combinedContext.includes(serviceName)) {
        intentGroups.add('mcp');
      }
    }
  }

  // Keep tools in a deterministic order so the Prompt Cache prefix never shifts
  const keptTools: ToolDefinition[] = [];

  for (const tool of tools) {
    const group = classifyToolIntentGroup(tool.name);
    if (group === 'core') {
      keptTools.push(minifyToolSchema(tool));
      continue;
    }
    if (group !== null) {
      if (intentGroups.has(group)) {
        keptTools.push(minifyToolSchema(tool));
      }
      continue;
    }
    // Keep file_list only when explicitly needed or when no file_glob is present
    if (tool.name === 'file_list') {
      const hasFileGlob = tools.some(t => t.name === 'file_glob');
      if (!hasFileGlob || combinedContext.includes('file_list') || combinedContext.includes('dizin') || combinedContext.includes('klasör')) {
        keptTools.push(minifyToolSchema(tool));
      }
      continue;
    }
    keptTools.push(minifyToolSchema(tool));
  }

  // Ensure deterministic alphabetical order across all kept tools so the Prompt Cache prefix never shifts
  keptTools.sort((a, b) => a.name.localeCompare(b.name));

  const prunedCount = tools.length - keptTools.length;
  const prunedTokens = keptTools.reduce((acc, t) => acc + estimateSingleToolTokens(t), 0);
  const savedTokens = Math.max(0, originalTokens - prunedTokens);

  return {
    tools: keptTools,
    savedTokens,
    prunedCount,
  };
}

const ANSI_ESCAPE_REGEX = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07/g;
const LOCK_OR_DIST_DIFF_REGEX = /^diff --git a\/([^\s]+) b\/([^\s]+)/;
const NOISE_DIFF_PATH_REGEX = /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|Cargo\.lock|dist\/.+|build\/.+|\.next\/.+)$/i;
const ERROR_SIGNAL_LINE_REGEX = /(?:error|fail|failed|exception|TS\d+|ERR!|fatal|panic| syntaxerror|referenceerror|typeerror)/i;

function stripAnsiAndSpinners(raw: string): string {
  const withoutAnsi = raw.replace(ANSI_ESCAPE_REGEX, '');
  const normalizedNewlines = withoutAnsi.replace(/\r\n/g, '\n');
  if (!normalizedNewlines.includes('\r')) return normalizedNewlines;

  return normalizedNewlines
    .split('\n')
    .map(line => (line.includes('\r') ? line.split('\r').pop() ?? '' : line))
    .join('\n');
}

function collapseGitDiffNoise(diffText: string): string {
  if (!diffText.includes('diff --git ')) return diffText;
  const lines = diffText.split('\n');
  const out: string[] = [];
  let skippingBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = LOCK_OR_DIST_DIFF_REGEX.exec(line);
    if (match) {
      const fileA = match[1];
      const fileB = match[2];
      if (NOISE_DIFF_PATH_REGEX.test(fileA) || NOISE_DIFF_PATH_REGEX.test(fileB)) {
        out.push(line);
        out.push('[Otomatik gizlendi: derleme/kilit dosyası diff bloğu]');
        skippingBlock = true;
      } else {
        skippingBlock = false;
        out.push(line);
      }
      continue;
    }
    if (!skippingBlock) {
      out.push(line);
    }
  }

  return out.join('\n');
}

/**
 * Smart tool output truncation:
 * - Strips ANSI escape sequences and carriage-return (\r) spinner lines.
 * - For `shell` and `process_output` exceeding `maxChars`: keeps first 1,400 chars + middle error/warning lines (up to 1,600 chars) + last 3,500 chars (preserving Exit code & stack trace).
 * - For `git_diff`: collapses lockfiles and dist/ diff blocks into a 1-line placeholder before applying `maxChars`.
 */
export function smartTruncateToolOutput(
  toolName: string,
  output: string,
  maxChars = 8000
): { text: string; savedTokens: number } {
  if (!output) return { text: '', savedTokens: 0 };

  const initialTokens = estimateTokens(output);
  let cleaned = stripAnsiAndSpinners(output);

  if (toolName === 'git_diff') {
    cleaned = collapseGitDiffNoise(cleaned);
  }

  if (cleaned.length <= maxChars) {
    const savedTokens = Math.max(0, initialTokens - estimateTokens(cleaned));
    return { text: cleaned, savedTokens };
  }

  if (toolName === 'shell' || toolName === 'process_output') {
    const scale = maxChars >= 6500 ? 1 : maxChars / 6800;
    const headBudget = Math.max(100, Math.floor(1400 * scale));
    const midBudget = Math.max(100, Math.floor(1600 * scale));
    const tailBudget = Math.max(200, Math.floor(3500 * scale));

    const head = cleaned.slice(0, headBudget);
    const tailStart = Math.max(headBudget, cleaned.length - tailBudget);
    const tail = cleaned.slice(tailStart);
    const middleRaw = cleaned.slice(headBudget, tailStart);

    const middleErrorLines: string[] = [];
    let midChars = 0;
    for (const line of middleRaw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (ERROR_SIGNAL_LINE_REGEX.test(trimmed)) {
        if (midChars + trimmed.length + 1 > midBudget) break;
        middleErrorLines.push(trimmed);
        midChars += trimmed.length + 1;
      }
    }

    const middleSection = middleErrorLines.length > 0
      ? `\n...[Ara çıktı budandı; tespit edilen hata/uyarı satırları (${middleErrorLines.length} satır)]:\n${middleErrorLines.join('\n')}\n...[Son bölüm]:\n`
      : `\n...[${middleRaw.length} karakterlik ara çıktı budandı]...\n`;

    const combined = `${head}${middleSection}${tail}`;
    const savedTokens = Math.max(0, initialTokens - estimateTokens(combined));
    return { text: combined, savedTokens };
  }

  const headBudget = Math.floor(maxChars * 0.5);
  const tailBudget = Math.floor(maxChars * 0.42);
  const truncated = `${cleaned.slice(0, headBudget)}\n...[${cleaned.length - headBudget - tailBudget} karakter budandı]...\n${cleaned.slice(cleaned.length - tailBudget)}`;
  const savedTokens = Math.max(0, initialTokens - estimateTokens(truncated));
  return { text: truncated, savedTokens };
}

/**
 * Deterministically summarizes older tool outputs into structural evidence (file paths, signatures, errors, lines).
 * This is a lossy summary; source should be read again when exact details matter.
 */
function extractStructuralEvidence(content: string): string {
  if (content.length <= 400) return content;

  const fileRegex = /(?:[a-zA-Z]:[\\/]|(?:\.{1,2}[\\/])|\/)[a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9_]+/g;
  const files = Array.from(new Set(content.match(fileRegex) || [])).slice(0, 8);

  const sigRegex = /(?:export\s+)?(?:async\s+)?(?:function\s+[a-zA-Z0-9_$]+|[a-zA-Z0-9_$]+\s*\(.*?\)\s*(?::|\{)|class\s+[a-zA-Z0-9_$]+|interface\s+[a-zA-Z0-9_$]+|type\s+[a-zA-Z0-9_$]+\s*=|def\s+[a-zA-Z0-9_$]+)/g;
  const signatures = Array.from(new Set(content.match(sigRegex) || [])).slice(0, 6);

  const lines = content.split('\n');
  const errorLines = lines
    .filter(l => /(?:error|exception|fail|failed|fatal|reject|denied|timeout|panic|warn|warning|traceback|at\s+[a-zA-Z0-9_$.]+\s*\()/i.test(l))
    .map(l => l.trim())
    .slice(0, 5);

  const diffRanges = Array.from(new Set(content.match(/@@\s*-\d+,\d+\s*\+\d+,\d+\s*@@|lines?\s*\d+(?:-\d+)?/gi) || [])).slice(0, 4);

  const head = lines.slice(0, 2).map(l => l.trim()).filter(Boolean).join(' ');
  const tail = lines.slice(-2).map(l => l.trim()).filter(Boolean).join(' ');

  const parts: string[] = [];
  if (files.length) parts.push(`Dosyalar: ${files.join(', ')}`);
  if (signatures.length) parts.push(`İmzalar: ${signatures.join('; ')}`);
  if (diffRanges.length) parts.push(`Satırlar/Diff: ${diffRanges.join(', ')}`);
  if (errorLines.length) parts.push(`Hata/Durum: ${errorLines.join(' | ')}`);
  if (head || tail) parts.push(`Özet Satırları: [Başlangıç: ${head.slice(0, 100)}] ... [Bitiş: ${tail.slice(0, 100)}]`);

  return `[Kanıt Özeti (${content.length} karakterden sıkıştırıldı):\n${parts.join('\n')}]`;
}

function getCachedEvidenceSummary(msg: Message): string {
  const cached = compressedToolOutputCache.get(msg);
  if (cached?.content === msg.content) return cached.summary;
  const summary = extractStructuralEvidence(msg.content);
  compressedToolOutputCache.set(msg, { content: msg.content, summary });
  return summary;
}

/** Token-budget windowing adapted from Hermes; the session transcript is never mutated. */
export function compressConversationHistory(
  messages: Message[],
  maxTokenBudget = 28_000,
): ContextWindow & { savedTokens: number } {
  const initialTokens = estimateMessagesTokens(messages);
  const window = planContextWindow(messages, maxTokenBudget, estimateMessagesTokens, getCachedEvidenceSummary);
  return { ...window, savedTokens: Math.max(0, initialTokens - window.estimatedTokens) };
}

export interface TokenSavingsReport {
  totalRawTokens: number;
  totalSentInputTokens: number;
  totalUncachedInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalPrunedSchemaTokens: number;
  totalCompressedHistoryTokens: number;
  totalContextCacheSavedTokens: number;
  totalSavedTokens: number;
  turnSavedTokens: number;
  turnCachedTokens: number;
  cachedTokens: number;
  savedTokens: number;
  savingsPercent: number;
  turnsCount: number;
}

export class TokenSessionTracker {
  private totalRawTokens = 0;
  private totalSentInputTokens = 0;
  private totalUncachedInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCachedTokens = 0;
  private totalPrunedSchemaTokens = 0;
  private totalCompressedHistoryTokens = 0;
  private totalContextCacheSavedTokens = 0;
  private pendingContextCacheSavedTokens = 0;
  private lastTurnSavedTokens = 0;
  private lastTurnCachedTokens = 0;
  private turnsCount = 0;

  recordContextCacheSaving(savedTokens: number): void {
    const valid = Math.max(0, Math.floor(savedTokens || 0));
    this.totalContextCacheSavedTokens += valid;
    this.pendingContextCacheSavedTokens += valid;
  }

  recordTurn(data: {
    rawTokens: number;
    sentInputTokens: number;
    outputTokens: number;
    cachedTokens?: number;
    prunedSchemaTokens?: number;
    compressedHistoryTokens?: number;
  }): TokenSavingsReport {
    this.turnsCount++;
    const inputTokens = Math.max(0, data.sentInputTokens || 0);
    const cached = Math.max(0, Math.min(inputTokens, data.cachedTokens ?? 0));
    const uncachedInput = Math.max(0, inputTokens - cached);
    const pruned = Math.max(0, data.prunedSchemaTokens ?? 0);
    const compressed = Math.max(0, data.compressedHistoryTokens ?? 0);
    const contextSavedThisTurn = this.pendingContextCacheSavedTokens;
    this.pendingContextCacheSavedTokens = 0;

    // Cache hits still occupy input/context tokens. Pricing varies by provider;
    // report hits separately instead of inventing a universal cost discount.
    const turnSaved = pruned + compressed + contextSavedThisTurn;

    this.totalSentInputTokens += inputTokens;
    this.totalUncachedInputTokens += uncachedInput;
    this.totalOutputTokens += Math.max(0, data.outputTokens || 0);
    this.totalCachedTokens += cached;
    // Each request would otherwise resend its full schema, so savings accumulate.
    this.totalPrunedSchemaTokens += pruned;
    this.totalCompressedHistoryTokens += compressed;
    this.totalRawTokens += Math.max(
      data.rawTokens || 0,
      uncachedInput + cached + pruned + compressed + contextSavedThisTurn
    );

    this.lastTurnCachedTokens = cached;
    this.lastTurnSavedTokens = turnSaved;

    return this.getReport();
  }

  getSavingsPercentage(): number {
    return this.getReport().savingsPercent;
  }

  getReport(): TokenSavingsReport {
    const totalSavedTokens =
      this.totalPrunedSchemaTokens +
      this.totalCompressedHistoryTokens +
      this.totalContextCacheSavedTokens;

    // Dürüst oturum bütçesi muhasebesi
    const totalBaselineTokens =
      this.totalUncachedInputTokens +
      this.totalCachedTokens +
      this.totalPrunedSchemaTokens +
      this.totalCompressedHistoryTokens +
      this.totalContextCacheSavedTokens;

    let savingsPercent = 0;
    if (this.turnsCount > 0 && totalBaselineTokens > 0) {
      const rawPercent = (totalSavedTokens / totalBaselineTokens) * 100;
      savingsPercent = Number(Math.min(100, Math.max(0, rawPercent)).toFixed(1));
    }

    return {
      totalRawTokens: this.totalRawTokens,
      totalSentInputTokens: this.totalSentInputTokens,
      totalUncachedInputTokens: this.totalUncachedInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalCachedTokens: this.totalCachedTokens,
      totalPrunedSchemaTokens: this.totalPrunedSchemaTokens,
      totalCompressedHistoryTokens: this.totalCompressedHistoryTokens,
      totalContextCacheSavedTokens: this.totalContextCacheSavedTokens,
      totalSavedTokens,
      turnSavedTokens: this.lastTurnSavedTokens,
      turnCachedTokens: this.lastTurnCachedTokens,
      cachedTokens: this.lastTurnCachedTokens,
      savedTokens: totalSavedTokens,
      savingsPercent,
      turnsCount: this.turnsCount,
    };
  }

  reset(): void {
    this.totalRawTokens = 0;
    this.totalSentInputTokens = 0;
    this.totalUncachedInputTokens = 0;
    this.totalOutputTokens = 0;
    this.totalCachedTokens = 0;
    this.totalPrunedSchemaTokens = 0;
    this.totalCompressedHistoryTokens = 0;
    this.totalContextCacheSavedTokens = 0;
    this.pendingContextCacheSavedTokens = 0;
    this.lastTurnSavedTokens = 0;
    this.lastTurnCachedTokens = 0;
    this.turnsCount = 0;
    activeIntentGroups.clear();
  }
}

export const globalTokenTracker = new TokenSessionTracker();
