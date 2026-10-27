import { createInterface } from 'node:readline';
import { symbols, theme } from './theme.js';
import { animateLogo } from './logo.js';
import { globalTokenTracker } from './token-optimizer.js';
import { globalGroundingLedger } from './grounding.js';
import { getMemoryStats } from './memory-guard.js';
import { getTelegramBotStatus } from './bot.js';
/**
 * Renders the single-line Cyber-Minimalist HUD status bar:
 * ╭─[ ⚡ model │ 🧠 efor │ 💎 Tasarruf: %XX (Y tok) │ 🛡️ Grounding: ✓ │ 💾 RAM: XX MB │ 🤖 Bot/MCP ]
 */
export function renderHudBar(config) {
    const model = config.model || 'model';
    const effort = config.effort || 'normal';
    const report = globalTokenTracker.getReport();
    const savingsPct = report.savingsPercent || 0;
    const savedTokens = report.totalSavedTokens > 0 ? report.totalSavedTokens.toLocaleString() : '0';
    const savingsStr = `💎 Tasarruf: %${savingsPct} (${savedTokens} tok)`;
    const gStatus = globalGroundingLedger.getStatus();
    const groundingStr = gStatus.warnings.length === 0
        ? theme.success('🛡️ Grounding: ✓')
        : theme.amber(`🛡️ Grounding: ! (${gStatus.warnings.length})`);
    const mem = getMemoryStats();
    const ramStr = theme.cyan(`💾 RAM: ${mem.heapUsedMB} MB`);
    const botStatus = getTelegramBotStatus();
    const botPart = botStatus.running
        ? theme.success(`🤖 Bot: ${botStatus.username ? `@${botStatus.username}` : 'Aktif'}`)
        : (config.mcpCount && config.mcpCount > 0
            ? theme.dim(`🤖 MCP: ${config.mcpCount}`)
            : theme.dim('🤖 Bot: Pasif'));
    const sep = theme.dim(' │ ');
    return `${theme.muted('╭─[')} ${theme.cyan(`⚡ ${model}`)}${sep}${theme.amber(`🧠 ${effort}`)}${sep}${theme.brand(savingsStr)}${sep}${groundingStr}${sep}${ramStr}${sep}${botPart} ${theme.muted(']')}`;
}
const BRAILLE_SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
// Do not allow control sequences from a tool or provider to operate the terminal.
const safe = (text) => text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
/**
 * Creates an event printer with animated braille spinner, streaming syntax/diff highlighting,
 * and token/grounding/memory HUD reporting.
 */
