/**
 * Göz Yormayan Açık Tabit (tabit.webp) & Siber-Zen ANSI Paleti
 * Terminal Arka Planında Parlak Açık Tabit Yeşili, Açık Yaprak/Nane Yeşili ve Saf Beyaz Tonlar
 */
const color = Boolean(process.stdout.isTTY && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb');
export const paint = (code) => (value) => (color ? `\x1b[${code}m${value}\x1b[0m` : value);
export const theme = {
    // Parlak Açık Tabit Yeşili (#94D82D - tabit.webp açık ana marka yeşili)
    brand: paint('1;38;2;148;216;45'),
    accent: paint('38;2;148;216;45'),
    // Açık Parlak Tabit Tonları (Saf Beyaz, Parlak Filiz Yeşili, Açık Yaprak & Nane Yeşili)
    iceWhite: paint('1;38;2;250;253;248'),
    brightMint: paint('1;38;2;160;228;90'),
    crystalCyan: paint('38;2;184;236;130'),
    softLavender: paint('38;2;204;242;158'),
    // Açık Sıcak Kehribar (#FCC419)
    amber: paint('38;2;252;196;25'),
    warning: paint('38;2;252;196;25'),
    // Tabit Orijinal Yaprak Yeşili (#78B82A - tabit.webp temel yeşili)
    forest: paint('38;2;120;184;42'),
    // Açık Adaçayı Grisi (#A3B89E)
    muted: paint('38;2;163;184;158'),
    // Göz Yormayan Ferah Kırık Beyaz (#EEF5EB)
    text: paint('38;2;238;245;235'),
    // Yumuşak Mercan Kırmızı (#FF6B6B)
    danger: paint('38;2;255;107;107'),
    error: paint('38;2;255;107;107'),
    // Yumuşak Yaprak Çerçeve (#5F735A)
    panel: paint('38;2;95;115;90'),
    // Parlak Açık Yeşil Rozet (#A9E34B)
    badge: paint('1;38;2;169;227;75'),
    // Ferah Açık Nane / Filiz Yeşili (#8CE99A)
    cyan: paint('38;2;140;233;154'),
    // Canlı Açık Tabit Yeşili (#82C91E)
    success: paint('38;2;130;201;30'),
    // Sakin Zeytin / Adaçayı Grisi (#74886E)
    dim: paint('38;2;116;136;110'),
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
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[0-9;?]*[a-zA-Z]/g;
/**
 * Metindeki tüm ANSI kaçış dizilerini temizler.
 */
export function stripAnsi(str) {
    if (!str)
        return '';
    return str.replace(ANSI_REGEX, '');
}
/**
 * ANSI renk kodlarını yok sayarak metnin ekranda kapladığı görünür karakter uzunluğunu hesaplar.
 */
export function visibleLength(str) {
    if (!str)
        return 0;
    return Array.from(stripAnsi(str)).length;
}
/**
 * ANSI renk kodlarını bozmadan görünür karakter sayısını `maxCols` ile sınırlandırır
 * ve taşma durumunda sonuna `…\x1b[0m` ekler (sıfır-taşma garantisi).
 */
export function truncateAnsi(str, maxCols) {
    if (!str || maxCols <= 0)
        return '';
    const visLen = visibleLength(str);
    if (visLen <= maxCols)
        return str;
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
        if (count >= targetCols)
            break;
        const codePoint = str.codePointAt(i);
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
function titleCaseWord(word, isFirst) {
    if (!word)
        return word;
    const upperAscii = word.toUpperCase();
    const upperTr = word.toLocaleUpperCase('tr-TR');
    if (KNOWN_ACRONYMS.has(upperAscii))
        return KNOWN_ACRONYMS.get(upperAscii);
    if (KNOWN_ACRONYMS.has(upperTr))
        return KNOWN_ACRONYMS.get(upperTr);
    const lowerTr = word.toLocaleLowerCase('tr-TR');
    if (!isFirst && CONJUNCTIONS.has(lowerTr))
        return lowerTr;
    return word.charAt(0).toLocaleUpperCase('tr-TR') + word.slice(1).toLocaleLowerCase('tr-TR');
}
/**
 * Cümle olmayan metinleri Türkçe Başlık Düzenine (Title Case) dönüştürür.
 * Bağlaçlar küçük harfle yazılırken teknik kısaltmalar korunur.
 */
export function toTurkishTitleCase(input) {
    if (!input)
        return input;
    const words = input.split(/(\s+)/);
    let wordIndex = 0;
    return words
        .map((token) => {
        if (/^\s+$/.test(token))
            return token;
        const match = token.match(/^([^a-zA-ZçğıöşüÇĞİÖŞÜ0-9]*)(.*?)([^a-zA-ZçğıöşüÇĞİÖŞÜ0-9]*)$/);
        if (!match)
            return token;
        const [, leading, core, trailing] = match;
        if (!core)
            return token;
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
export const TOOL_TITLE_MAP = {
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
    git_status: 'Git Durumu',
    git_diff: 'Git Farkı',
    git_log: 'Git Günlüğü',
    git_add: 'Git Ekleme',
    git_commit: 'Git İşleme',
    git_push: 'Git Gönderme',
    git_branch: 'Git Dalı',
    browser_navigate: 'Tarayıcı Gezinme',
    browser_click: 'Tarayıcı Tıklama',
    browser_type: 'Tarayıcı Yazma',
    browser_fill: 'Form Doldurma',
    browser_press: 'Tarayıcı Tuş Basımı',
    browser_scroll: 'Tarayıcı Kaydırma',
    browser_inspect: 'Sayfa İnceleme',
    browser_tabs: 'Sekme Yönetimi',
    browser_screenshot: 'Tarayıcı Ekran Görüntüsü',
    computer: 'Bilgisayar Kontrolü',
    image_generate: 'Görsel Üretimi',
    memory_save: 'Bellek Kaydetme',
    memory_recall: 'Bellek Hatırlama',
    memory_forget: 'Hafıza Silme',
    skill_create: 'Yetenek Oluşturma',
    skill_list: 'Yetenek Listesi',
    delegate_task: 'Alt Ajan Görevlendirme',
    mcp_catalog: 'MCP Kataloğu',
    mcp_call: 'MCP Çağrısı',
};
/**
 * Araç adını Türkçe başlık ve parantez içinde teknik ad formatında döndürür.
 */
export function formatToolTitle(toolName) {
    if (TOOL_TITLE_MAP[toolName]) {
        return `${TOOL_TITLE_MAP[toolName]} (${toolName})`;
    }
    const clean = toolName.replace(/[_-]+/g, ' ');
    return `${toTurkishTitleCase(clean)} (${toolName})`;
}
/**
 * 0-100 arası yüzdeyi şık bir ilerleme çubuğu olarak çizer.
 */
export function renderProgressBar(percent, width = 10) {
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
export function formatDuration(ms) {
    const safeMs = Math.max(0, Number.isFinite(ms) ? ms : 0);
    return safeMs < 1000 ? `${Math.round(safeMs)}ms` : `${(safeMs / 1000).toFixed(2)}sn`;
}
//# sourceMappingURL=theme.js.map