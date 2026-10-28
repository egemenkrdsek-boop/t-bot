import { cyberPulseBadge, theme, themeMode, unicode } from './theme.js';
import { APP_VERSION } from './version.js';

// Sol rozet (14x14 matris - assets/tabit.webp sol ikonundan örneklenmiştir):
// W = Saf Parlak Tabit Beyazı (#FFFFFF) T sembolü,
// G = Açık ve Parlak Tabit Yeşili (#84CC32 -> #B8EC6E) diyagonal gradyan zemin.
const mark = [
  'GGGGGGGGGGGGG.',
  'GGGGGGGGGGGGGG',
  'GGGGGWWGGGGGGG',
  'GGGGGWWWGGGGGG',
  'GGGGWWWWWWGGGG',
  'GGGGGWWWGGGGGG',
  'GGGGGWWWGGGGGG',
  'GGGGGWWWGGGGGG',
  'GGGGGWWWGGGGGG',
  'GGGGGWWWGGGGGG',
  'GGGGGWWWWGGGGG',
  'GGGGGGWWWGGGGG',
  'GGGGGGGGGGGGGG',
  '.GGGGGGGGGGGGG',
] as const;

// Sağdaki "T BOT" yazısı (14 satır yüksekliğinde sub-pixel ▀, ▄, █ matrisi)
const word = [
  '000000000000000000000000000000000000000',
  '000000000000000000000000000000000000000',
  '111111110001111111000011111100011111111',
  '111111110001111111100111111110011111111',
  '000110000001100001100110000110000011000',
  '000110000001100001100110000110000011000',
  '000110000001111111000110000110000011000',
  '000110000001111111000110000110000011000',
  '000110000001100001100110000110000011000',
  '000110000001100001100110000110000011000',
  '000110000001111111100111111110000011000',
  '000110000001111111000011111100000011000',
  '000000000000000000000000000000000000000',
  '000000000000000000000000000000000000000',
] as const;

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * Math.max(0, Math.min(1, t)));
}

/**
 * Rozet (mark) pikselleri için tabit.webp'nin açık ve parlak Tabit yeşili (#84CC32 -> #B8EC6E)
 * diyagonal gradyanı ve Saf Parlak Beyaz (#FFFFFF) T sembolü rengi üretir.
 */
function markPixelColor(
  pixel: string,
  x: number,
  y: number,
  background: boolean,
  highlight: boolean,
  trueColor: boolean,
  color256: boolean,
): string {
  const prefix = background ? '48' : '38';
  if (pixel === '.') return background ? '49' : '39';

  if (trueColor) {
    if (pixel === 'W') {
      return background ? '48;2;255;255;255' : '1;38;2;255;255;255';
    }
    // G pikselleri: tabit.webp'nin açık ve parlak yeşili (#84CC32: 132,204,50 -> #B8EC6E: 184,236,110)
    if (highlight) {
      return `${prefix};2;226;250;170`;
    }
    const diag = (x + y) / 26;
    const r = lerp(132, 184, diag);
    const g = lerp(204, 236, diag);
    const b = lerp(50, 110, diag);
    return `${prefix};2;${r};${g};${b}`;
  }

  if (color256) {
    if (pixel === 'W') return `${prefix};5;231`;
    return `${prefix};5;${highlight ? '192' : '149'}`;
  }

  return background
    ? (pixel === 'G' ? '102' : '107')
    : (pixel === 'G' ? '92' : '97');
}

/**
 * "T BOT" (word) pikselleri için tabit.webp'deki Saf Parlak Beyaz (#FFFFFF) ->
 * Açık Filiz/Nane Yeşili Beyazı (#F4FCE8 -> #C8F096) parlak açık tonlu gradyan rengi üretir.
 */
