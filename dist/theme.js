/** Resolve the palette from explicit configuration or the COLORFGBG background index. */
export function detectTheme(env = process.env) {
    const explicit = (env.TBOT_THEME ?? '').trim().toLowerCase();
    if (explicit === 'light' || explicit === 'dark')
        return explicit;
    const hint = (env.COLORFGBG ?? '').trim();
    if (hint) {
        const parts = hint.split(';').map(part => part.trim()).filter(Boolean);
        const background = Number(parts[parts.length - 1]);
        if (Number.isInteger(background)) {
            // ANSI colours 0-6 and 8 are dark surfaces; 7 and 9-15 are light surfaces.
            return (background >= 0 && background <= 6) || background === 8 ? 'dark' : 'light';
        }
    }
    return 'dark';
}
export const colorEnabled = Boolean(process.stdout.isTTY && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb');
const color = colorEnabled;
export const paint = (code) => (value) => (color ? `\x1b[${code}m${value}\x1b[0m` : value);
export const themeMode = detectTheme();
const DARK_PALETTE = {
    // Tabit green remains the brand: a calm leaf/bright-lime system on graphite.
    brand: '1;38;2;155;227;61',
    accent: '38;2;155;227;61',
    iceWhite: '1;38;2;237;245;234',
    brightMint: '1;38;2;198;230;160',
    crystalCyan: '38;2;147;166;141',
    softLavender: '38;2;180;205;165',
    amber: '38;2;252;196;25',
    warning: '38;2;252;196;25',
    forest: '38;2;101;184;23',
    muted: '38;2;147;166;141',
    text: '38;2;237;245;234',
    danger: '38;2;255;107;107',
    error: '38;2;255;107;107',
    panel: '38;2;95;115;90',
    badge: '1;38;2;169;227;75',
    cyan: '38;2;140;233;154',
    success: '38;2;111;212;74',
    dim: '38;2;116;136;110',
    bold: '1',
};
const LIGHT_PALETTE = {
    // Dark ink on a light terminal; green stays the brand but is deepened for contrast.
    brand: '1;38;2;44;104;16',
    accent: '38;2;44;104;16',
    iceWhite: '1;38;2;22;30;26',
    brightMint: '1;38;2;38;96;16',
    crystalCyan: '38;2;70;88;80',
    softLavender: '38;2;84;68;120',
    amber: '38;2;146;94;0',
    warning: '38;2;146;94;0',
    forest: '38;2;44;104;16',
    muted: '38;2;78;94;86',
    text: '38;2;28;36;31',
    danger: '38;2;170;36;36',
    error: '38;2;170;36;36',
    panel: '38;2;72;84;76',
    badge: '1;38;2;34;88;13',
    cyan: '38;2;18;104;104',
    success: '38;2;36;116;22',
    dim: '38;2;116;126;120',
    bold: '1',
};
function buildTheme(palette) {
    return {
        brand: paint(palette.brand),
        accent: paint(palette.accent),
        iceWhite: paint(palette.iceWhite),
        brightMint: paint(palette.brightMint),
        crystalCyan: paint(palette.crystalCyan),
        softLavender: paint(palette.softLavender),
        amber: paint(palette.amber),
        warning: paint(palette.warning),
        forest: paint(palette.forest),
        muted: paint(palette.muted),
        text: paint(palette.text),
        danger: paint(palette.danger),
        error: paint(palette.error),
        panel: paint(palette.panel),
        badge: paint(palette.badge),
        cyan: paint(palette.cyan),
        success: paint(palette.success),
        dim: paint(palette.dim),
        bold: paint(palette.bold),
    };
}
export const theme = buildTheme(themeMode === 'light' ? LIGHT_PALETTE : DARK_PALETTE);
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
/**
 * Görünür genişliği `width` sütuna sığdırır. `truncateAnsi` üzerine kuruludur:
 * ANSI dizileri korunur, taşmada tek `…` eklenir.
 */
export function fitLine(text, width) {
    return truncateAnsi(text, Math.max(0, Math.floor(width)));
}
function toAnsiAtoms(text) {
    const atoms = [];
    let i = 0;
    while (i < text.length) {
        if (text.charCodeAt(i) === 0x1b) {
            const match = text.slice(i).match(/^\x1b\[[0-9;?]*[a-zA-Z]/);
            if (match) {
                atoms.push({ raw: match[0], vis: 0, isAnsi: true });
                i += match[0].length;
                continue;
            }
        }
        const codePoint = text.codePointAt(i);
        const char = String.fromCodePoint(codePoint);
        atoms.push({ raw: char, vis: 1, isAnsi: false });
        i += char.length;
    }
    return atoms;
}
/** Track the SGR state so wrapped continuation lines keep their colour. */
function nextSgrState(active, sequence) {
    if (!/^\x1b\[[0-9;]*m$/.test(sequence))
        return active;
    const params = sequence.slice(2, -1);
    if (!params || params.split(';').every(part => part === '' || part === '0'))
        return '';
    const next = `${active}${sequence}`;
    return next.length > 240 ? sequence : next;
}
function hasOpenSgr(raw) {
    const matches = raw.match(/\x1b\[[0-9;]*m/g);
    if (!matches?.length)
        return false;
    const params = matches[matches.length - 1].slice(2, -1);
    return Boolean(params) && !params.split(';').every(part => part === '' || part === '0');
}
function wrapSegment(text, width) {
    const max = Math.max(1, Math.floor(width));
    const atoms = toAnsiAtoms(text);
    if (!atoms.length)
        return [''];
    const lines = [];
    let current = [];
    let cols = 0;
    let active = '';
    let lastSpace = -1;
    let atLineStart = true;
    let firstLine = true;
    const flush = (list, dropTrailingSpace) => {
        let head = list;
        if (dropTrailingSpace) {
            while (head.length && !head[head.length - 1].isAnsi && head[head.length - 1].raw === ' ') {
                head = head.slice(0, -1);
            }
        }
        let raw = head.map(atom => atom.raw).join('');
        active = '';
        for (const atom of head)
            if (atom.isAnsi)
                active = nextSgrState(active, atom.raw);
        if (hasOpenSgr(raw))
            raw += '\x1b[0m';
        lines.push(raw);
        current = active ? [{ raw: active, vis: 0, isAnsi: true }] : [];
        cols = 0;
        lastSpace = -1;
        atLineStart = true;
        firstLine = false;
    };
    const hardBreak = () => {
        let vis = 0;
        let cut = 0;
        for (; cut < current.length; cut++) {
            const atom = current[cut];
            if (!atom.isAnsi && vis + atom.vis > max)
                break;
            if (!atom.isAnsi)
                vis += atom.vis;
        }
        if (!current.slice(0, cut).some(atom => !atom.isAnsi)) {
            const firstVisible = current.findIndex(atom => !atom.isAnsi);
            cut = firstVisible >= 0 ? firstVisible + 1 : current.length;
        }
        const head = current.slice(0, cut);
        const tail = current.slice(cut);
        flush(head, true);
        current.push(...tail);
        cols = tail.reduce((sum, atom) => sum + atom.vis, 0);
        atLineStart = false;
        lastSpace = -1;
        for (let i = 0; i < current.length; i++)
            if (!current[i].isAnsi && current[i].raw === ' ')
                lastSpace = i;
    };
    const breakAtSpace = () => {
        if (lastSpace < 0)
            return false;
        const head = current.slice(0, lastSpace);
        if (!head.some(atom => !atom.isAnsi))
            return false;
        const tail = current.slice(lastSpace + 1);
        flush(head, true);
        current.push(...tail);
        cols = tail.reduce((sum, atom) => sum + atom.vis, 0);
        atLineStart = false;
        lastSpace = -1;
        for (let i = 0; i < current.length; i++)
            if (!current[i].isAnsi && current[i].raw === ' ')
                lastSpace = i;
        return true;
    };
    for (const atom of atoms) {
        if (atom.isAnsi) {
            current.push(atom);
            continue;
        }
        if (atom.raw === ' ') {
            if (atLineStart && !firstLine)
                continue;
            if (cols >= max) {
                flush(current, true);
                continue;
            }
            current.push(atom);
            cols += 1;
            lastSpace = current.length - 1;
            atLineStart = false;
            continue;
        }
        while (cols >= max) {
            if (!breakAtSpace())
                hardBreak();
            if (cols < max || (!current.length && !lines.length))
                break;
            // A tail that is still too wide is split again on the next pass.
            if (cols >= max && current.every(item => item.isAnsi))
                break;
        }
        current.push(atom);
        cols += atom.vis;
        atLineStart = false;
    }
    if (current.length)
        flush(current, true);
    return lines.length ? lines : [''];
}
/**
 * ANSI-güvenli kelime kaydırma. Görünür genişliği `width` sütunu aşmaz;
 * satır sonlarında renk durumu korunur ve sıfırlama dizisi eklenir.
 */
export function wrapLine(text, width) {
    if (!text)
        return [''];
    const max = Math.max(1, Math.floor(width));
    return String(text)
        .split('\n')
        .flatMap(segment => wrapSegment(segment, max));
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
const CYBER_STOPS = [
    { r: 148, g: 216, b: 45 }, // #94D82D (Tabit Yeşili)
    { r: 102, g: 217, b: 232 }, // #66D9E8 (Kristal Camgöbeği)
    { r: 184, g: 236, b: 130 }, // #B8EC82 (Parlak Nane)
    { r: 226, g: 250, b: 170 }, // #E2FAAA (Işıltılı Filiz)
];
/**
 * 24-bit TrueColor sinüs dalgası faz enterpolasyonlu renk hesaplayıcı.
 * #94D82D (Tabit Yeşili) -> #66D9E8 (Kristal Camgöbeği) -> #B8EC82 (Parlak Nane) -> #E2FAAA (Işıltılı Filiz)
 */
export function interpolateCyberColor(phase) {
    const normPhase = ((phase % 1) + 1) % 1;
    const scaled = normPhase * 4;
    const i0 = Math.floor(scaled) % 4;
    const i1 = (i0 + 1) % 4;
    const frac = scaled - Math.floor(scaled);
    // Pürüzsüz sinüs geçişi
    const smooth = 0.5 * (1 - Math.cos(frac * Math.PI));
    const c0 = CYBER_STOPS[i0];
    const c1 = CYBER_STOPS[i1];
    return {
        r: Math.round(c0.r + (c1.r - c0.r) * smooth),
        g: Math.round(c0.g + (c1.g - c0.g) * smooth),
        b: Math.round(c0.b + (c1.b - c0.b) * smooth),
    };
}
/** TrueColor terminal desteğini güvenle sorgular */
function isTrueColorSupported() {
    return (process.env.NO_COLOR === undefined &&
        (Boolean(process.env.WT_SESSION) ||
            /truecolor|24bit/i.test(process.env.COLORTERM ?? '') ||
            (Boolean(process.stdout.isTTY) && process.env.TERM !== 'dumb')));
}
/**
 * Siber-Dalga Gradyan Çubuğu Üretici.
 * 24-bit TrueColor faz enterpolasyonu ile pürüzsüz akan biyolüminesan dalga çizer.
 */
export function renderCyberWave(frame = 0, width = 8) {
    const safeFrame = Number.isFinite(Number(frame)) ? Math.abs(Math.floor(Number(frame))) : 0;
    const safeWidth = Number.isFinite(Number(width)) ? Math.max(1, Math.floor(Number(width))) : 8;
    if (process.env.NO_COLOR !== undefined) {
        return '━'.repeat(safeWidth);
    }
    if (themeMode === 'light' || !isTrueColorSupported()) {
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
export function cyberPulseBadge(text, frame = 0) {
    if (!text)
        return '';
    if (process.env.NO_COLOR !== undefined)
        return text;
    const safeFrame = Number.isFinite(Number(frame)) ? Math.abs(Math.floor(Number(frame))) : 0;
    if (themeMode === 'light' || !isTrueColorSupported()) {
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
//# sourceMappingURL=theme.js.map