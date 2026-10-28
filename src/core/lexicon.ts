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

const WRITE_ACTION = /(?:^|[^\p{L}])(?:fix(?:ing|ed)?|implement(?:ing|ed)?|add(?:ing|ed)?|create(?:d|ing)?|write|writes|writing|written|edit(?:ing|ed)?|patch(?:ing|ed)?|refactor(?:ing|ed)?|rename(?:d|ing)?|remove(?:d|ing)?|delete(?:d|ing)?|update(?:d|ing)?|change(?:d|ing)?|migrate(?:d|ing)?|repair(?:ing|ed)?|replace(?:d|ing)?|insert(?:ing|ed)?|append(?:ing|ed)?|generate(?:d|ing)?|scaffold(?:ing|ed)?|build(?:ing)?|ship(?:ped|ping)?|improve(?:d|ing)?|optimi[sz]e(?:d|ing)?|enhance(?:d|ing)?|solve(?:d|ing)?|correct(?:ing|ed)?|adjust(?:ing|ed)?|tweak(?:ing|ed)?|simplif(?:y|ies|ied|ying)|extract(?:ing|ed)?|convert(?:ing|ed)?|upgrade(?:d|ing)?|bump(?:ing|ed)?|wire(?:d|ing)?|configure(?:d|ing)?|clean\s*up|set\s+up|speed\s+up|make\s+(?:it|this|that|them)\s+(?:better|work|faster|cleaner)|make\s+(?:the\s+)?tests?\s+(?:pass|green|succeed)|get\s+(?:the\s+)?tests?\s+(?:to\s+)?pass|get\s+(?:it|this|that)\s+working|save\s+(?:the\s+)?file|save\s+to\s+(?:the\s+)?file|dosyaya\s+kaydet|dosyaya\s+yaz|düzelt(?:ir|me|ti|elim|in|meyi|meyin|mesini)?|ekle(?:r|me|yin|yelim|meyi|meyin)?|oluştur(?:ur|ma|un|alım|mayı|mayın)?|yaz(?:ar|ma|ın|alım|mayı|mayın)?|düzenle(?:r|me|yin|yelim|meyi|meyin)?|yamala(?:r|ma|yin|mayı)?|yeniden\s+adlandır|kaldır(?:ır|ma|ın|alım|mayı|mayın)?|sil(?:er|me|in|elim|meyi|meyin)?|güncelle(?:r|me|yin|yelim|meyi|meyin)?|değiştir(?:ir|me|in|elim|meyi|meyin)?|taşı(?:r|ma|n|mayı|mayın)?|onar(?:ır|ma|ın|mayı)?|tamamla(?:r|ma|yın|yalım|mayı|mayın)?|uygula(?:r|ma|yın|yalım|mayı|mayın)?|iyileştir(?:ir|me|in|meyi|meyin)?|optimize\s+et|hızlandır(?:ır|ma|mayı)?|çöz(?:er|me|ün|meyi)?|temizle(?:r|me|yin|meyi|meyin)?|sadeleştir(?:ir|me|meyi)?|ayır(?:ır|ma|mayı)?|çıkar(?:ır|ma|mayı)?|dönüştür(?:ür|me|meyi)?|yükselt(?:ir|me|meyi)?|bağla(?:r|ma|mayı)?|destekle(?:r|me|meyi)?|ayarla(?:r|ma|mayı)?|yapılandır(?:ır|ma|mayı)?)(?![\p{L}])/iu;
const INSPECT_ACTION = /(?:^|[^\p{L}])(?:review(?:s|ing|ed)?|inspect(?:s|ing|ed)?|analy[sz]e(?:s|d|ing)?|explain(?:s|ing|ed)?|summari[sz]e(?:s|d|ing)?|audit(?:s|ing|ed)?|read(?:s|ing)?|find(?:s|ing)?|locate(?:s|d|ing)?|search(?:es|ing|ed)?|investigate(?:s|d|ing)?|look(?:\s+(?:at|into|through))?|check(?:s|ing|ed)?|show(?:s|ing|n)?|list(?:s|ing|ed)?|describe(?:s|d|ing)?|examine(?:s|d|ing)?|understand(?:s|ing)?|explore(?:s|d|ing)?|incele(?:r|me|yin|yelim|mek|meyi|meyin)?|analiz\s+et(?:er|me|in|meyi)?|açıkla(?:r|ma|yin|mayı)?|özetle(?:r|me|yin|meyi)?|denetle(?:r|me|yin|meyi)?|bul(?:ur|ma|un|alım|mayı)?|araştır(?:ır|ma|in|mayı)?|ara(?:r|ma|yin|mayı)?|bak(?:ar|ma|ın|mayı)?|kontrol\s+et(?:er|me|in|meyi)?|göster(?:ir|me|in|meyi)?|listele(?:r|me|yin|meyi)?|anlat(?:ır|ma|in|mayı)?|anla(?:r|ma|yın|mayı)?|gözden\s+geçir(?:ir|me|in|meyi)?|değerlendir(?:ir|me|in|meyi)?|kaç(?:tane)?|sayısı|sayisi|how\s+many|how\s+much|count)(?![\p{L}])/iu;

