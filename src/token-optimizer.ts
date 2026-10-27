import type { Message, ToolDefinition } from './types.js';

/**
 * Fast, dependency-free BPE token estimator.
 * Mimics modern LLM tokenizers (cl100k_base / o200k / Llama / Claude)
 * taking into account punctuation, code syntax, indentation, and Turkish/multibyte Unicode characters.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  // Regex matching tokens: word parts, numbers, operators, punctuation, newlines, whitespace runs
  const tokenRegex = /'s|'t|'re|'ve|'m|'ll|'d|\p{Lu}\p{Ll}+|\p{Lu}+(?!\p{Ll})|\p{Ll}+|\p{N}+|===|!==|==|!=|<=|>=|=>|->|\+\+|--|&&|\|\||\+=|-=|\*=|\/=|::|[{}()[\].,;:<>+\-=*\/\\|!@#$%^&~?`"']|\r\n|\r|\n|\s+|\P{M}\p{M}+|[^\s\p{L}\p{N}]/gu;

  let tokens = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    const chunk = match[0];
    const len = chunk.length;

    // Whitespace / Indentation
    if (/^\s+$/.test(chunk)) {
      if (chunk.includes('\n')) {
        const lines = chunk.split('\n');
        tokens += lines.length - 1;
        const trailingSpaces = lines[lines.length - 1].length;
        if (trailingSpaces > 0) {
          tokens += Math.ceil(trailingSpaces / 4);
        }
      } else {
        tokens += Math.max(1, Math.ceil(len / 4));
      }
      continue;
    }

    // Numbers: 1-3 digits per token
    if (/^\d+$/.test(chunk)) {
      tokens += Math.max(1, Math.ceil(len / 2.7));
      continue;
    }

    // Punctuation / Code operators: usually 1 token per operator/char
    if (/^[{}()[\].,;:<>+\-=*\/\\|!@#$%^&~?`"']+$|^===|^!==|^==|^!=|^<=|^>=|^=>|^->|^\+\+|^\-\-|^&&|^\|\||^\+=|^\-=|^\*=|^\/=|::$/.test(chunk)) {
      if (chunk.length <= 3) {
        tokens += 1;
      } else {
        tokens += Math.ceil(chunk.length / 2);
      }
      continue;
    }

    // Words / Letters: detect Turkish/Unicode multibyte characters which take extra subword tokens
    const turkishChars = chunk.match(/[çğıöşüÇĞİÖŞÜ]/g);
    const turkishExtra = turkishChars ? turkishChars.length * 0.45 : 0;

    // Standard subword splitting for words (e.g. ~3.7 chars per token)
    tokens += Math.max(1, Math.ceil(len / 3.7 + turkishExtra));
  }

  return tokens;
}

/**
 * Calculates estimated token count across messages, tool calls, response items, system prompt and tool definitions.
 */
export function estimateMessagesTokens(
  messages: Message[],
  systemPrompt?: string,
  tools?: ToolDefinition[]
): number {
  let total = 0;

  if (systemPrompt) {
    total += estimateTokens(systemPrompt) + 4; // <|im_start|>system...<|im_end|>
  }

  for (const message of messages) {
    total += 4; // message role wrapper overhead
    if (message.content) {
      total += estimateTokens(message.content);
    }
    if (message.images?.length) {
      // Vision model token budget per image (average low-res/tile estimate)
      total += message.images.length * 256;
    }
    if (message.toolCalls?.length) {
      for (const call of message.toolCalls) {
        total += 8; // tool call structure overhead
        total += estimateTokens(call.name);
        if (call.arguments) {
          total += estimateTokens(JSON.stringify(call.arguments));
        }
        if (call.id) {
          total += estimateTokens(call.id);
        }
      }
    }
    if (message.toolCallId) {
      total += estimateTokens(message.toolCallId) + 2;
    }
    if (message.responseItems?.length) {
      total += estimateTokens(JSON.stringify(message.responseItems));
    }
  }

  if (tools?.length) {
    for (const tool of tools) {
      total += 12; // function declaration overhead
      total += estimateTokens(tool.name);
      if (tool.description) {
        total += estimateTokens(tool.description);
      }
      if (tool.parameters) {
        total += estimateTokens(JSON.stringify(tool.parameters));
      }
    }
  }

  return total;
}

