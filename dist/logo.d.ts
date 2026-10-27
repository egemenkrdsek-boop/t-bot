/** Render two image pixels per terminal cell, with a plain-text fallback. */
export declare function logo(width: number, frame?: number): string[];
/** Render static logo frame directly to stdout. */
export declare function renderLogo(width?: number): void;
/**
 * Terminal-responsive animated logo.
 * If terminal rows < 12 or columns < 50, renders static logo directly
 * to prevent cursor drift/clipping.
 */
export declare function animateLogo(width?: number, isExiting?: () => boolean): Promise<void>;
