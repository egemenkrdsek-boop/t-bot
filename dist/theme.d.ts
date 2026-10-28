/**
 * T Bot terminal palette: Tabit green on graphite, semantic status colors,
 * and a calm low-contrast surface set. ANSI is disabled for NO_COLOR/dumb terminals.
 *
 * The palette follows the terminal background so the TUI stays readable on a
 * light (white) terminal:
 *   TBOT_THEME=light|dark   explicit override
 *   COLORFGBG=15;0          xterm background hint (0-6 / 8 dark, 7 / 9-15 light)
 * When neither is present the dark palette is used (historical behaviour).
 */
export type ThemeMode = 'light' | 'dark';
/** Resolve the palette from explicit configuration or the COLORFGBG background index. */
export declare function detectTheme(env?: Record<string, string | undefined>): ThemeMode;
export declare const colorEnabled: boolean;
export declare const paint: (code: string) => (value: string) => string;
export declare const themeMode: ThemeMode;
export declare const theme: {
    brand: (value: string) => string;
    accent: (value: string) => string;
    iceWhite: (value: string) => string;
    brightMint: (value: string) => string;
    crystalCyan: (value: string) => string;
    softLavender: (value: string) => string;
    amber: (value: string) => string;
    warning: (value: string) => string;
    forest: (value: string) => string;
    muted: (value: string) => string;
    text: (value: string) => string;
    danger: (value: string) => string;
    error: (value: string) => string;
    panel: (value: string) => string;
    badge: (value: string) => string;
    cyan: (value: string) => string;
    success: (value: string) => string;
    dim: (value: string) => string;
    bold: (value: string) => string;
};
export declare const unicode: boolean;
export declare const symbols: {
    prompt: string;
    assistant: string;
    user: string;
    tool: string;
    bullet: string;
    arrow: string;
    tree: string;
    check: string;
    cross: string;
    warn: string;
    bar: string;
    rule: string;
    dot: string;
    sparkle: string;
    brain: string;
    gem: string;
    shield: string;
    ram: string;
    bot: string;
    hudLeft: string;
    hudRight: string;
    hudSep: string;
};
/**
 * Metindeki tüm ANSI kaçış dizilerini temizler.
 */
export declare function stripAnsi(str: string): string;
/**
 * ANSI renk kodlarını yok sayarak metnin ekranda kapladığı görünür karakter uzunluğunu hesaplar.
 */
export declare function visibleLength(str: string): number;
/**
 * ANSI renk kodlarını bozmadan görünür karakter sayısını `maxCols` ile sınırlandırır
 * ve taşma durumunda sonuna `…\x1b[0m` ekler (sıfır-taşma garantisi).
 */
export declare function truncateAnsi(str: string, maxCols: number): string;
/**
 * Görünür genişliği `width` sütuna sığdırır. `truncateAnsi` üzerine kuruludur:
 * ANSI dizileri korunur, taşmada tek `…` eklenir.
 */
export declare function fitLine(text: string, width: number): string;
/**
 * ANSI-güvenli kelime kaydırma. Görünür genişliği `width` sütunu aşmaz;
 * satır sonlarında renk durumu korunur ve sıfırlama dizisi eklenir.
 */
export declare function wrapLine(text: string, width: number): string[];
/**
 * Cümle olmayan metinleri Türkçe Başlık Düzenine (Title Case) dönüştürür.
 * Bağlaçlar küçük harfle yazılırken teknik kısaltmalar korunur.
 */
export declare function toTurkishTitleCase(input: string): string;
export declare const TOOL_TITLE_MAP: Record<string, string>;
/**
 * Araç adını Türkçe başlık ve parantez içinde teknik ad formatında döndürür.
 */
export declare function formatToolTitle(toolName: string): string;
/**
 * 0-100 arası yüzdeyi şık bir ilerleme çubuğu olarak çizer.
 */
export declare function renderProgressBar(percent: number, width?: number): string;
/**
 * Milisaniye cinsinden süreyi okunabilir biçimde biçimlendirir.
 */
export declare function formatDuration(ms: number): string;
interface RGB {
    r: number;
    g: number;
    b: number;
}
/**
 * 24-bit TrueColor sinüs dalgası faz enterpolasyonlu renk hesaplayıcı.
 * #94D82D (Tabit Yeşili) -> #66D9E8 (Kristal Camgöbeği) -> #B8EC82 (Parlak Nane) -> #E2FAAA (Işıltılı Filiz)
 */
export declare function interpolateCyberColor(phase: number): RGB;
/**
 * Siber-Dalga Gradyan Çubuğu Üretici.
 * 24-bit TrueColor faz enterpolasyonu ile pürüzsüz akan biyolüminesan dalga çizer.
 */
export declare function renderCyberWave(frame?: number, width?: number): string;
/**
 * Siber-Zen Nabız Rozeti Üretici.
 * Metni harf harf veya faz bazlı sinüs dalgası degrade geçişi ile boyar.
 */
export declare function cyberPulseBadge(text: string, frame?: number): string;
export {};