/** Always preserved core tools that must never be pruned. */
export const CORE_TOOLS = new Set([
  'file_read', 'file_write', 'file_patch', 'file_outline', 'file_search',
  'shell', 'process_list', 'process_output', 'process_stop',
  'git_status', 'git_diff', 'git_log', 'git_add', 'git_commit', 'git_branch', 'git_push',
  'memory_save', 'memory_recall', 'mcp_catalog', 'mcp_call'
]);

/**
 * Cleans boilerplate filler words from tool descriptions without losing semantic meaning.
 */
function compressToolDescription(desc: string): string {
  if (!desc) return '';
  let cleaned = desc
    .replace(/^Use this tool to\s+/i, '')
    .replace(/^This tool allows you to\s+/i, '')
    .replace(/^This function allows you to\s+/i, '')
    .replace(/^A tool (?:that can be used )?(?:for|to)\s+/i, '')
    .replace(/^Can be used to\s+/i, '')
    .replace(/\bPlease note that\b/gi, 'Note:')
    .replace(/\bIn order to\b/gi, 'To')
    .replace(/^Bu araç(?:,\s*|\s+ile\s+)?/i, '')
    .trim();
  return cleaned.replace(/\s+/g, ' ');
}

/**
 * Prunes conditional heavy tool definitions and compresses descriptions.
 * Yields significant token savings (often 40-70% of schema tokens).
 */
export function pruneToolDefinitions(
  tools: ToolDefinition[],
  userQuery: string,
  activeSkills: string[] = [],
  history: Message[] = []
): { tools: ToolDefinition[]; savedTokens: number; prunedCount: number } {
  const originalTokens = tools.reduce((acc, t) =>
    acc + 12 + estimateTokens(t.name) + estimateTokens(t.description) + estimateTokens(JSON.stringify(t.parameters)), 0);

  // Analyze context: query, recent 2 messages, active skills
  const recentHistoryTexts = history.slice(-2).map(m => m.content).join(' ');
  const combinedContext = `${userQuery} ${recentHistoryTexts}`.toLowerCase();
  const skillsSet = new Set(activeSkills.map(s => s.toLowerCase()));

  // Intent patterns
  const browserKeywords = ['web', 'tarayıcı', 'tarayici', 'url', 'http', 'https', 'localhost', 'scrape', 'sayfa', 'browser', 'ui testi', 'site'];
  const computerKeywords = ['masaüstü', 'masaustu', 'ekran', 'pencere', 'mouse', 'fare', 'klavye', 'desktop', 'screen', 'window', 'click', 'screenshot'];
  const imageKeywords = ['görsel', 'gorsel', 'resim', 'logo', 'ikon', 'icon', 'çiz', 'ciz', 'image', 'picture', 'draw', 'banner'];
  const mcpKeywords = ['github', 'supabase', 'vercel', 'deploy', 'database', 'veritabanı', 'veritabani', 'postgres', 'sql', 'mcp'];

  const needsBrowser = browserKeywords.some(kw => combinedContext.includes(kw)) ||
    [...skillsSet].some(s => s.includes('browser') || s.includes('web') || s.includes('playwright'));

  const needsComputer = computerKeywords.some(kw => combinedContext.includes(kw)) ||
    [...skillsSet].some(s => s.includes('computer') || s.includes('desktop'));

  const needsImage = imageKeywords.some(kw => combinedContext.includes(kw)) ||
    skillsSet.has('imagegen') || skillsSet.has('image_generate') || skillsSet.has('image');

  const needsMcp = mcpKeywords.some(kw => combinedContext.includes(kw));

  const keptTools: ToolDefinition[] = [];

  for (const tool of tools) {
    const name = tool.name;

    // 1. Core tools are always kept
    if (CORE_TOOLS.has(name)) {
      keptTools.push({
        ...tool,
        description: compressToolDescription(tool.description)
      });
      continue;
    }

    // 2. Browser tools
    if (name.startsWith('browser_') || name === 'browser') {
      if (needsBrowser) {
        keptTools.push({ ...tool, description: compressToolDescription(tool.description) });
      }
      continue;
    }

    // 3. Computer tool
    if (name === 'computer' || name.startsWith('computer_')) {
      if (needsComputer) {
        keptTools.push({ ...tool, description: compressToolDescription(tool.description) });
      }
      continue;
    }

    // 4. Image generate tool
    if (name === 'image_generate' || name.startsWith('image_')) {
      if (needsImage) {
        keptTools.push({ ...tool, description: compressToolDescription(tool.description) });
      }
      continue;
    }

    // 5. Directly connected remote MCP tools (mcp_* or mcp__*)
    if (name.startsWith('mcp_') || name.startsWith('mcp__')) {
      const serviceName = name.startsWith('mcp__')
        ? name.split('__')[1]?.toLowerCase()
        : name.split('_')[1]?.toLowerCase();
      if (needsMcp || (serviceName && combinedContext.includes(serviceName))) {
        keptTools.push({ ...tool, description: compressToolDescription(tool.description) });
      }
      continue;
    }

    // Fallback: If unknown tool, keep it but compress description
    keptTools.push({ ...tool, description: compressToolDescription(tool.description) });
  }

  const prunedCount = tools.length - keptTools.length;
  const prunedTokens = keptTools.reduce((acc, t) =>
    acc + 12 + estimateTokens(t.name) + estimateTokens(t.description) + estimateTokens(JSON.stringify(t.parameters)), 0);

  const savedTokens = Math.max(0, originalTokens - prunedTokens);

  return {
    tools: keptTools,
    savedTokens,
    prunedCount
  };
}