const VERIFY_ACTION = /(?:^|[^\p{L}])(?:test(?:s|ing|ed|leri|ler)?|type\s*check(?:s|ing|ed)?|lint(?:s|ing|ed)?|verify|verifies|verifying|validat(?:e|es|ing|ion)|diagnos(?:e|es|tic|tics)|doğrula(?:r|ma|yin|meyi)?|test\s+et(?:er|me|in)?|testleri\s+(?:çalıştır|koştur|geçir)|kontrol\s+et(?:er|me|in)?|denetle(?:r|me|yin)?)(?![\p{L}])/iu;

const BROWSE_ACTION = /(?:^|[^\p{L}])(?:https?:\/\/|(?:browser|playwright|web\s*site|web\s*page|url|localhost|scrape|dom|navigate|click|tarayıcı|tıkla|gez)(?![\p{L}]))/iu;

const DESKTOP_ACTION = /(?:^|[^\p{L}])(?:computer|desktop|masaüstü|screenshot|ekran\s*görüntüsü|mouse|fare|keyboard|klavye|window|pencere|uia|gui|arayüz)(?![\p{L}])/iu;

// Operation requests ("start the dev server", "sunucuyu başlat") need tools
// but do not promise a file change. Keeping them out of the ambiguous bucket
// stops the completion gate from demanding a write that was never requested.
const OPERATE_ACTION = /(?:^|[^\p{L}])(?:run|start|launch|serve|stop|execute|başlat(?:ır|ma|ın|alım)?|durdur(?:ur|ma|un|alım)?|çalıştır(?:ır|ma|ın|alım)?|koştur(?:ur|ma)?|derle(?:r|me|yin|yelim|meyi)?|open\s+(?:the\s+)?(?:app|application|notepad|calculator|browser))(?![\p{L}])/iu;

// Meta/social verbs describe the assistant or an idea; they are not work
// orders and must never select a write contract on their own.
const META_ACTION = /(?:^|[^\p{L}])(?:introduce(?:s|d|ing)?|describe(?:s|d|ing)?|explain(?:s|ing|ed)?|tell\s+me|talk\s+about|summari[sz]e(?:s|d|ing)?|tanıt(?:ır|ma|ın|ır\s+mısın|abilir\s+misin)?|kendini\s+tanıt|kendinden\s+bahset|bahset(?:er|me|in)?|anlat(?:ır|ma|ın)?|açıkla(?:r|ma|yin)?)(?![\p{L}])/iu;

export const ACTION_RULES: ActionRule[] = [
  { kind: 'write', pattern: WRITE_ACTION },
  { kind: 'inspect', pattern: INSPECT_ACTION },
  { kind: 'browse', pattern: BROWSE_ACTION },
  { kind: 'desktop', pattern: DESKTOP_ACTION },
  { kind: 'operate', pattern: OPERATE_ACTION },
  { kind: 'meta', pattern: META_ACTION },
];

const CONTINUATION = /^\s*(?:continue|go\s+on|keep\s+going|proceed|resume|carry\s+on|next(?:\s+step)?|go\s+ahead|devam(?:\s+et)?|devam\s+edelim|sürdür(?:\s+et)?|kaldığın\s+yerden(?:\s+devam\s+et)?|sonraki\s+adım|ilerle)[\s!.,…]*$/iu;

