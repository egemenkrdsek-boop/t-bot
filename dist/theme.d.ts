export declare const paint: (code: string) => (value: string) => string;
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