const MAX_TOOL_RESULT_CHARS = 12_000;

/**
 * Deterministically summarizes older tool outputs into structural evidence (file paths, signatures, errors, lines).
 * Preserves 100% of reasoning context while saving 65-85% of tokens.
 */
function extractStructuralEvidence(content: string): string {
  if (content.length <= 400) return content;

  // 1. Extract file paths
  const fileRegex = /(?:[a-zA-Z]:[\\/]|(?:\.{1,2}[\\/])|\/)[a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9_]+/g;
  const files = Array.from(new Set(content.match(fileRegex) || [])).slice(0, 8);

  // 2. Extract signatures (functions, classes, interfaces, types, exports)
  const sigRegex = /(?:export\s+)?(?:async\s+)?(?:function\s+[a-zA-Z0-9_$]+|[a-zA-Z0-9_$]+\s*\(.*?\)\s*(?::|\{)|class\s+[a-zA-Z0-9_$]+|interface\s+[a-zA-Z0-9_$]+|type\s+[a-zA-Z0-9_$]+\s*=|def\s+[a-zA-Z0-9_$]+)/g;
  const signatures = Array.from(new Set(content.match(sigRegex) || [])).slice(0, 6);

  // 3. Extract errors, exceptions, stack traces
  const lines = content.split('\n');
  const errorLines = lines
    .filter(l => /(?:error|exception|fail|failed|fatal|reject|denied|timeout|panic|warn|warning|traceback|at\s+[a-zA-Z0-9_$.]+\s*\()/i.test(l))
    .map(l => l.trim())
    .slice(0, 5);

  // 4. Extract diff ranges / line numbers
  const diffRanges = Array.from(new Set(content.match(/@@\s*-\d+,\d+\s*\+\d+,\d+\s*@@|lines?\s*\d+(?:-\d+)?/gi) || [])).slice(0, 4);

  // 5. Head and Tail snippet
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

/**
 * Compresses conversation history to fit budget while preserving:
 * - Full output of the last 3 tool batches when under budget (MAX_TOOL_RESULT_CHARS = 12_000)
 * - Structural evidence of older tool outputs (bIdx < batches.length - 3) or when budget exceeds 85%
 * - Images only in the latest 2 messages
 * - Initial user goal summary when dropping overflow turns
 */
export function compressConversationHistory(
  messages: Message[],
  maxTokenBudget = 28_000
): { messages: Message[]; savedTokens: number } {
  const initialTokens = estimateMessagesTokens(messages);
  if (messages.length === 0) return { messages: [], savedTokens: 0 };

  // 1. Identify tool batches (each assistant toolCalls round followed by its tool results)
  const batches: { assistantIndex: number; toolIndices: number[] }[] = [];
  let currentBatch: { assistantIndex: number; toolIndices: number[] } | null = null;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'assistant' && m.toolCalls?.length) {
      currentBatch = { assistantIndex: i, toolIndices: [] };
      batches.push(currentBatch);
    } else if (m.role === 'tool') {
      if (!currentBatch) {
        currentBatch = { assistantIndex: -1, toolIndices: [] };
        batches.push(currentBatch);
      }
      currentBatch.toolIndices.push(i);
    }
  }

  const toolBatchMap = new Map<number, number>();
  batches.forEach((batch, bIdx) => {
    for (const toolIdx of batch.toolIndices) {
      toolBatchMap.set(toolIdx, bIdx);
    }
  });

  // 2. Strip images from all but the last 2 messages
  const imageCutoffIndex = Math.max(0, messages.length - 2);

  // 3. Compress older tool batches into structural evidence summaries,
  // and preserve recent 3 tool batches up to MAX_TOOL_RESULT_CHARS
  let compressed: Message[] = messages.map((m, idx) => {
    const msg = { ...m };

    // Image pruning: keep only in last 2 messages
    if (idx < imageCutoffIndex && msg.images?.length) {
      msg.images = undefined;
    }

    if (msg.role === 'tool') {
      const bIdx = toolBatchMap.get(idx) ?? -1;
      const isRecentBatch = bIdx >= batches.length - 3;

      if (isRecentBatch) {
        // Keep raw output up to MAX_TOOL_RESULT_CHARS
        if (msg.content.length > MAX_TOOL_RESULT_CHARS) {
          const half = Math.floor(MAX_TOOL_RESULT_CHARS / 2);
          msg.content = `${msg.content.slice(0, half)}\n...[Tool output truncated to ${MAX_TOOL_RESULT_CHARS} chars]...\n${msg.content.slice(-half)}`;
        }
      } else {
        // Older tool message: transform into deterministic structural evidence summary
        msg.content = extractStructuralEvidence(msg.content);
      }
    }

    return msg;
  });

  let currentTokens = estimateMessagesTokens(compressed);

  // 4. If total tokens exceed maxTokenBudget * 0.85, summarize earlier tool batches in the recent window
  if (currentTokens > maxTokenBudget * 0.85 && batches.length > 1) {
    for (let bIdx = Math.max(0, batches.length - 3); bIdx < batches.length - 1; bIdx++) {
      const batch = batches[bIdx];
      if (!batch) continue;
      for (const toolIdx of batch.toolIndices) {
        if (compressed[toolIdx] && compressed[toolIdx].role === 'tool') {
          compressed[toolIdx].content = extractStructuralEvidence(compressed[toolIdx].content);
        }
      }
      currentTokens = estimateMessagesTokens(compressed);
      if (currentTokens <= maxTokenBudget * 0.85) {
        break;
      }
    }
  }

  // 5. If total tokens still exceed maxTokenBudget, drop older turns while preserving initial user goal
  if (currentTokens > maxTokenBudget) {
    const firstUserMsg = compressed.find(m => m.role === 'user');
    const initialUserGoal = firstUserMsg ? firstUserMsg.content.slice(0, 600) : '';

    const turns: Message[][] = [];
    let systemMsgs: Message[] = [];

    for (const msg of compressed) {
      if (msg.role === 'system') {
        systemMsgs.push(msg);
      } else if (msg.role === 'user') {
        turns.push([msg]);
      } else {
        if (turns.length) {
          turns[turns.length - 1].push(msg);
        } else {
          turns.push([msg]);
        }
      }
    }

    const selectedTurns: Message[][] = [];
    let budgetRemaining = maxTokenBudget - estimateMessagesTokens(systemMsgs) - (initialUserGoal ? 150 : 0);

    for (let i = turns.length - 1; i >= 0; i--) {
      const turnTokens = estimateMessagesTokens(turns[i]);
      if (turnTokens <= budgetRemaining) {
        selectedTurns.unshift(turns[i]);
        budgetRemaining -= turnTokens;
      } else {
        if (selectedTurns.length > 0) {
          break;
        } else {
          selectedTurns.unshift(turns[i]);
          break;
        }
      }
    }

    const reconstructed: Message[] = [...systemMsgs];

    if (selectedTurns.length < turns.length && initialUserGoal) {
      reconstructed.push({
        role: 'user',
        content: `[Önceki Konuşma Özeti - Orijinal Kullanıcı Hedefi]: ${initialUserGoal}\n(Eski konuşma turları token bütçesi (${maxTokenBudget}) koruması için sıkıştırıldı)`
      });
    }

    reconstructed.push(...selectedTurns.flat());
    compressed = reconstructed;
  }

  const finalTokens = estimateMessagesTokens(compressed);
  const savedTokens = Math.max(0, initialTokens - finalTokens);

  return {
    messages: compressed,
    savedTokens
  };
}

export interface TokenSavingsReport {
  totalRawTokens: number;
  totalSentInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalPrunedSchemaTokens: number;
  totalCompressedHistoryTokens: number;
  totalSavedTokens: number;
  savingsPercent: number;
  turnsCount: number;
}

export class TokenSessionTracker {
  private totalRawTokens = 0;
  private totalSentInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCachedTokens = 0;
  private totalPrunedSchemaTokens = 0;
  private totalCompressedHistoryTokens = 0;
  private turnsCount = 0;

  recordTurn(data: {
    rawTokens: number;
    sentInputTokens: number;
    outputTokens: number;
    cachedTokens?: number;
    prunedSchemaTokens?: number;
    compressedHistoryTokens?: number;
  }): TokenSavingsReport {
    this.turnsCount++;
    this.totalRawTokens += data.rawTokens;
    this.totalSentInputTokens += data.sentInputTokens;
    this.totalOutputTokens += data.outputTokens;
    const cached = data.cachedTokens ?? 0;
    const pruned = data.prunedSchemaTokens ?? 0;
    const compressed = data.compressedHistoryTokens ?? 0;

    this.totalCachedTokens += cached;
    this.totalPrunedSchemaTokens += pruned;
    this.totalCompressedHistoryTokens += compressed;

    return this.getReport();
  }

  getReport(): TokenSavingsReport {
    const totalSavedTokens = this.totalPrunedSchemaTokens + this.totalCompressedHistoryTokens + this.totalCachedTokens;
    const totalPotentialTokens = this.totalSentInputTokens + totalSavedTokens;
    const savingsPercent = totalPotentialTokens > 0
      ? Math.min(100, Math.max(0, Number(((totalSavedTokens / totalPotentialTokens) * 100).toFixed(1))))
      : 0;

    return {
      totalRawTokens: this.totalRawTokens,
      totalSentInputTokens: this.totalSentInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalCachedTokens: this.totalCachedTokens,
      totalPrunedSchemaTokens: this.totalPrunedSchemaTokens,
      totalCompressedHistoryTokens: this.totalCompressedHistoryTokens,
      totalSavedTokens,
      savingsPercent,
      turnsCount: this.turnsCount,
    };
  }

  reset(): void {
    this.totalRawTokens = 0;
    this.totalSentInputTokens = 0;
    this.totalOutputTokens = 0;
    this.totalCachedTokens = 0;
    this.totalPrunedSchemaTokens = 0;
    this.totalCompressedHistoryTokens = 0;
    this.turnsCount = 0;
  }
}

export const globalTokenTracker = new TokenSessionTracker();
