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
];
const word = [
    '11110 00000 00100',
    '10001 00000 00100',
    '10001 01110 11111',
    '11110 10001 00100',
    '10001 10001 00100',
    '10001 10001 00101',
    '11110 01110 00010',
];
/** Terminal hücresi başına iki piksel çizer; düz metin yedeği içerir. */
export function logo(width, frame = -1) {
    if (!unicode || width < 30)
        return [`  ${theme.bold('[T] Bot')}`];
    const compact = width < 54;
    const monochrome = process.env.NO_COLOR !== undefined;
    const trueColor = Boolean(process.env.WT_SESSION) || /truecolor|24bit/i.test(process.env.COLORTERM ?? '');
    const color256 = /256color/i.test(process.env.TERM ?? '');
    const color = (pixel, background, highlight) => {
        const prefix = background ? '48' : '38';
        if (pixel === '.')
            return background ? '49' : '39';
        // Yumuşak Zümrüt (#38D9A9) ve Mat Adaçayı (#2B8A66), Göz Yormayan Kırık Beyaz (#DAE4EB)
        if (trueColor) {
            if (pixel === 'G') {
                return `${prefix};2;${highlight ? '56;217;169' : '43;138;102'}`;
            }
            return `${prefix};2;${highlight ? '240;248;252' : '218;228;235'}`;
        }
        if (color256) {
            if (pixel === 'G') {
                return `${prefix};5;${highlight ? '79' : '29'}`;
            }
            return `${prefix};5;${highlight ? '255' : '254'}`;
        }
        return background
            ? (pixel === 'G' ? (highlight ? '102' : '42') : '107')
            : (pixel === 'G' ? (highlight ? '92' : '32') : '97');
    };
    const lines = [];
    const wavePos = frame >= 0 ? frame * 8 : -1;
    for (let y = 0; y < mark.length; y += 2) {
        let row = '  ';
        for (let x = 0; x < mark[y].length; x += compact ? 2 : 1) {
            const highlight = frame >= 0 && Math.abs(x - wavePos) < 6;
            const visible = frame < 0 || x <= wavePos + 8;
            const top = visible ? mark[y][x] : '.';
            const bottom = visible ? mark[y + 1][x] : '.';
            if (monochrome)
                row += top === 'G' ? (bottom === 'G' ? '█' : '▀') : (bottom === 'G' ? '▄' : ' ');
            else if (top === '.' && bottom === '.')
                row += '\x1b[0m ';
            else if (top === '.')
                row += `\x1b[${color(bottom, false, highlight)};49m▄`;
            else
                row += `\x1b[${color(top, false, highlight)};${color(bottom, true, highlight)}m▀`;
        }
        row += monochrome ? '  ' : '\x1b[0m  ';
        // 14 piksellik işaret boyuna eşitlemek için iki eksende de piksel büyütme
        for (const [x, pixel] of [...word[y / 2]].entries()) {
            const fontX = 17 + x * 2;
            const highlight = frame >= 0 && Math.abs(fontX - wavePos) < 6;
            const glyph = compact ? '█' : '██';
            const visible = frame < 0 || fontX <= wavePos + 8;
            row += pixel === '1' && visible
                ? (highlight && !monochrome ? theme.accent(glyph) : (!monochrome ? theme.text(glyph) : glyph))
                : ' '.repeat(glyph.length);
        }
        lines.push(row);
    }
    return lines;
}
/** Statik logoyu doğrudan standart çıktıya çizer. */
export function renderLogo(width) {
    const logoWidth = width ?? process.stdout.columns ?? 70;
    const lines = logo(logoWidth, -1);
    process.stdout.write(`\n${lines.join('\n')}\n`);
}
/**
 * Terminal Duyarlı Hareketli Logo Çizimi.
 * Terminal satır sayısı < 12 veya sütun sayısı < 50 ise imleç kaymasını
 * önlemek için statik logo çizer.
 */
export async function animateLogo(width, isExiting) {
    const cols = width ?? process.stdout.columns ?? 70;
    const rows = process.stdout.rows ?? 24;
    // Terminal Boyutu Kontrolü
    const skipAnimation = rows < 12 ||
        cols < 50 ||
        process.env.TBOT_NO_ANIMATION !== undefined ||
        process.env.TERM === 'dumb' ||
        process.env.TBOT_ASCII === '1' ||
        !unicode;
    if (skipAnimation) {
        renderLogo(cols);
        return;
    }
    // İlk Kare
    process.stdout.write(`\n${logo(cols, 0).join('\n')}\n`);
    // Yumuşak Dalga Animasyonu
    const totalFrames = 7;
    for (let frame = 1; frame <= totalFrames; frame++) {
        if (isExiting?.())
            break;
        await new Promise(resolve => setTimeout(resolve, 75));
        if (isExiting?.())
            break;
        // 7 Satır Yukarı Çıkıp Yeniden Çiz
        process.stdout.write(`\x1b[7A\r${logo(cols, frame === totalFrames ? -1 : frame).join('\n')}\n`);
    }
}
//# sourceMappingURL=logo.js.map