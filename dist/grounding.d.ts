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
export declare function normalizePath(filePath: string, workspace?: string): string;
/**
 * GroundingLedger tracks all file inspections, modifications, and command executions
 * during a session to strictly enforce Grounding and the Read-Before-Write invariant.
 */
export declare class GroundingLedger {
    inspectedFiles: Set<string>;
    modifiedFiles: Set<string>;
    commandsRun: CommandRunRecord[];
    gitCommits: number;
    warnings: string[];
    workspace?: string;
    constructor(workspace?: string);
    /**
     * Mark a file as inspected (e.g. read, outlined, searched).
     */
    markFileInspected(filePath: string, workspace?: string): void;
    /**
     * Mark a file as modified (e.g. written, patched).
     */
    markFileModified(filePath: string, workspace?: string): void;
    /**
     * Append a grounding warning.
     */
    addWarning(warning: string): void;
    /**
     * Record a shell command execution in the ledger.
     * If commandsRun exceeds 100 entries, removes oldest entries to prevent memory bloat.
     */
    recordShellCommand(commandOrRecord: string | CommandRunRecord, ok?: boolean, outputSnippet?: string): void;
    /**
     * Clear all recorded states.
     */
    clear(): void;
    /**
     * Read-Before-Write guard.
     * If a file already exists on disk and has NOT been inspected in this session
     * (and was not already modified in this session), reject modification with an anti-hallucination error.
     */
    verifyCanModifyFile(filePath: string, existsOnDisk: boolean, workspace?: string): {
        allowed: boolean;
        error?: string;
    };
    /**
     * Record tool execution results to maintain the grounding ledger.
     */
    recordToolResult(toolName: string, args: Record<string, unknown>, result: {
        ok: boolean;
        output: string;
    }, workspace?: string): void;
    /**
     * Return grounding status for HUD and diagnostics.
     */
    getStatus(): GroundingStatus;
}
/**
 * Global singleton grounding ledger.
 */
export declare const globalGroundingLedger: GroundingLedger;
/**
 * Get or create a session-based GroundingLedger for a given workspace.
 */
export declare function getGroundingLedger(workspace?: string): GroundingLedger;
/**
 * Standalone status helper for TUI HUD bar.
 */
export declare function getStatus(ledger?: GroundingLedger): GroundingStatus;
/**
 * Standalone helper to record shell command in grounding ledger.
 */
export declare function recordShellCommand(commandOrRecord: string | CommandRunRecord, ok?: boolean, outputSnippet?: string, ledger?: GroundingLedger): void;
/**
 * Fast TypeScript lexer/scanner that validates balanced parentheses, braces,
 * brackets, and string/template literals while collecting relative imports.
 */
export declare function scanTypeScript(content: string): {
    valid: boolean;
    error?: string;
    imports: string[];
};
/**
 * Validates file syntax and structure deterministically immediately after writing or patching.
 * Supports .json, .js, .mjs, .cjs, .ts, and .tsx files.
 */
export declare function validateFileSyntax(filePath: string, content: string, workspace?: string): Promise<SyntaxValidationResult>;
/**
 * Claim-Evidence Gate:
 * Audits model response text against the session's actual tool history.
 * Detects ungrounded claims about test passes, successful builds, and file modifications.
 */
export declare function auditAssistantClaims(responseText: string, ledger?: GroundingLedger): ClaimAuditResult;