export function createEventPrinter(options) {
    const write = options.write ?? ((t) => { process.stdout.write(t); });
    let streaming = false;
    let spinnerTimer;
    let spinnerStartTime = 0;
    let spinnerFrame = 0;
    let lineBuffer = '';
    let inCodeBlock = false;
    const stopSpinner = () => {
        if (spinnerTimer) {
            clearInterval(spinnerTimer);
            spinnerTimer = undefined;
            if (options.interactive) {
                process.stdout.write('\r\x1b[2K');
            }
        }
    };
    const startThinking = (label = 'Düşünüyor…') => {
        if (!options.interactive)
            return;
        stopSpinner();
        spinnerStartTime = Date.now();
        spinnerFrame = 0;
        process.stdout.write(`\r\x1b[2K  ${theme.accent(BRAILLE_SPINNER[0])} ${theme.muted(label)} ${theme.dim('0.0s')}`);
        spinnerTimer = setInterval(() => {
            spinnerFrame = (spinnerFrame + 1) % BRAILLE_SPINNER.length;
            const elapsed = ((Date.now() - spinnerStartTime) / 1000).toFixed(1);
            process.stdout.write(`\r\x1b[2K  ${theme.accent(BRAILLE_SPINNER[spinnerFrame])} ${theme.muted(label)} ${theme.dim(`${elapsed}s`)}`);
        }, 80);
    };
    const highlightLine = (line) => {
        if (/^```/.test(line)) {
            inCodeBlock = !inCodeBlock;
            return theme.cyan(line);
        }
        if (inCodeBlock) {
            if (line.startsWith('+') && !line.startsWith('+++'))
                return theme.success(line);
            if (line.startsWith('-') && !line.startsWith('---'))
                return theme.danger(line);
            if (line.startsWith('@@'))
                return theme.cyan(line);
            if (/^\s*(#|\/\/|\/\*|\*)/.test(line))
                return theme.dim(line);
            return theme.text(line);
        }
        if (line.startsWith('+') && !line.startsWith('+++'))
            return theme.success(line);
        if (line.startsWith('-') && !line.startsWith('---'))
            return theme.danger(line);
        if (line.startsWith('@@'))
            return theme.cyan(line);
        if (/^#{1,4}\s/.test(line))
            return theme.brand(line);
        if (/^>\s/.test(line))
            return theme.dim(line);
        if (/^\s*[-*]\s/.test(line)) {
            const spaceIdx = line.indexOf(' ');
            return `${theme.accent(line.slice(0, spaceIdx + 1))}${theme.text(line.slice(spaceIdx + 1))}`;
        }
        return theme.text(line);
    };
    const finishStream = () => {
        stopSpinner();
        if (streaming) {
            if (lineBuffer.length > 0) {
                write(highlightLine(lineBuffer));
                lineBuffer = '';
            }
            inCodeBlock = false;
            write('\n');
            streaming = false;
            // Bottom info line: ↳ 💎 Token Tasarrufu: %XX | 🛡️ Doğrulandı | 💾 RAM: XX MB
            const report = globalTokenTracker.getReport();
            const gStatus = globalGroundingLedger.getStatus();
            const mem = getMemoryStats();
            const gBadge = gStatus.warnings.length === 0
                ? theme.success('🛡️ Doğrulandı')
                : theme.amber(`🛡️ Uyarı (${gStatus.warnings.length})`);
            const sep = theme.dim(' | ');
            const footer = `  ${theme.dim(symbols.arrow)} ${theme.brand(`💎 Token Tasarrufu: %${report.savingsPercent}`)}${sep}${gBadge}${sep}${theme.cyan(`💾 RAM: ${mem.heapUsedMB} MB`)}\n`;
            write(footer);
            if (options.interactive) {
                write(`  ${renderHudBar(options.getHudConfig())}\n`);
            }
            write('\n');
        }
    };
    const emit = (event) => {
        switch (event.type) {
            case 'text':
                stopSpinner();
                if (!streaming) {
                    write(`\n${theme.accent(symbols.assistant)} ${theme.bold('T Bot')}\n\n`);
                    streaming = true;
                }
                lineBuffer += safe(event.text);
                while (lineBuffer.includes('\n')) {
                    const nlIdx = lineBuffer.indexOf('\n');
                    const line = lineBuffer.slice(0, nlIdx);
                    lineBuffer = lineBuffer.slice(nlIdx + 1);
                    write(`${highlightLine(line)}\n`);
                }
                break;
            case 'tool_start':
                stopSpinner();
                finishStream();
                write(`\n${theme.muted(`${symbols.tool} ${safe(event.call.name)}`)}\n`);
                startThinking(`${safe(event.call.name)} çalıştırılıyor…`);
                break;
            case 'tool_end':
                stopSpinner();
                write(`  ${theme.dim(symbols.arrow)} ${theme.muted(symbols.tool)} ${theme.accent(safe(event.call.name))} ${theme.dim('tamamlandı')}\n`);
                startThinking('Yanıt hazırlanıyor…');
                break;
            case 'status':
                stopSpinner();
                finishStream();
                write(`${theme.muted(safe(event.message))}\n`);
                break;
            case 'error':
                stopSpinner();
                finishStream();
                write(`${theme.error(`Hata: ${safe(event.error)}`)}\n`);
                break;
            case 'usage':
                if (event.inputTokens !== undefined || event.outputTokens !== undefined) {
                    globalTokenTracker.recordTurn({
                        rawTokens: (event.inputTokens ?? 0) + (event.outputTokens ?? 0) + (event.savedTokens ?? 0),
                        sentInputTokens: event.inputTokens ?? 0,
                        outputTokens: event.outputTokens ?? 0,
                        cachedTokens: event.cachedTokens ?? 0,
                        prunedSchemaTokens: event.savedTokens ?? 0,
                    });
                }
                break;
        }
    };
    return { emit, finishStream, startThinking, stopSpinner };
}
/** Print comprehensive help menu with modern cyber-minimalist categories. */
export function printHelp() {
    const rule = symbols.rule.repeat(64);
    const title = `${theme.brand('T BOT')} ${theme.muted('─ Siber-Minimalist Terminal Komutları')}`;
    const categories = [
        {
            name: 'Oturum & Çekirdek',
            cmds: [
                ['/help', 'Yardım menüsünü görüntüler'],
                ['/clear', 'Sohbet geçmişini ve terminal ekranını temizler'],
                ['/status', 'Canlı Siber HUD durum çubuğunu görüntüler'],
                ['/exit, /quit', 'T Bot uygulamasından güvenle ayrılır'],
            ],
        },
        {
            name: 'Model & Düşünme',
            cmds: [
                ['/provider, /model', 'LLM sağlayıcı ve model seçimi'],
                ['/config, /auth', 'Yapılandırma ayarları ve API anahtarı yönetimi'],
                ['/effort [düzey]', 'Düşünme eforu (low, medium, high, xhigh, max)'],
                ['/ultracode [on|off]', 'Yüksek doğruluklu özerk kodlama modu'],
                ['/yolo [on|off]', 'Araç çalıştırma otomatik onay modu'],
            ],
        },
        {
            name: 'Sistem, Bellek & Optimizasyon',
            cmds: [
                ['/tokens', 'Token tasarrufu, önbellek ve kullanım raporu'],
                ['/memory', 'RAM kullanımı ve bellek koruma istatistikleri'],
                ['/remember <k> = <v>', 'Kalıcı proje/küresel belleğe bilgi kaydeder'],
                ['/gc', 'Bellek çöp toplayıcısını (GC) tetikler ve RAM temizler'],
                ['/bot', 'Telegram botu canlı durum ve bağlantı kontrolü'],
            ],
        },
        {
            name: 'Ajan & İş Akışları',
            cmds: [
                ['/goal [hedef]', 'Oturum hedefini belirler veya hedefleri görüntüler'],
                ['/plan [apply]', 'Görevi adım adım planlar veya planı yürütür'],
                ['/subagents', 'Paralel araştırma ve alt ajan yönetim menüsü'],
                ['/mcp', 'Model Context Protocol (MCP) sunucu bağlantıları'],
                ['/skills', 'Mevcut yerleşik yetenek ve uzmanlıkları listeler'],
                ['/sessions, /resume', 'Geçmiş oturumları listeler ve devam ettirir'],
            ],
        },
    ];
    let out = `\n${title}\n${theme.dim(rule)}\n`;
    for (const cat of categories) {
        out += `\n  ${theme.accent(cat.name)}\n`;
        for (const [cmd, desc] of cat.cmds) {
            out += `    ${theme.cyan(cmd.padEnd(24))} ${theme.text(desc)}\n`;
        }
    }
    out += `\n${theme.dim('  Not: Çok satırlı girdiler için satır sonuna \\ koyarak devam edebilirsiniz.')}\n${theme.dim(rule)}\n\n`;
    process.stdout.write(out);
}
export async function startTui(options) {
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    let rl = createInterface({ input: process.stdin, output: process.stdout, terminal: interactive });
    const lines = [];
    let waiting;
    let closed = false;
    let controller;
    let exiting = false;
    let yolo = options.yolo ?? false;
    const setYolo = (enabled) => { yolo = enabled; };
    const getHudContext = () => {
        let effortLabel = 'normal';
        if (options.modeStatus) {
            const raw = options.modeStatus();
            const match = raw.match(/Effort:\s*([^\s·]+)/i);
            if (match)
                effortLabel = match[1];
            if (/ultracode/i.test(raw))
                effortLabel += '+Ultra';
        }
        return {
            model: options.model,
            provider: options.provider,
            effort: effortLabel,
            yolo,
            workspace: options.workspace,
        };
    };
    const write = (text) => { process.stdout.write(text); };
    const eventPrinter = createEventPrinter({ interactive, getHudConfig: getHudContext, write });
    const attach = () => {
        rl.on('line', line => {
            if (waiting) {
                const resolve = waiting;
                waiting = undefined;
                resolve(line);
            }
            else
                lines.push(line);
        });
        rl.on('close', () => { closed = true; if (waiting) {
            const resolve = waiting;
            waiting = undefined;
            resolve(undefined);
        } });
        rl.on('SIGINT', () => {
            if (controller) {
                controller.abort();
                if (waiting) {
                    const resolve = waiting;
                    waiting = undefined;
                    resolve(undefined);
                }
                eventPrinter.finishStream();
                write(`\n${theme.muted('İptal ediliyor…')}\n`);
            }
            else {
                exiting = true;
                rl.close();
            }
        });
    };
    attach();
    const read = async (prompt) => {
        if (interactive)
            write(prompt);
        if (lines.length)
            return lines.shift();
        if (closed)
            return undefined;
        return new Promise(resolve => { waiting = resolve; });
    };
    const approve = async (request) => {
        eventPrinter.stopSpinner();
        eventPrinter.finishStream();
        write(`\n${theme.warning('Onay gerekli:')} ${theme.bold(safe(request.tool))}\n${safe(request.description)}\n`);
        write(`${theme.muted(safe(JSON.stringify(request.arguments, null, 2)))}\n`);
        if (!interactive || controller?.signal.aborted) {
            write(`${theme.muted('Reddedildi (etkileşimli onay gerekli).')}\n`);
            return false;
        }
        const answer = await read(`${theme.warning('İzin verilsin mi?')} [y/N] `);
        return !controller?.signal.aborted && /^(y|yes|e|evet)$/i.test((answer ?? '').trim());
    };
    const suspendUi = async (action) => {
        eventPrinter.stopSpinner();
        if (!interactive)
            return action();
        rl.close();
        try {
            return await action();
        }
        finally {
            closed = false;
            rl = createInterface({ input: process.stdin, output: process.stdout, terminal: interactive });
            attach();
        }
    };
    if (interactive) {
        const width = Math.max(20, Math.min(process.stdout.columns || 70, 70));
        await animateLogo(width, () => exiting);
        write(`${theme.muted(`  ${safe(options.provider.label)} / ${safe(options.model)}  ${symbols.bullet}  ${safe(options.workspace)}`)}\n`);
        write(`  ${yolo ? theme.warning('YOLO · otomatik onay') : theme.muted('Onaylı')}\n`);
        if (options.modeStatus)
            write(`  ${theme.muted(safe(options.modeStatus()))}\n`);
        write(`\n  ${renderHudBar(getHudContext())}\n`);
        write(`${theme.dim(`  ${symbols.rule.repeat(Math.max(20, width - 4))}`)}\n`);
        write(`${theme.muted('  /help komutlar için  ·  Ctrl+C iptal etmek için')}\n\n`);
    }
    try {
        while (!exiting) {
            const status = options.modeStatus ? ` ${theme.muted(safe(options.modeStatus()))}` : '';
            const promptStr = interactive
                ? `${yolo ? theme.warning('YOLO · otomatik onay') : theme.muted('Onaylı')}${status} ${theme.accent(symbols.prompt)} `
                : '';
            const first = await read(promptStr);
            if (first === undefined)
                break;
            let input = first;
            // Trailing backslash joins the next line for multi-line prompts
            while (input.endsWith('\\')) {
                input = input.slice(0, -1);
                const next = await read(interactive ? `${theme.muted('...')} ` : '');
                if (next === undefined)
                    break;
                input += `\n${next}`;
            }
            input = input.trim();
            if (!input)
                continue;
            if (input.startsWith('/')) {
                const parts = input.split(/\s+/);
                const command = parts[0]?.toLowerCase();
                if (command === '/exit' || command === '/quit')
                    break;
                if (command === '/help') {
                    printHelp();
                    continue;
                }
                if (command === '/status') {
                    write(`\n  ${renderHudBar(getHudContext())}\n\n`);
                    continue;
                }
                if (command === '/tokens') {
                    const report = globalTokenTracker.getReport();
                    write(`\n  ${theme.bold('💎 Canlı Token Tasarrufu & Oturum Raporu')}\n`);
                    write(`  ${theme.dim('─'.repeat(48))}\n`);
                    write(`  Toplam Ham Token     : ${theme.cyan(report.totalRawTokens.toLocaleString())}\n`);
                    write(`  Gönderilen Girdi     : ${theme.text(report.totalSentInputTokens.toLocaleString())}\n`);
                    write(`  Üretilen Çıktı       : ${theme.text(report.totalOutputTokens.toLocaleString())}\n`);
                    write(`  Önbellek (Cache)     : ${theme.accent(report.totalCachedTokens.toLocaleString())}\n`);
                    write(`  Budanan Şemalar      : ${theme.accent(report.totalPrunedSchemaTokens.toLocaleString())}\n`);
                    write(`  Sıkıştırılmış Geçmiş : ${theme.accent(report.totalCompressedHistoryTokens.toLocaleString())}\n`);
                    write(`  Toplam Tasarruf      : ${theme.brand(report.totalSavedTokens.toLocaleString())} tok\n`);
                    write(`  Tasarruf Oranı       : ${theme.brand(`%${report.savingsPercent}`)}\n`);
                    write(`  Oturum Turu          : ${theme.dim(String(report.turnsCount))}\n\n`);
                    continue;
                }
                if (command === '/memory') {
                    const mem = getMemoryStats();
                    write(`\n  ${theme.bold('💾 Bellek & RAM Koruma Durumu')}\n`);
                    write(`  ${theme.dim('─'.repeat(48))}\n`);
                    const ratioStr = mem.heapTotalMB > 0 ? ` (%${((mem.heapUsedMB / mem.heapTotalMB) * 100).toFixed(1)})` : '';
                    write(`  Heap Kullanımı : ${theme.cyan(`${mem.heapUsedMB} MB`)} / ${theme.dim(`${mem.heapTotalMB} MB`)}${ratioStr}\n`);
                    write(`  RSS (Fiziksel) : ${theme.muted(`${mem.rssMB} MB`)}\n`);
                    const statusColor = mem.pressure === 'low' ? theme.success : mem.pressure === 'moderate' ? theme.accent : theme.danger;
                    write(`  Baskı Düzeyi   : ${statusColor(mem.pressure.toUpperCase())}\n\n`);
                    continue;
                }
                if (command === '/gc') {
                    const before = getMemoryStats();
                    if (typeof global.gc === 'function') {
                        global.gc();
                    }
                    const after = getMemoryStats();
                    const freed = Math.max(0, before.heapUsedMB - after.heapUsedMB).toFixed(1);
                    write(`\n  ${theme.success('✓')} ${theme.brand('Bellek temizlendi (Garbage Collection)')}\n`);
                    write(`  Kazanılan RAM: ${theme.cyan(`${freed} MB`)} (Şu an: ${after.heapUsedMB} MB)\n\n`);
                    continue;
                }
                if (command === '/bot') {
                    const bStatus = getTelegramBotStatus();
                    write(`\n  ${theme.bold('🤖 Telegram Bot Canlı Durumu')}\n`);
                    write(`  ${theme.dim('─'.repeat(48))}\n`);
                    write(`  Durum         : ${bStatus.running ? theme.success('EVET (Aktif)') : theme.muted('HAYIR (Pasif)')}\n`);
                    if (bStatus.username)
                        write(`  Kullanıcı Adı : ${theme.cyan(`@${bStatus.username}`)}\n`);
                    if (bStatus.allowedChats && bStatus.allowedChats.length > 0) {
                        write(`  İzinli Sohbet : ${theme.text(bStatus.allowedChats.join(', '))}\n`);
                    }
                    if (bStatus.handledCount !== undefined) {
                        write(`  İşlenen Mesaj : ${theme.text(String(bStatus.handledCount))}\n`);
                    }
                    write('\n');
                    continue;
                }
                if (command === '/remember') {
                    const remMatch = input.match(/^\/remember\s+([^=]+)=\s*(.+)$/i);
                    if (remMatch) {
                        const key = remMatch[1].trim();
                        const val = remMatch[2].trim();
                        try {
                            const { rememberFact } = await import('./memory.js');
                            await rememberFact(options.workspace, key, val);
                            write(`\n  ${theme.success('✓')} ${theme.brand('Kalıcı Belleğe Kaydedildi:')} ${theme.cyan(key)} = ${theme.text(val)}\n\n`);
                        }
                        catch (err) {
                            write(`\n  ${theme.error(`Kayıt hatası: ${err instanceof Error ? err.message : String(err)}`)}\n\n`);
                        }
                        continue;
                    }
                    write(`\n  ${theme.muted('Kullanım:')} ${theme.cyan('/remember <anahtar> = <değer>')}\n\n`);
                    continue;
                }
                if (command === '/clear') {
                    await options.onCommand?.(input, setYolo);
                    if (interactive)
                        process.stdout.write('\x1b[2J\x1b[H');
                    write(`${theme.muted('Sohbet geçmişi ve ekran temizlendi.')}\n`);
                    continue;
                }
                if (['/goal', '/plan', '/subagents', '/mcp', '/frontenddesign', '/backend', '/codereview', '/debuganalysis', '/imagegen'].includes(command ?? '') && options.onWorkflow) {
                    controller = new AbortController();
                    eventPrinter.startThinking('İş akışı yürütülüyor…');
                    try {
                        await options.onWorkflow(command, input.slice(command.length).trim(), eventPrinter.emit, approve, controller.signal, suspendUi);
                    }
                    catch (error) {
                        eventPrinter.finishStream();
                        write(`${theme.error(controller.signal.aborted ? 'İptal edildi.' : `Hata: ${safe(error instanceof Error ? error.message : String(error))}`)}\n`);
                    }
                    finally {
                        controller = undefined;
                        eventPrinter.finishStream();
                    }
                    if (interactive)
                        write('\n');
                    continue;
                }
                let result;
                const isMenuCommand = interactive && (command === '/provider' ||
                    command === '/model' ||
                    command === '/config' ||
                    command === '/auth' ||
                    command === '/effort' ||
                    input.toLowerCase() === '/yolo' ||
                    input.toLowerCase() === '/ultracode');
                try {
                    result = isMenuCommand
                        ? await suspendUi(async () => options.onCommand?.(input, setYolo))
                        : await options.onCommand?.(input, setYolo);
                }
                catch (error) {
                    result = `Hata: ${error instanceof Error ? error.message : String(error)}`;
                }
                write(`${safe(result ?? 'Bilinmeyen komut. Komutlar için /help yazın.')}\n`);
                continue;
            }
            controller = new AbortController();
            eventPrinter.startThinking('Düşünüyor…');
            try {
                await options.onSubmit(input, eventPrinter.emit, approve, controller.signal);
            }
            catch (error) {
                eventPrinter.finishStream();
                write(`${theme.error(controller.signal.aborted ? 'İptal edildi.' : `Hata: ${safe(error instanceof Error ? error.message : String(error))}`)}\n`);
            }
            finally {
                controller = undefined;
                eventPrinter.finishStream();
            }
            if (interactive)
                write('\n');
        }
    }
    finally {
        eventPrinter.stopSpinner();
        rl.close();
    }
}
//# sourceMappingURL=tui.js.map