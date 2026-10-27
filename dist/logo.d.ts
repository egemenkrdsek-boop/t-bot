/** Terminal hücresi başına iki dikey sub-pixel çizer; düz metin yedeği içerir. */
export declare function logo(width: number, frame?: number): string[];
/** Statik logoyu doğrudan standart çıktıya çizer. */
export declare function renderLogo(width?: number): void;
/**
 * Terminal Duyarlı Hareketli Logo Çizimi (Açık Parlak Tabit Yeşili & Saf Beyaz Işıltı).
 * Başlarken \x1b[?25l ile imleci gizler, try ... finally içinde \x1b[?25h ile geri açar.
 * 8 karelik diyagonal saf beyaz / açık filiz yeşili ışıltısı akıp geçer ve parlak açık renklerde sabitlenir.
 */
export declare function animateLogo(widthOrDelay?: number, isExiting?: () => boolean, frameDelayMs?: number): Promise<void>;
