import { theme, symbols } from './theme.js';
import { StringDecoder } from 'node:string_decoder';
/** Select a fixed choice with arrow keys. Returns undefined when cancelled or not a TTY. */
export async function selectOption(title, choices) {
    if (!process.stdin.isTTY || !process.stdout.isTTY || choices.length === 0)
        return undefined;
    let selected = 0;
    let rendered = 0;
    const clean = (value) => value.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
    const draw = () => {
        if (rendered)
            process.stdout.write(`\x1b[${rendered}A\x1b[J`);
        const height = Math.max(1, Math.min(choices.length, Math.max(3, (process.stdout.rows || 24) - 6), 12));
        const start = Math.max(0, Math.min(selected - Math.floor(height / 2), choices.length - height));
        const rows = choices.slice(start, start + height).map((choice, offset) => {
            const active = start + offset === selected;
            const text = `${active ? symbols.prompt : ' '} ${clean(choice.label)}${choice.description ? `  ${clean(choice.description)}` : ''}`;
            return active ? theme.accent(text) : theme.muted(text);
        });
        const footer = choices.length > height ? `  ${selected + 1}/${choices.length} · ` : '  ';
        process.stdout.write(`${theme.bold(clean(title))}\n${rows.join('\n')}\n${theme.muted(`${footer}↑/↓ select · Enter confirm · Esc cancel`)}\n`);
        rendered = rows.length + 2;
    };
    return new Promise(resolve => {
        const stdin = process.stdin;
        const previousRaw = stdin.isRaw;
        const wasPaused = stdin.isPaused();
        let pending = '';
        let escapeTimer;
        let done = false;
        const finish = (value) => {
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
            process.stdout.write(`\x1b[${rendered}A\x1b[J`);
            if (value !== undefined)
                process.stdout.write(`${theme.muted(clean(title))} ${theme.accent(clean(choices[selected].label))}\n`);
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