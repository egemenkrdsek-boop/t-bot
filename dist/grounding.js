import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
 * during a session to strictly enforce Grounding and the Read-Before-Write invariant.
 */
export class GroundingLedger {
    inspectedFiles = new Set();
    modifiedFiles = new Set();
    commandsRun = [];
    gitCommits = 0;
    warnings = [];
    workspace;
    constructor(workspace) {
        this.workspace = workspace;
    }
    /**
     * Mark a file as inspected (e.g. read, outlined, searched).
     */
    markFileInspected(filePath, workspace) {
        const norm = normalizePath(filePath, workspace ?? this.workspace);
        if (norm) {
            this.inspectedFiles.add(norm);
        }
    }
    /**
     * Mark a file as modified (e.g. written, patched).
     */
    markFileModified(filePath, workspace) {
        const norm = normalizePath(filePath, workspace ?? this.workspace);
        if (norm) {
            this.modifiedFiles.add(norm);
        }
    }
    /**
     * Append a grounding warning.
     */
    addWarning(warning) {
        this.warnings.push(warning);
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
        while (this.commandsRun.length > 100) {
            this.commandsRun.shift();
        }
    }
    /**
     * Clear all recorded states.
     */
    clear() {
        this.inspectedFiles.clear();
        this.modifiedFiles.clear();
        this.commandsRun = [];
        this.gitCommits = 0;
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
                error: "Anti-Halüsinasyon Engeli (Read-Before-Write): Mevcut bir dosyayı değiştirmeden önce içeriğini doğrulamak için file_read veya file_outline aracını kullanmalısınız."
            };
        }
        return { allowed: true };
    }
    /**
     * Record tool execution results to maintain the grounding ledger.
     */
    recordToolResult(toolName, args, result, workspace) {
        const ws = workspace ?? this.workspace;
        const filePath = typeof args.path === 'string'
            ? args.path
            : (typeof args.filePath === 'string' ? args.filePath : '');
        if (toolName === 'file_read' || toolName === 'file_outline') {
            if (filePath) {
                this.markFileInspected(filePath, ws);
            }
        }
        else if (toolName === 'file_search') {
            if (filePath) {
                this.markFileInspected(filePath, ws);
            }
            if (result.output) {
                try {
                    const parsed = JSON.parse(result.output);
                    if (Array.isArray(parsed.matches)) {
                        for (const match of parsed.matches) {
                            const filePart = match.split(':')[0];
                            if (filePart)
                                this.markFileInspected(filePart, ws);
                        }
                    }
                }
                catch {
                    const lines = result.output.split(/\r?\n/);
                    for (const line of lines) {
                        const match = line.match(/^([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+):/);
                        if (match && match[1]) {
                            this.markFileInspected(match[1], ws);
                        }
                    }
                }
            }
        }
        else if (toolName === 'file_write' || toolName === 'file_patch') {
            if (result.ok && filePath) {
                this.markFileModified(filePath, ws);
            }
        }
        else if (toolName === 'shell' || toolName === 'run_command' || toolName === 'execute_command') {
            const cmd = typeof args.command === 'string'
                ? args.command
                : (typeof args.cmd === 'string' ? args.cmd : (typeof args.CommandLine === 'string' ? args.CommandLine : ''));
            const snippet = result.output ? result.output.slice(0, 300) : '';
            this.recordShellCommand({
                command: cmd,
                ok: result.ok,
                timestamp: Date.now(),
                outputSnippet: snippet
            });
            if (result.ok && /(?:^|\s)git\s+commit\b/i.test(cmd)) {
                this.gitCommits++;
            }
        }
        else if (toolName === 'git_commit') {
            if (result.ok) {
                this.gitCommits++;
            }
        }
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
            warnings: [...this.warnings]
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
 * Fast TypeScript lexer/scanner that validates balanced parentheses, braces,
 * brackets, and string/template literals while collecting relative imports.
 */
export function scanTypeScript(content) {
    let i = 0;
    let line = 1;
    let col = 1;
    const bracketStack = [];
    const modeStack = ['CODE'];
    const templateStartStack = [];
    const imports = [];
    let prevSignificantToken = '';
    const regexPreceders = new Set([
        '', '(', '[', '{', ';', ',', '=', '+', '-', '*', '/', '%', '&', '|', '^', '!', '~', '?', ':', '<', '>',
        'return', 'case', 'default', 'throw', 'yield', 'await', 'typeof', 'void', 'delete', 'instanceof', 'in', 'of', 'new'
    ]);
    while (i < content.length) {
        const currentMode = modeStack[modeStack.length - 1];
        if (currentMode === 'TEMPLATE') {
            const ch = content[i];
            if (ch === '\\') {
                i++;
                col++;
                if (i < content.length) {
                    if (content[i] === '\n') {
                        line++;
                        col = 1;
                    }
                    else {
                        col++;
                    }
                    i++;
                }
                continue;
            }
            if (ch === '`') {
                modeStack.pop();
                templateStartStack.pop();
                i++;
                col++;
                prevSignificantToken = '`';
                continue;
            }
            if (ch === '$' && i + 1 < content.length && content[i + 1] === '{') {
                const exprLine = line;
                const exprCol = col;
                i += 2;
                col += 2;
                bracketStack.push({ char: '{', line: exprLine, col: exprCol, isTemplateExpr: true });
                modeStack.push('CODE');
                prevSignificantToken = '{';
                continue;
            }
            if (ch === '\n') {
                line++;
                col = 1;
                i++;
            }
            else {
                col++;
                i++;
            }
            continue;
        }
        // Code mode
        const ch = content[i];
        // Whitespace
        if (ch === ' ' || ch === '\t' || ch === '\r') {
            col++;
            i++;
            continue;
        }
        if (ch === '\n') {
            line++;
            col = 1;
            i++;
            continue;
        }
        // Single-line comments
        if (ch === '/' && i + 1 < content.length && content[i + 1] === '/') {
            i += 2;
            col += 2;
            while (i < content.length && content[i] !== '\n') {
                i++;
                col++;
            }
            continue;
        }
        // Multi-line comments
        if (ch === '/' && i + 1 < content.length && content[i + 1] === '*') {
            const startLine = line;
            const startCol = col;
            i += 2;
            col += 2;
            let closed = false;
            while (i < content.length) {
                if (content[i] === '*' && i + 1 < content.length && content[i + 1] === '/') {
                    i += 2;
                    col += 2;
                    closed = true;
                    break;
                }
                if (content[i] === '\n') {
                    line++;
                    col = 1;
                    i++;
                }
                else {
                    col++;
                    i++;
                }
            }
            if (!closed) {
                return {
                    valid: false,
                    error: `TypeScript Sözdizimi Hatası: Kapatılmamış çok satırlı yorum '/*' (satır ${startLine}, sütun ${startCol}).`,
                    imports
                };
            }
            continue;
        }
        // Strings: single and double quotes
        if (ch === "'" || ch === '"') {
            const quote = ch;
            const startLine = line;
            const startCol = col;
            i++;
            col++;
            let strVal = '';
            let closed = false;
            while (i < content.length) {
                const c = content[i];
                if (c === '\\') {
                    i++;
                    col++;
                    if (i < content.length) {
                        const esc = content[i];
                        strVal += esc;
                        if (esc === '\n') {
                            line++;
                            col = 1;
                        }
                        else {
                            col++;
                        }
                        i++;
                    }
                    continue;
                }
                if (c === quote) {
                    i++;
                    col++;
                    closed = true;
                    break;
                }
                if (c === '\n') {
                    return {
                        valid: false,
                        error: `TypeScript Sözdizimi Hatası: String içinde satır sonu hatası (satır ${line}, sütun ${col}).`,
                        imports
                    };
                }
                strVal += c;
                col++;
                i++;
            }
            if (!closed) {
                return {
                    valid: false,
                    error: `TypeScript Sözdizimi Hatası: Kapatılmamış string literal ${quote} (satır ${startLine}, sütun ${startCol}).`,
                    imports
                };
            }
            if (prevSignificantToken === 'from' || prevSignificantToken === 'import' || prevSignificantToken === 'require') {
                if (strVal.startsWith('.')) {
                    imports.push(strVal);
                }
            }
            prevSignificantToken = 'STRING';
            continue;
        }
        // Template literal
        if (ch === '`') {
            templateStartStack.push({ line, col });
            modeStack.push('TEMPLATE');
            i++;
            col++;
            continue;
        }
        // Regex or division
        if (ch === '/') {
            if (regexPreceders.has(prevSignificantToken)) {
                const startLine = line;
                const startCol = col;
                i++;
                col++;
                let inCharClass = false;
                let closed = false;
                while (i < content.length) {
                    const rc = content[i];
                    if (rc === '\\') {
                        i++;
                        col++;
                        if (i < content.length) {
                            if (content[i] === '\n')
                                break;
                            col++;
                            i++;
                        }
                        continue;
                    }
                    if (rc === '[') {
                        inCharClass = true;
                    }
                    else if (rc === ']') {
                        inCharClass = false;
                    }
                    else if (rc === '/' && !inCharClass) {
                        i++;
                        col++;
                        closed = true;
                        while (i < content.length && /[a-z]/i.test(content[i])) {
                            i++;
                            col++;
                        }
                        break;
                    }
                    else if (rc === '\n') {
                        break;
                    }
                    i++;
                    col++;
                }
                if (!closed) {
                    return {
                        valid: false,
                        error: `TypeScript Sözdizimi Hatası: Kapatılmamış RegExp literali '/' (satır ${startLine}, sütun ${startCol}).`,
                        imports
                    };
                }
                prevSignificantToken = 'REGEX';
                continue;
            }
            else {
                i++;
                col++;
                if (i < content.length && content[i] === '=') {
                    i++;
                    col++;
                }
                prevSignificantToken = '/';
                continue;
            }
        }
        // Parentheses, brackets, and braces
        if (ch === '(' || ch === '[' || ch === '{') {
            bracketStack.push({ char: ch, line, col });
            prevSignificantToken = ch;
            i++;
            col++;
            continue;
        }
        if (ch === ')') {
            if (bracketStack.length === 0) {
                return {
                    valid: false,
                    error: `TypeScript Sözdizimi Hatası: Beklenmeyen kapatma parantezi ')' (satır ${line}, sütun ${col}).`,
                    imports
                };
            }
            const top = bracketStack.pop();
            if (top.char !== '(') {
                return {
                    valid: false,
                    error: `TypeScript Sözdizimi Hatası: Uyumsuz parantez: '${top.char}' (satır ${top.line}, sütun ${top.col}) açıldı ancak ')' ile kapatıldı (satır ${line}, sütun ${col}).`,
                    imports
                };
            }
            prevSignificantToken = ')';
            i++;
            col++;
            continue;
        }
        if (ch === ']') {
            if (bracketStack.length === 0) {
                return {
                    valid: false,
                    error: `TypeScript Sözdizimi Hatası: Beklenmeyen kapatma köşeli parantezi ']' (satır ${line}, sütun ${col}).`,
                    imports
                };
            }
            const top = bracketStack.pop();
            if (top.char !== '[') {
                return {
                    valid: false,
                    error: `TypeScript Sözdizimi Hatası: Uyumsuz parantez: '${top.char}' (satır ${top.line}, sütun ${top.col}) açıldı ancak ']' ile kapatıldı (satır ${line}, sütun ${col}).`,
                    imports
                };
            }
            prevSignificantToken = ']';
            i++;
            col++;
            continue;
        }
        if (ch === '}') {
            if (bracketStack.length === 0) {
                return {
                    valid: false,
                    error: `TypeScript Sözdizimi Hatası: Beklenmeyen kapatma süslü parantezi '}' (satır ${line}, sütun ${col}).`,
                    imports
                };
            }
            const top = bracketStack.pop();
            if (top.char !== '{') {
                return {
                    valid: false,
                    error: `TypeScript Sözdizimi Hatası: Uyumsuz parantez: '${top.char}' (satır ${top.line}, sütun ${top.col}) açıldı ancak '}' ile kapatıldı (satır ${line}, sütun ${col}).`,
                    imports
                };
            }
            if (top.isTemplateExpr) {
                modeStack.pop();
            }
            prevSignificantToken = '}';
            i++;
            col++;
            continue;
        }
        // Identifiers and keywords
        if (/[a-zA-Z_$]/.test(ch)) {
            let word = '';
            while (i < content.length && /[a-zA-Z0-9_$]/.test(content[i])) {
                word += content[i];
                i++;
                col++;
            }
            prevSignificantToken = word;
            continue;
        }
        // Other characters/operators
        prevSignificantToken = ch;
        i++;
        col++;
    }
    if (templateStartStack.length > 0) {
        const top = templateStartStack[templateStartStack.length - 1];
        return {
            valid: false,
            error: `TypeScript Sözdizimi Hatası: Kapatılmamış template literal '\`' (satır ${top.line}, sütun ${top.col}).`,
            imports
        };
    }
    if (bracketStack.length > 0) {
        const top = bracketStack[bracketStack.length - 1];
        return {
            valid: false,
            error: `TypeScript Sözdizimi Hatası: Kapatılmamış parantez '${top.char}' (satır ${top.line}, sütun ${top.col}).`,
            imports
        };
    }
    return { valid: true, imports };
}
/**
 * Checks whether an imported relative specifier resolves to an existing file on disk.
 */
function checkImportOnDisk(fileDir, specifier) {
    try {
        const targetBase = path.resolve(fileDir, specifier);
        if (fs.existsSync(targetBase) && fs.statSync(targetBase).isFile()) {
            return true;
        }
        const tsExtensions = ['.ts', '.tsx', '.d.ts', '.js', '.mjs', '.cjs', '.json'];
        // If specifier ends with .js, also check .ts, .tsx, .d.ts or directory index
        if (specifier.endsWith('.js')) {
            const baseNoExt = targetBase.slice(0, -3);
            for (const ext of ['.ts', '.tsx', '.d.ts', '.js']) {
                const candidate = baseNoExt + ext;
                if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
                    return true;
            }
            for (const indexExt of ['.ts', '.tsx', '.js']) {
                const candidate = path.join(baseNoExt, 'index' + indexExt);
                if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
                    return true;
            }
        }
        else if (specifier.endsWith('.mjs')) {
            const baseNoExt = targetBase.slice(0, -4);
            for (const ext of ['.mts', '.mjs', '.ts']) {
                const candidate = baseNoExt + ext;
                if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
                    return true;
            }
        }
        else if (specifier.endsWith('.cjs')) {
            const baseNoExt = targetBase.slice(0, -4);
            for (const ext of ['.cts', '.cjs', '.js']) {
                const candidate = baseNoExt + ext;
                if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
                    return true;
            }
        }
        // Check with standard extensions if not already present
        for (const ext of tsExtensions) {
            const candidate = targetBase + ext;
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
                return true;
        }
        // Check directory index
        for (const ext of tsExtensions) {
            const candidate = path.join(targetBase, 'index' + ext);
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
                return true;
        }
        // Check package.json in directory
        const pkgJson = path.join(targetBase, 'package.json');
        if (fs.existsSync(pkgJson) && fs.statSync(pkgJson).isFile())
            return true;
        return false;
    }
    catch {
        return false;
    }
}
/**
 * Validates file syntax and structure deterministically immediately after writing or patching.
 * Supports .json, .js, .mjs, .cjs, .ts, and .tsx files.
 */
export async function validateFileSyntax(filePath, content, workspace) {
    const ext = path.extname(filePath).toLowerCase();
    // 1. JSON Validation
    if (ext === '.json') {
        try {
            JSON.parse(content);
            return { valid: true };
        }
        catch (err) {
            return {
                valid: false,
                error: `JSON Sözdizimi Hatası: ${err instanceof Error ? err.message : String(err)}`
            };
        }
    }
    // 2. JavaScript Validation via Node.js --check
    if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
        const fullPath = workspace ? path.resolve(workspace, filePath) : path.resolve(filePath);
        let checkTarget = fullPath;
        let tempCreated = false;
        try {
            if (!fs.existsSync(fullPath) || fs.readFileSync(fullPath, 'utf8') !== content) {
                const dir = fs.existsSync(path.dirname(fullPath))
                    ? path.dirname(fullPath)
                    : (workspace && fs.existsSync(workspace) ? workspace : os.tmpdir());
                checkTarget = path.join(dir, `.tbot_check_${randomUUID().slice(0, 8)}${ext}`);
                fs.writeFileSync(checkTarget, content, 'utf8');
                tempCreated = true;
            }
            await new Promise((resolve, reject) => {
                execFile(process.execPath, ['--check', checkTarget], { timeout: 5000 }, (error, _stdout, stderr) => {
                    if (error) {
                        const errOutput = (stderr || error.message || '').trim();
                        reject(new Error(errOutput));
                    }
                    else {
                        resolve();
                    }
                });
            });
            return { valid: true };
        }
        catch (err) {
            let rawError = err instanceof Error ? err.message : String(err);
            if (tempCreated) {
                rawError = rawError.replaceAll(checkTarget, filePath);
            }
            return {
                valid: false,
                error: `JavaScript Sözdizimi Hatası:\n${rawError}`
            };
        }
        finally {
            if (tempCreated) {
                try {
                    fs.unlinkSync(checkTarget);
                }
                catch { /* ignore */ }
            }
        }
    }
    // 3. TypeScript & TSX Validation
    if (ext === '.ts' || ext === '.tsx') {
        const scanResult = scanTypeScript(content);
        if (!scanResult.valid) {
            return { valid: false, error: scanResult.error };
        }
        // Also collect regex-based relative imports as backup to ensure complete coverage
        const allImports = new Set(scanResult.imports);
        const importRegex1 = /(?:import|export)\s+(?:type\s+)?(?:[\w\s{},*$_]+\s+from\s+)?['"](\.[^'"]+)['"]/g;
        const importRegex2 = /(?:import|require)\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
        let match;
        while ((match = importRegex1.exec(content)) !== null) {
            allImports.add(match[1]);
        }
        while ((match = importRegex2.exec(content)) !== null) {
            allImports.add(match[1]);
        }
        // Check imports against disk if file location or workspace is available
        const fullPath = workspace ? path.resolve(workspace, filePath) : path.resolve(filePath);
        const fileDir = path.dirname(fullPath);
        if (fs.existsSync(fileDir)) {
            for (const imp of allImports) {
                if (!checkImportOnDisk(fileDir, imp)) {
                    return {
                        valid: false,
                        error: `Halüsinasyon Import Uyarısı: '${imp}' göreli import hedefi diskte bulunamadı. Lütfen var olmayan bir dosya yolunu import etmeyin.`
                    };
                }
            }
        }
        return { valid: true };
    }
    return { valid: true };
}
/**
 * Claim-Evidence Gate:
 * Audits model response text against the session's actual tool history.
 * Detects ungrounded claims about test passes, successful builds, and file modifications.
 */
export function auditAssistantClaims(responseText, ledger = globalGroundingLedger) {
    const warnings = [];
    const text = responseText.toLowerCase();
    // 1. Audit Test Passing Claims
    const testClaimPattern = /(?:tüm\s+)?testler(?:in\s+tamamı)?\s+(?:başarıyla\s+)?(?:geçti|tamamlandı|başarılı)|(?:all\s+)?tests?\s+(?:have\s+)?(?:passed|succeeded)|test\s+suite\s+passed|başarıyla\s+test\s+edildi/i;
    if (testClaimPattern.test(text)) {
        const hasSuccessfulTest = ledger.commandsRun.some(c => c.ok && /(?:npm\s+(?:run\s+)?test|pnpm\s+(?:run\s+)?test|yarn\s+test|vitest|jest|mocha|pytest|cargo\s+test|go\s+test|playwright|node\s+--test)/i.test(c.command));
        if (!hasSuccessfulTest) {
            warnings.push('Anti-Halüsinasyon / Temelsiz Doğrulama Uyarısı: Asistan testlerin başarıyla geçtiğini iddia etti, ancak oturum geçmişinde başarıyla tamamlanan herhangi bir test komutu (npm test, vitest, jest vb.) bulunamadı.');
        }
    }
    // 2. Audit Build / Compilation / Typecheck Claims
    const buildClaimPattern = /(?:(?:derleme|proje|kod|build|compile|typecheck)\s+(?:başarıyla\s+)?(?:geçti|tamamlandı|başarılı|tamam))|(?:başarıyla\s+)?(?:derlendi|derlenmiştir)|build\s+succeeded|compilation\s+succeeded|compiled\s+successfully|typecheck\s+passed/i;
    if (buildClaimPattern.test(text)) {
        const hasSuccessfulBuild = ledger.commandsRun.some(c => c.ok && /(?:tsc|npm\s+run\s+build|pnpm\s+build|yarn\s+build|vite\s+build|next\s+build|webpack|typecheck)/i.test(c.command));
        if (!hasSuccessfulBuild) {
            warnings.push('Anti-Halüsinasyon / Temelsiz Doğrulama Uyarısı: Asistan derleme veya tip kontrolünün başarılı olduğunu iddia etti, ancak oturum geçmişinde başarıyla tamamlanan herhangi bir derleme komutu (tsc, npm run build vb.) bulunamadı.');
        }
    }
    // 3. Audit File Modification Claims
    const fileModClaimPattern = /(?:dosya(?:yı|ları)?\s+(?:başarıyla\s+)?(?:güncelledim|oluşturdum|yazdım|değiştirdim|düzenledim|kaydettim|oluşturuldu|güncellendi|yazıldı))|(?:kod(?:u)?\s+(?:başarıyla\s+)?(?:değiştirdim|güncelledim|düzenledim|yazdım))|(?:değişiklikler(?:i)?\s+(?:başarıyla\s+)?(?:kaydettim|uyguladım|yaptım))|(?:(?:created|updated|modified|edited|wrote|patched)\s+the\s+file(?:s)?)|(?:file(?:s)?\s+(?:has\s+been|were)\s+(?:created|updated|modified|written|patched))/i;
    if (fileModClaimPattern.test(text)) {
        if (ledger.modifiedFiles.size === 0) {
            warnings.push('Anti-Halüsinasyon / Temelsiz Eylem Uyarısı: Asistan dosya oluşturulduğunu veya güncellendiğini iddia etti, ancak oturum geçmişinde hiçbir dosya yazma (file_write) veya yamalama (file_patch) işlemi gerçekleşmedi.');
        }
    }
    // 4. Audit Git Commit Claims
    const gitCommitClaimPattern = /(?:commit\s+(?:ettim|yapıldı|oluşturdum|atıldı)|committed\s+(?:the\s+)?changes)/i;
    if (gitCommitClaimPattern.test(text)) {
        const hasCommit = ledger.gitCommits > 0 || ledger.commandsRun.some(c => c.ok && /git\s+commit/i.test(c.command));
        if (!hasCommit) {
            warnings.push('Anti-Halüsinasyon / Temelsiz Eylem Uyarısı: Asistan git commit yapıldığını iddia etti, ancak oturum geçmişinde başarılı bir commit işlemi bulunamadı.');
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
            'Yanıtınızda kanıtlanmamış iddialar tespit edildi:',
            ...warnings.map(w => `- ${w}`),
            'Lütfen oturum geçmişine dayanmayan hayali iddialarda bulunmayın ve doğrulanmamış sonuçları teyit edilmiş gibi sunmayın.'
        ].join('\n');
    return {
        verified,
        warnings,
        correctionPrompt
    };
}
//# sourceMappingURL=grounding.js.map