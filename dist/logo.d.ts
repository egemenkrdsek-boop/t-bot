/** Terminal hücresi başına iki piksel çizer; düz metin yedeği içerir. */
export declare function logo(width: number, frame?: number): string[];
/** Statik logoyu doğrudan standart çıktıya çizer. */
export declare function renderLogo(width?: number): void;
/**
 * Terminal Duyarlı Hareketli Logo Çizimi.
 * Terminal satır sayısı < 12 veya sütun sayısı < 50 ise imleç kaymasını
 * önlemek için statik logo çizer.
 */
export declare function animateLogo(width?: number, isExiting?: () => boolean): Promise<void>;
