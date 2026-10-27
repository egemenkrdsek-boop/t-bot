/**
 * Göz Yormayan Siber-Minimalist ANSI Paleti
 * Terminal Arka Planında Gözü Dinlendiren Mat ve Dengeli Tonlar
 */
const color = Boolean(process.stdout.isTTY && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb');
export const paint = (code: string) => (value: string): string => (color ? `\x1b[${code}m${value}\x1b[0m` : value);

export const theme = {
  // Yumuşak Zümrüt / Mint (#38D9A9)
  brand: paint('1;38;2;56;217;169'),
  accent: paint('38;2;56;217;169'),

  // Yumuşak Kehribar (#F59F00)
  amber: paint('38;2;245;159;0'),
  warning: paint('38;2;245;159;0'),

  // Mat Adaçayı (#2B8A66)
  forest: paint('38;2;43;138;102'),

  // Yumuşak Arduvaz (#8696A7)
  muted: paint('38;2;134;150;167'),

  // Göz Yormayan Yumuşak Kırık Beyaz (#DAE4EB)
  text: paint('38;2;218;228;235'),

  // Yumuşak Mercan Kırmızı (#FA5252)
  danger: paint('38;2;250;82;82'),
  error: paint('38;2;250;82;82'),

  // Çelik Çerçeve (#495867)
  panel: paint('38;2;73;88;103'),

  // Buz Mavisi Rozet (#74C0FC)
  badge: paint('1;38;2;116;192;252'),

  // Sakin Camgöbeği (#66D9E8)
  cyan: paint('38;2;102;217;232'),

  // Yumuşak Yeşil (#51CF66)
  success: paint('38;2;81;207;102'),

  // Soluk Arduvaz (#5C6B7A)
  dim: paint('38;2;92;107;122'),

  // Kalın Yazı
  bold: paint('1'),
};

export const unicode = Boolean(process.stdin && process.stdout.isTTY && process.env.TERM !== 'dumb' && process.env.TBOT_ASCII !== '1');
const plain = !unicode;

export const symbols = {
  prompt: plain ? '>' : '›',
  assistant: plain ? '*' : '◆',
  user: plain ? '>' : '▸',
  tool: plain ? '#' : '◈',
  bullet: plain ? '-' : '▪',
  arrow: plain ? '->' : '→',
  tree: plain ? '|-' : '↳',
  check: plain ? '[OK]' : '✓',
  cross: plain ? '[X]' : '✗',
  warn: plain ? '[!]' : '!',
  bar: plain ? '-' : '─',
  rule: plain ? '-' : '─',
  dot: plain ? '.' : '·',
  sparkle: plain ? '*' : '◆',
  brain: plain ? '~' : '◈',
  gem: plain ? '+' : '▪',
  shield: plain ? '#' : '■',
  ram: plain ? '=' : '▣',
  bot: plain ? '@' : '●',
  hudLeft: plain ? '[ ' : '╭─ ',
  hudRight: plain ? ' ]' : ' ─╮',
  hudSep: plain ? ' | ' : ' │ ',
};

const CONJUNCTIONS = new Set([
  've',
  'ile',
  'veya',
  'yahut',
  'ya',
  'da',
  'de',
  'ki',
  'ama',
  'fakat',
  'lakin',
  'ancak',
  'için',
  'gibi',
  'kadar',
  'üzere',
  'mı',
  'mi',
  'mu',
  'mü',
]);

const KNOWN_ACRONYMS = new Map([
  ['RAM', 'RAM'],
  ['CPU', 'CPU'],
  ['API', 'API'],
  ['APİ', 'API'],
  ['MCP', 'MCP'],
  ['CLI', 'CLI'],
  ['CLİ', 'CLI'],
  ['TUI', 'TUI'],
  ['TUİ', 'TUI'],
  ['HUD', 'HUD'],
  ['LLM', 'LLM'],
  ['ID', 'ID'],
  ['İD', 'ID'],
  ['URL', 'URL'],
  ['JSON', 'JSON'],
  ['SSE', 'SSE'],
  ['YOLO', 'YOLO'],
  ['GC', 'GC'],
  ['MB', 'MB'],
  ['GB', 'GB'],
  ['KB', 'KB'],
  ['PID', 'PID'],
  ['PİD', 'PID'],
  ['OK', 'OK'],
]);

function titleCaseWord(word: string, isFirst: boolean): string {
  if (!word) return word;
  const upperAscii = word.toUpperCase();
  const upperTr = word.toLocaleUpperCase('tr-TR');
  if (KNOWN_ACRONYMS.has(upperAscii)) return KNOWN_ACRONYMS.get(upperAscii)!;
  if (KNOWN_ACRONYMS.has(upperTr)) return KNOWN_ACRONYMS.get(upperTr)!;

  const lowerTr = word.toLocaleLowerCase('tr-TR');
  if (!isFirst && CONJUNCTIONS.has(lowerTr)) return lowerTr;

  return word.charAt(0).toLocaleUpperCase('tr-TR') + word.slice(1).toLocaleLowerCase('tr-TR');
}

/**
 * Cümle olmayan metinleri Türkçe Başlık Düzenine (Title Case) dönüştürür.
 * Bağlaçlar küçük harfle yazılırken teknik kısaltmalar korunur.
 */
export function toTurkishTitleCase(input: string): string {
  if (!input) return input;
  const words = input.split(/(\s+)/);
  let wordIndex = 0;

  return words
    .map((token) => {
      if (/^\s+$/.test(token)) return token;
      const match = token.match(/^([^a-zA-ZçğıöşüÇĞİÖŞÜ0-9]*)(.*?)([^a-zA-ZçğıöşüÇĞİÖŞÜ0-9]*)$/);
      if (!match) return token;
      const [, leading, core, trailing] = match;
      if (!core) return token;
      const isFirst = wordIndex === 0;
      wordIndex++;

      if (core.includes('-')) {
        const parts = core.split('-');
        const cased = parts.map((part, pIdx) => titleCaseWord(part, isFirst && pIdx === 0)).join('-');
        return `${leading}${cased}${trailing}`;
      }
      if (core.includes('/')) {
        const parts = core.split('/');
        const cased = parts.map((part, pIdx) => titleCaseWord(part, isFirst && pIdx === 0)).join('/');
        return `${leading}${cased}${trailing}`;
      }
      return `${leading}${titleCaseWord(core, isFirst)}${trailing}`;
    })
    .join('');
}

/**
 * 0-100 arası yüzdeyi şık bir ilerleme çubuğu olarak çizer.
 */
export function renderProgressBar(percent: number, width = 10): string {
  const safeWidth = Math.max(1, Math.floor(width));
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const filledCount = Math.round((clamped / 100) * safeWidth);
  const emptyCount = Math.max(0, safeWidth - filledCount);
  const filled = filledCount > 0 ? theme.accent('━'.repeat(filledCount)) : '';
  const empty = emptyCount > 0 ? theme.dim('─'.repeat(emptyCount)) : '';
  return `${filled}${empty}`;
}

/**
 * Milisaniye cinsinden süreyi okunabilir biçimde biçimlendirir.
 */
export function formatDuration(ms: number): string {
  const safeMs = Math.max(0, Number.isFinite(ms) ? ms : 0);
  return safeMs < 1000 ? `${safeMs}ms` : `${(safeMs / 1000).toFixed(2)}sn`;
}
