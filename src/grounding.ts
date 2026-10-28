import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import {
  validateCodeAstAndGrounding,
  getPendingCrossFileExports,
  clearPendingCrossFileExports,
} from './ast-validator.js';

/**
 * Command run record stored in the GroundingLedger.
 */
export interface CommandRunRecord {
  command: string;
  ok: boolean;
  timestamp: number;
  outputSnippet: string;
}

/**
 * Status summary for TUI HUD bar and diagnostics.
 */
export interface GroundingStatus {
  verified: boolean;
  inspectedCount: number;
  modifiedCount: number;
  verifiedCommands: number;
  warnings: string[];
}

/**
 * Result of syntax and structural validation.
 */
export interface SyntaxValidationResult {
  valid: boolean;
  error?: string;
  warnings?: string[];
}

/**
 * Result of auditing assistant claims against actual tool evidence.
 */
export interface ClaimAuditResult {
  verified: boolean;
  warnings: string[];
  correctionPrompt?: string;
}

/**
 * Normalizes a file path to a canonical form.
 * On Windows, normalizes case and separators to prevent casing hallucination mismatches.
 */
export function normalizePath(filePath: string, workspace?: string): string {
  if (!filePath || typeof filePath !== 'string') return '';
  const trimmed = filePath.trim();
  const resolved = workspace ? path.resolve(workspace, trimmed) : path.resolve(trimmed);
  const normalized = path.normalize(resolved);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Checks whether tool output text indicates a runtime or validation error.
 */
function isToolResultOk(name: string, output: string): boolean {
  if (typeof output !== 'string') return false;
  const trimmed = output.trimStart();
  if (
    trimmed.startsWith('Tool error:') ||
    trimmed.startsWith('Araç Hatası:') ||
    trimmed.startsWith('Araç hatası:') ||
    trimmed.startsWith('Tool action denied') ||
    trimmed.startsWith('Tool denied:') ||
    trimmed.startsWith('Araç reddedildi') ||
    trimmed.startsWith('Unknown tool:')
  ) {
    return false;
  }
  if (
    name === 'file_read' ||
    name === 'file_outline' ||
    name === 'file_glob' ||
    name === 'file_search' ||
    name === 'file_list'
  ) {
    if (
      trimmed.startsWith('Tool error:') ||
      trimmed.startsWith('Araç Hatası:') ||
      trimmed.startsWith('Araç hatası:') ||
      /^\[ikili dosya engeli/i.test(trimmed)
    ) {
      return false;
    }
    return true;
  }
  if (trimmed.startsWith('{') && /"ok"\s*:\s*false/.test(trimmed) && !/"warning"\s*:/.test(trimmed)) {
    return false;
  }
  if (name === 'shell' || name === 'run_command' || name === 'execute_command') {
    if (output.includes('Timed out') || output.includes('Aborted')) {
      return false;
    }
    const exitMatch = output.match(/Exit code:\s*(\d+)/i);
    if (exitMatch && Number(exitMatch[1]) !== 0) {
      return false;
    }
    if (/Exit code:\s*(?:-\d+|signal\b)/i.test(output)) {
      return false;
    }
  }
  return true;
}

/**
 * GroundingLedger tracks all file inspections, modifications, and command executions
 * during a session and per turn to strictly enforce Grounding and the Read-Before-Write invariant.
 */
export class GroundingLedger {
  public inspectedFiles = new Set<string>();
  public modifiedFiles = new Set<string>();
  public commandsRun: CommandRunRecord[] = [];
  public gitCommits = 0;
  public warnings: string[] = [];
  public workspace?: string;

  private turnModifiedFiles = new Set<string>();
  private turnCommandsRun: string[] = [];
  private turnGitCommits = 0;
  private turnGuiAndBrowserActions: string[] = [];
  private fileRevisions = new Map<string, string>();
  private fileHashes = new Map<string, string>();

  constructor(workspace?: string) {
    this.workspace = workspace;
  }

  /**
   * Resets turn-scoped evidence sets and HUD warnings at the start of each new user request.
   */
  public beginTurn(): void {
    this.inspectedFiles.clear();
    this.fileRevisions.clear();
    this.fileHashes.clear();
    this.turnModifiedFiles.clear();
    this.turnCommandsRun = [];
    this.turnGitCommits = 0;
    this.turnGuiAndBrowserActions = [];
    this.warnings = [];
    clearPendingCrossFileExports();
  }

  /**
   * Alias for beginTurn(). Resets turn-scoped evidence and clears pending cross-file export debts.
   */
  public resetTurn(): void {
    this.beginTurn();
  }

  /**
   * Clears active grounding warnings.
   */
  public clearWarnings(): void {
    this.warnings = [];
  }

  /**
   * Returns files modified during the current turn.
   */
  public getTurnModifiedFiles(): ReadonlySet<string> {
    return this.turnModifiedFiles;
  }

  /**
   * Returns commands executed successfully during the current turn.
   */
  public getTurnCommandsRun(): readonly string[] {
    return this.turnCommandsRun;
  }

  /**
   * Returns git commit count during the current turn.
   */
  public getTurnGitCommits(): number {
    return this.turnGitCommits;
  }

  /**
   * Returns interactive GUI and browser actions executed during the current turn.
   */
  public getTurnGuiAndBrowserActions(): readonly string[] {
    return this.turnGuiAndBrowserActions;
  }

  /**
   * Mark a file as inspected (only via real inspection tools such as file_read or file_outline).
   */
  public markFileInspected(filePath: string, workspace?: string, content?: string): void {
    const norm = normalizePath(filePath, workspace ?? this.workspace);
    if (norm) {
      this.inspectedFiles.add(norm);
      if (content !== undefined) this.fileHashes.set(norm, createHash('sha256').update(content).digest('hex'));
    }
  }

  public forgetFileSnapshot(filePath: string, workspace?: string): void {
    const norm = normalizePath(filePath, workspace ?? this.workspace);
    this.fileRevisions.delete(norm);
    this.fileHashes.delete(norm);
  }

  public recordFileRevision(filePath: string, revision: string, workspace?: string): void {
    this.fileRevisions.set(normalizePath(filePath, workspace ?? this.workspace), revision);
  }

  /** Content hashes cover complete reads; metadata also protects partial/offset reads. */
  public assertFileSnapshot(filePath: string, revision: string, content: string, workspace?: string): void {
    const norm = normalizePath(filePath, workspace ?? this.workspace);
    const hash = this.fileHashes.get(norm);
    if (this.fileRevisions.get(norm) !== revision || (hash !== undefined && hash !== createHash('sha256').update(content).digest('hex'))) {
      throw new Error('File changed since inspection or has no current snapshot; use file_read or file_outline before editing');
    }
  }

  /**
   * Mark a file as modified (e.g. written, patched) in both session and current turn sets.
   */
  public markFileModified(filePath: string, workspace?: string): void {
    const norm = normalizePath(filePath, workspace ?? this.workspace);
    if (norm) {
      this.modifiedFiles.add(norm);
      this.turnModifiedFiles.add(norm);
    }
  }

  /**
   * Append a grounding warning.
   */
  public addWarning(warning: string): void {
    if (!this.warnings.includes(warning)) {
      this.warnings.push(warning);
    }
  }

  /**
   * Record a shell command execution in the ledger.
   * If commandsRun exceeds 100 entries, removes oldest entries to prevent memory bloat.
   */
  public recordShellCommand(
    commandOrRecord: string | CommandRunRecord,
    ok = true,
    outputSnippet = ''
  ): void {
    const record: CommandRunRecord =
      typeof commandOrRecord === 'string'
        ? { command: commandOrRecord, ok, timestamp: Date.now(), outputSnippet }
        : commandOrRecord;
    this.commandsRun.push(record);
    if (record.ok && record.command) {
      this.turnCommandsRun.push(record.command);
    }
    while (this.commandsRun.length > 100) {
      this.commandsRun.shift();
    }
  }

  /**
   * Clear all recorded states (session and turn) and pending cross-file export debts.
   */
  public clear(): void {
    this.inspectedFiles.clear();
    this.fileRevisions.clear();
    this.fileHashes.clear();
    this.modifiedFiles.clear();
    this.turnModifiedFiles.clear();
    this.commandsRun = [];
    this.turnCommandsRun = [];
    this.gitCommits = 0;
    this.turnGitCommits = 0;
    this.turnGuiAndBrowserActions = [];
    this.warnings = [];
    clearPendingCrossFileExports();
  }

  /**
   * Read-Before-Write guard.
   * If a file already exists on disk and has NOT been inspected in this session
   * (and was not already modified in this session), reject modification with an anti-hallucination error.
   */
  public verifyCanModifyFile(
    filePath: string,
    existsOnDisk: boolean,
    workspace?: string
  ): { allowed: boolean; error?: string } {
    const norm = normalizePath(filePath, workspace ?? this.workspace);
    if (existsOnDisk && !this.inspectedFiles.has(norm) && !this.modifiedFiles.has(norm)) {
      return {
        allowed: false,
        error:
          'Anti-Halüsinasyon Engeli (Read-Before-Write): Mevcut bir dosyayı değiştirmeden önce içeriğini doğrulamak için file_read veya file_outline aracını kullanmalısınız.',
      };
    }
    return { allowed: true };
  }

  /**
   * Alias for verifyCanModifyFile assuming file exists on disk.
   */
  public canModifyFile(
    filePath: string,
    workspace?: string
  ): { allowed: boolean; error?: string } {
    return this.verifyCanModifyFile(filePath, true, workspace);
  }

  /**
   * Record tool execution results to maintain the grounding ledger.
   * Accepts both 4-argument calls (toolName, args, resultString, isError/ok) and legacy
   * 3-argument calls (toolName, args, { ok, output }, workspace).
   */
  public recordToolResult(
    toolName: string,
    args: Record<string, unknown>,
    result: { ok: boolean; output: string } | string,
    isErrorOrOkOrWorkspace?: boolean | string,
    maybeWorkspace?: string
  ): void {
    let rawOutput = '';
    let rawOk = true;

    if (typeof result === 'object' && result !== null) {
      rawOutput = typeof result.output === 'string' ? result.output : '';
      rawOk = Boolean(result.ok);
    } else if (typeof result === 'string') {
      rawOutput = result;
      if (typeof isErrorOrOkOrWorkspace === 'boolean') {
        rawOk = isErrorOrOkOrWorkspace;
      } else {
        rawOk = true;
      }
    }

    let ok = rawOk && isToolResultOk(toolName, rawOutput);
    if (toolName === 'shell' || toolName === 'run_command' || toolName === 'execute_command') {
      // Starting a background job is not evidence of successful completion.
      try {
        const job = JSON.parse(rawOutput);
        if (job && typeof job === 'object' && 'status' in job) {
          ok = ok && job.status === 'completed' && job.exitCode === 0;
        }
      } catch { /* Foreground tools return plain text with an exit-code trailer. */ }
    }
    const ws =
      typeof isErrorOrOkOrWorkspace === 'string'
        ? isErrorOrOkOrWorkspace
        : typeof maybeWorkspace === 'string'
          ? maybeWorkspace
          : this.workspace;

    const filePath =
      typeof args.path === 'string'
        ? args.path
        : typeof args.filePath === 'string'
          ? args.filePath
          : '';

    if (toolName === 'file_read' || toolName === 'file_outline') {
      if (ok && filePath) {
        this.markFileInspected(filePath, ws);
      }
    } else if (toolName === 'file_write' || toolName === 'file_patch') {
      if (ok && filePath) {
        this.markFileModified(filePath, ws);
      }
    } else if (
      toolName === 'shell' ||
      toolName === 'run_command' ||
      toolName === 'execute_command'
    ) {
      const cmd =
        typeof args.command === 'string'
          ? args.command
          : typeof args.cmd === 'string'
            ? args.cmd
            : typeof args.CommandLine === 'string'
              ? args.CommandLine
              : '';
      const snippet = rawOutput ? rawOutput.slice(0, 300) : '';
      this.recordShellCommand({
        command: cmd,
        ok,
        timestamp: Date.now(),
        outputSnippet: snippet,
      });
      if (ok && /(?:^|\s)git\s+commit\b/i.test(cmd)) {
        this.gitCommits++;
        this.turnGitCommits++;
      }
    } else if (toolName === 'git_commit') {
      if (ok) {
        this.gitCommits++;
        this.turnGitCommits++;
      }
    } else if (
      toolName === 'computer' ||
      toolName.startsWith('browser_') ||
      toolName === 'web_search' ||
      toolName === 'url_fetch'
    ) {
      if (ok) {
        const actionDesc =
          typeof args.action === 'string'
            ? `${toolName}:${args.action}`
            : typeof args.query === 'string'
              ? `${toolName}(${args.query})`
              : typeof args.url === 'string'
                ? `${toolName}(${args.url})`
                : toolName;
        this.turnGuiAndBrowserActions.push(actionDesc);
      }
    }
  }

  /**
   * Compact (~1,500 chars) evidence summary for Ultracode auditor / verification checks.
   */
  public getTurnEvidenceSummary(): string {
    const ws = this.workspace;
    const toRel = (p: string): string => {
      if (!ws) return p;
      try {
        const rel = path.relative(ws, p);
        return rel && !rel.startsWith('..') ? rel : p;
      } catch {
        return p;
      }
    };

    const inspectedList = Array.from(this.inspectedFiles).slice(-20).map(toRel);
    const turnModList = Array.from(this.turnModifiedFiles).map(toRel);
    const recentCmds = this.commandsRun.slice(-8).map(c => {
      const status = c.ok ? 'OK' : 'FAIL';
      const cmdShort = c.command.length > 80 ? `${c.command.slice(0, 77)}...` : c.command;
      return `[${status}] ${cmdShort}`;
    });

    const lines: string[] = [
      `=== Grounding Kanıt Özeti ===`,
      `İncelenen Dosyalar (${this.inspectedFiles.size}): ${inspectedList.length ? inspectedList.join(', ') : 'Yok'}`,
      `Bu Turda Değiştirilen Dosyalar (${this.turnModifiedFiles.size}): ${turnModList.length ? turnModList.join(', ') : 'Yok'}`,
      `Bu Turda Başarılı Komutlar (${this.turnCommandsRun.length}): ${this.turnCommandsRun.length ? this.turnCommandsRun.slice(-8).join(' | ') : 'Yok'}`,
      `Etkileşimli GUI/Tarayıcı İşlemleri (${this.turnGuiAndBrowserActions.length}): ${this.turnGuiAndBrowserActions.length ? this.turnGuiAndBrowserActions.slice(-8).join(' | ') : 'Yok'}`,
      `Son Komut Geçmişi: ${recentCmds.length ? recentCmds.join(' ; ') : 'Yok'}`,
      `Bu Turda Git Commit: ${this.turnGitCommits}`,
    ];

    if (this.warnings.length > 0) {
      lines.push(`Uyarılar: ${this.warnings.join(' | ')}`);
    }

    const summary = lines.join('\n');
    return summary.length > 1500 ? `${summary.slice(0, 1497)}...` : summary;
  }

  /**
   * Return grounding status for HUD and diagnostics.
   */
  public getStatus(): GroundingStatus {
    return {
      verified: this.warnings.length === 0,
      inspectedCount: this.inspectedFiles.size,
      modifiedCount: this.modifiedFiles.size,
      verifiedCommands: this.commandsRun.filter(c => c.ok).length,
      warnings: [...this.warnings],
    };
  }

  /**
   * Verify claims made in assistant response against ledger evidence and cross-file exports.
   */
  public verifyClaims(assistantResponse: string): ClaimAuditResult {
    return auditAssistantClaims(assistantResponse, this);
  }
}

/**
 * Global singleton grounding ledger.
 */
const groundingScope = new AsyncLocalStorage<GroundingLedger>();
let visibleGroundingLedger = new GroundingLedger();

export function withGroundingLedger<T>(workspace: string, publish: boolean, action: () => T): T {
  const ledger = new GroundingLedger(workspace);
  if (publish) visibleGroundingLedger = ledger;
  return groundingScope.run(ledger, action);
}

/** Legacy tools resolve this facade to their own invocation's ledger. */
export const globalGroundingLedger = new Proxy(new GroundingLedger(), {
  get(_fallback, key) {
    const ledger = groundingScope.getStore() ?? visibleGroundingLedger;
    const value = Reflect.get(ledger, key);
    return typeof value === 'function' ? value.bind(ledger) : value;
  },
  set(_fallback, key, value) {
    return Reflect.set(groundingScope.getStore() ?? visibleGroundingLedger, key, value);
  },
});

const workspaceLedgers = new Map<string, GroundingLedger>();

/**
 * Get or create a session-based GroundingLedger for a given workspace.
 */
export function getGroundingLedger(workspace?: string): GroundingLedger {
  if (!workspace) return globalGroundingLedger;
  const key = normalizePath(workspace);
  let ledger = workspaceLedgers.get(key);
  if (!ledger) {
    ledger = new GroundingLedger(workspace);
    workspaceLedgers.set(key, ledger);
  }
  return ledger;
}

/**
 * Standalone status helper for TUI HUD bar.
 */
export function getStatus(ledger: GroundingLedger = globalGroundingLedger): GroundingStatus {
  return ledger.getStatus();
}

/**
 * Standalone helper to record shell command in grounding ledger.
 */
export function recordShellCommand(
  commandOrRecord: string | CommandRunRecord,
  ok = true,
  outputSnippet = '',
  ledger: GroundingLedger = globalGroundingLedger
): void {
  ledger.recordShellCommand(commandOrRecord, ok, outputSnippet);
}

/**
 * Fast TypeScript lexer/scanner preserved for backward compatibility.
 */
export function scanTypeScript(content: string): {
  valid: boolean;
  error?: string;
  imports: string[];
} {
  const imports: string[] = [];
  const importRegex =
    /(?:import|export)\s+(?:type\s+)?(?:[\w\s{},*$_]+\s+from\s+)?['"](\.[^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  return { valid: true, imports };
}

/**
 * Validates file syntax, AST diagnostics, cross-file exports, and package grounding
 * deterministically in memory (before writing to disk).
 */
export async function validateFileSyntax(
  filePath: string,
  content: string,
  workspace?: string
): Promise<SyntaxValidationResult> {
  const ws = workspace ?? globalGroundingLedger.workspace ?? process.cwd();
  const result = await validateCodeAstAndGrounding(filePath, content, ws);
  if (result.warnings && result.warnings.length > 0) {
    for (const w of result.warnings) {
      globalGroundingLedger.addWarning(w);
    }
  }
  return {
    valid: result.valid,
    error: result.error,
    warnings: result.warnings,
  };
}

/**
 * Claim-Evidence Gate:
 * Audits model response text against the current turn's actual tool history and pending cross-file export debts.
 * Detects ungrounded claims about test passes, successful builds, git commits, file modifications, and unsatisfied cross-file export debts.
 */
export function auditAssistantClaims(
  responseText: string,
  ledger: GroundingLedger = globalGroundingLedger
): ClaimAuditResult {
  ledger.clearWarnings();

  const warnings: string[] = [];
  const text = responseText.toLowerCase();
  const turnCommands = ledger.getTurnCommandsRun();
  const turnModified = ledger.getTurnModifiedFiles();
  const turnCommits = ledger.getTurnGitCommits();
  const turnGuiActions = ledger.getTurnGuiAndBrowserActions();
  const hasGuiOrBrowser = turnGuiActions.length > 0;

  // 1. Audit Test Passing Claims against turn-scoped commands
  const testClaimPattern =
    /(?:tüm\s+)?testler(?:in\s+tamamı)?\s+(?:başarıyla\s+)?(?:geçti|tamamlandı|başarılı)|(?:all\s+)?tests?\s+(?:have\s+)?(?:passed|succeeded)|test\s+suite\s+passed|başarıyla\s+test\s+edildi/i;
  if (testClaimPattern.test(text)) {
    const testCmdRegex =
      /(?:npm\s+(?:run\s+)?test|pnpm\s+(?:run\s+)?test|yarn\s+test|vitest|jest|mocha|pytest|cargo\s+test|go\s+test|playwright|node\s+--test)/i;
    const hasSuccessfulTest = turnCommands.some(cmd => testCmdRegex.test(cmd));
    if (!hasSuccessfulTest) {
      warnings.push(
        'Anti-Halüsinasyon / Temelsiz Doğrulama Uyarısı: Asistan testlerin başarıyla geçtiğini iddia etti, ancak bu turda başarıyla tamamlanan herhangi bir test komutu (npm test, vitest, jest vb.) bulunamadı.'
      );
    }
  }

  // 2. Audit Build / Compilation / Typecheck Claims against turn-scoped commands
  const buildClaimPattern =
    /(?:(?:derleme|proje|kod|build|compile|typecheck)\s+(?:başarıyla\s+)?(?:geçti|tamamlandı|başarılı|tamam))|(?:başarıyla\s+)?(?:derlendi|derlenmiştir)|build\s+succeeded|compilation\s+succeeded|compiled\s+successfully|typecheck\s+passed/i;
  if (buildClaimPattern.test(text)) {
    const buildCmdRegex =
      /(?:tsc|npm\s+run\s+build|pnpm\s+build|yarn\s+build|vite\s+build|next\s+build|webpack|typecheck)/i;
    const hasSuccessfulBuild = turnCommands.some(cmd => buildCmdRegex.test(cmd));
    if (!hasSuccessfulBuild) {
      warnings.push(
        'Anti-Halüsinasyon / Temelsiz Doğrulama Uyarısı: Asistan derleme veya tip kontrolünün başarılı olduğunu iddia etti, ancak bu turda başarıyla tamamlanan herhangi bir derleme komutu (tsc, npm run build vb.) bulunamadı.'
      );
    }
  }

  // 3. Audit File Modification Claims & Citation Grounding against turnModifiedFiles
  const fileModClaimPattern =
    /(?:dosya(?:yı|ları|sını)?\s+(?:başarıyla\s+)?(?:güncelledim|oluşturdum|yazdım|değiştirdim|düzenledim|kaydettim|oluşturuldu|güncellendi|yazıldı))|(?:kod(?:u)?\s+(?:başarıyla\s+)?(?:değiştirdim|güncelledim|düzenledim|yazdım))|(?:değişiklikler(?:i)?\s+(?:başarıyla\s+)?(?:kaydettim|uyguladım|yaptım))|(?:(?:created|updated|modified|edited|wrote|patched)\s+the\s+file(?:s)?)|(?:file(?:s)?\s+(?:has\s+been|were)\s+(?:created|updated|modified|written|patched))/i;

  const citedFileModPattern =
    /[`'"']?([a-zA-Z0-9_\-./\\]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|py|md|html|css|yml|yaml))[`'"']?\s+(?:dosyasını\s+)?(?:güncelledim|oluşturdum|değiştirdim|düzenledim|yazdım|yamaladım|kaydettim|güncellendi|oluşturuldu|değiştirildi)|(?:updated|modified|created|edited|patched|wrote)\s+[`'"']?([a-zA-Z0-9_\-./\\]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|py|md|html|css|yml|yaml))[`'"']?/i;

  const citedMatch = responseText.match(citedFileModPattern);
  if (turnModified.size > 0) {
    for (const match of responseText.matchAll(new RegExp(citedFileModPattern.source, 'gi'))) {
      const cited = match[1] || match[2];
      if (cited && !turnModified.has(normalizePath(cited, ledger.workspace))) {
        warnings.push(`Citation Grounding: '${cited}' için bu turda doğrulanmış bir dosya değişikliği bulunamadı.`);
      }
    }
  }
  if ((fileModClaimPattern.test(text) || citedMatch) && turnModified.size === 0) {
    const citedFile = citedMatch ? citedMatch[1] || citedMatch[2] : undefined;
    if (citedFile) {
      warnings.push(
        `Anti-Halüsinasyon / Dosya Atıf Uyarısı (Citation Grounding): Asistan '${citedFile}' dosyasını güncellediğini/oluşturduğunu iddia etti, ancak bu turda hiçbir dosya yazma (file_write) veya yamalama (file_patch) işlemi gerçekleşmedi.`
      );
    } else if (!hasGuiOrBrowser) {
      warnings.push(
        'Anti-Halüsinasyon / Temelsiz Eylem Uyarısı: Asistan dosya oluşturulduğunu veya güncellendiğini iddia etti, ancak bu turda hiçbir dosya yazma (file_write) veya yamalama (file_patch) işlemi gerçekleşmedi.'
      );
    }
  }

  // 4. Audit Git Commit Claims against turnGitCommits and turnCommands
  const gitCommitClaimPattern =
    /(?:commit\s+(?:ettim|yapıldı|oluşturdum|atıldı)|committed\s+(?:the\s+)?changes)/i;
  if (gitCommitClaimPattern.test(text)) {
    const hasCommit =
      turnCommits > 0 || turnCommands.some(cmd => /(?:^|\s)git\s+commit\b/i.test(cmd));
    if (!hasCommit) {
      warnings.push(
        'Anti-Halüsinasyon / Temelsiz Eylem Uyarısı: Asistan git commit yapıldığını iddia etti, ancak bu turda başarılı bir commit işlemi bulunamadı.'
      );
    }
  }

  // 5. Audit Unsatisfied Cross-File Export Debts (PendingExportLedger)
  const pendingExports = getPendingCrossFileExports();
  const unsatisfiedDebts: Array<{ file: string; symbols: string[] }> = [];

  for (const [targetFile, symSet] of pendingExports.entries()) {
    if (symSet.size > 0) {
      unsatisfiedDebts.push({
        file: targetFile,
        symbols: Array.from(symSet),
      });
    }
  }

  if (unsatisfiedDebts.length > 0) {
    for (const debt of unsatisfiedDebts) {
      warnings.push(
        `Anti-Halüsinasyon / Karşılanmamış Çapraz Dosya Borcu: '${debt.file}' dosyasında henüz şu sembol(ler) export edilmedi: [${debt.symbols.join(', ')}].`
      );
    }
  }

  for (const warning of warnings) {
    ledger.addWarning(warning);
  }

  const verified = warnings.length === 0;
  const correctionPrompt = verified
    ? undefined
    : [
        'DİKKAT (Anti-Halüsinasyon Doğrulama Uyarısı):',
        'Yanıtınızda bu turdaki araç kanıtlarıyla doğrulanmayan iddialar veya eksik çapraz dosya exportları tespit edildi:',
        ...warnings.map(w => `- ${w}`),
        ...(unsatisfiedDebts.length > 0
          ? [
              '\nKarşılanmamış Çapraz Dosya Borçları:',
              ...unsatisfiedDebts.map(
                d => `- Hedef Dosya: '${d.file}' -> Export Edilmesi Gereken Semboller: [${d.symbols.join(', ')}]`
              ),
              'Lütfen bu turu tamamlamadan önce yukarıdaki dosyalara ilgili exportları ekleyin veya hatalı importları düzeltin!',
            ]
          : []),
        'Lütfen gerçek araç çalıştırma kanıtına dayanmayan iddialarda bulunmayın veya eksik işlemleri tamamlayın.',
      ].join('\n');

  return {
    verified,
    warnings,
    correctionPrompt,
  };
}

/**
 * Verifies assistant claims and cross-file export commitments against turn evidence.
 * Exported for standard agent verification pipelines.
 */
export function verifyClaims(
  assistantResponse: string,
  ledger: GroundingLedger = globalGroundingLedger
): ClaimAuditResult {
  return auditAssistantClaims(assistantResponse, ledger);
}