function wordPixelColor(
  x: number,
  y: number,
  totalWidth: number,
  highlight: boolean,
  trueColor: boolean,
  color256: boolean,
): string {
  if (trueColor) {
    if (themeMode === 'light') {
      // Dark ink for the "T BOT" wordmark so it stays readable on a white terminal.
      if (highlight) return '1;38;2;8;18;12';
      const t = Math.max(0, Math.min(1, (x / Math.max(1, totalWidth)) * 0.65 + (y / 14) * 0.35));
      const r = lerp(34, 24, t);
      const g = lerp(56, 84, t);
      const b = lerp(38, 32, t);
      return `1;38;2;${r};${g};${b}`;
    }
    if (highlight) {
      return '1;38;2;255;255;255';
    }
    const t = Math.max(0, Math.min(1, (x / Math.max(1, totalWidth)) * 0.65 + (y / 14) * 0.35));
    if (t <= 0.5) {
      const localT = t * 2;
      const r = lerp(255, 244, localT);
      const g = lerp(255, 252, localT);
      const b = lerp(255, 232, localT);
      return `1;38;2;${r};${g};${b}`;
    }
    const localT = (t - 0.5) * 2;
    const r = lerp(244, 200, localT);
    const g = lerp(252, 240, localT);
    const b = lerp(232, 150, localT);
    return `1;38;2;${r};${g};${b}`;
  }

  if (color256) {
    if (themeMode === 'light') return `1;38;5;${highlight ? '232' : '22'}`;
    return `1;38;5;${highlight ? '231' : '192'}`;
  }

  if (themeMode === 'light') return highlight ? '1;30' : '1;32';
  return highlight ? '1;97' : '1;92';
}

/** Terminal hücresi başına iki dikey sub-pixel çizer; düz metin yedeği içerir. */
export function logo(width: number, frame = -1): string[] {
  if (!unicode || width < 30) return [`  ${theme.iceWhite('[T] T BOT')} ${theme.brightMint(`v${APP_VERSION} · LOCAL AI`)}`];
  const compact = width < 58;
  const monochrome = process.env.NO_COLOR !== undefined;
  const trueColor = Boolean(process.env.WT_SESSION) || /truecolor|24bit/i.test(process.env.COLORTERM ?? '') || Boolean(process.stdout.isTTY);
  const color256 = /256color/i.test(process.env.TERM ?? '');

  const lines: string[] = [];
  // 10 karelik (frame = 0..9) diyagonal saf beyaz / açık parlak Tabit yeşili ışıltı dalgası
  const wavePos = frame >= 0 ? frame * 7.5 : -100;
  const wordWidth = word[0]!.length;

  for (let y = 0; y < mark.length; y += 2) {
    let row = '  ';
    // 1. Sol Rozet (14x14 Açık Parlak Tabit Yeşili + Saf Beyaz T)
    for (let x = 0; x < mark[y]!.length; x += compact ? 2 : 1) {
      const diag = x + y * 0.75;
      const highlight = frame >= 0 && Math.abs(diag - wavePos) < 4.5;
      const top = mark[y]![x]!;
      const bottom = mark[y + 1]![x]!;

      if (monochrome) {
        row += top !== '.' ? (bottom !== '.' ? '█' : '▀') : (bottom !== '.' ? '▄' : ' ');
      } else if (top === '.' && bottom === '.') {
        row += '\x1b[0m ';
      } else if (top === '.') {
        const fg = markPixelColor(bottom, x, y + 1, false, highlight, trueColor, color256);
        row += `\x1b[${fg};49m▄`;
      } else if (bottom === '.') {
        const fg = markPixelColor(top, x, y, false, highlight, trueColor, color256);
        row += `\x1b[${fg};49m▀`;
      } else {
        const fg = markPixelColor(top, x, y, false, highlight, trueColor, color256);
        const bg = markPixelColor(bottom, x, y + 1, true, highlight, trueColor, color256);
        row += `\x1b[${fg};${bg}m▀`;
      }
    }

    row += monochrome ? '   ' : '\x1b[0m   ';

    // 2. Sağdaki "T BOT" Sub-Pixel Yazısı ve Alt Rozet Satırı
    if (y === 12) {
      // 7. terminal satırında "T BOT" yazısının hemen altına açık renkli zarif rozet satırı
      const subtitle = monochrome
        ? `v${APP_VERSION} · LOCAL AI`
        : `${theme.brightMint(`v${APP_VERSION}`)} ${theme.dim('·')} ${theme.crystalCyan('LOCAL AI')}`;
      row += subtitle;
    } else {
      const step = compact ? 2 : 1;
      for (let x = 0; x < wordWidth; x += step) {
        const globalX = 17 + x;
        const diag = globalX + y * 0.75;
        const highlight = frame >= 0 && Math.abs(diag - wavePos) < 5;
        const top = word[y]![x]!;
        const bottom = word[y + 1]![x]!;

        if (top === '0' && bottom === '0') {
          row += ' ';
        } else if (monochrome) {
          row += top === '1' && bottom === '1' ? '█' : top === '1' ? '▀' : '▄';
        } else {
          const fg = wordPixelColor(x, y, wordWidth, highlight, trueColor, color256);
          const glyph = top === '1' && bottom === '1' ? '█' : top === '1' ? '▀' : '▄';
          row += `\x1b[${fg}m${glyph}\x1b[0m`;
        }
      }
    }

    if (!monochrome) row += '\x1b[0m';
    lines.push(row);
  }

  // Alt bilgi rozet satırı (geniş terminallerde canlı sistem telemetri rozeti)
  if (!compact && width >= 66) {
    const badgeText = '◈ YEREL AJAN · KOD DENETİMİ · TOKEN OPTİMİZASYONU';
    const pill = monochrome
      ? `  ╭─ ${badgeText} ─╮`
      : `  ${theme.crystalCyan('╭─')} ${cyberPulseBadge(badgeText, frame >= 0 ? frame : 0)} ${theme.crystalCyan('─╮')}`;
    lines.push(pill);
  }

  return lines;
}

