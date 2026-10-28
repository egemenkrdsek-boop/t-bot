/**
 * Deterministic task contract derived from the current user request.
 *
 * The contract records the few facts the turn loop can enforce: whether the
 * user asked for a change, whether verification is expected, and which risk
 * class the task belongs to. Intent comes from `request-brief.ts` so the same
 * lexical rules are used everywhere.
 *
 * Policy: fail-open for write permission, fail-closed for security. Only an
 * explicit no-write boundary, a read-only policy/skill, or a clear question
 * blocks writing. Ambiguous commands become `mixed` with write + verification.
 */
import { HIGH_RISK } from './lexicon.js';
import { deriveBrief } from './request-brief.js';
function cleanObjective(input) {
    return String(input || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 400);
}
function acceptanceFor(kind, requiresWrite, requiresVerification) {
    const acceptance = [];
    if (requiresWrite) {
        acceptance.push('Files are changed with file_patch or file_write, and the final response names the exact paths and changes.');
    }
    if (requiresVerification) {
        acceptance.push('After the last write, project_verify or diagnostics is run; if neither is available, the response says the change is unverified.');
    }
    if (kind === 'browser' || kind === 'computer' || kind === 'mixed') {
        acceptance.push('A post-action observation (URL, title, DOM, screenshot, or window state) confirms the intended state before success is claimed.');
    }
    if (kind === 'inspect') {
        acceptance.push('Findings cite concrete file paths or symbols and separate verified facts from uncertainty.');
    }
    acceptance.push('Every success claim is backed by a tool result; user boundaries are respected without exception.');
    return acceptance;
}
/**
 * Build the contract for one turn. `readOnly` and an explicit no-write
 * boundary always win: an investigator cannot be given a write contract.
 */
export function buildTaskContract(message, options = {}) {
    const brief = deriveBrief(message);
    const objective = cleanObjective(message);
    const weakMode = options.weakMode === true;
    // Security is fail-closed: an explicit boundary always produces an
    // inspection contract, regardless of any write verb in the same message.
    if (options.readOnly || brief.noWrite) {
        return {
            objective,
            kind: 'inspect',
            risk: brief.risk,
            requiresWrite: false,
            requiresVerification: options.readOnly ? false : brief.verificationHint,
            weakMode,
            acceptance: acceptanceFor('inspect', false, options.readOnly ? false : brief.verificationHint),
        };
    }
    // "continue" / "devam et" inherits the previous contract when one exists.
    if (brief.continuation && options.previousContract) {
        return {
            ...options.previousContract,
            objective: options.previousContract.objective || objective,
            weakMode,
        };
    }
    // A command with no recognized action and no verification hint is
    // ambiguous. Fail-open is deliberately narrow: short approvals stay chat,
    // and a single unknown word does not demand a file change. Work-like
    // objects (file/test/code/url/window) or high-risk verbs keep the old
    // "allow writing" behavior.
    const rawText = String(message || '').trim();
    const tokenCount = rawText.split(/\s+/u).filter(Boolean).length;
    const highRisk = HIGH_RISK.test(rawText);
    const workLike = brief.objects.length > 0 || highRisk;
    // Browser/computer actions are not file writes. Only an explicit file-like
    // target makes a write verb a file-change contract.
    const fileTarget = brief.objects.some(object => ['file', 'code', 'docs', 'config'].includes(object)) ||
        /(?:\.(?:ts|tsx|js|jsx|json|md|py|css|html|ya?ml)\b|src[\\/]|\b(?:file|files|dosya|dosyaya|kod|kodu)\b)/iu.test(rawText);
    const browserOrComputer = brief.browser || brief.computer;
    const fileWriteIntent = brief.writeIntent && (!browserOrComputer || fileTarget);
    // A real question ("kaç dosya var?") never becomes a write contract unless
    // the same message contains an explicit file-edit order.
    const questionOnly = brief.hasQuestion && !fileWriteIntent;
    const ambiguousCommand = brief.speechAct === 'command' &&
        !fileWriteIntent && !brief.inspection && !brief.browser && !brief.computer &&
        !brief.operation && !brief.meta && !questionOnly &&
        (highRisk || (tokenCount >= 2 && workLike));
    const inheritedWrite = brief.continuation && !options.previousContract;
    const requiresWrite = !questionOnly && (fileWriteIntent || inheritedWrite || (ambiguousCommand && !brief.verificationHint));
    let kind;
    if (fileWriteIntent) {
        kind = brief.browser || brief.computer || brief.inspection ? 'mixed' : 'edit';
    }
    else if (brief.inspection) {
        kind = 'inspect';
    }
    else if (brief.browser && brief.computer) {
        kind = 'mixed';
    }
    else if (brief.browser) {
        kind = 'browser';
    }
    else if (brief.computer) {
        kind = 'computer';
    }
    else if (brief.speechAct === 'command' && brief.verificationHint &&
        !/\b(?:start|serve|stop|launch|server|başlat|durdur|sunucu)\b/iu.test(rawText)) {
        // "run the tests" verifies; it does not ask for a file change. A real
        // start/stop/serve command keeps the operation contract below.
        kind = 'inspect';
    }
    else if (brief.operation) {
        // Start/run/stop/serve needs shell/process tools but implies no file change.
        kind = 'mixed';
    }
    else if (ambiguousCommand || inheritedWrite) {
        kind = 'mixed';
    }
    else if (brief.meta) {
        // "introduce yourself", "tanıt", "anlat": conversation, never a work order.
        kind = 'conversation';
    }
    else {
        kind = 'conversation';
    }
    const requiresVerification = requiresWrite || brief.verificationHint;
    const risk = HIGH_RISK.test(String(message || '')) ? 'high' : requiresWrite ? 'medium' : 'low';
    return {
        objective,
        kind,
        risk,
        requiresWrite,
        requiresVerification,
        weakMode,
        acceptance: acceptanceFor(kind, requiresWrite, requiresVerification),
    };
}
/** Compact, cache-friendly contract block for the system prompt. */
export function taskContractPrompt(contract) {
    const lines = [
        '[TASK CONTRACT]',
        `Objective: ${contract.objective || '(not stated)'}`,
        `Kind: ${contract.kind} | Risk: ${contract.risk} | Write: ${contract.requiresWrite ? 'yes' : 'no'} | Verification: ${contract.requiresVerification ? 'required' : 'not required'}`,
        'Acceptance:',
        ...contract.acceptance.map(item => `- ${item}`),
    ];
    if (contract.weakMode) {
        lines.push('Weak-model rule: exactly one tool call per turn. Read the result before the next call. Do not attempt a large refactor in one action.');
    }
    return lines.join('\n');
}
//# sourceMappingURL=task-contract.js.map