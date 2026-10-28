import { createInterface } from 'node:readline';
import { formatDuration, renderCyberWave, renderProgressBar, symbols, theme, toTurkishTitleCase, truncateAnsi, unicode, } from './theme.js';
import { animateLogo, logo } from './logo.js';
import { globalTokenTracker } from './token-optimizer.js';
import { globalGroundingLedger } from './grounding.js';
import { getMemoryStats } from './memory-guard.js';
import { getTelegramBotStatus } from './bot.js';
import { registerGuiKillSwitch } from './tools/index.js';
export { logo };
function renderMiniSavingsBar(percent, cells = 5) {
    const safeCells = Math.max(1, cells);
    const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
    const filled = Math.round((clamped / 100) * safeCells);
    const empty = Math.max(0, safeCells - filled);
    return `${theme.brightMint('▰'.repeat(filled))}${theme.dim('▱'.repeat(empty))}`;
}
/**
 * Tekilleştirilmiş Zarif Cyber-Zen HUD Çubuğu:
 * ╭─[ Model: ... │ Efor: ... │ Tasarruf: %XX ▰▱ (Y Tok) │ Doğrulama: Doğrulandı │ Bellek: XX MB ● (Sistem: %YY) │ Bot: Aktif / Pasif ]─╮
 */
export function renderHudBar(config) {
    const model = config.model || 'Model';
    const effort = config.effort || 'Normal';
    const report = globalTokenTracker.getReport();
    const savingsPct = report.savingsPercent || 0;
    const savedTokens = report.totalSavedTokens > 0 ? report.totalSavedTokens.toLocaleString() : '0';
    const miniBar = renderMiniSavingsBar(savingsPct, 5);
    const savingsStr = `${theme.brightMint(`Tasarruf: %${savingsPct}`)} ${miniBar} ${theme.dim(`(${savedTokens} Tok)`)}`;
    const gStatus = globalGroundingLedger.getStatus();
    const groundingStr = gStatus.warnings.length === 0
        ? theme.success('Doğrulama: Doğrulandı')
        : theme.amber(`Doğrulama: Uyarı (${gStatus.warnings.length})`);
    const mem = getMemoryStats();
    const ramStatusDot = mem.pressure === 'high' ? theme.danger('▲') : (mem.pressure === 'moderate' ? theme.amber('■') : theme.success('●'));
    const ramStr = `${theme.crystalCyan(`Bellek: ${mem.heapUsedMB} MB`)} ${ramStatusDot} ${theme.dim(`(Sistem: %${mem.systemUsedPercent})`)}`;
    const botStatus = getTelegramBotStatus();
    const botPart = botStatus.running
        ? theme.success(`Bot: ${botStatus.username ? `@${botStatus.username}` : 'Aktif'}`)
        : (config.mcpCount && config.mcpCount > 0
            ? theme.softLavender(`MCP: ${config.mcpCount}`)
            : theme.dim('Bot: Pasif'));
    const sep = theme.dim(symbols.hudSep);
    const left = theme.muted(unicode ? '╭─[' : '[[');
    const right = theme.muted(unicode ? ']─╮' : ']]');
    return `${left} ${theme.cyan(`Model: ${model}`)}${sep}${theme.amber(`Efor: ${effort}`)}${sep}${savingsStr}${sep}${groundingStr}${sep}${ramStr}${sep}${botPart} ${right}`;
}
export const TOOL_TITLE_MAP = {
    // T Bot Yerel Araçları (T Bot Native Tools)
    file_read: 'Dosya Okuma',
    file_write: 'Dosya Yazma',
    file_patch: 'Dosya Yamalama',
    file_list: 'Dosya Listeleme',
    file_search: 'Dosya Arama',
    file_glob: 'Dosya Bulma',
    file_outline: 'Dosya Özeti',
    shell: 'Komut Satırı',
    process_list: 'İşlem Listesi',
    process_output: 'İşlem Çıktısı',
    process_stop: 'İşlem Durdurma',
    process_write: 'Süreç Girdisi Gönderme',
    git_status: 'Git Durumu',
    git_diff: 'Git Farkı',
    git_log: 'Git Günlüğü',
    git_add: 'Git Ekleme',
    git_commit: 'Git İşleme',
    git_push: 'Git Gönderme',
    git_branch: 'Git Dalı',
    web_search: 'Web Araması',
    url_fetch: 'Web Sayfası Okuma',
    browser_navigate: 'Tarayıcı Gezinme',
    browser_click: 'Tarayıcı Tıklama',
    browser_type: 'Tarayıcı Yazma',
    browser_fill: 'Form Doldurma',
    browser_press: 'Tarayıcı Tuş Basımı',
    browser_scroll: 'Tarayıcı Kaydırma',
    browser_hover: 'Tarayıcı Üzerine Gelme',
    browser_evaluate: 'Tarayıcı Betik Çalıştırma',
    browser_inspect: 'Sayfa İnceleme',
    browser_tabs: 'Tarayıcı Sekme Yönetimi',
    browser_screenshot: 'Tarayıcı Ekran Görüntüsü',
    computer: 'Bilgisayar Kontrolü',
    image_generate: 'Görsel Üretimi',
    memory_save: 'Bellek Kaydetme',
    memory_recall: 'Bellek Hatırlama',
    memory_forget: 'Hafıza Silme',
    todo_manage: 'Görev Pusulası',
    goal_manage: 'Hedef Yönetimi',
    skill_create: 'Yetenek Oluşturma',
    skill_list: 'Yetenek Listesi',
    delegate_task: 'Alt Ajan Görevlendirme',
    mcp_catalog: 'MCP Kataloğu',
    mcp_call: 'MCP Çağrısı',
};
export function formatToolTitle(toolName) {
    if (TOOL_TITLE_MAP[toolName]) {
        return `${TOOL_TITLE_MAP[toolName]} (${toolName})`;
    }
    const clean = toolName.replace(/[_-]+/g, ' ');
    return `${toTurkishTitleCase(clean)} (${toolName})`;
}
function extractToolTarget(args) {
    if (!args)
        return '';
    let obj = {};
    if (typeof args === 'string') {
        try {
            obj = JSON.parse(args);
        }
        catch {
            const clean = args.trim().replace(/\r?\n.*/s, '');
            return clean.length > 60 ? `${clean.slice(0, 57)}...` : clean;
        }
    }
    else if (typeof args === 'object' && args !== null) {
        obj = args;
    }
    const priorityKeys = [
        'path', 'filePath', 'file', 'filename', 'pattern',
        'query', 'q', 'search',
        'url', 'selector',
        'command', 'cmd',
        'action', 'role', 'task', 'goal', 'objective', 'todo',
        'key', 'name', 'prompt', 'input', 'code', 'script',
        'tabId', 'target',
    ];
    for (const key of priorityKeys) {
        const val = obj[key];
        if (typeof val === 'string' && val.trim().length > 0) {
            const cleanVal = val.trim().replace(/\r?\n.*/s, '');
            return cleanVal.length > 60 ? `${cleanVal.slice(0, 57)}...` : cleanVal;
        }
    }
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string' && v.trim().length > 0) {
            const cleanVal = `${k}: ${v.trim().replace(/\r?\n.*/s, '')}`;
            return cleanVal.length > 60 ? `${cleanVal.slice(0, 57)}...` : cleanVal;
        }
    }
    return '';
}
function extractResultSummary(result, toolName) {
    if (result === undefined || result === null) {
        return { isError: false, summary: '' };
    }
    const str = typeof result === 'string' ? result : JSON.stringify(result);
    const trimmed = str.trim();
    const isReadTool = toolName === 'file_read' ||
        toolName === 'file_outline' ||
        toolName === 'file_search' ||
        toolName === 'file_glob' ||
        toolName === 'file_list';
    let isError = false;
    if (isReadTool) {
        isError = /^(tool error:|araç hatası:|\[halüsinasyon engeli|\[ikili dosya engeli|\[acil durdurma)/i.test(trimmed);
    }
    else {
        const isExplicitToolError = /^(tool error:|araç hatası:|\[halüsinasyon engeli|\[ikili dosya engeli|\[acil durdurma)/i.test(trimmed);
        const isJsonError = trimmed.startsWith('{') && /"ok"\s*:\s*false/i.test(trimmed) && !/"warning"\s*:/i.test(trimmed);
        isError = isExplicitToolError || isJsonError;
    }
    if (isError) {
        const firstLine = trimmed.split('\n')[0] || trimmed;
        const shortErr = firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
        return { isError: true, summary: shortErr };
    }
    // file_patch veya file_write başarılı tamamlandığında (+X/-Y lines) veya satır bilgisi varsa yeşil rozetle vurgula
    if (toolName === 'file_patch' || toolName === 'file_write') {
        const diffMatch = trimmed.match(/\(\+(\d+)\s*\/\s*-(\d+)\s*(?:lines?|satır)?\)/i) ||
            trimmed.match(/\+(\d+)\s*\/\s*-(\d+)\s*(?:lines?|satır)?/i);
        if (diffMatch) {
            const plus = diffMatch[1];
            const minus = diffMatch[2];
            const astBadge = theme.success(`+${plus} / -${minus} satır · AST Doğrulandı ${symbols.check}`);
            const cleanLine = (trimmed.split('\n')[0] || '').replace(/\s*\(\+\d+\s*\/\s*-\d+[^)]*\)/i, '').trim();
            return {
                isError: false,
                summary: cleanLine.length > 50 ? `${cleanLine.slice(0, 47)}...` : cleanLine,
                astBadge,
            };
        }
        const lineCountMatch = trimmed.match(/\((\d+)\s*(?:lines?|satır)\)/i) ||
            trimmed.match(/(\d+)\s*(?:lines?|satır)\b/i);
        if (lineCountMatch) {
            const lineCount = lineCountMatch[1];
            const astBadge = theme.success(`+${lineCount} / -0 satır · AST Doğrulandı ${symbols.check}`);
            const cleanLine = (trimmed.split('\n')[0] || '').trim();
            return {
                isError: false,
                summary: cleanLine.length > 50 ? `${cleanLine.slice(0, 47)}...` : cleanLine,
                astBadge,
            };
        }
        const firstLine = (trimmed.split('\n')[0] || '').trim();
        return {
            isError: false,
            summary: firstLine.length > 50 ? `${firstLine.slice(0, 47)}...` : firstLine,
            astBadge: theme.success(`AST Doğrulandı ${symbols.check}`),
        };
    }
    const lines = trimmed.split('\n').filter(l => l.trim().length > 0);
    let summary = '';
    if (lines.length > 1) {
        summary = `${lines.length} Satır · ${trimmed.length} Karakter`;
    }
    else if (lines.length === 1) {
        const line = lines[0];
        summary = line.length > 60 ? `${line.slice(0, 57)}...` : line;
    }
    return { isError: false, summary };
}
/**
 * 4-aşamalı görsel Ultracode Hattı Stepper satırı üretir:
 * ╭─ ◆ ULTRACODE  ✓ 1. Araştırma ──▶ ◉ 2. Denetim ──▶ ○ 3. Öz-Onarım ──▶ ○ 4. Özet
 */
function renderUltracodeStepper(activeStage) {
    const stages = ['1. Araştırma', '2. Denetim', '3. Öz-Onarım', '4. Özet'];
    const renderedStages = stages.map((label, idx) => {
        const stepNum = idx + 1;
        if (stepNum < activeStage) {
            return theme.success(`${symbols.check} ${label}`);
        }
        if (stepNum === activeStage) {
            return theme.brightMint(`◉ ${label}`);
        }
        return theme.dim(`○ ${label}`);
    });
    const arrow = ` ${theme.dim('──▶')} `;
    return `  ${theme.muted('╭─')} ${theme.brightMint('◆ ULTRACODE')}  ${renderedStages.join(arrow)}`;
}
/**
 * Kod blokları dışında satır içi **kalın** -> theme.bold ve `kod` -> theme.cyan vurgulaması uygular.
 */
function formatInlineMarkdown(text) {
    const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*)/g;
    const parts = text.split(tokenRegex);
    return parts
        .map((part) => {
        if (!part)
            return '';
        if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
            return theme.cyan(part);
        }
        if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
            return theme.bold(part.slice(2, -2));
        }
        return theme.text(part);
    })
        .join('');
}
const BRAILLE_SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const WAVE_BARS = ['━━━───', '─━━━──', '──━━━─', '───━━━', '────━━', '━────━'];
// Do not allow control sequences from a tool or provider to operate the terminal.
const safe = (text) => text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
/**
 * Sıfır-Kırpışmalı (DEC ?2026h/?2026l), Sıfır-Taşmalı (truncateAnsi),
 * Görsel Görev Ağacı ve Ultracode Stepper destekli Cyber-Zen EventPrinter.
 */
export function createEventPrinter(options) {
    const write = options.write ?? ((t) => { process.stdout.write(t); });
    let streaming = false;
    let spinnerTimer;
    let thinkingStartedAt = 0;
    let spinnerFrame = 0;
    let waveFrame = 0;
    let currentSpinnerLabel = '';
    let lineBuffer = '';
    let inCodeBlock = false;
    let cursorHidden = false;
    let toolStartTime = 0;
    let stepCount = 0;
    const renderSpinnerLine = () => {
        const elapsed = formatDuration(Date.now() - thinkingStartedAt);
        const stepPrefix = stepCount > 0 ? `${theme.softLavender(`[Adım ${stepCount}]`)} ` : '';
        const wave = renderCyberWave(spinnerFrame, 8);
        const mem = getMemoryStats();
        const tokenReport = globalTokenTracker.getReport();
        const telemetry = `${theme.crystalCyan(`▣ ${mem.heapUsedMB}MB`)} ${theme.brightMint(`%${tokenReport.savingsPercent ?? 0}`)}`;
        const stopHint = theme.amber('[ESC / F12 / ⏹ Durdur]');
        const rawLine = `  ${theme.brightMint(BRAILLE_SPINNER[spinnerFrame])} ${wave} ${stepPrefix}${theme.text(currentSpinnerLabel)} ${theme.dim(`· ${elapsed}`)} ${theme.dim('·')} ${telemetry} ${theme.dim('·')} ${stopHint}`;
        const maxCols = Math.max(40, (process.stdout.columns || 100) - 2);
        return truncateAnsi(rawLine, maxCols);
    };
    const stopThinking = () => {
        if (spinnerTimer) {
            clearInterval(spinnerTimer);
            spinnerTimer = undefined;
        }
        if (options.interactive) {
            cursorHidden = false;
            process.stdout.write('\x1b[?2026h\r\x1b[2K\x1b[?2026l\x1b[?25h');
        }
    };
    const stopSpinner = stopThinking;
    const isThinking = () => spinnerTimer !== undefined;
    const updateSpinnerLabel = (label) => {
        currentSpinnerLabel = label.replace(/\r?\n/g, ' ').trim();
        if (options.interactive && spinnerTimer) {
            const line = renderSpinnerLine();
            process.stdout.write(`\x1b[?2026h\r\x1b[2K${line}\x1b[?2026l`);
        }
    };
    const printPermanentLine = (text) => {
        if (options.interactive && spinnerTimer) {
            const currentSpinner = renderSpinnerLine();
            process.stdout.write(`\x1b[?2026h\r\x1b[2K${text}\n${currentSpinner}\x1b[?2026l`);
        }
        else {
            write(`${text}\n`);
        }
    };
    const startThinking = (label = 'Düşünülüyor…') => {
        currentSpinnerLabel = label.replace(/\r?\n/g, ' ').trim();
        if (!options.interactive)
            return;
        if (spinnerTimer) {
            // Eğer spinner zaten çalışıyorsa zıplatmadan yerinde güncelle
            updateSpinnerLabel(label);
            return;
        }
        thinkingStartedAt = Date.now();
        spinnerFrame = 0;
        waveFrame = 0;
        cursorHidden = true;
        const firstLine = renderSpinnerLine();
        process.stdout.write(`\x1b[?25l\x1b[?2026h\r\x1b[2K${firstLine}\x1b[?2026l`);
        spinnerTimer = setInterval(() => {
            spinnerFrame = (spinnerFrame + 1) % BRAILLE_SPINNER.length;
            waveFrame = (waveFrame + 1) % WAVE_BARS.length;
            const line = renderSpinnerLine();
            process.stdout.write(`\x1b[?2026h\r\x1b[2K${line}\x1b[?2026l`);
        }, 90);
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
            return `${theme.accent(line.slice(0, spaceIdx + 1))}${formatInlineMarkdown(line.slice(spaceIdx + 1))}`;
        }
        return formatInlineMarkdown(line);
    };
    const finishStream = () => {
        stopThinking();
        if (streaming) {
            if (lineBuffer.length > 0) {
                write(highlightLine(lineBuffer));
                lineBuffer = '';
            }
            inCodeBlock = false;
            write('\n\n');
            streaming = false;
            // Tekilleştirilmiş zarif Cyber-HUD çubuğu (mükerrer footer kaldırıldı)
            write(`  ${renderHudBar(options.getHudConfig())}\n\n`);
        }
    };
    const emit = (event) => {
        switch (event.type) {
            case 'text':
                stopThinking();
                if (!streaming) {
                    write(`\n${theme.brightMint(symbols.prompt)} ${theme.iceWhite('T Bot')}\n\n`);
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
            case 'tool_start': {
                stopThinking();
                finishStream();
                stepCount++;
                toolStartTime = Date.now();
                const toolTitle = formatToolTitle(event.call.name);
                const targetInfo = extractToolTarget(event.call.arguments);
                const targetSuffix = targetInfo ? ` ${theme.dim('›')} ${theme.crystalCyan(targetInfo)}` : '';
                write(`\n  ${theme.muted('╭─')} ${theme.brightMint('◈')} ${theme.bold('Araç Çalıştırılıyor')} ${theme.dim('·')} ${theme.text(toolTitle)}${targetSuffix}\n`);
                startThinking(`${toolTitle} Çalıştırılıyor`);
                break;
            }
            case 'tool_end': {
                stopThinking();
                const elapsed = formatDuration(Date.now() - toolStartTime);
                const toolTitle = formatToolTitle(event.call.name);
                const { isError, summary, astBadge } = extractResultSummary(event.result, event.call.name);
                if (isError) {
                    write(`  ${theme.muted('╰─')} ${theme.danger(symbols.cross)} ${theme.danger(`${toolTitle} Başarısız Oldu`)} ${theme.dim(`(${elapsed})`)} ${theme.dim('·')} ${theme.error(summary)}\n`);
                }
                else {
                    const badgePart = astBadge ? ` ${theme.dim('·')} ${astBadge}` : '';
                    const summaryStr = summary ? ` ${theme.dim('·')} ${theme.muted(summary)}` : '';
                    write(`  ${theme.muted('╰─')} ${theme.success(symbols.check)} ${theme.text(`${toolTitle} Tamamlandı`)} ${theme.dim(`(${elapsed})`)}${badgePart}${summaryStr}\n`);
                }
                startThinking('Yanıt Hazırlanıyor…');
                break;
            }
            case 'status': {
                const msg = safe(event.message);
                // 1. Ultracode [Aşama X/4] -> 4-Aşamalı Görsel Stepper
                const ultraMatch = msg.match(/Ultracode\s*\[Aşama\s*(\d+)\s*\/\s*4\](?:\s*:?\s*(.*))?/i);
                if (ultraMatch) {
                    const stageNum = Math.max(1, Math.min(4, parseInt(ultraMatch[1], 10)));
                    const detail = ultraMatch[2]?.trim();
                    let line = renderUltracodeStepper(stageNum);
                    if (detail) {
                        line += `\n  ${theme.muted('╰─')} ${theme.crystalCyan('▸')} ${theme.text(detail)}`;
                    }
                    printPermanentLine(line);
                    updateSpinnerLabel(msg);
                    break;
                }
                // 2. Otonom Hedef [Adım X/Y] -> Görsel İlerleme Çubuğu
                const goalMatch = msg.match(/Otonom Hedef\s*\[Adım\s*(\d+)\s*\/\s*(\d+)\](?:\s*:?\s*(.*))?/i);
                if (goalMatch) {
                    const stepX = parseInt(goalMatch[1], 10);
                    const totalY = Math.max(1, parseInt(goalMatch[2], 10));
                    const pct = Math.max(0, Math.min(100, Math.round((stepX / totalY) * 100)));
                    const detail = goalMatch[3]?.trim();
                    const bar = renderProgressBar(pct, 18);
                    const detailSuffix = detail ? ` ${theme.dim('·')} ${theme.text(detail)}` : '';
                    const line = `  ${theme.muted('╭─')} ${theme.brightMint('◆ Otonom Hedef')} ${theme.dim(`[Adım ${stepX}/${totalY}]`)} ${bar} ${theme.crystalCyan(`%${pct}`)}${detailSuffix}`;
                    printPermanentLine(line);
                    updateSpinnerLabel(msg);
                    break;
                }
                // 3. Paralel Alt Ajanlar ([Rol] ...) -> Düzenli Ağaç Dalı
                const roleMatch = msg.match(/^\[([^\]]+)\]\s*(.*)$/);
                if (roleMatch) {
                    const role = roleMatch[1].trim();
                    const rest = roleMatch[2].trim();
                    const line = `  ├─ ◈ ${theme.brightMint(`[${role}]`)} ${theme.text(rest)}`;
                    printPermanentLine(line);
                    updateSpinnerLabel(msg);
                    break;
                }
                // 4. Sıradan durum mesajları: Spinner çalışıyorsa sıfır-sıçrama ile yerinde güncelle
                if (spinnerTimer) {
                    updateSpinnerLabel(msg);
                }
                else {
                    const isWorkflowStatus = /Ultracode|Aşama|Adım|Hedef|Plan|MCP|Alt Ajan/i.test(msg);
                    if (isWorkflowStatus) {
                        write(`  ├─ ${theme.badge('◈ AKIŞ')} ${theme.text(msg)}\n`);
                    }
                    else {
                        write(`${theme.muted(msg)}\n`);
                    }
                }
                break;
            }
            case 'error':
                stopThinking();
                finishStream();
                write(`${theme.error(`Hata: ${safe(event.error)}`)}\n`);
                break;
            case 'usage':
                // globalTokenTracker.recordTurn src/agent.ts içinde kaydediliyor. Çift sayımı önlemek için burada çağırmıyoruz.
                break;
        }
    };
    return { emit, finishStream, startThinking, stopThinking, stopSpinner, isThinking };
}
/** Print comprehensive help menu with modern cyber-minimalist categories. */
export function printHelp() {
    const rule = symbols.rule.repeat(64);
    const title = `${theme.brightMint('T Bot')} ${theme.muted('─ Cyber-Zen Terminal Komutları')}`;
    const categories = [
        {
            name: 'Oturum ve Çekirdek',
            cmds: [
                ['/help', 'Yardım Menüsünü Görüntüler'],
                ['/clear', 'Sohbet Geçmişini ve Terminal Ekranını Temizler'],
                ['/status', 'Canlı Siber HUD Durum Çubuğunu Görüntüler'],
                ['/exit, /quit', 'T Bot Uygulamasından Güvenle Ayrılır'],
            ],
        },
        {
            name: 'Model ve Düşünme',
            cmds: [
                ['/provider, /model', 'LLM Sağlayıcı ve Model Seçimi'],
                ['/config, /auth', 'Yapılandırma Ayarları ve API Anahtarı Yönetimi'],
                ['/effort [düzey]', 'Düşünme Eforu (Düşük, Orta, Yüksek, Maksimum)'],
                ['/ultracode [on|off]', 'Yüksek Doğruluklu Özerk Kodlama Modu'],
                ['/yolo [on|off]', 'Araç Çalıştırma Otomatik Onay Modu'],
                ['/gui [live|headless|stop]', 'Canlı Tarayıcı/Masaüstü HUD ve Pencere Kontrolü'],
            ],
        },
        {
            name: 'Sistem, Bellek ve Optimizasyon',
            cmds: [
                ['/tokens', 'Token Tasarrufu, Önbellek ve Kullanım Raporu'],
                ['/memory', 'RAM Kullanımı ve Bellek Koruma İstatistikleri'],
                ['/remember <k> = <v>', 'Kalıcı Proje veya Küresel Belleğe Bilgi Kaydeder'],
                ['/gc', 'Bellek Çöp Toplayıcısını (GC) Tetikler ve RAM Temizler'],
                ['/bot', 'Telegram Botu Canlı Durum ve Bağlantı Kontrolü'],
            ],
        },
        {
            name: 'Ajan ve İş Akışları',
            cmds: [
                ['/goal [hedef]', 'Oturum Hedefini Belirler veya Hedefleri Görüntüler'],
                ['/plan [apply]', 'Görevi Adım Adım Planlar veya Planı Yürütür'],
                ['/subagents', 'Paralel Araştırma ve Alt Ajan Yönetim Menüsü'],
                ['/mcp', 'Model Context Protocol (MCP) Sunucu Bağlantıları'],
                ['/skills', 'Mevcut Yerleşik Yetenek ve Uzmanlıkları Listeler'],
                ['/sessions, /resume', 'Geçmiş Oturumları Listeler ve Devam Ettirir'],
            ],
        },
    ];
    let out = `\n${title}\n${theme.dim(rule)}\n`;
    for (const cat of categories) {
        out += `\n  ${theme.brightMint(cat.name)}\n`;
        for (const [cmd, desc] of cat.cmds) {
            out += `    ${theme.crystalCyan(cmd.padEnd(24))} ${theme.text(desc)}\n`;
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
    let isSuspended = false;
    let yolo = options.yolo ?? false;
    const setYolo = (enabled) => { yolo = enabled; };
    const getHudContext = () => {
        let effortLabel = 'Normal';
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
    registerGuiKillSwitch((reason) => {
        eventPrinter.emit({ type: 'error', error: reason });
        if (controller && !controller.signal.aborted) {
            controller.abort();
        }
    });
    const onKeyData = (data) => {
        if (isSuspended || !eventPrinter.isThinking())
            return;
        if (!controller || controller.signal.aborted)
            return;
        const str = typeof data === 'string' ? data : data.toString();
        // Tek başına ESC (\x1b) veya F12 (\x1b[24~)
        if (str === '\x1b' || str === '\x1b[24~') {
            controller.abort();
            eventPrinter.stopThinking();
            write(`\n${theme.amber('⏹ İşlem kullanıcı tarafından klavyeden [ESC / F12] ile durduruldu.')}\n`);
            eventPrinter.finishStream();
            if (waiting) {
                const resolve = waiting;
                waiting = undefined;
                resolve(undefined);
            }
        }
    };
    if (interactive && process.stdin.isTTY) {
        process.stdin.on('data', onKeyData);
    }
    const attach = () => {
        rl.on('line', line => {
            if (waiting) {
                const resolve = waiting;
                waiting = undefined;
                resolve(line);
            }
            else {
                // Spinner dönerken kullanıcı yanlışlıkla Enter'a basarsa boş satırların lines kuyruğunda birikip sonraki turda kendi kendine mesaj göndermesini önle
                if (eventPrinter.isThinking() && !line.trim()) {
                    return;
                }
                lines.push(line);
            }
        });
        rl.on('close', () => {
            closed = true;
            if (interactive)
                process.stdout.write('\x1b[?25h');
            if (waiting) {
                const resolve = waiting;
                waiting = undefined;
                resolve(undefined);
            }
        });
        rl.on('SIGINT', () => {
            if (controller) {
                controller.abort();
                if (waiting) {
                    const resolve = waiting;
                    waiting = undefined;
                    resolve(undefined);
                }
                eventPrinter.finishStream();
                write(`\n${theme.muted('İptal Ediliyor…')}\n`);
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
        eventPrinter.stopThinking();
        eventPrinter.finishStream();
        write(`\n${theme.warning('Onay Gerekli:')} ${theme.bold(safe(request.tool))}\n${safe(request.description)}\n`);
        write(`${theme.muted(safe(JSON.stringify(request.arguments, null, 2)))}\n`);
        if (!interactive || controller?.signal.aborted) {
            write(`${theme.muted('Reddedildi (Etkileşimli Onay Gerekli).')}\n`);
            return false;
        }
        const answer = await read(`${theme.warning('İzin Verilsin mi?')} [E/H] `);
        return !controller?.signal.aborted && /^(e|evet|y|yes)$/i.test((answer ?? '').trim());
    };
    const suspendUi = async (action) => {
        isSuspended = true;
        eventPrinter.stopThinking();
        if (!interactive) {
            try {
                return await action();
            }
            finally {
                isSuspended = false;
            }
        }
        rl.close();
        try {
            return await action();
        }
        finally {
            isSuspended = false;
            closed = false;
            rl = createInterface({ input: process.stdin, output: process.stdout, terminal: interactive });
            attach();
        }
    };
    if (interactive) {
        const width = Math.max(20, Math.min(process.stdout.columns || 76, 76));
        await animateLogo(width, () => exiting, 55);
        write(`${theme.muted(`  ${safe(options.provider.label)} / ${safe(options.model)}  ${symbols.bullet}  ${safe(options.workspace)}`)}\n`);
        write(`  ${yolo ? theme.warning('YOLO · Otomatik Onay') : theme.muted('Onaylı')}\n`);
        if (options.modeStatus)
            write(`  ${theme.muted(safe(options.modeStatus()))}\n`);
        write(`\n  ${renderHudBar(getHudContext())}\n`);
        write(`${theme.dim(`  ${symbols.rule.repeat(Math.max(20, width - 4))}`)}\n`);
        write(`${theme.muted('  /help Komutlar İçin · Ctrl+C İptal Etmek İçin')}\n\n`);
    }
    try {
        while (!exiting) {
            const status = options.modeStatus ? ` ${theme.muted(safe(options.modeStatus()))}` : '';
            const promptStr = interactive
                ? `${yolo ? theme.warning('YOLO · Otomatik Onay') : theme.muted('Onaylı')}${status} ${theme.brightMint(symbols.prompt)} `
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
                if (command === '/clear') {
                    await options.onCommand?.(input, setYolo);
                    if (interactive)
                        process.stdout.write('\x1b[2J\x1b[H');
                    write(`${theme.muted('Sohbet Geçmişi ve Ekran Temizlendi.')}\n`);
                    continue;
                }
                if (['/goal', '/plan', '/subagents', '/mcp', '/frontenddesign', '/backend', '/codereview', '/debuganalysis', '/imagegen'].includes(command ?? '') && options.onWorkflow) {
                    controller = new AbortController();
                    eventPrinter.startThinking('İş Akışı Yürütülüyor…');
                    try {
                        await options.onWorkflow(command, input.slice(command.length).trim(), eventPrinter.emit, approve, controller.signal, suspendUi);
                    }
                    catch (error) {
                        eventPrinter.finishStream();
                        write(`${theme.error(controller.signal.aborted ? 'İptal Edildi.' : `Hata: ${safe(error instanceof Error ? error.message : String(error))}`)}\n`);
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
                write(`${safe(result ?? 'Bilinmeyen Komut. Komutlar İçin /help Yazın.')}\n`);
                continue;
            }
            controller = new AbortController();
            eventPrinter.startThinking('Düşünülüyor…');
            try {
                await options.onSubmit(input, eventPrinter.emit, approve, controller.signal);
            }
            catch (error) {
                eventPrinter.finishStream();
                write(`${theme.error(controller.signal.aborted ? 'İptal Edildi.' : `Hata: ${safe(error instanceof Error ? error.message : String(error))}`)}\n`);
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
        if (interactive && process.stdin.isTTY) {
            process.stdin.off('data', onKeyData);
        }
        registerGuiKillSwitch(null);
        eventPrinter.stopThinking();
        if (interactive) {
            process.stdout.write('\x1b[?25h');
        }
        rl.close();
    }
}
//# sourceMappingURL=tui.js.map