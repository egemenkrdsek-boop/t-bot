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
/** Render two image pixels per terminal cell, with a plain-text fallback. */
export function logo(width) {
    if (!unicode || process.env.NO_COLOR !== undefined || width < 53)
        return [`  ${theme.bold('[t] Bot')}`];
    const trueColor = /truecolor|24bit/i.test(process.env.COLORTERM ?? '');
    const color256 = /256color/i.test(process.env.TERM ?? '');
    const color = (pixel, background) => {
        const prefix = background ? '48' : '38';
        if (pixel === '.')
            return background ? '49' : '39';
        if (trueColor)
            return `${prefix};2;${pixel === 'G' ? '120;184;42' : '255;255;255'}`;
        if (color256)
            return `${prefix};5;${pixel === 'G' ? '107' : '231'}`;
        return background ? (pixel === 'G' ? '42' : '107') : (pixel === 'G' ? '32' : '97');
    };
    const lines = [];
    for (let y = 0; y < mark.length; y += 2) {
        let row = '  ';
        for (let x = 0; x < mark[y].length; x++) {
            row += `\x1b[${color(mark[y][x], false)};${color(mark[y + 1][x], true)}m▀`;
        }
        row += '\x1b[0m   ';
        // Double each font pixel in both axes to match the 14-pixel mark height.
        for (const pixel of word[y / 2])
            row += pixel === '1' ? '██' : '  ';
        lines.push(row);
    }
    return lines;
}
//# sourceMappingURL=logo.js.map