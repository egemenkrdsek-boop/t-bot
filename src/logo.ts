import { theme, unicode } from './theme.js';

// Sol rozet (14x14 matris): W = Saf Parlak Kristal Beyaz (#FFFFFF) T sembolü,
// G = Parlak Kristal Mint & Buz Camgöbeği (#63E6BE -> #A5F3FC) açık gradyan zemin.
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
 * Rozet (mark) pikselleri için parlak açık Kristal Mint (#63E6BE) -> Buz Camgöbeği (#A5F3FC)
 * diyagonal gradyanı ve Saf Parlak Kristal Beyaz (#FFFFFF) T sembolü rengi üretir.
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
    // G pikselleri: #63E6BE (99, 230, 190) -> #A5F3FC (165, 243, 252) diyagonal açık gradyan
    if (highlight) {
      return `${prefix};2;236;254;255`;
    }
    const diag = (x + y) / 26;
    const r = lerp(99, 165, diag);
    const g = lerp(230, 243, diag);
    const b = lerp(190, 252, diag);
    return `${prefix};2;${r};${g};${b}`;
  }

  if (color256) {
    if (pixel === 'W') return `${prefix};5;231`;
    return `${prefix};5;${highlight ? '195' : '122'}`;
  }

  return background
    ? (pixel === 'G' ? (highlight ? '106' : '102') : '107')
    : (pixel === 'G' ? (highlight ? '96' : '92') : '97');
}

/**
 * "T BOT" (word) pikselleri için Saf Parlak Beyaz (#FFFFFF) -> Açık Buz Mavisi (#E0F2FE -> #A5F3FC)
 * parlak açık tonlu gradyan rengi üretir.
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
    if (highlight) {
      return '1;38;2;255;255;255';
    }
    const t = Math.max(0, Math.min(1, (x / Math.max(1, totalWidth)) * 0.65 + (y / 14) * 0.35));
    if (t <= 0.5) {
      const localT = t * 2;
      const r = lerp(255, 224, localT);
      const g = lerp(255, 242, localT);
      const b = lerp(255, 254, localT);
      return `1;38;2;${r};${g};${b}`;
    }
    const localT = (t - 0.5) * 2;
    const r = lerp(224, 165, localT);
    const g = lerp(242, 243, localT);
    const b = lerp(254, 252, localT);
    return `1;38;2;${r};${g};${b}`;
  }

  if (color256) {
    return `1;38;5;${highlight ? '231' : '195'}`;
  }

  return highlight ? '1;97' : '1;96';
}

/** Terminal hücresi başına iki dikey sub-pixel çizer; düz metin yedeği içerir. */
export function logo(width: number, frame = -1): string[] {
  if (!unicode || width < 30) return [`  ${theme.iceWhite('[T] T BOT')} ${theme.brightMint('v2.0 · TRI-CORE · LOCAL AI')}`];
  const compact = width < 58;
  const monochrome = process.env.NO_COLOR !== undefined;
  const trueColor = Boolean(process.env.WT_SESSION) || /truecolor|24bit/i.test(process.env.COLORTERM ?? '') || Boolean(process.stdout.isTTY);
  const color256 = /256color/i.test(process.env.TERM ?? '');

  const lines: string[] = [];
  // 8 karelik (frame = 0..7) diyagonal gümüş-beyaz / parlak buz ışıltı dalgası
  const wavePos = frame >= 0 ? frame * 8 : -100;
  const wordWidth = word[0]!.length;

  for (let y = 0; y < mark.length; y += 2) {
    let row = '  ';
    // 1. Sol Rozet (14x14 Crystal-Mint & Ice-Cyan + Saf Beyaz T)
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
        ? 'v2.0 · TRI-CORE · LOCAL AI'
        : `${theme.brightMint('v2.0')} ${theme.dim('·')} ${theme.iceWhite('TRI-CORE')} ${theme.dim('·')} ${theme.crystalCyan('LOCAL AI')}`;
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

  // Alt bilgi rozet satırı (geniş terminallerde)
  if (!compact && width >= 66) {
    const pill = monochrome
      ? '  ╭─ ⚡ Tri-Core  │  🛡 Zero-Hallucination  │  💎 %50-75 Token Tasarrufu ─╮'
      : `  ${theme.crystalCyan('╭─')} ${theme.brightMint('⚡ Tri-Core')}  ${theme.dim('│')}  ${theme.iceWhite('🛡 Zero-Hallucination')}  ${theme.dim('│')}  ${theme.crystalCyan('💎 %50-75 Token Tasarrufu')} ${theme.crystalCyan('─╮')}`;
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
 * Terminal Duyarlı Hareketli Logo Çizimi (Crystal-Ice & Bright-Mint Shimmer).
 * Başlarken \x1b[?25l ile imleci gizler, try ... finally içinde \x1b[?25h ile geri açar.
 * 8 karelik diyagonal gümüş-beyaz / parlak buz ışıltısı akıp geçer ve parlak açık renklerde sabitlenir.
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

    const totalFrames = 8;
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
