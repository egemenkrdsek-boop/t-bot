import path from 'node:path';
import { validateCodeAstAndGrounding } from './ast-validator.js';
/**
 * Normalizes a file path to a canonical form.
 * On Windows, normalizes case and separators to prevent casing hallucination mismatches.
 */
export function normalizePath(filePath, workspace) {
    if (!filePath || typeof filePath !== 'string')
        return '';
    const trimmed = filePath.trim();
    const resolved = workspace ? path.resolve(workspace, trimmed) : path.resolve(trimmed);
    const normalized = path.normalize(resolved);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
/**
 * GroundingLedger tracks all file inspections, modifications, and command executions
 * during a session and per turn to strictly enforce Grounding and the Read-Before-Write invariant.
 */
export class GroundingLedger {
    inspectedFiles = new Set();
    modifiedFiles = new Set();
    commandsRun = [];
    gitCommits = 0;
    warnings = [];
    workspace;
    turnModifiedFiles = new Set();
    turnCommandsRun = [];
    turnGitCommits = 0;
    constructor(workspace) {
        this.workspace = workspace;
    }
    /**
     * Resets turn-scoped evidence sets and HUD warnings at the start of each new user request.
     */
    beginTurn() {
        this.turnModifiedFiles.clear();
        this.turnCommandsRun = [];
        this.turnGitCommits = 0;
        this.warnings = [];
    }
    /**
     * Clears active grounding warnings.
     */
    clearWarnings() {
        this.warnings = [];
    }
    /**
     * Returns files modified during the current turn.
     */
    getTurnModifiedFiles() {
        return this.turnModifiedFiles;
    }
    /**
     * Returns commands executed successfully during the current turn.
     */
    getTurnCommandsRun() {
        return this.turnCommandsRun;
    }
    /**
     * Returns git commit count during the current turn.
     */
    getTurnGitCommits() {
        return this.turnGitCommits;
    }
    /**
     * Mark a file as inspected (only via real inspection tools such as file_read or file_outline).
     */
    markFileInspected(filePath, workspace) {
        const norm = normalizePath(filePath, workspace ?? this.workspace);
        if (norm) {
            this.inspectedFiles.add(norm);
        }
    }
    /**
     * Mark a file as modified (e.g. written, patched) in both session and current turn sets.
     */
    markFileModified(filePath, workspace) {
        const norm = normalizePath(filePath, workspace ?? this.workspace);
        if (norm) {
            this.modifiedFiles.add(norm);
            this.turnModifiedFiles.add(norm);
        }
    }
    /**
     * Append a grounding warning.
     */
    addWarning(warning) {
        if (!this.warnings.includes(warning)) {
            this.warnings.push(warning);
        }
    }
    /**
     * Record a shell command execution in the ledger.
     * If commandsRun exceeds 100 entries, removes oldest entries to prevent memory bloat.
     */
    recordShellCommand(commandOrRecord, ok = true, outputSnippet = '') {
        const record = typeof commandOrRecord === 'string'
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
     * Clear all recorded states (session and turn).
     */
    clear() {
        this.inspectedFiles.clear();
        this.modifiedFiles.clear();
        this.turnModifiedFiles.clear();
        this.commandsRun = [];
        this.turnCommandsRun = [];
        this.gitCommits = 0;
        this.turnGitCommits = 0;
        this.warnings = [];
    }
    /**
     * Read-Before-Write guard.
     * If a file already exists on disk and has NOT been inspected in this session
     * (and was not already modified in this session), reject modification with an anti-hallucination error.
     */
    verifyCanModifyFile(filePath, existsOnDisk, workspace) {
        const norm = normalizePath(filePath, workspace ?? this.workspace);
        if (existsOnDisk && !this.inspectedFiles.has(norm) && !this.modifiedFiles.has(norm)) {
            return {
                allowed: false,
                error: 'Anti-Halüsinasyon Engeli (Read-Before-Write): Mevcut bir dosyayı değiştirmeden önce içeriğini doğrulamak için file_read veya file_outline aracını kullanmalısınız.',
            };
        }
        return { allowed: true };
    }
    /**
     * Record tool execution results to maintain the grounding ledger.
     * Note: file_search is intentionally excluded from markFileInspected so files must be
     * genuinely read or outlined via file_read / file_outline before modification.
     */
    recordToolResult(toolName, args, result, workspace) {
        const ws = workspace ?? this.workspace;
        const filePath = typeof args.path === 'string'
            ? args.path
            : typeof args.filePath === 'string'
                ? args.filePath
                : '';
        if (toolName === 'file_read' || toolName === 'file_outline') {
            if (result.ok && filePath) {
                this.markFileInspected(filePath, ws);
            }
        }
        else if (toolName === 'file_write' || toolName === 'file_patch') {
            if (result.ok && filePath) {
                this.markFileModified(filePath, ws);
            }
        }
        else if (toolName === 'shell' ||
            toolName === 'run_command' ||
            toolName === 'execute_command') {
            const cmd = typeof args.command === 'string'
                ? args.command
                : typeof args.cmd === 'string'
                    ? args.cmd
                    : typeof args.CommandLine === 'string'
                        ? args.CommandLine
                        : '';
            const snippet = result.output ? result.output.slice(0, 300) : '';
            this.recordShellCommand({
                command: cmd,
                ok: result.ok,
                timestamp: Date.now(),
                outputSnippet: snippet,
            });
            if (result.ok && /(?:^|\s)git\s+commit\b/i.test(cmd)) {
                this.gitCommits++;
                this.turnGitCommits++;
            }
        }
        else if (toolName === 'git_commit') {
            if (result.ok) {
                this.gitCommits++;
                this.turnGitCommits++;
            }
        }
    }
    /**
     * Compact (~1,500 chars) evidence summary for Ultracode auditor / verification checks.
     */
    getTurnEvidenceSummary() {
        const ws = this.workspace;
        const toRel = (p) => {
            if (!ws)
                return p;
            try {
                const rel = path.relative(ws, p);
                return rel && !rel.startsWith('..') ? rel : p;
            }
            catch {
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
        const lines = [
            `=== Grounding Kanıt Özeti ===`,
            `İncelenen Dosyalar (${this.inspectedFiles.size}): ${inspectedList.length ? inspectedList.join(', ') : 'Yok'}`,
            `Bu Turda Değiştirilen Dosyalar (${this.turnModifiedFiles.size}): ${turnModList.length ? turnModList.join(', ') : 'Yok'}`,
            `Bu Turda Başarılı Komutlar (${this.turnCommandsRun.length}): ${this.turnCommandsRun.length ? this.turnCommandsRun.slice(-8).join(' | ') : 'Yok'}`,
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
    getStatus() {
        return {
            verified: this.warnings.length === 0,
            inspectedCount: this.inspectedFiles.size,
            modifiedCount: this.modifiedFiles.size,
            verifiedCommands: this.commandsRun.filter(c => c.ok).length,
            warnings: [...this.warnings],
        };
    }
}
/**
 * Global singleton grounding ledger.
 */
export const globalGroundingLedger = new GroundingLedger();
const workspaceLedgers = new Map();
/**
 * Get or create a session-based GroundingLedger for a given workspace.
 */
export function getGroundingLedger(workspace) {
    if (!workspace)
        return globalGroundingLedger;
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
export function getStatus(ledger = globalGroundingLedger) {
    return ledger.getStatus();
}
/**
 * Standalone helper to record shell command in grounding ledger.
 */
export function recordShellCommand(commandOrRecord, ok = true, outputSnippet = '', ledger = globalGroundingLedger) {
    ledger.recordShellCommand(commandOrRecord, ok, outputSnippet);
}
/**
 * Fast TypeScript lexer/scanner preserved for backward compatibility.
 */
export function scanTypeScript(content) {
    const imports = [];
    const importRegex = /(?:import|export)\s+(?:type\s+)?(?:[\w\s{},*$_]+\s+from\s+)?['"](\.[^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
        imports.push(match[1]);
    }
    return { valid: true, imports };
}
/**
 * Validates file syntax, AST diagnostics, cross-file exports, and package grounding
 * deterministically in memory (before writing to disk).
 */
export async function validateFileSyntax(filePath, content, workspace) {
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
 * Audits model response text against the current turn's actual tool history.
 * Detects ungrounded claims about test passes, successful builds, git commits, and file modifications.
 */
export function auditAssistantClaims(responseText, ledger = globalGroundingLedger) {
    ledger.clearWarnings();
    const warnings = [];
    const text = responseText.toLowerCase();
    const turnCommands = ledger.getTurnCommandsRun();
    const turnModified = ledger.getTurnModifiedFiles();
    const turnCommits = ledger.getTurnGitCommits();
    // 1. Audit Test Passing Claims against turn-scoped commands
    const testClaimPattern = /(?:tüm\s+)?testler(?:in\s+tamamı)?\s+(?:başarıyla\s+)?(?:geçti|tamamlandı|başarılı)|(?:all\s+)?tests?\s+(?:have\s+)?(?:passed|succeeded)|test\s+suite\s+passed|başarıyla\s+test\s+edildi/i;
    if (testClaimPattern.test(text)) {
        const testCmdRegex = /(?:npm\s+(?:run\s+)?test|pnpm\s+(?:run\s+)?test|yarn\s+test|vitest|jest|mocha|pytest|cargo\s+test|go\s+test|playwright|node\s+--test)/i;
        const hasSuccessfulTest = turnCommands.some(cmd => testCmdRegex.test(cmd));
        if (!hasSuccessfulTest) {
            warnings.push('Anti-Halüsinasyon / Temelsiz Doğrulama Uyarısı: Asistan testlerin başarıyla geçtiğini iddia etti, ancak bu turda başarıyla tamamlanan herhangi bir test komutu (npm test, vitest, jest vb.) bulunamadı.');
        }
    }
    // 2. Audit Build / Compilation / Typecheck Claims against turn-scoped commands
    const buildClaimPattern = /(?:(?:derleme|proje|kod|build|compile|typecheck)\s+(?:başarıyla\s+)?(?:geçti|tamamlandı|başarılı|tamam))|(?:başarıyla\s+)?(?:derlendi|derlenmiştir)|build\s+succeeded|compilation\s+succeeded|compiled\s+successfully|typecheck\s+passed/i;
    if (buildClaimPattern.test(text)) {
        const buildCmdRegex = /(?:tsc|npm\s+run\s+build|pnpm\s+build|yarn\s+build|vite\s+build|next\s+build|webpack|typecheck)/i;
        const hasSuccessfulBuild = turnCommands.some(cmd => buildCmdRegex.test(cmd));
        if (!hasSuccessfulBuild) {
            warnings.push('Anti-Halüsinasyon / Temelsiz Doğrulama Uyarısı: Asistan derleme veya tip kontrolünün başarılı olduğunu iddia etti, ancak bu turda başarıyla tamamlanan herhangi bir derleme komutu (tsc, npm run build vb.) bulunamadı.');
        }
    }
    // 3. Audit File Modification Claims & Citation Grounding against turnModifiedFiles
    const fileModClaimPattern = /(?:dosya(?:yı|ları|sını)?\s+(?:başarıyla\s+)?(?:güncelledim|oluşturdum|yazdım|değiştirdim|düzenledim|kaydettim|oluşturuldu|güncellendi|yazıldı))|(?:kod(?:u)?\s+(?:başarıyla\s+)?(?:değiştirdim|güncelledim|düzenledim|yazdım))|(?:değişiklikler(?:i)?\s+(?:başarıyla\s+)?(?:kaydettim|uyguladım|yaptım))|(?:(?:created|updated|modified|edited|wrote|patched)\s+the\s+file(?:s)?)|(?:file(?:s)?\s+(?:has\s+been|were)\s+(?:created|updated|modified|written|patched))/i;
    const citedFileModPattern = /[`'"']?([a-zA-Z0-9_\-./\\]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|py|md|html|css|yml|yaml))[`'"']?\s+(?:dosyasını\s+)?(?:güncelledim|oluşturdum|değiştirdim|düzenledim|yazdım|yamaladım|kaydettim|güncellendi|oluşturuldu|değiştirildi)|(?:updated|modified|created|edited|patched|wrote)\s+[`'"']?([a-zA-Z0-9_\-./\\]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|py|md|html|css|yml|yaml))[`'"']?/i;
    const citedMatch = responseText.match(citedFileModPattern);
    if ((fileModClaimPattern.test(text) || citedMatch) && turnModified.size === 0) {
        const citedFile = citedMatch ? citedMatch[1] || citedMatch[2] : undefined;
        warnings.push(citedFile
            ? `Anti-Halüsinasyon / Dosya Atıf Uyarısı (Citation Grounding): Asistan '${citedFile}' dosyasını güncellediğini/oluşturduğunu iddia etti, ancak bu turda hiçbir dosya yazma (file_write) veya yamalama (file_patch) işlemi gerçekleşmedi.`
            : 'Anti-Halüsinasyon / Temelsiz Eylem Uyarısı: Asistan dosya oluşturulduğunu veya güncellendiğini iddia etti, ancak bu turda hiçbir dosya yazma (file_write) veya yamalama (file_patch) işlemi gerçekleşmedi.');
    }
    // 4. Audit Git Commit Claims against turnGitCommits and turnCommands
    const gitCommitClaimPattern = /(?:commit\s+(?:ettim|yapıldı|oluşturdum|atıldı)|committed\s+(?:the\s+)?changes)/i;
    if (gitCommitClaimPattern.test(text)) {
        const hasCommit = turnCommits > 0 || turnCommands.some(cmd => /(?:^|\s)git\s+commit\b/i.test(cmd));
        if (!hasCommit) {
            warnings.push('Anti-Halüsinasyon / Temelsiz Eylem Uyarısı: Asistan git commit yapıldığını iddia etti, ancak bu turda başarılı bir commit işlemi bulunamadı.');
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
            'Yanıtınızda bu turdaki araç kanıtlarıyla doğrulanmayan iddialar tespit edildi:',
            ...warnings.map(w => `- ${w}`),
            'Lütfen gerçek araç çalıştırma kanıtına dayanmayan iddialarda bulunmayın veya eksik araç çağrılarını gerçekten çalıştırın.',
        ].join('\n');
    return {
        verified,
        warnings,
        correctionPrompt,
    };
}
//# sourceMappingURL=grounding.js.map