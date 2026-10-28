import { createInterface } from 'node:readline';
import type { AgentEvent, ApprovalRequest, Message, Provider } from './types.js';
import {
  fitLine,
  formatDuration,
  formatToolTitle,
  renderCyberWave,
  renderProgressBar,
  symbols,
  theme,
  truncateAnsi,
  unicode,
  visibleLength,
  wrapLine,
} from './theme.js';
import { isWorkflowInvocation, COMMAND_GROUPS } from './commands.js';
import { animateLogo, logo } from './logo.js';
import { APP_VERSION } from './version.js';
import { globalTokenTracker } from './token-optimizer.js';
import { globalGroundingLedger } from './grounding.js';
import { getMemoryStats } from './memory-guard.js';
import { getTelegramBotStatus } from './bot.js';
import { registerMcpStdioApproval } from './mcp.js';
import { registerGuiKillSwitch } from './tools/index.js';

export { logo };

export interface HudConfig {
  model?: string;
  provider?: Provider | string;
  effort?: string;
  yolo?: boolean;
  workspace?: string;
  mcpCount?: number;
}

function renderMiniSavingsBar(percent: number, cells = 5): string {
  const safeCells = Math.max(1, cells);
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const filled = Math.round((clamped / 100) * safeCells);
  const empty = Math.max(0, safeCells - filled);
  return `${theme.brightMint('▰'.repeat(filled))}${theme.dim('▱'.repeat(empty))}`;
}

/**
 * Tekilleştirilmiş Zarif Cyber-Zen HUD Çubuğu:
 * ╭─[ Model: ... │ Efor: ... │ Tasarruf: %XX ▰▱ (Y Tok) │ Doğrulama: Doğrulandı │ Bellek: XX MB ● (Sistem: %YY) │ Bot: Aktif / Pasif ]─╮
 *
 * `width` verilmezse terminal genişliği kullanılır. Sığmayan düşük öncelikli
 * segmentler (tasarruf → bot → doğrulama) sırayla kısaltılır/atılır; model ve
 * bellek her zaman görünür kalır.
 */
export function renderHudBar(config: HudConfig, width: number = process.stdout.columns || 100): string {
  const target = Math.max(20, Math.floor(Number.isFinite(width) ? width : 100));
  const model = safe(config.model || 'Model');
  const effort = safe(config.effort || 'Normal');

  const report = globalTokenTracker.getReport();
  const savingsPct = report.savingsPercent || 0;
  const savedTokens = report.totalSavedTokens > 0 ? report.totalSavedTokens.toLocaleString() : '0';
  const miniBar = renderMiniSavingsBar(savingsPct, 5);
  const savingsFull = `${theme.brightMint(`Tasarruf: %${savingsPct}`)} ${miniBar} ${theme.dim(`(${savedTokens} Tok)`)}`;
  const savingsCompact = theme.brightMint(`Tasarruf: %${savingsPct}`);

  const gStatus = globalGroundingLedger.getStatus();
  const groundingStr = gStatus.warnings.length === 0
    ? theme.success('Doğrulama: Uyarı Yok')
    : theme.amber(`Doğrulama: Uyarı (${gStatus.warnings.length})`);

  const mem = getMemoryStats();
  const ramStatusDot = mem.pressure === 'high' ? theme.danger('▲') : (mem.pressure === 'moderate' ? theme.amber('■') : theme.success('●'));
  const memoryFull = `${theme.crystalCyan(`Bellek: ${mem.heapUsedMB} MB`)} ${ramStatusDot} ${theme.dim(`(Sistem: %${mem.systemUsedPercent})`)}`;
  const memoryCompact = `${theme.crystalCyan(`Bellek: ${mem.heapUsedMB} MB`)} ${ramStatusDot}`;
  const memoryMin = theme.crystalCyan(`RAM: ${mem.heapUsedMB}MB`);

  const botStatus = getTelegramBotStatus();
  const botPart = botStatus.running
    ? theme.success(`Bot: ${botStatus.username ? `@${safe(botStatus.username)}` : 'Aktif'}`)
    : (config.mcpCount && config.mcpCount > 0
        ? theme.softLavender(`MCP: ${config.mcpCount}`)
        : theme.dim('Bot: Pasif'));

  const effortFull = theme.amber(`Efor: ${effort}`);
  const effortCompact = theme.amber(`Efor:${effort}`);

  const left = theme.muted(unicode ? '╭─[' : '[[');
  const right = theme.muted(unicode ? ']─╮' : ']]');
  const sep = theme.dim(symbols.hudSep);
  const sepWidth = visibleLength(symbols.hudSep);
  const frameWidth = visibleLength(unicode ? '╭─[' : '[[') + 2 + visibleLength(unicode ? ']─╮' : ']]');
  const modelLabel = `Model: ${model}`;
  const modelMinimum = 9; // "Model: …"

  interface Level {
    savings: 0 | 1 | 2;
    bot: boolean;
    grounding: boolean;
    effort: 0 | 1 | 2;
    memory: 0 | 1 | 2;
  }
  const levels: Level[] = [
    { savings: 2, bot: true, grounding: true, effort: 2, memory: 2 },
    { savings: 1, bot: true, grounding: true, effort: 2, memory: 2 },
    { savings: 0, bot: true, grounding: true, effort: 2, memory: 2 },
    { savings: 0, bot: false, grounding: true, effort: 2, memory: 2 },
    { savings: 0, bot: false, grounding: true, effort: 1, memory: 2 },
    { savings: 0, bot: false, grounding: true, effort: 1, memory: 1 },
    { savings: 0, bot: false, grounding: false, effort: 1, memory: 1 },
    { savings: 0, bot: false, grounding: false, effort: 0, memory: 1 },
    { savings: 0, bot: false, grounding: false, effort: 0, memory: 0 },
  ];

  for (const level of levels) {
    const parts: string[] = [];
    if (level.effort === 2) parts.push(effortFull);
    else if (level.effort === 1) parts.push(effortCompact);
    if (level.savings === 2) parts.push(savingsFull);
    else if (level.savings === 1) parts.push(savingsCompact);
    if (level.grounding) parts.push(groundingStr);
    parts.push(level.memory === 2 ? memoryFull : level.memory === 1 ? memoryCompact : memoryMin);
    if (level.bot) parts.push(botPart);

    const fixedWidth = parts.reduce((sum, part) => sum + visibleLength(part), 0);
    const modelWidth = target - frameWidth - fixedWidth - parts.length * sepWidth;
    if (modelWidth < modelMinimum) continue;
    const modelSegment = truncateAnsi(theme.cyan(modelLabel), modelWidth);
    const line = `${left} ${modelSegment}${sep}${parts.join(sep)} ${right}`;
    if (visibleLength(line) <= target) return line;
  }

  // Son çare: çerçeveyi koru, modeli ve belleği kısaltarak taşmayı engelle.
  const narrowedModel = truncateAnsi(theme.cyan(modelLabel), Math.max(7, Math.floor(target / 2)));
  return truncateAnsi(`${left} ${narrowedModel}${sep}${memoryMin} ${right}`, target);
}

