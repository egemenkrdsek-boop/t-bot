export type SkillId = 'frontenddesign' | 'backend' | 'codereview' | 'debuganalysis' | 'imagegen';
export interface SkillDefinition { id: SkillId; title: string; description: string; guidance: string }

export const BUILTIN_SKILLS: readonly SkillDefinition[] = [
  {
    id: 'frontenddesign',
    title: 'Önyüz ve Arayüz Tasarımı',
    description: 'Kullanıcı Arayüzü Tasarımı ve Uygulaması',
    guidance: 'Inspect existing conventions and design systems first. Deliver real, accessible, responsive code using the project stack. Create intentional typography, layout, and colors; avoid generic templates, purple gradients, and placeholder copy.'
  },
  {
    id: 'backend',
    title: 'Arkayüz ve API Mimarisi',
    description: 'Arkayüz Servisleri ve API Mimarisi',
    guidance: 'Inspect architecture and conventions. Define clear contracts, validate inputs at boundaries, handle errors and cancellation gracefully, and verify changes with tests.'
  },
  {
    id: 'codereview',
    title: 'Kod ve Güvenlik İncelemesi',
    description: 'Eyleme Dönüştürülebilir Kod ve Güvenlik İncelemesi',
    guidance: 'Inspect relevant code and callers. Prioritize concrete bugs, regressions, and security issues with precise locations and evidence. Distinguish verified facts from uncertainty; never invent findings.'
  },
  {
    id: 'debuganalysis',
    title: 'Hata Ayıklama ve Kök Neden Analizi',
    description: 'Hata Araştırması ve Kök Neden Analizi',
    guidance: 'Trace actual failures through code and execution evidence. Separate observations from hypotheses. Identify root causes and concrete next steps; never claim a reproduction or fix without evidence.'
  },
  {
    id: 'imagegen',
    title: 'Görsel Üretim ve Tasarım',
    description: 'Raster Görsel Üretimi ve Düzenleme',
    guidance: 'Use the image_generate tool to create or edit raster images. For image editing, supply the existing image path in source_image. Describe subject, visual style, and constraints clearly. Never claim an image was generated or edited unless the tool succeeded.'
  },
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

export function buildSkillPrompt(skills?: readonly (SkillDefinition | string)[]): string {
  if (!skills || !skills.length) return '';
  const skillMap = new Map<string, SkillDefinition>(BUILTIN_SKILLS.map(s => [s.id, s]));
  return skills
    .map(skill => {
      if (typeof skill === 'string') {
        const found = skillMap.get(skill) ?? BUILTIN_SKILLS.find(b => b.title.toLowerCase() === skill.toLowerCase());
        return found ? `${found.title}: ${found.guidance}` : skill;
      }
      return `${skill.title}: ${skill.guidance}`;
    })
    .filter(Boolean)
    .join('\n');
}

export function skillRequiresReadOnly(skills: readonly SkillDefinition[], message: string): boolean {
  const command = normalize(message).match(explicit)?.[1];
  if (command === 'codereview' || command === 'debuganalysis') return true;
  if (!skills.some(s => s.id === 'codereview' || s.id === 'debuganalysis')) return false;
  // A combined request to implement a fix authorizes editing; pure analysis stays read-only.
  return !/\b(?:fix|implement|change|edit|patch)\s+(?:the\s+|this\s+|that\s+|these\s+|any\s+)?(?:bugs?|issues?|errors?|problems?|code|files?|it|them|changes|fixes|solution)\b|\b(?:duzelt|uygula|degistir|onar)(?:in|iniz|elim|ilsin|mek)?\b/.test(normalize(message));
}
