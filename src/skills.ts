export type SkillId = 'frontenddesign' | 'backend' | 'codereview' | 'debuganalysis' | 'imagegen';
export interface SkillDefinition { id: SkillId; title: string; description: string; guidance: string }

export const BUILTIN_SKILLS: readonly SkillDefinition[] = [
  { id: 'frontenddesign', title: 'Frontend design', description: 'Design and implement interfaces.', guidance: 'Follow the user’s style and existing design system. Inspect the project conventions first. Deliver real runnable frontend code using the existing stack, not merely a screenshot or mockup. Image generation may supply optional art assets. Create a distinctive, intentional visual direction with considered typography, layout, color and real content. Avoid generic purple gradients, repetitive cards and placeholder copy. Build accessible, responsive interfaces and preserve functional behavior.' },
  { id: 'backend', title: 'Backend', description: 'Design and implement backend behavior.', guidance: 'Inspect existing architecture and conventions. Define clear contracts, validate inputs at boundaries, apply least privilege, handle failures and cancellation, and keep resource use bounded. Make focused changes and verify relevant behavior when appropriate.' },
  { id: 'codereview', title: 'Code review', description: 'Review code for actionable defects.', guidance: 'Inspect the relevant code and its callers. Prioritize concrete bugs, regressions and security issues with evidence, impact and precise locations. Distinguish uncertainty and coverage gaps. Do not invent findings.' },
  { id: 'debuganalysis', title: 'Debug analysis', description: 'Investigate a failure and explain its cause.', guidance: 'Trace the actual failure through relevant code and evidence. Separate observations from hypotheses; identify the likely cause, supporting locations and practical next steps. Do not claim a reproduction or fix without evidence.' },
  { id: 'imagegen', title: 'Image generation', description: 'Create raster images with the image generation tool.', guidance: 'Use the native image generation tool to create images. Describe the subject, visual style and constraints clearly. The tool cannot edit existing images; say so honestly when editing is requested. Never claim an image was generated unless the tool succeeded; report when the capability is unavailable.' },
];

function normalize(text: string): string {
  return text.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i');
}
const explicit = /^\s*\/(frontenddesign|backend|codereview|debuganalysis|imagegen)(?=\s|$)/i;
export function stripSkillCommand(message: string): string {
  return message.replace(explicit, '').trim();
}

/** Resolve all applicable skills; slash commands are exact, keywords use word boundaries. */
export function resolveSkills(message: string): SkillDefinition[] {
  const normalized = normalize(message);
  const command = normalized.match(explicit)?.[1] as SkillId | undefined;
  const matches: Record<SkillId, boolean> = {
    frontenddesign: /\b(frontenddesign|frontend design|front end|frontend|ui design|interface design|arayuz|on yuz|tasarim sistemi)\b/.test(normalized),
    backend: /\b(backend|back end|api|api endpoint|rest api|server side|sunucu tarafi|arka uc|veritabani|database)\b/.test(normalized),
    codereview: /\b(codereview|code review|review (?:the )?code|review (?:this |the )?(?:pr|pull request)|kod incele(?:mesi|me)?|kodu incele|kod (?:gozden gecir|gozden gecirme))\b/.test(normalized),
    debuganalysis: /\b(debuganalysis|debug analysis|debugging|debug|root cause|neden calismiyor|hata analizi|hatayi incele|hata ayikla|sorunu analiz)\b/.test(normalized),
    imagegen: /\b(imagegen|image generation|generate (?:an? |the )?(?:image|illustration|picture)|create (?:an? |the )?(?:image|illustration|picture)|edit (?:an? |the )?(?:image|picture)|gorsel (?:olustur|uret|duzenle)|resim (?:olustur|uret|duzenle))\b/.test(normalized),
  };
  return BUILTIN_SKILLS.filter(skill => skill.id === command || matches[skill.id]);
}
export function buildSkillPrompt(skills: readonly SkillDefinition[]): string {
  return skills.map(skill => `${skill.title}: ${skill.guidance}`).join('\n');
}
export function skillRequiresReadOnly(skills: readonly SkillDefinition[], message: string): boolean {
  const command = normalize(message).match(explicit)?.[1];
  if (command === 'codereview' || command === 'debuganalysis') return true;
  if (!skills.some(s => s.id === 'codereview' || s.id === 'debuganalysis')) return false;
  // A combined request to implement a fix authorizes editing; pure analysis stays read-only.
  return !/\b(?:fix|implement|change|edit|patch)\s+(?:the\s+|this\s+|that\s+|these\s+|any\s+)?(?:bugs?|issues?|errors?|problems?|code|files?|it|them|changes|fixes|solution)\b|\b(?:duzelt|uygula|degistir|onar)(?:in|iniz|elim|ilsin|mek)?\b/.test(normalize(message));
}
