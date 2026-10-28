/**
 * Deterministic task contract derived from the current user request.
 *
 * This is deliberately conservative. It does not try to understand every
 * sentence; it records the few facts the turn loop can enforce: whether the
 * user asked for a change, whether verification is expected, and which risk
 * class the task belongs to. Ambiguous language stays with the model.
 */

export type TaskKind = 'conversation' | 'inspect' | 'edit' | 'browser' | 'computer' | 'mixed';
export type TaskRisk = 'low' | 'medium' | 'high';

export interface TaskContract {
  objective: string;
  kind: TaskKind;
  risk: TaskRisk;
  /** A file-changing outcome is expected. */
  requiresWrite: boolean;
  /** A declared verification command or diagnostics check is expected after the last write. */
  requiresVerification: boolean;
  /** Small-model profile: one action per turn and a narrow schema. */
  weakMode: boolean;
  /** Concrete, checkable outcomes shown to the model and the user. */
  acceptance: string[];
}

export interface TaskContractOptions {
  weakMode?: boolean;
  readOnly?: boolean;
  hasImages?: boolean;
}

const EDIT_INTENT = /(?:\b(?:fix|implement|add|create|write|edit|patch|refactor|rename|remove|delete|update|change|migrate|repair|replace|insert|append|generate|scaffold|build|ship|düzelt|ekle|oluştur|yaz|düzenle|yamala|yeniden adlandır|kaldır|sil|güncelle|değiştir|taşı|onar|tamamla|uygula)\b)/iu;
const VERIFY_INTENT = /(?:\b(?:test|tests|typecheck|type check|lint|verify|validation|check|diagnose|diagnostics|doğrula|denetle|test et|kontrol et|teşhis)\b)/iu;
const INSPECT_INTENT = /(?:\b(?:review|inspect|analy[sz]e|explain|summari[sz]e|audit|read|find|locate|search|investigate|incele|analiz et|açıkla|özetle|denetle|bul|ara|araştır)\b)/iu;
const BROWSER_INTENT = /(?:\b(?:browser|tarayıcı|playwright|web ?site|web ?sayfa|url|http|localhost|scrape|dom|form|click|tıkla|navigate|gezin)\b)/iu;
const COMPUTER_INTENT = /(?:\b(?:computer|desktop|masaüstü|ekran|screenshot|ekran görüntüsü|mouse|fare|klavye|keyboard|window|pencere|uia|gui|arayüz)\b)/iu;
const HIGH_RISK = /(?:\b(?:delete|remove|drop|truncate|force|push|deploy|publish|release|migration|credential|secret|password|token|rm -rf|format|sil|kaldır|zorla|yayınla|gönder|kimlik bilgisi|parola)\b)/iu;
const QUESTION_START = /^\s*(?:why|how|what|when|where|who|which|is|are|was|were|does|did|should|would|explain|review|analy[sz]e|summari[sz]e|audit|inspect|tell me|neden|nasıl|ne|hangi|açıkla|incele|analiz et|özetle)\b/iu;
const REQUEST_PREFIX = /^\s*(?:please|lütfen|can you|could you|would you|will you|benim için|bana)\b/iu;
const EDIT_CONTINUATION = /(?:\b(?:and|then|also|sonra|ve|ayrıca)\s+(?:fix|implement|add|create|update|change|refactor|düzelt|ekle|oluştur|güncelle|değiştir)\b)/iu;

function cleanObjective(input: string): string {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}

/**
 * Build the contract for one turn. `readOnly` always wins: an investigator
 * cannot be given a write contract.
 */
export function buildTaskContract(
  message: string,
  options: TaskContractOptions = {}
): TaskContract {
  const text = String(message || '');
  const objective = cleanObjective(text);
  const hasEdit = EDIT_INTENT.test(text);
  const isQuestion = QUESTION_START.test(text) && !REQUEST_PREFIX.test(text);
  const isEditContinuation = EDIT_CONTINUATION.test(text);
  const requiresWrite = !options.readOnly && hasEdit && (!isQuestion || isEditContinuation);
  const browser = BROWSER_INTENT.test(text);
  const computer = COMPUTER_INTENT.test(text);
  const inspect = INSPECT_INTENT.test(text);

  let kind: TaskKind;
  if (options.readOnly) kind = 'inspect';
  else if (requiresWrite && (browser || computer)) kind = 'mixed';
  else if (requiresWrite) kind = 'edit';
  else if (browser && computer) kind = 'mixed';
  else if (browser) kind = 'browser';
  else if (computer) kind = 'computer';
  else if (inspect) kind = 'inspect';
  else kind = 'conversation';

  const requiresVerification = !options.readOnly &&
    (requiresWrite || VERIFY_INTENT.test(text));
  const risk: TaskRisk = HIGH_RISK.test(text) ? 'high' : requiresWrite ? 'medium' : 'low';

  const acceptance: string[] = [];
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

  return {
    objective,
    kind,
    risk,
    requiresWrite,
    requiresVerification,
    weakMode: options.weakMode === true,
    acceptance,
  };
}

/** Compact, cache-friendly contract block for the system prompt. */
export function taskContractPrompt(contract: TaskContract): string {
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
