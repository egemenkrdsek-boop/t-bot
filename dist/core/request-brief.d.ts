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
import { type ActionKind, type SpeechAct } from './lexicon.js';
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
export declare function deriveBrief(message: string): RequestBrief;
