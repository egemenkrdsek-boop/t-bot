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
export declare function normalizePath(filePath: string, workspace?: string): string;
/**
 * GroundingLedger tracks all file inspections, modifications, and command executions
 * during a session and per turn to strictly enforce Grounding and the Read-Before-Write invariant.
 */
export declare class GroundingLedger {
    inspectedFiles: Set<string>;
    modifiedFiles: Set<string>;
    commandsRun: CommandRunRecord[];
    gitCommits: number;
    warnings: string[];
    workspace?: string;
    private turnModifiedFiles;
    private turnCommandsRun;
    private turnGitCommits;
    constructor(workspace?: string);
    /**
     * Resets turn-scoped evidence sets and HUD warnings at the start of each new user request.
     */
    beginTurn(): void;
    /**
     * Alias for beginTurn(). Resets turn-scoped evidence and clears pending cross-file export debts.
     */
    resetTurn(): void;
    /**
     * Clears active grounding warnings.
     */
    clearWarnings(): void;
    /**
     * Returns files modified during the current turn.
     */
    getTurnModifiedFiles(): ReadonlySet<string>;
    /**
     * Returns commands executed successfully during the current turn.
     */
    getTurnCommandsRun(): readonly string[];
    /**
     * Returns git commit count during the current turn.
     */
    getTurnGitCommits(): number;
    /**
     * Mark a file as inspected (only via real inspection tools such as file_read or file_outline).
     */
    markFileInspected(filePath: string, workspace?: string): void;
    /**
     * Mark a file as modified (e.g. written, patched) in both session and current turn sets.
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
     * Clear all recorded states (session and turn) and pending cross-file export debts.
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
     * Accepts both 4-argument calls (toolName, args, resultString, isError/ok) and legacy
     * 3-argument calls (toolName, args, { ok, output }, workspace).
     */
    recordToolResult(toolName: string, args: Record<string, unknown>, result: {
        ok: boolean;
        output: string;
    } | string, isErrorOrOkOrWorkspace?: boolean | string, maybeWorkspace?: string): void;
    /**
     * Compact (~1,500 chars) evidence summary for Ultracode auditor / verification checks.
     */
    getTurnEvidenceSummary(): string;
    /**
     * Return grounding status for HUD and diagnostics.
     */
    getStatus(): GroundingStatus;
    /**
     * Verify claims made in assistant response against ledger evidence and cross-file exports.
     */
    verifyClaims(assistantResponse: string): ClaimAuditResult;
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
 * Fast TypeScript lexer/scanner preserved for backward compatibility.
 */
export declare function scanTypeScript(content: string): {
    valid: boolean;
    error?: string;
    imports: string[];
};
/**
 * Validates file syntax, AST diagnostics, cross-file exports, and package grounding
 * deterministically in memory (before writing to disk).
 */
export declare function validateFileSyntax(filePath: string, content: string, workspace?: string): Promise<SyntaxValidationResult>;
/**
 * Claim-Evidence Gate:
 * Audits model response text against the current turn's actual tool history and pending cross-file export debts.
 * Detects ungrounded claims about test passes, successful builds, git commits, file modifications, and unsatisfied cross-file export debts.
 */
export declare function auditAssistantClaims(responseText: string, ledger?: GroundingLedger): ClaimAuditResult;
/**
 * Verifies assistant claims and cross-file export commitments against turn evidence.
 * Exported for standard agent verification pipelines.
 */
export declare function verifyClaims(assistantResponse: string, ledger?: GroundingLedger): ClaimAuditResult;
