/**
 * Cyber-Minimalist ANSI palette; all styling disappears for redirected output or NO_COLOR.
 * Flawlessly readable on both dark and light terminal backgrounds.
 */
const color = Boolean(process.stdout.isTTY && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb');
export const paint = (code) => (value) => color ? `\x1b[${code}m${value}\x1b[0m` : value;
export const theme = {
    // Cyber Emerald / Brand Green
    brand: paint('1;38;2;0;235;150'),
    accent: paint('38;2;0;235;150'),
    // Neon Amber / Gold
    amber: paint('38;2;255;184;0'),
    // Deep Forest / Emerald
    forest: paint('38;2;46;139;87'),
    // Cyber Slate / Muted
    muted: paint('38;2;130;145;160'),
    // Bright Off-White text - 100% readable on dark and light terminals
    text: paint('38;2;230;242;235'),
    // Cyber Neon Danger & Warning
    danger: paint('38;2;255;92;92'),
    warning: paint('38;2;255;184;0'),
    error: paint('38;2;255;92;92'),
    // Cyber Panel borders
    panel: paint('38;2;72;95;115'),
    // Badge Highlight
    badge: paint('1;38;2;0;235;150'),
    // Cyber Cyan / Neon Blue
    cyan: paint('38;2;56;205;242'),
    // Cyber Success Green
    success: paint('38;2;74;222;128'),
    // Subtle Dim text
    dim: paint('38;2;90;105;120'),
    // Bold
    bold: paint('1'),
};
export const unicode = Boolean(process.stdin && process.stdout.isTTY && process.env.TERM !== 'dumb' && process.env.TBOT_ASCII !== '1');
export const symbols = unicode
    ? {
        prompt: '›',
        assistant: '✦',
        rule: '─',
        bullet: '·',
        tool: '◇',
        hudLeft: '╭─[',
        hudRight: ']',
        hudSep: '│',
        check: '✓',
        cross: '✗',
        warn: '⚠',
        arrow: '↳',
        dot: '•',
        sparkle: '⚡',
        brain: '🧠',
        gem: '💎',
        shield: '🛡️',
        ram: '💾',
        bot: '🤖',
    }
    : {
        prompt: '>',
        assistant: '*',
        rule: '-',
        bullet: '.',
        tool: '*',
        hudLeft: '+-[',
        hudRight: ']',
        hudSep: '|',
        check: 'v',
        cross: 'x',
        warn: '!',
        arrow: '->',
        dot: '*',
        sparkle: '*',
        brain: '*',
        gem: '*',
        shield: '*',
        ram: '*',
        bot: '*',
    };
//# sourceMappingURL=theme.js.map