export interface EventPrinterOptions {
  interactive: boolean;
  getHudConfig: () => HudConfig;
  write?: (text: string) => void;
}

export interface EventPrinter {
  emit: (event: AgentEvent) => void;
  finishStream: () => void;
  startThinking: (label?: string) => void;
  stopThinking: () => void;
  stopSpinner: () => void;
  isThinking: () => boolean;
  /** Re-render the live spinner after a terminal resize (SIGWINCH). */
  redraw: () => void;
}

/** Terminal width with a sane floor; never trusts a zero/undefined column count. */
function terminalColumns(): number {
  return Math.max(20, Math.floor(process.stdout.columns || 80));
}

function extractToolTarget(args: unknown): string {
  if (!args) return '';
  let obj: Record<string, unknown> = {};
  if (typeof args === 'string') {
    try {
      const parsed: unknown = JSON.parse(args);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '';
      obj = parsed as Record<string, unknown>;
    } catch {
      const clean = args.trim().replace(/\r?\n.*/s, '');
      return clean.length > 60 ? `${clean.slice(0, 57)}...` : clean;
    }
  } else if (typeof args === 'object' && args !== null) {
    obj = args as Record<string, unknown>;
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

function extractResultSummary(
  result: unknown,
  toolName?: string,
): { isError: boolean; summary: string; astBadge?: string } {
  if (result === undefined || result === null) {
    return { isError: false, summary: '' };
  }
  const str = typeof result === 'string' ? result : JSON.stringify(result);
  const trimmed = str.trim();

  const isReadTool =
    toolName === 'file_read' ||
    toolName === 'file_outline' ||
    toolName === 'file_search' ||
    toolName === 'file_glob' ||
    toolName === 'file_list';

  let isError = false;
  if (isReadTool) {
    isError = /^(tool error:|araç hatası:|\[halüsinasyon engeli|\[ikili dosya engeli|\[acil durdurma)/i.test(trimmed);
  } else {
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
    const diffMatch =
      trimmed.match(/\(\+(\d+)\s*\/\s*-(\d+)\s*(?:lines?|satır)?\)/i) ||
      trimmed.match(/\+(\d+)\s*\/\s*-(\d+)\s*(?:lines?|satır)?/i);
    if (diffMatch) {
      const plus = diffMatch[1]!;
      const minus = diffMatch[2]!;
      const astBadge = theme.success(`+${plus} / -${minus} satır · Dosya Güncellendi ${symbols.check}`);
      const cleanLine = (trimmed.split('\n')[0] || '').replace(/\s*\(\+\d+\s*\/\s*-\d+[^)]*\)/i, '').trim();
      return {
        isError: false,
        summary: cleanLine.length > 50 ? `${cleanLine.slice(0, 47)}...` : cleanLine,
        astBadge,
      };
    }

    const lineCountMatch =
      trimmed.match(/\((\d+)\s*(?:lines?|satır)\)/i) ||
      trimmed.match(/(\d+)\s*(?:lines?|satır)\b/i);
    if (lineCountMatch) {
      const lineCount = lineCountMatch[1]!;
      const astBadge = theme.success(`+${lineCount} / -0 satır · Dosya Güncellendi ${symbols.check}`);
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
      astBadge: theme.success(`Dosya Güncellendi ${symbols.check}`),
    };
  }

  const lines = trimmed.split('\n').filter(l => l.trim().length > 0);
  let summary = '';
  if (lines.length > 1) {
    summary = `${lines.length} Satır · ${trimmed.length} Karakter`;
  } else if (lines.length === 1) {
    const line = lines[0]!;
    summary = line.length > 60 ? `${line.slice(0, 57)}...` : line;
  }
  return { isError: false, summary };
}

/**
 * 4-aşamalı görsel Ultracode Hattı Stepper satırı üretir:
 * ╭─ ◆ ULTRACODE  ✓ 1. Araştırma ──▶ ◉ 2. Denetim ──▶ ○ 3. Öz-Onarım ──▶ ○ 4. Özet
 */
function renderUltracodeStepper(activeStage: number): string {
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
function formatInlineMarkdown(text: string): string {
  const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  const parts = text.split(tokenRegex);
  return parts
    .map((part) => {
      if (!part) return '';
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
const safe = (text: string): string => text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');

/**
 * Sıfır-Kırpışmalı (DEC ?2026h/?2026l), Sıfır-Taşmalı (truncateAnsi),
 * Görsel Görev Ağacı ve Ultracode Stepper destekli Cyber-Zen EventPrinter.
 */
export function createEventPrinter(options: EventPrinterOptions): EventPrinter {
  const write = options.write ?? ((t: string) => { process.stdout.write(t); });
  let streaming = false;
  let thinking = false;
  let spinnerTimer: ReturnType<typeof setInterval> | undefined;
  let thinkingStartedAt = 0;
  let spinnerFrame = 0;
  let waveFrame = 0;
  let currentSpinnerLabel = '';
  let lineBuffer = '';
  let inCodeBlock = false;
  let cursorHidden = false;

  let toolStartTime = 0;
  let stepCount = 0;

  // Block boundaries: separate consecutive assistant/tool blocks with one blank line.
  let blockOpen = false;
  let freshBlock = true;

  const beginBlock = (): void => {
    if (blockOpen) {
      // Close an unterminated block before opening the next one.
      write('\n');
      blockOpen = false;
    }
    if (!freshBlock) {
      // Every closed block already ends with a newline; one more gives a blank separator.
      write('\n');
    }
    freshBlock = false;
    blockOpen = true;
  };
  const endBlock = (): void => {
    blockOpen = false;
    freshBlock = false;
  };

  /** Truncate a single-line status/tool row to the terminal width. */
  const writeFitted = (text: string): void => {
    write(`${fitLine(text, terminalColumns())}\n`);
  };

  /** Wrap a status row instead of letting it run past the terminal edge. */
  const writeWrapped = (text: string, indent = '  '): void => {
    const parts = wrapLine(text, terminalColumns());
    write(`${parts.map((part, index) => (index === 0 ? part : `${indent}${part}`)).join('\n')}\n`);
  };

  const renderSpinnerLine = (): string => {
    const elapsed = formatDuration(Date.now() - thinkingStartedAt);
    const stepPrefix = stepCount > 0 ? `${theme.softLavender(`[Adım ${stepCount}]`)} ` : '';
    const wave = renderCyberWave(spinnerFrame, 8);
    const mem = getMemoryStats();
    const tokenReport = globalTokenTracker.getReport();
    const telemetry = `${theme.crystalCyan(`▣ ${mem.heapUsedMB}MB`)} ${theme.brightMint(`%${tokenReport.savingsPercent ?? 0}`)}`;
    const stopHint = theme.amber('[ESC / F12 / ⏹ Durdur]');
    const rawLine = `  ${theme.brightMint(BRAILLE_SPINNER[spinnerFrame]!)} ${wave} ${stepPrefix}${theme.text(currentSpinnerLabel)} ${theme.dim(`· ${elapsed}`)} ${theme.dim('·')} ${telemetry} ${theme.dim('·')} ${stopHint}`;
    const maxCols = Math.max(1, (process.stdout.columns || 100) - 2);
    return truncateAnsi(rawLine, maxCols);
  };

  const stopThinking = (): void => {
    thinking = false;
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
  const isThinking = (): boolean => thinking;

  const updateSpinnerLabel = (label: string): void => {
    currentSpinnerLabel = safe(label).replace(/\r?\n/g, ' ').trim();
    if (options.interactive && spinnerTimer) {
      const line = renderSpinnerLine();
      process.stdout.write(`\x1b[?2026h\r\x1b[2K${line}\x1b[?2026l`);
    }
  };

  /** Re-render the live spinner line after SIGWINCH so it uses the new width. */
  const redraw = (): void => {
    if (!options.interactive || !spinnerTimer) return;
    process.stdout.write(`\x1b[?2026h\r\x1b[2K${renderSpinnerLine()}\x1b[?2026l`);
  };

  const printPermanentLine = (text: string): void => {
    const fitted = wrapLine(text, terminalColumns()).join('\n');
    if (options.interactive && spinnerTimer) {
      const currentSpinner = renderSpinnerLine();
      process.stdout.write(`\x1b[?2026h\r\x1b[2K${fitted}\n${currentSpinner}\x1b[?2026l`);
    } else {
      write(`${fitted}\n`);
    }
  };

  const startThinking = (label = 'Düşünülüyor…'): void => {
    currentSpinnerLabel = safe(label).replace(/\r?\n/g, ' ').trim();
    thinking = true;
    if (!options.interactive) return;
    if (process.env.TBOT_NO_ANIMATION !== undefined || process.env.TERM === 'dumb') {
      write(`${theme.muted(currentSpinnerLabel)}\n`);
      return;
    }
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

  const highlightLine = (line: string): string => {
    if (/^```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      return theme.cyan(line);
    }
    if (inCodeBlock) {
      if (line.startsWith('+') && !line.startsWith('+++')) return theme.success(line);
      if (line.startsWith('-') && !line.startsWith('---')) return theme.danger(line);
      if (line.startsWith('@@')) return theme.cyan(line);
      if (/^\s*(#|\/\/|\/\*|\*)/.test(line)) return theme.dim(line);
      return theme.text(line);
    }
    if (line.startsWith('+') && !line.startsWith('+++')) return theme.success(line);
    if (line.startsWith('-') && !line.startsWith('---')) return theme.danger(line);
    if (line.startsWith('@@')) return theme.cyan(line);
    if (/^#{1,4}\s/.test(line)) return theme.brand(line);
    if (/^>\s/.test(line)) return theme.dim(line);
    if (/^\s*[-*]\s/.test(line)) {
      const spaceIdx = line.indexOf(' ');
      return `${theme.accent(line.slice(0, spaceIdx + 1))}${formatInlineMarkdown(line.slice(spaceIdx + 1))}`;
    }
    return formatInlineMarkdown(line);
  };

  const finishStream = (): void => {
    stopThinking();
    if (streaming) {
      if (lineBuffer.length > 0) {
        write(highlightLine(lineBuffer));
        lineBuffer = '';
      }
      inCodeBlock = false;
      write('\n\n');
      streaming = false;
      blockOpen = false;
      freshBlock = true;

      // Tekilleştirilmiş zarif Cyber-HUD çubuğu (mükerrer footer kaldırıldı)
      write(`  ${renderHudBar(options.getHudConfig(), terminalColumns())}\n\n`);
    }
  };

  const emit = (event: AgentEvent): void => {
    switch (event.type) {
      case 'text':
        stopThinking();
        if (!streaming) {
          beginBlock();
          write(`${theme.brightMint(symbols.prompt)} ${theme.iceWhite('T Bot')}\n\n`);
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
        const toolTitle = safe(formatToolTitle(event.call.name));
        const targetInfo = safe(extractToolTarget(event.call.arguments));
        const targetSuffix = targetInfo ? ` ${theme.dim('›')} ${theme.crystalCyan(targetInfo)}` : '';
        beginBlock();
        writeFitted(`  ${theme.muted('╭─')} ${theme.brightMint('◈')} ${theme.bold('Araç Çalıştırılıyor')} ${theme.dim('·')} ${theme.text(toolTitle)}${targetSuffix}`);
        startThinking(`${toolTitle} Çalıştırılıyor`);
        break;
      }

      case 'tool_end': {
        stopThinking();
        const elapsed = formatDuration(Date.now() - toolStartTime);
        const toolTitle = safe(formatToolTitle(event.call.name));
        const result = extractResultSummary(event.result, event.call.name);
        const { isError, astBadge } = result;
        const summary = safe(result.summary);
        if (isError) {
          writeFitted(`  ${theme.muted('╰─')} ${theme.danger(symbols.cross)} ${theme.danger(`${toolTitle} Başarısız Oldu`)} ${theme.dim(`(${elapsed})`)} ${theme.dim('·')} ${theme.error(summary)}`);
        } else {
          const badgePart = astBadge ? ` ${theme.dim('·')} ${astBadge}` : '';
          const summaryStr = summary ? ` ${theme.dim('·')} ${theme.muted(summary)}` : '';
          writeFitted(`  ${theme.muted('╰─')} ${theme.success(symbols.check)} ${theme.text(`${toolTitle} Tamamlandı`)} ${theme.dim(`(${elapsed})`)}${badgePart}${summaryStr}`);
        }
        endBlock();
        startThinking('Yanıt Hazırlanıyor…');
        break;
      }

      case 'status': {
        const msg = safe(event.message);

        // 1. Ultracode [Aşama X/4] -> 4-Aşamalı Görsel Stepper
        const ultraMatch = msg.match(/Ultracode\s*\[Aşama\s*(\d+)\s*\/\s*4\](?:\s*:?\s*(.*))?/i);
        if (ultraMatch) {
          const stageNum = Math.max(1, Math.min(4, parseInt(ultraMatch[1]!, 10)));
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
          const stepX = parseInt(goalMatch[1]!, 10);
          const totalY = Math.max(1, parseInt(goalMatch[2]!, 10));
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
          const role = roleMatch[1]!.trim();
          const rest = roleMatch[2]!.trim();
          const line = `  ├─ ◈ ${theme.brightMint(`[${role}]`)} ${theme.text(rest)}`;
          printPermanentLine(line);
          updateSpinnerLabel(msg);
          break;
        }

        // 4. Sıradan durum mesajları: Spinner çalışıyorsa sıfır-sıçrama ile yerinde güncelle
        if (spinnerTimer) {
          updateSpinnerLabel(msg);
        } else {
          const isWorkflowStatus = /Ultracode|Aşama|Adım|Hedef|Plan|MCP|Alt Ajan/i.test(msg);
          if (isWorkflowStatus) {
            writeWrapped(`  ├─ ${theme.badge('◈ AKIŞ')} ${theme.text(msg)}`);
          } else {
            writeWrapped(theme.muted(msg), '');
          }
        }
        break;
      }

      case 'error':
        stopThinking();
        finishStream();
        beginBlock();
        writeWrapped(theme.error(`Hata: ${safe(event.error)}`), '');
        endBlock();
        break;

      case 'usage':
        // globalTokenTracker.recordTurn src/agent.ts içinde kaydediliyor. Çift sayımı önlemek için burada çağırmıyoruz.
        break;
    }
  };

  return { emit, finishStream, startThinking, stopThinking, stopSpinner, isThinking, redraw };
}

/** Print the shared CLI command catalog with terminal styling. */
export function printHelp(width: number = process.stdout.columns || 80): void {
  const cols = Math.max(40, Math.floor(Number.isFinite(width) ? width : 80));
  const rule = symbols.rule.repeat(Math.max(10, cols));
  const title = `${theme.brightMint('T Bot')} ${theme.muted('─ Terminal Komutları')}`;
  const compact = cols < 64;

  let out = `\n${fitLine(title, cols)}\n${theme.dim(rule)}\n`;
  for (const group of COMMAND_GROUPS) {
    const commands = group.commands.filter(command => command.surfaces.includes('cli'));
    if (!commands.length) continue;
    out += `\n  ${theme.brightMint(group.name)}\n`;
    for (const command of commands) {
      const aliases = command.aliases?.length ? `  (${command.aliases.join(', ')})` : '';
      if (compact) {
        out += `    ${fitLine(theme.crystalCyan(command.usage), cols - 4)}${theme.dim(aliases)}\n`;
        for (const line of wrapLine(theme.text(command.description), Math.max(10, cols - 6))) {
          out += `      ${line}\n`;
        }
      } else {
        const usageWidth = Math.min(34, Math.max(18, Math.floor(cols * 0.38)));
        const descriptionWidth = Math.max(10, cols - 4 - usageWidth - 1);
        const wrapped = wrapLine(theme.text(`${command.description}${aliases}`), descriptionWidth);
        out += `    ${theme.crystalCyan(fitLine(command.usage, usageWidth).padEnd(usageWidth))} ${wrapped[0] ?? ''}\n`;
        for (const line of wrapped.slice(1)) out += `    ${' '.repeat(usageWidth)} ${line}\n`;
      }
    }
  }
  for (const line of wrapLine(theme.dim('  Not: Çok satırlı girdiler için satır sonuna \\ koyarak devam edebilirsiniz.'), cols)) {
    out += `${line}\n`;
  }
  out += `${theme.dim(rule)}\n\n`;
  process.stdout.write(out);
}

export interface TuiOptions {
  workspace: string;
  provider: Provider;
  model: string;
  history: Message[];
  onSubmit: (message: string, emit: (event: AgentEvent) => void, approve: (request: ApprovalRequest) => Promise<boolean>, signal: AbortSignal) => Promise<Message[]>;
  onCommand?: (command: string, setYolo: (enabled: boolean) => void) => Promise<string | undefined>;
  yolo?: boolean;
  modeStatus?: () => string;
  onWorkflow?: (command: string, input: string, emit: (event: AgentEvent) => void, approve: (request: ApprovalRequest) => Promise<boolean>, signal: AbortSignal, suspendUi: <T>(action: () => Promise<T>) => Promise<T>) => Promise<void>;
}

export async function startTui(options: TuiOptions): Promise<void> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  let rl = createInterface({ input: process.stdin, output: process.stdout, terminal: interactive });
  const lines: string[] = [];
  let waiting: ((line: string | undefined) => void) | undefined;
  let closed = false;
  let controller: AbortController | undefined;
  let exiting = false;
  let isSuspended = false;
  let yolo = options.yolo ?? false;
  const setYolo = (enabled: boolean): void => { yolo = enabled; };

  const getHudContext = (): HudConfig => {
    let effortLabel = 'Normal';
    if (options.modeStatus) {
      const raw = options.modeStatus();
      const match = raw.match(/Effort:\s*([^\s·]+)/i);
      if (match) effortLabel = match[1]!;
      if (/ultracode/i.test(raw)) effortLabel += '+Ultra';
    }
    return {
      model: options.model,
      provider: options.provider,
      effort: effortLabel,
      yolo,
      workspace: options.workspace,
    };
  };

  const write = (text: string): void => { process.stdout.write(text); };
  const eventPrinter = createEventPrinter({ interactive, getHudConfig: getHudContext, write });

  registerGuiKillSwitch((reason: string) => {
    eventPrinter.emit({ type: 'error', error: reason });
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
  });

  const onKeyData = (data: Buffer | string): void => {
    if (isSuspended) return;
    if (!controller || controller.signal.aborted) return;
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

  /** SIGWINCH: refresh the live spinner and reprint the HUD at the new width. */
  const onResize = (): void => {
    if (!interactive) return;
    eventPrinter.redraw();
    if (!waiting && !eventPrinter.isThinking()) {
      write(`\n  ${renderHudBar(getHudContext(), terminalColumns())}\n`);
    }
  };
  if (interactive) process.stdout.on('resize', onResize);

  const PASTE_START = '\x1b[200~';
  const PASTE_END = '\x1b[201~';
  let pasteBuffer: string[] | null = null;

  const deliverLine = (line: string): void => {
    if (waiting) {
      const resolve = waiting;
      waiting = undefined;
      resolve(line);
      return;
    }
    // Spinner dönerken kullanıcı yanlışlıkla Enter'a basarsa boş satırların lines kuyruğunda birikip sonraki turda kendi kendine mesaj göndermesini önle
    if (eventPrinter.isThinking() && !line.trim()) return;
    lines.push(line);
  };

  /**
   * Bracketed paste keeps multi-line clipboard content inside one turn.
   * The terminal wraps the block in \x1b[200~ … \x1b[201~; readline still emits
   * one `line` event per newline, so buffer until the closing marker arrives.
   */
  const handleLineInput = (rawLine: string): void => {
    if (pasteBuffer) {
      pasteBuffer.push(rawLine);
      if (rawLine.includes(PASTE_END)) {
        const joined = pasteBuffer.join('\n').replaceAll(PASTE_START, '').replaceAll(PASTE_END, '');
        pasteBuffer = null;
        deliverLine(joined);
      }
      return;
    }
    if (rawLine.includes(PASTE_START)) {
      const opened = rawLine.replaceAll(PASTE_START, '');
      if (opened.includes(PASTE_END)) deliverLine(opened.replaceAll(PASTE_END, ''));
      else pasteBuffer = [opened];
      return;
    }
    deliverLine(rawLine.includes(PASTE_END) ? rawLine.replaceAll(PASTE_END, '') : rawLine);
  };

  const attach = (): void => {
    rl.on('line', handleLineInput);
    rl.on('close', () => {
      closed = true;
      if (!isSuspended) controller?.abort();
      if (interactive) process.stdout.write('\x1b[?25h');
      if (waiting) {
        const resolve = waiting;
        waiting = undefined;
        resolve(undefined);
      }
    });
    rl.on('SIGINT', () => {
      if (controller) {
        controller.abort();
        if (waiting) { const resolve = waiting; waiting = undefined; resolve(undefined); }
        eventPrinter.finishStream();
        write(`\n${theme.muted('İptal Ediliyor…')}\n`);
      } else {
        exiting = true;
        rl.close();
      }
    });
  };
  attach();

  const read = async (prompt: string): Promise<string | undefined> => {
    if (interactive) write(prompt);
    if (lines.length) return lines.shift();
    if (closed) return undefined;
    return new Promise(resolve => { waiting = resolve; });
  };

  const approve = async (request: ApprovalRequest): Promise<boolean> => {
    // Input entered before a permission prompt must never approve the next tool.
    lines.length = 0;
    eventPrinter.stopThinking();
    eventPrinter.finishStream();
    const cols = terminalColumns();
    write(`\n${theme.warning('Onay Gerekli:')} ${theme.bold(safe(request.tool))}\n`);
    for (const line of wrapLine(theme.text(safe(request.description)), Math.max(10, cols - 2))) {
      write(`  ${line}\n`);
    }

    // Page the arguments so a large file_write does not flood the scrollback.
    const PAGE_SIZE = 20;
    const MAX_ARG_LINES = 120;
    const display: string[] = [];
    let truncatedArgs = false;
    for (const raw of safe(JSON.stringify(request.arguments ?? {}, null, 2)).split('\n')) {
      const wrapped = wrapLine(raw, Math.max(10, cols - 4));
      if (display.length + wrapped.length > MAX_ARG_LINES) { truncatedArgs = true; break; }
      for (const part of wrapped) display.push(`  ${theme.muted(part)}`);
    }

    if (!interactive || controller?.signal.aborted) {
      write(`${display.slice(0, PAGE_SIZE).join('\n')}\n`);
      const hidden = display.length - PAGE_SIZE + (truncatedArgs ? 1 : 0);
      if (hidden > 0) write(`${theme.dim(`… ${hidden} satır daha (sayfalanmadı)`)}\n`);
      write(`${theme.muted('Reddedildi (Etkileşimli Onay Gerekli).')}\n`);
      return false;
    }

    for (let offset = 0; offset < display.length; offset += PAGE_SIZE) {
      const page = display.slice(offset, offset + PAGE_SIZE);
      write(`${page.join('\n')}\n`);
      const remaining = display.length - offset - PAGE_SIZE;
      if (remaining > 0) {
        const prompt = `${theme.dim(`… ${remaining} satır daha · Enter devam / q iptal`)} `;
        const answer = await read(prompt);
        if (answer === undefined || /^q$/i.test(answer.trim())) {
          write(`${theme.muted('Onay iptal edildi.')}\n`);
          return false;
        }
      }
    }
    if (truncatedArgs) write(`${theme.dim(`… argüman çıktısı ${MAX_ARG_LINES} satırda kısaltıldı`)}\n`);

    const answer = await read(`${theme.warning('İzin Verilsin mi?')} [E/H] `);
    return !controller?.signal.aborted && /^(e|evet|y|yes)$/i.test((answer ?? '').trim());
  };

  // S6: the shared MCP layer asks this TUI before spawning any local stdio server.
  registerMcpStdioApproval(request => approve({
    tool: `mcp_stdio:${request.service}`,
    description: [
      'Yerel MCP stdio sunucusu başlatmak isteniyor.',
      `Sunucu: ${request.service}`,
      `Komut: ${[request.command, ...request.args].join(' ')}`,
      `Dizin: ${request.cwd}`,
      'Onay verilmezse bağlantı kurulmaz.',
    ].join('\n'),
    arguments: { command: request.command, args: request.args, cwd: request.cwd },
  }));

  const suspendUi = async <T>(action: () => Promise<T>): Promise<T> => {
    isSuspended = true;
    eventPrinter.stopThinking();
    if (!interactive) {
      try {
        return await action();
      } finally {
        isSuspended = false;
      }
    }
    rl.close();
    if (interactive) write('\x1b[?2004l');
    try {
      return await action();
    } finally {
      isSuspended = false;
      closed = false;
      rl = createInterface({ input: process.stdin, output: process.stdout, terminal: interactive });
      attach();
      if (interactive) write('\x1b[?2004h');
    }
  };

  try {
    if (interactive) {
      const width = Math.max(24, Math.min(process.stdout.columns || 80, 84));
      const cols = terminalColumns();
      await animateLogo(width, () => exiting, 55);
      const rule = symbols.rule.repeat(Math.max(20, width - 4));
      write(`\n  ${theme.brand('T BOT')} ${theme.muted(APP_VERSION)}  ${theme.dim(symbols.bullet)}  ${theme.muted('Yerel Ajan')}\n`);
      write(`  ${theme.dim(rule)}\n`);
      write(`${fitLine(`  ${theme.muted('Çalışma Alanı')}  ${theme.iceWhite(safe(options.workspace))}`, cols)}\n`);
      write(`${fitLine(`  ${theme.muted('Model')}  ${theme.brightMint(safe(options.provider.label))} / ${theme.iceWhite(safe(options.model))}  ${theme.dim(symbols.bullet)}  ${yolo ? theme.warning('YOLO') : theme.muted('Onaylı')}`, cols)}\n`);
      if (options.modeStatus) write(`${fitLine(`  ${theme.muted('Mod')}  ${theme.muted(safe(options.modeStatus()))}`, cols)}\n`);
      write(`  ${theme.dim(rule)}\n`);
      write(`${fitLine(`  ${theme.muted('/plan Plan')}  ${theme.dim(symbols.bullet)}  ${theme.muted('/ultracode Ultra')}  ${theme.dim(symbols.bullet)}  ${theme.muted('/help Komutlar')}  ${theme.dim(symbols.bullet)}  ${theme.muted('Ctrl+C İptal')}`, cols)}\n\n`);
      write('\x1b[?2004h');
    }

    while (!exiting) {
      if (interactive) {
        const width = Math.max(24, Math.min(process.stdout.columns || 80, 84));
        write(`\n  ${theme.dim(symbols.rule.repeat(Math.max(20, width - 4)))}\n`);
        write(`  ${renderHudBar(getHudContext(), terminalColumns())}\n`);
      }
      const status = options.modeStatus ? ` ${theme.muted(safe(options.modeStatus()))}` : '';
      const promptStr = interactive
        ? `${theme.dim('│')} ${theme.muted('Mesaj')} ${theme.brand(symbols.prompt)} `
        : '';
      const first = await read(promptStr);
      if (first === undefined) break;

      let input = first;
      // Trailing backslash joins the next line for multi-line prompts
      while (input.endsWith('\\')) {
        input = input.slice(0, -1);
        const next = await read(interactive ? `${theme.muted('...')} ` : '');
        if (next === undefined) break;
        input += `\n${next}`;
      }

      input = input.trim();
      if (!input) continue;

      if (input.startsWith('/')) {
        const parts = input.split(/\s+/);
        const command = parts[0]?.toLowerCase();
        if (command === '/exit' || command === '/quit') break;

        if (command === '/help') {
          printHelp();
          continue;
        }

        if (command === '/status') {
          write(`\n  ${renderHudBar(getHudContext(), terminalColumns())}\n\n`);
          continue;
        }

        if (command === '/clear') {
          await options.onCommand?.(input, setYolo);
          if (interactive) process.stdout.write('\x1b[2J\x1b[H');
          write(`${theme.muted('Sohbet Geçmişi ve Ekran Temizlendi.')}\n`);
          continue;
        }

        const workflowArgument = input.slice(command?.length ?? 0).trim();
        if (options.onWorkflow && isWorkflowInvocation(command ?? '', workflowArgument)) {
          controller = new AbortController();
          eventPrinter.startThinking('İş Akışı Yürütülüyor…');
          try {
            await options.onWorkflow(command!, workflowArgument, eventPrinter.emit, approve, controller.signal, suspendUi);
          } catch (error) {
            eventPrinter.finishStream();
            write(`${theme.error(controller.signal.aborted ? 'İptal Edildi.' : `Hata: ${safe(error instanceof Error ? error.message : String(error))}`)}\n`);
          } finally {
            controller = undefined;
            eventPrinter.finishStream();
          }
          if (interactive) write('\n');
          continue;
        }

        let result: string | undefined;
        const isMenuCommand = interactive && (
          command === '/provider' ||
          command === '/model' ||
          command === '/config' ||
          command === '/auth' ||
          command === '/effort' ||
          input.toLowerCase() === '/yolo' ||
          input.toLowerCase() === '/ultracode'
        );

        try {
          result = isMenuCommand
            ? await suspendUi(async () => options.onCommand?.(input, setYolo))
            : await options.onCommand?.(input, setYolo);
        } catch (error) {
          result = `Hata: ${error instanceof Error ? error.message : String(error)}`;
        }
        write(`${safe(result ?? 'Bilinmeyen Komut. Komutlar İçin /help Yazın.')}\n`);
        continue;
      }

      controller = new AbortController();
      eventPrinter.startThinking('Düşünülüyor…');
      try {
        await options.onSubmit(input, eventPrinter.emit, approve, controller.signal);
      } catch (error) {
        eventPrinter.finishStream();
        write(`${theme.error(controller.signal.aborted ? 'İptal Edildi.' : `Hata: ${safe(error instanceof Error ? error.message : String(error))}`)}\n`);
      } finally {
        controller = undefined;
        eventPrinter.finishStream();
      }
      if (interactive) write('\n');
    }
  } finally {
    if (interactive && process.stdin.isTTY) {
      process.stdin.off('data', onKeyData);
    }
    if (interactive) process.stdout.off('resize', onResize);
    registerMcpStdioApproval(undefined);
    registerGuiKillSwitch(null);
    eventPrinter.stopThinking();
    if (interactive) {
      process.stdout.write('\x1b[?2004l\x1b[?25h');
    }
    rl.close();
  }
}