/** Statik logoyu doğrudan standart çıktıya çizer. */
export function renderLogo(width?: number): void {
  const logoWidth = width ?? process.stdout.columns ?? 70;
  const lines = logo(logoWidth, -1);
  process.stdout.write(`\n${lines.join('\n')}\n`);
}

/**
 * Terminal Duyarlı Hareketli Logo Çizimi (Açık Parlak Tabit Yeşili & Saf Beyaz Işıltı).
 * Başlarken \x1b[?25l ile imleci gizler, try ... finally içinde \x1b[?25h ile geri açar.
 * 8 karelik diyagonal saf beyaz / açık filiz yeşili ışıltısı akıp geçer ve parlak açık renklerde sabitlenir.
 */
export async function animateLogo(
  widthOrDelay?: number,
  isExiting?: () => boolean,
  frameDelayMs = 55,
): Promise<void> {
  // Hem animateLogo(55) hem de animateLogo(width, isExiting, 55) çağrılarını destekle
  const isFirstArgDelay = isExiting === undefined && widthOrDelay !== undefined && widthOrDelay <= 60;
  const cols = isFirstArgDelay
    ? (process.stdout.columns ?? 70)
    : (widthOrDelay ?? process.stdout.columns ?? 70);
  const delay = isFirstArgDelay ? widthOrDelay : frameDelayMs;
  const rows = process.stdout.rows ?? 24;

  const skipAnimation =
    rows < 12 ||
    cols < 50 ||
    process.env.TBOT_NO_ANIMATION !== undefined ||
    process.env.TERM === 'dumb' ||
    process.env.TBOT_ASCII === '1' ||
    !unicode;

  if (skipAnimation) {
    renderLogo(cols);
    return;
  }

  process.stdout.write('\x1b[?25l');
  try {
    const initialLines = logo(cols, 0);
    const lineCount = initialLines.length;
    process.stdout.write(`\n${initialLines.join('\n')}\n`);

    const totalFrames = 10;
    for (let frame = 1; frame <= totalFrames; frame++) {
      if (isExiting?.()) break;
      await new Promise<void>(resolve => setTimeout(resolve, delay));
      if (isExiting?.()) break;
      const targetFrame = frame === totalFrames ? -1 : frame;
      const nextLines = logo(cols, targetFrame);
      process.stdout.write(`\x1b[?2026h\x1b[${lineCount}A\r${nextLines.join('\n')}\n\x1b[?2026l`);
    }
  } finally {
    process.stdout.write('\x1b[?25h');
  }
}
