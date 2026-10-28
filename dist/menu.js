import { fitLine, theme, unicode, wrapLine } from './theme.js';
import { StringDecoder } from 'node:string_decoder';
/** Select a fixed choice with arrow keys. Returns undefined when cancelled or not a TTY. */
export async function selectOption(title, choices) {
    if (!process.stdin.isTTY || !process.stdout.isTTY || choices.length === 0)
        return undefined;
    let selected = 0;
    let rendered = 0;
    const clean = (value) => value.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
    const borderChar = unicode ? '│' : '|';
    const arrowChar = unicode ? '❯' : '>';
    const draw = () => {
        const cols = Math.max(20, Math.floor(process.stdout.columns || 80));
        const rows = Math.max(6, Math.floor(process.stdout.rows || 24));
        const safeRendered = Math.min(rendered, Math.max(1, rows - 2));
        const clearSeq = rendered ? `\x1b[${safeRendered}A\x1b[J` : '';
        const prefixWidth = 6; // "  │ ❯ "
        const contentWidth = Math.max(8, cols - prefixWidth);
        const choiceLines = choices.map((choice, index) => {
            const active = index === selected;
            const label = clean(choice.label);
            const desc = choice.description ? `  ${clean(choice.description)}` : '';
            const content = active
                ? `${theme.iceWhite(label)}${desc ? theme.crystalCyan(desc) : ''}`
                : `${theme.muted(label)}${desc ? theme.dim(desc) : ''}`;
            return wrapLine(content, contentWidth);
        });
        const counts = choiceLines.map(lines => Math.max(1, lines.length));
        // Fit as many whole choices as the terminal allows, keeping the selection visible.
        const titleLine = fitLine(theme.iceWhite(clean(title)), cols);
        const footerVisible = choices.length > 1;
        const footerLine = fitLine(theme.muted(`${footerVisible ? `  ${selected + 1}/${choices.length} · ` : '  '}↑/↓ Seç · Enter Onayla · Esc İptal`), cols);
        const budget = Math.max(1, rows - 3); // title + footer + one safety row
        let start = selected;
        let end = selected + 1;
        let used = counts[selected];
        for (;;) {
            let grew = false;
            if (start > 0 && used + counts[start - 1] <= budget) {
                start--;
                used += counts[start];
                grew = true;
            }
            if (end < choices.length && used + counts[end] <= budget) {
                used += counts[end];
                end++;
                grew = true;
            }
            if (!grew)
                break;
        }
        const lines = [titleLine];
        for (let index = start; index < end; index++) {
            const active = index === selected;
            const prefix = active
                ? `  ${theme.brightMint(borderChar)} ${theme.brightMint(arrowChar)} `
                : `  ${theme.dim(borderChar)}   `;
            const pad = ' '.repeat(prefixWidth);
            choiceLines[index].forEach((line, lineIndex) => {
                lines.push(lineIndex === 0 ? `${prefix}${line}` : `${pad}${line}`);
            });
        }
        lines.push(footerLine);
        process.stdout.write(`\x1b[?2026h${clearSeq}${lines.join('\n')}\n\x1b[?2026l`);
        rendered = lines.length;
    };
    return new Promise(resolve => {
        const stdin = process.stdin;
        const stdout = process.stdout;
        const previousRaw = stdin.isRaw;
        const wasPaused = stdin.isPaused();
        let pending = '';
        let escapeTimer;
        let done = false;
        stdout.write('\x1b[?25l');
        const onResize = () => {
            if (done)
                return;
            draw();
        };
        stdout.on('resize', onResize);
        const finish = (value) => {
            if (done)
                return;
            done = true;
            if (escapeTimer)
                clearTimeout(escapeTimer);
            stdout.off('resize', onResize);
            stdin.removeListener('data', onData);
            stdin.removeListener('end', onEnd);
            stdin.removeListener('error', onEnd);
            if (!stdin.destroyed)
                stdin.setRawMode(Boolean(previousRaw));
            if (wasPaused)
                stdin.pause();
            const safeRendered = Math.min(rendered, Math.max(1, (process.stdout.rows || 24) - 2));
            stdout.write(`\x1b[${safeRendered}A\x1b[J\x1b[?25h`);
            if (value !== undefined) {
                stdout.write(`${theme.muted(clean(title))} ${theme.brightMint(arrowChar)} ${theme.iceWhite(clean(choices[selected].label))}\n`);
            }
            resolve(value);
        };
        const onEnd = () => finish();
        const onData = (chunk) => {
            if (escapeTimer) {
                clearTimeout(escapeTimer);
                escapeTimer = undefined;
            }
            pending += chunk.toString();
            while (pending) {
                if (pending === '\x1b' || pending === '\x1b[') {
                    escapeTimer = setTimeout(() => finish(), 40);
                    return;
                }
                if (pending.startsWith('\x1b[A') || pending.startsWith('\x1b[B')) {
                    selected = (selected + (pending[2] === 'A' ? -1 : 1) + choices.length) % choices.length;
                    pending = pending.slice(3);
                    draw();
                    continue;
                }
                const char = pending[0];
                pending = pending.slice(1);
                if (char === '\x1b' || char === '\x03' || char === '\x04') {
                    finish();
                    return;
                }
                if (char === '\r' || char === '\n') {
                    finish(choices[selected].value);
                    return;
                }
            }
        };
        stdin.setRawMode(true);
        stdin.on('data', onData);
        stdin.once('end', onEnd);
        stdin.once('error', onEnd);
        stdin.resume();
        draw();
    });
}
/** Read a secret without echoing its contents. */
export async function inputSecret(prompt) {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
        return undefined;
    const clean = prompt.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
    return new Promise(resolve => {
        const stdin = process.stdin;
        const previousRaw = stdin.isRaw;
        const wasPaused = stdin.isPaused();
        let value = '';
        let done = false;
        let pending = '';
        let pasting = false;
        let escapeTimer;
        const decoder = new StringDecoder('utf8');
        process.stdout.write(`${clean}: `);
        const finish = (result) => {
            if (done)
                return;
            done = true;
            if (escapeTimer)
                clearTimeout(escapeTimer);
            stdin.removeListener('data', onData);
            stdin.removeListener('end', onEnd);
            stdin.removeListener('error', onEnd);
            if (!stdin.destroyed)
                stdin.setRawMode(Boolean(previousRaw));
            if (wasPaused)
                stdin.pause();
            process.stdout.write('\n');
            resolve(result);
        };
        const onEnd = () => finish();
        const onData = (chunk) => {
            if (escapeTimer) {
                clearTimeout(escapeTimer);
                escapeTimer = undefined;
            }
            pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
            while (pending) {
                const marker = pasting ? '\x1b[201~' : '\x1b[200~';
                if (pending.startsWith('\x1b')) {
                    if (marker.startsWith(pending) && pending.length < marker.length) {
                        escapeTimer = setTimeout(() => { pending = ''; if (!pasting)
                            finish(); }, 100);
                        return;
                    }
                    if (pending.startsWith(marker)) {
                        pending = pending.slice(marker.length);
                        pasting = !pasting;
                        continue;
                    }
                    if (!pasting) {
                        finish();
                        return;
                    }
                    pending = pending.slice(1);
                    continue;
                }
                const code = pending.codePointAt(0);
                const char = String.fromCodePoint(code);
                pending = pending.slice(char.length);
                if (char === '\x03' || char === '\x04') {
                    finish();
                    return;
                }
                if (char === '\r' || char === '\n') {
                    if (!pasting) {
                        finish(value);
                        return;
                    }
                    continue;
                }
                if (char === '\x7f' || char === '\b') {
                    if (!pasting && value.length) {
                        value = Array.from(value).slice(0, -1).join('');
                        process.stdout.write('\b \b');
                    }
                }
                else if (code >= 32 && !(code >= 127 && code <= 159)) {
                    value += char;
                    process.stdout.write('*');
                }
            }
        };
        stdin.setRawMode(true);
        stdin.on('data', onData);
        stdin.once('end', onEnd);
        stdin.once('error', onEnd);
        stdin.resume();
    });
}
//# sourceMappingURL=menu.js.map