/**
 * Deterministic request brief: the turn-level reading of the user's message.
 *
 * The brief answers a small set of questions the loop can enforce:
 * - Is this a question, an order, a continuation or plain chat?
 * - Does the request ask for a change, an inspection, browser or desktop work?
 * - Does the user explicitly forbid writes in this message?
 *
 * Ambiguity is resolved fail-open for write permission (a task may write) but
 * fail-closed for security (an explicit no-write boundary always wins).
 */
import {
  classifySentence,
  detectLanguage,
  extractObjectTypes,
  hasBrowseIntent,
  hasDesktopIntent,
  hasInspectAction,
  hasMetaIntent,
  hasNoWriteBoundary,
  hasOperationIntent,
  hasVerifyAction,
  hasWriteAction,
  HIGH_RISK,
  matchActionKinds,
  splitSentences,
  type ActionKind,
  type SpeechAct,
} from './lexicon.js';

export interface RequestBrief {
  text: string;
  language: 'tr' | 'en' | 'other';
  sentences: string[];
  speechActs: SpeechAct[];
  /** Dominant speech act: command wins, then continuation, question, chat. */
  speechAct: SpeechAct;
  actions: ActionKind[];
  objects: string[];
  continuation: boolean;
  /** An explicit "do not change anything" style boundary in this message. */
  noWrite: boolean;
  question: boolean;
  /** At least one sentence is a real question (not just a social phrase). */
  hasQuestion: boolean;
  browser: boolean;
  computer: boolean;
  inspection: boolean;
  /** Start/run/serve intent: needs tools, but does not promise a file change. */
  operation: boolean;
  /** Self-description/explanation verbs: chat or inspection, never a work order. */
  meta: boolean;
  writeIntent: boolean;
  verificationHint: boolean;
  risk: 'low' | 'medium' | 'high';
}

export function deriveBrief(message: string): RequestBrief {
  const text = String(message || '').trim();
  const sentences = splitSentences(text);
  const speechActs = sentences.map(classifySentence);

  const dominant: SpeechAct = speechActs.includes('command')
    ? 'command'
    : speechActs.includes('continuation')
      ? 'continuation'
      : speechActs.includes('question')
        ? 'question'
        : 'chat';

  const writeIntent = speechActs.some((act, index) => act === 'command' && hasWriteAction(sentences[index] ?? ''));
  const inspection = speechActs.some((act, index) =>
    (act === 'command' || act === 'question') && hasInspectAction(sentences[index] ?? ''));
  const browser = hasBrowseIntent(text);
  const computer = hasDesktopIntent(text);
  const operation = hasOperationIntent(text);
  const meta = hasMetaIntent(text);
  // Only exact continuation sentences ("continue", "devam et") count, so
  // "continue fixing the parser" remains a write command.
  const continuation = speechActs.includes('continuation');
  const verificationHint = hasVerifyAction(text);
  const noWrite = hasNoWriteBoundary(text);
  const risk: RequestBrief['risk'] = HIGH_RISK.test(text)
    ? 'high'
    : writeIntent
      ? 'medium'
      : 'low';

  return {
    text,
    language: detectLanguage(text),
    sentences,
    speechActs,
    speechAct: dominant,
    actions: matchActionKinds(text),
    objects: extractObjectTypes(text),
    continuation,
    noWrite,
    question: dominant === 'question',
    hasQuestion: speechActs.includes('question'),
    browser,
    computer,
    inspection,
    operation,
    meta,
    writeIntent,
    verificationHint,
    risk,
  };
}
