import { theme, unicode } from './theme.js';

// Sampled from the square at the left of assets/tabit.webp. W is the original
// white glyph; G is the green field; dots preserve the rounded corners.
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

const word = [
  '11110 00000 00100',
  '10001 00000 00100',
  '10001 01110 11111',
  '11110 10001 00100',
  '10001 10001 00100',
  '10001 10001 00101',
  '11110 01110 00010',
] as const;

/** Render two image pixels per terminal cell, with a plain-text fallback. */
export function logo(width: number, frame = -1): string[] {
  if (!unicode || width < 30) return [`  ${theme.bold('[t] Bot')}`];
  const compact = width < 54;
  const monochrome = process.env.NO_COLOR !== undefined;
  const trueColor = Boolean(process.env.WT_SESSION) || /truecolor|24bit/i.test(process.env.COLORTERM ?? '');
  const color256 = /256color/i.test(process.env.TERM ?? '');
  const color = (pixel: string, background: boolean, highlight: boolean): string => {
    const prefix = background ? '48' : '38';
    if (pixel === '.') return background ? '49' : '39';
    if (trueColor) return `${prefix};2;${pixel === 'G' ? (highlight ? '160;218;80' : '120;184;42') : '255;255;255'}`;
    if (color256) return `${prefix};5;${pixel === 'G' ? (highlight ? '149' : '107') : '231'}`;
    return background ? (pixel === 'G' ? (highlight ? '102' : '42') : '107') : (pixel === 'G' ? (highlight ? '92' : '32') : '97');
  };
  const lines: string[] = [];
  for (let y = 0; y < mark.length; y += 2) {
    let row = '  ';
    for (let x = 0; x < mark[y]!.length; x += compact ? 2 : 1) {
      const highlight = frame >= 0 && Math.abs(x - frame * 10) < 7;
      const visible = frame < 0 || x <= frame * 10 + 8;
      const top = visible ? mark[y]![x]! : '.';
      const bottom = visible ? mark[y + 1]![x]! : '.';
      if (monochrome) row += top === 'G' ? (bottom === 'G' ? '█' : '▀') : (bottom === 'G' ? '▄' : ' ');
      else if (top === '.' && bottom === '.') row += '\x1b[0m ';
      else if (top === '.') row += `\x1b[${color(bottom, false, highlight)};49m▄`;
      else row += `\x1b[${color(top, false, highlight)};${color(bottom, true, highlight)}m▀`;
    }
    row += monochrome ? '  ' : '\x1b[0m  ';
    // Double each font pixel in both axes to match the 14-pixel mark height.
    for (const [x, pixel] of [...word[y / 2]!].entries()) {
      const highlight = frame >= 0 && Math.abs(17 + x * 2 - frame * 10) < 7;
      const glyph = compact ? '█' : '██';
      const visible = frame < 0 || 17 + x * 2 <= frame * 10 + 8;
      row += pixel === '1' && visible ? (highlight && !monochrome ? theme.accent(glyph) : glyph) : ' '.repeat(glyph.length);
    }
    lines.push(row);
  }
  return lines;
}

/** Render static logo frame directly to stdout. */
export function renderLogo(width?: number): void {
  const logoWidth = width ?? process.stdout.columns ?? 70;
  const lines = logo(logoWidth, -1);
  process.stdout.write(`\n${lines.join('\n')}\n`);
}

/**
 * Terminal-responsive animated logo.
 * If terminal rows < 12 or columns < 50, renders static logo directly
 * to prevent cursor drift/clipping.
 */
export async function animateLogo(width?: number, isExiting?: () => boolean): Promise<void> {
  const cols = width ?? process.stdout.columns ?? 70;
  const rows = process.stdout.rows ?? 24;

  // Terminal boyutu kontrolü: rows < 12 veya columns < 50 ise imleç kaymasını önlemek için statik bas
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

  // İlk kare
  process.stdout.write(`\n${logo(cols, 0).join('\n')}\n`);

  // Dalga animasyonu (5 kare)
  for (let frame = 1; frame <= 5; frame++) {
    if (isExiting?.()) break;
    await new Promise<void>(resolve => setTimeout(resolve, 110));
    if (isExiting?.()) break;
    // 7 satır yukarı çıkıp yeniden çiz
    process.stdout.write(`\x1b[7A\r${logo(cols, frame === 5 ? -1 : frame).join('\n')}\n`);
  }
}
