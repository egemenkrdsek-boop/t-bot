/** Small ANSI palette; all styling disappears for redirected output or NO_COLOR. */
const color = Boolean(process.stdout.isTTY && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb');
const paint = (code) => (value) => color ? `\x1b[${code}m${value}\x1b[0m` : value;
export const theme = {
    brand: paint('1;38;2;120;184;42'),
    accent: paint('38;2;120;184;42'),
    text: paint('38;2;23;35;23'),
    muted: paint('38;2;132;143;158'),
    success: paint('38;2;80;145;124'),
    warning: paint('38;2;181;127;65'),
    error: paint('38;2;190;85;91'),
    bold: paint('1'),
};
export const unicode = Boolean(process.stdout.isTTY && process.env.TERM !== 'dumb' && process.env.TBOT_ASCII !== '1');
export const symbols = unicode
    ? { prompt: '›', assistant: '✦', rule: '─', bullet: '·', tool: '◇' }
    : { prompt: '>', assistant: '*', rule: '-', bullet: '.', tool: '*' };
//# sourceMappingURL=theme.js.map