const SOCIAL = /^\s*(?:hi|hello|hey|greetings|good\s+(?:morning|evening|afternoon|night)|how\s+are\s+you|thanks|thank\s+you|thx|ok|okay|alright|sure|bye|goodbye|merhaba|selam(?:lar)?|günaydın|iyi\s+(?:akşamlar|geceler|günler)|nasılsın(?:ız)?|teşekkür(?:ler|\s+ederim)?|sağ\s+ol|hoşçakal|tamam|anladım|anladim|peki|evet|harika|tabii|tabi|olur)[\s!.,…]*$/iu;

const QUESTION_START = /^\s*(?:why|how|what|when|where|who|whom|whose|which|is|are|was|were|do|does|did|can|could|should|would|will|may|might|must|have|has|had|am)\b/iu;
const TR_QUESTION_START = /^\s*(?:neden|niye|nasıl|ne|nedir|ne\s+zaman|nerede|nereye|kim|kime|kimin|hangi|kaç|niçin|acaba)\b/iu;
const TR_PARTICLE = /(?:^|\s)(?:mi|mı|mu|mü|midir|mıdır|mudur|müdür)(?=\s|\?|!|\.|,|$)/iu;
const REQUEST_PREFIX = /^\s*(?:please|lütfen|can\s+you|could\s+you|would\s+you|will\s+you|would\s+you\s+mind|i(?:'d|\s+would)\s+like\s+you\s+to|benim\s+için|bana|rica(?:m)?|acaba)\b/iu;

// Only a blanket boundary counts here. "Don't touch README.md" is a
// path-specific constraint (handled by constraints.ts), not a no-write task.
const NO_WRITE = /\b(?:do\s+not|don'?t|never|must\s+not|mustn'?t|should\s+not|shouldn'?t)\s+(?:change|modify|edit|write|touch|delete|remove|rename|overwrite|patch|alter|reformat)\s+(?:anything|any\s+(?:files?|code|changes?)|the\s+(?:code|codebase|repo|project|workspace|files?)|files?|codebase|workspace)\b|\b(?:read[- ]?only|without\s+(?:changing|editing|modifying|writing|touching)|only\s+(?:review|inspect|analy[sz]e|read|look)|just\s+(?:review|inspect|analy[sz]e|read|look)|(?:only|just)\s+use\s+(?:the\s+)?(?:file|read[- ]?only)\s+tools?)\b|salt\s+okunur|(?:sadece|yalnızca|yalnız)\s+(?:incele|analiz\s+et|gözden\s+geçir)|(?:sadece|yalnızca|yalnız)\s+(?:dosya\s+)?(?:araçlarını|araçları|araclarini|araclari)\s+kullan|(?:hiçbir\s+(?:şeyi|dosyayı|dosyaları|kodu|projeyi)|hiç\s+bir\s+şeyi|tüm\s+(?:dosyaları|kodu|projeyi)|dosyaları|kodu|projeyi)\s+(?:değiştirme|değiştirmeyin|düzenleme|düzenlemeyin|dokunma|dokunmayın|silme|silmeyin|yazma|yazmayın)/iu;

export const HIGH_RISK = /(?:\b(?:delete|remove|drop|truncate|force|push|deploy|publish|release|migration|credential|secret|password|token|rm -rf|format|sil|kaldır|zorla|yayınla|gönder|kimlik bilgisi|parola)\b)/iu;

const OBJECT_RULES: Array<{ type: string; pattern: RegExp }> = [
  { type: 'tests', pattern: /(?:^|[^\p{L}])(?:tests?|testler?|test\s+suite)(?![\p{L}])/iu },
  { type: 'bug', pattern: /(?:^|[^\p{L}])(?:bugs?|errors?|failures?|hata(?:lar)?|sorun(?:lar)?|bug)(?![\p{L}])/iu },
  { type: 'file', pattern: /(?:^|[^\p{L}])(?:files?|dosya(?:lar)?|path|yol)(?![\p{L}])/iu },
  { type: 'code', pattern: /(?:^|[^\p{L}])(?:code|source|kod|kaynak)(?![\p{L}])/iu },
  { type: 'docs', pattern: /(?:^|[^\p{L}])(?:docs?|readme|documentation|belge|doküman)(?![\p{L}])/iu },
  { type: 'performance', pattern: /(?:^|[^\p{L}])(?:performance|speed|latency|memory|performans|hız|bellek)(?![\p{L}])/iu },
  { type: 'ui', pattern: /(?:^|[^\p{L}])(?:ui|ux|interface|component|button|arayüz|bileşen|düğme)(?![\p{L}])/iu },
  { type: 'api', pattern: /(?:^|[^\p{L}])(?:api|endpoint|route|request|response)(?![\p{L}])/iu },
  { type: 'config', pattern: /(?:^|[^\p{L}])(?:config|configuration|settings|yapılandırma|ayar(?:lar)?)(?![\p{L}])/iu },
  { type: 'dependency', pattern: /(?:^|[^\p{L}])(?:dependenc(?:y|ies)|packages?|modules?|bağımlılık(?:lar)?|paket(?:ler)?)(?![\p{L}])/iu },
  { type: 'build', pattern: /(?:^|[^\p{L}])(?:build|compile|typecheck|derleme)(?![\p{L}])/iu },
  { type: 'auth', pattern: /(?:^|[^\p{L}])(?:auth|login|session|token|oturum|giriş)(?![\p{L}])/iu },
  { type: 'data', pattern: /(?:^|[^\p{L}])(?:database|migration|schema|query|veritabanı|şema)(?![\p{L}])/iu },
  { type: 'git', pattern: /(?:^|[^\p{L}])(?:git|commit|branch|merge|push|pull)(?![\p{L}])/iu },
];

const MAX_SENTENCES = 24;

/** Split a request into sentences on terminal punctuation and newlines. */
export function splitSentences(input: string): string[] {
  return String(input || '')
    .replace(/\r\n?/g, '\n')
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map(sentence => sentence.trim())
    .filter(Boolean)
    .slice(0, MAX_SENTENCES);
}

export function hasAction(text: string, kind: ActionKind): boolean {
  const rule = ACTION_RULES.find(item => item.kind === kind);
  return rule ? rule.pattern.test(text) : false;
}

export function matchActionKinds(text: string): ActionKind[] {
  return ACTION_RULES.filter(rule => rule.pattern.test(text)).map(rule => rule.kind);
}

export function hasWriteAction(text: string): boolean {
  return WRITE_ACTION.test(text);
}

export function hasInspectAction(text: string): boolean {
  return INSPECT_ACTION.test(text);
}

export function hasVerifyAction(text: string): boolean {
  return VERIFY_ACTION.test(text);
}

export function hasBrowseIntent(text: string): boolean {
  return BROWSE_ACTION.test(text);
}

export function hasDesktopIntent(text: string): boolean {
  return DESKTOP_ACTION.test(text);
}

export function hasOperationIntent(text: string): boolean {
  return OPERATE_ACTION.test(text);
}

export function hasMetaIntent(text: string): boolean {
  return META_ACTION.test(text);
}

export function hasNoWriteBoundary(text: string): boolean {
  return NO_WRITE.test(text);
}

export function isContinuation(text: string): boolean {
  return CONTINUATION.test(text);
}

export function isSocialPhrase(text: string): boolean {
  return SOCIAL.test(text);
}

export function hasRequestPrefix(text: string): boolean {
  return REQUEST_PREFIX.test(text);
}

export function isQuestionSentence(text: string): boolean {
  const sentence = String(text || '').trim();
  if (!sentence) return false;
  if (hasRequestPrefix(sentence)) return false;
  return /\?\s*$/u.test(sentence) ||
    QUESTION_START.test(sentence) ||
    TR_QUESTION_START.test(sentence) ||
    TR_PARTICLE.test(sentence);
}

/** Classify one sentence. Unknown non-empty commands stay `command`. */
export function classifySentence(sentence: string): SpeechAct {
  const text = String(sentence || '').trim();
  if (!text) return 'chat';
  if (isContinuation(text)) return 'continuation';
  if (isSocialPhrase(text)) return 'chat';
  if (isQuestionSentence(text)) return 'question';
  return 'command';
}

export function extractObjectTypes(text: string): string[] {
  return OBJECT_RULES.filter(rule => rule.pattern.test(text)).map(rule => rule.type);
}

export function detectLanguage(text: string): 'tr' | 'en' | 'other' {
  const input = String(text || '');
  if (/[çğıöşüÇĞİÖŞÜ]/u.test(input) ||
      /\b(?:bir|ve|için|değil|nasıl|neden|lütfen|dosya|testleri|değiştir|düzelt|devam)\b/iu.test(input)) {
    return 'tr';
  }
  if (/[A-Za-z]/.test(input)) return 'en';
  return 'other';
}
