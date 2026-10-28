const READ_TOOLS = new Set([
    'file_read',
    'file_outline',
    'file_list',
    'file_glob',
    'file_search',
    'artifact_read',
    'git_status',
    'git_diff',
    'git_log',
    'memory_recall',
    'process_list',
    'process_output',
    'skill_list',
    'mcp_catalog',
    'web_search',
    'diagnostics',
    'checkpoint_list',
]);
const WRITE_TOOLS = new Set([
    'file_write',
    'file_patch',
    'checkpoint_restore',
    'git_add',
    'git_commit',
    'git_push',
    'skill_create',
    'process_write',
    'process_stop',
    'computer_batch',
    'browser_batch',
]);
const VERIFICATION_COMMAND = /(?:\b(?:test|tests|typecheck|type check|lint|verify|check|tsc|vitest|jest|pytest)\b)/iu;
const SUCCESS_CLAIM = /(?:\b(?:passed|passes?|success|successful|fixed|completed|done|verified|green|works?|working|başarılı|tamamlandı|düzeltildi|doğrulandı|geçti)\b)/iu;
const NEGATED_CLAIM = /\b(?:not|never|no|without|un)\s*(?:yet\s+)?(?:been\s+)?(?:verified|successful|success|fixed|completed|complete|done|passed|passing|green|working|works)\b|\b(?:doesn't|does not|didn't|did not|isn't|is not|aren't|are not)\s+(?:work|working|pass|passing)\b/giu;
function makesSuccessClaim(text) {
    return SUCCESS_CLAIM.test(String(text || '').replace(NEGATED_CLAIM, ' '));
}
export function createPhaseState() {
    return {
        phase: 'intake',
        reads: 0,
        writes: 0,
        verificationAttempts: 0,
        verificationPassed: false,
        sequence: 0,
        lastWriteSequence: 0,
        lastVerifySequence: 0,
        lastVerificationPassed: false,
        toolCalls: 0,
    };
}
export function isReadTool(name) {
    return READ_TOOLS.has(name);
}
export function isWriteTool(name) {
    return WRITE_TOOLS.has(name);
}
export function isVerificationCall(name, args) {
    if (name === 'project_verify' || name === 'diagnostics')
        return true;
    if (name === 'shell') {
        const command = typeof args.command === 'string' ? args.command : '';
        return VERIFICATION_COMMAND.test(command);
    }
    return false;
}
export function phaseLabel(phase) {
    switch (phase) {
        case 'intake': return 'Intake';
        case 'locate': return 'Locate';
        case 'plan': return 'Plan';
        case 'act': return 'Act';
        case 'verify': return 'Verify';
        case 'report': return 'Report';
    }
}
/**
 * A pre-execution gate. Returns an error string when the call must not run.
 * This is intentionally narrow: it blocks only violations that are provable
 * from the task kind and the current turn state.
 */
export function phaseViolation(state, call, contract, readOnly) {
    if (readOnly && !isReadTool(call.name)) {
        return 'Araç reddedildi: Bu ajan salt okunur araçlarla sınırlandırılmıştır.';
    }
    if (contract.kind === 'inspect' && isWriteTool(call.name)) {
        return 'Tool denied: this is an inspection-only task. Report findings instead of changing files.';
    }
    if (contract.kind === 'conversation' && isWriteTool(call.name)) {
        return 'Tool denied: the request is conversational, not an edit request.';
    }
    return undefined;
}
/** Update state only after a call actually produced a result. */
export function recordPhaseToolResult(state, call, ok) {
    state.toolCalls++;
    state.sequence++;
    const args = call.arguments ?? {};
    if (isVerificationCall(call.name, args)) {
        state.verificationAttempts++;
        state.verificationPassed = state.verificationPassed || ok;
        state.lastVerifySequence = state.sequence;
        state.lastVerificationPassed = ok;
        state.phase = 'verify';
        return;
    }
    if (isWriteTool(call.name)) {
        if (ok) {
            state.writes++;
            state.lastWriteSequence = state.sequence;
        }
        state.phase = 'act';
        return;
    }
    if (isReadTool(call.name)) {
        if (ok)
            state.reads++;
        if (state.writes === 0)
            state.phase = state.reads > 0 ? 'locate' : 'intake';
    }
}
/**
 * A final-answer gate. The agent may retry once with this correction. After
 * that retry the answer is allowed through so the user is never trapped in a
 * loop; the prompt still requires an explicit unverified statement.
 */
export function finalAnswerViolation(state, contract, finalText) {
    if (contract.requiresWrite && state.writes === 0) {
        return 'Completion gate: this is an edit task, but no file was changed. Make the requested change with file_patch or file_write, or state clearly why it cannot be made.';
    }
    if (contract.requiresVerification && state.writes > 0) {
        const verifiedAfterLastWrite = state.lastVerifySequence > state.lastWriteSequence;
        if (!verifiedAfterLastWrite) {
            return state.verificationAttempts > 0
                ? 'Completion gate: verification ran before the last file change, so it does not cover the current state. Run project_verify or diagnostics again after the final change.'
                : 'Completion gate: files were changed, but no verification was run. Call project_verify or diagnostics now. If neither is available, say the change is unverified.';
        }
        if (!state.lastVerificationPassed && makesSuccessClaim(finalText)) {
            return 'Completion gate: the latest verification did not pass. Do not claim success. Report the failing command and the remaining error, or fix it and verify again.';
        }
    }
    return undefined;
}
//# sourceMappingURL=phase-policy.js.map