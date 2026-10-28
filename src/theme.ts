/**
 * T Bot terminal palette: Tabit green on graphite, semantic status colors,
 * and a calm low-contrast surface set. ANSI is disabled for NO_COLOR/dumb terminals.
 */
const color = Boolean(process.stdout.isTTY && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb');
export const paint = (code: string) => (value: string): string => (color ? `\x1b[${code}m${value}\x1b[0m` : value);

export const theme = {
  // Tabit green remains the brand: a calm leaf/bright-lime system on graphite.
  brand: paint('1;38;2;155;227;61'),
  accent: paint('38;2;155;227;61'),
  iceWhite: paint('1;38;2;237;245;234'),
  brightMint: paint('1;38;2;198;230;160'),
  crystalCyan: paint('38;2;147;166;141'),
  softLavender: paint('38;2;180;205;165'),
  amber: paint('38;2;252;196;25'),
  warning: paint('38;2;252;196;25'),
  forest: paint('38;2;101;184;23'),
  muted: paint('38;2;147;166;141'),
  text: paint('38;2;237;245;234'),
  danger: paint('38;2;255;107;107'),
  error: paint('38;2;255;107;107'),
  panel: paint('38;2;95;115;90'),
  badge: paint('1;38;2;169;227;75'),
  cyan: paint('38;2;140;233;154'),
  success: paint('38;2;111;212;74'),
  dim: paint('38;2;116;136;110'),
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

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[0-9;?]*[a-zA-Z]/g;

/**
 * Metindeki tüm ANSI kaçış dizilerini temizler.
 */
export function stripAnsi(str: string): string {
  if (!str) return '';
  return str.replace(ANSI_REGEX, '');
}

/**
 * ANSI renk kodlarını yok sayarak metnin ekranda kapladığı görünür karakter uzunluğunu hesaplar.
 */
export function visibleLength(str: string): number {
  if (!str) return 0;
  return Array.from(stripAnsi(str)).length;
}

/**
 * ANSI renk kodlarını bozmadan görünür karakter sayısını `maxCols` ile sınırlandırır
 * ve taşma durumunda sonuna `…\x1b[0m` ekler (sıfır-taşma garantisi).
 */
export function truncateAnsi(str: string, maxCols: number): string {
  if (!str || maxCols <= 0) return '';
  const visLen = visibleLength(str);
  if (visLen <= maxCols) return str;

  const targetCols = Math.max(0, maxCols - 1);
  let result = '';
  let count = 0;
  let i = 0;

  while (i < str.length) {
    if (str.charCodeAt(i) === 0x1b && str[i + 1] === '[') {
      const match = str.slice(i).match(/^\x1b\[[0-9;?]*[a-zA-Z]/);
      if (match) {
        result += match[0];
        i += match[0].length;
        continue;
      }
    }
    if (count >= targetCols) break;
    const codePoint = str.codePointAt(i)!;
    const ch = String.fromCodePoint(codePoint);
    result += ch;
    i += ch.length;
    count++;
  }

  return color ? `${result}…\x1b[0m` : `${result}…`;
}

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
  ['AST', 'AST'],
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

export const TOOL_TITLE_MAP: Record<string, string> = {
  file_read: 'Dosya Okuma',
  file_write: 'Dosya Yazma',
  file_patch: 'Dosya Yamalama',
  file_list: 'Dosya Listeleme',
  file_search: 'Dosya Arama',
  file_glob: 'Dosya Bulma',
  file_outline: 'Dosya Özeti',
  shell: 'Komut Satırı',
  process_list: 'İşlem Listesi',
  process_output: 'İşlem Çıktısı',
  process_stop: 'İşlem Durdurma',
  process_write: 'Süreç Girdisi Gönderme',
  git_status: 'Git Durumu',
  git_diff: 'Git Farkı',
  git_log: 'Git Günlüğü',
  git_add: 'Git Ekleme',
  git_commit: 'Git İşleme',
  git_push: 'Git Gönderme',
  git_branch: 'Git Dalı',
  web_search: 'Web Araması',
  url_fetch: 'Web Sayfası Okuma',
  browser_navigate: 'Tarayıcı Gezinme',
  browser_click: 'Tarayıcı Tıklama',
  browser_type: 'Tarayıcı Yazma',
  browser_fill: 'Form Doldurma',
  browser_press: 'Tarayıcı Tuş Basımı',
  browser_scroll: 'Tarayıcı Kaydırma',
  browser_hover: 'Tarayıcı Üzerine Gelme',
  browser_evaluate: 'Tarayıcı Betik Çalıştırma',
  browser_inspect: 'Sayfa İnceleme',
  browser_tabs: 'Tarayıcı Sekme Yönetimi',
  browser_screenshot: 'Tarayıcı Ekran Görüntüsü',
  browser_batch: 'Tarayıcı Toplu Eylem',
  computer: 'Bilgisayar Kontrolü',
  computer_batch: 'Bilgisayar Toplu Eylem',
  image_generate: 'Görsel Üretimi',
  memory_save: 'Bellek Kaydetme',
  memory_recall: 'Bellek Hatırlama',
  memory_forget: 'Hafıza Silme',
  todo_manage: 'Görev Pusulası',
  goal_manage: 'Hedef Yönetimi',
  skill_create: 'Yetenek Oluşturma',
  skill_list: 'Yetenek Listesi',
  delegate_task: 'Alt Ajan Görevlendirme',
  mcp_catalog: 'MCP Kataloğu',
  mcp_call: 'MCP Çağrısı',
    artifact_read: 'Artefakt Okuma',
    project_verify: 'Proje Doğrulama',
};

/**
 * Araç adını Türkçe başlık ve parantez içinde teknik ad formatında döndürür.
 */
export function formatToolTitle(toolName: string): string {
  if (TOOL_TITLE_MAP[toolName]) {
    return `${TOOL_TITLE_MAP[toolName]} (${toolName})`;
  }
  const clean = toolName.replace(/[_-]+/g, ' ');
  return `${toTurkishTitleCase(clean)} (${toolName})`;
}

/**
 * 0-100 arası yüzdeyi şık bir ilerleme çubuğu olarak çizer.
 */
export function renderProgressBar(percent: number, width = 10): string {
  const safeWidth = Math.max(1, Math.floor(width));
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const filledCount = Math.round((clamped / 100) * safeWidth);
  const emptyCount = Math.max(0, safeWidth - filledCount);
  const filled = filledCount > 0 ? theme.brightMint('━'.repeat(filledCount)) : '';
  const empty = emptyCount > 0 ? theme.dim('─'.repeat(emptyCount)) : '';
  return `${filled}${empty}`;
}

/**
 * Milisaniye cinsinden süreyi okunabilir biçimde biçimlendirir.
 */
export function formatDuration(ms: number): string {
  const safeMs = Math.max(0, Number.isFinite(ms) ? ms : 0);
  return safeMs < 1000 ? `${Math.round(safeMs)}ms` : `${(safeMs / 1000).toFixed(2)}sn`;
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

const CYBER_STOPS: RGB[] = [
  { r: 148, g: 216, b: 45 },  // #94D82D (Tabit Yeşili)
  { r: 102, g: 217, b: 232 }, // #66D9E8 (Kristal Camgöbeği)
  { r: 184, g: 236, b: 130 }, // #B8EC82 (Parlak Nane)
  { r: 226, g: 250, b: 170 }, // #E2FAAA (Işıltılı Filiz)
];

/**
 * 24-bit TrueColor sinüs dalgası faz enterpolasyonlu renk hesaplayıcı.
 * #94D82D (Tabit Yeşili) -> #66D9E8 (Kristal Camgöbeği) -> #B8EC82 (Parlak Nane) -> #E2FAAA (Işıltılı Filiz)
 */
export function interpolateCyberColor(phase: number): RGB {
  const normPhase = ((phase % 1) + 1) % 1;
  const scaled = normPhase * 4;
  const i0 = Math.floor(scaled) % 4;
  const i1 = (i0 + 1) % 4;
  const frac = scaled - Math.floor(scaled);
  // Pürüzsüz sinüs geçişi
  const smooth = 0.5 * (1 - Math.cos(frac * Math.PI));
  const c0 = CYBER_STOPS[i0]!;
  const c1 = CYBER_STOPS[i1]!;
  return {
    r: Math.round(c0.r + (c1.r - c0.r) * smooth),
    g: Math.round(c0.g + (c1.g - c0.g) * smooth),
    b: Math.round(c0.b + (c1.b - c0.b) * smooth),
  };
}

/** TrueColor terminal desteğini güvenle sorgular */
function isTrueColorSupported(): boolean {
  return (
    process.env.NO_COLOR === undefined &&
    (Boolean(process.env.WT_SESSION) ||
      /truecolor|24bit/i.test(process.env.COLORTERM ?? '') ||
      (Boolean(process.stdout.isTTY) && process.env.TERM !== 'dumb'))
  );
}

/**
 * Siber-Dalga Gradyan Çubuğu Üretici.
 * 24-bit TrueColor faz enterpolasyonu ile pürüzsüz akan biyolüminesan dalga çizer.
 */
export function renderCyberWave(frame: number = 0, width = 8): string {
  const safeFrame = Number.isFinite(Number(frame)) ? Math.abs(Math.floor(Number(frame))) : 0;
  const safeWidth = Number.isFinite(Number(width)) ? Math.max(1, Math.floor(Number(width))) : 8;
  if (process.env.NO_COLOR !== undefined) {
    return '━'.repeat(safeWidth);
  }
  if (!isTrueColorSupported()) {
    const fallbackColors = [
      theme.brightMint,
      theme.crystalCyan,
      theme.accent,
      theme.softLavender,
    ];
    const colorFn = fallbackColors[safeFrame % fallbackColors.length] || theme.brightMint;
    return colorFn('━'.repeat(safeWidth));
  }

  let wave = '';
  for (let i = 0; i < safeWidth; i++) {
    const phase = (safeFrame * 0.12 + i / safeWidth) % 1;
    const { r, g, b } = interpolateCyberColor(phase);
    wave += `\x1b[38;2;${r};${g};${b}m━`;
  }
  return `${wave}\x1b[0m`;
}

/**
 * Siber-Zen Nabız Rozeti Üretici.
 * Metni harf harf veya faz bazlı sinüs dalgası degrade geçişi ile boyar.
 */
export function cyberPulseBadge(text: string, frame: number = 0): string {
  if (!text) return '';
  if (process.env.NO_COLOR !== undefined) return text;
  const safeFrame = Number.isFinite(Number(frame)) ? Math.abs(Math.floor(Number(frame))) : 0;
  if (!isTrueColorSupported()) {
    return theme.brightMint(text);
  }

  let result = '';
  const len = text.length;
  for (let i = 0; i < len; i++) {
    const phase = (safeFrame * 0.08 + (i / Math.max(1, len)) * 0.75) % 1;
    const { r, g, b } = interpolateCyberColor(phase);
    result += `\x1b[38;2;${r};${g};${b}m${text[i]}`;
  }
  return `${result}\x1b[0m`;
}

