/**
 * Turkish/English lexical rules for deterministic intent detection.
 *
 * This module is deliberately shallow: sentence splitting, speech-act
 * classification and action/object/negation lookups. It never calls a model
 * and never decides whether a call is allowed; it only supplies evidence to
 * `request-brief.ts` and the task contract.
 */
export type SpeechAct = 'question' | 'command' | 'continuation' | 'chat';
export type ActionKind = 'write' | 'inspect' | 'browse' | 'desktop' | 'operate' | 'meta';
export interface ActionRule {
    kind: ActionKind;
    pattern: RegExp;
}
export declare const ACTION_RULES: ActionRule[];
export declare const HIGH_RISK: RegExp;
/** Split a request into sentences on terminal punctuation and newlines. */
export declare function splitSentences(input: string): string[];
export declare function hasAction(text: string, kind: ActionKind): boolean;
export declare function matchActionKinds(text: string): ActionKind[];
export declare function hasWriteAction(text: string): boolean;
export declare function hasInspectAction(text: string): boolean;
export declare function hasVerifyAction(text: string): boolean;
export declare function hasBrowseIntent(text: string): boolean;
export declare function hasDesktopIntent(text: string): boolean;
export declare function hasOperationIntent(text: string): boolean;
export declare function hasMetaIntent(text: string): boolean;
export declare function hasNoWriteBoundary(text: string): boolean;
export declare function isContinuation(text: string): boolean;
export declare function isSocialPhrase(text: string): boolean;
export declare function hasRequestPrefix(text: string): boolean;
export declare function isQuestionSentence(text: string): boolean;
/** Classify one sentence. Unknown non-empty commands stay `command`. */
export declare function classifySentence(sentence: string): SpeechAct;
export declare function extractObjectTypes(text: string): string[];
export declare function detectLanguage(text: string): 'tr' | 'en' | 'other';
