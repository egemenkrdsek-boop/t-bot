export type SkillId = 'frontenddesign' | 'backend' | 'codereview' | 'debuganalysis' | 'imagegen';
export interface SkillDefinition {
    id: SkillId;
    title: string;
    description: string;
    guidance: string;
}
export declare const BUILTIN_SKILLS: readonly SkillDefinition[];
export declare function stripSkillCommand(message: string): string;
/** Resolve all applicable skills; slash commands are exact, keywords use word boundaries. */
export declare function resolveSkills(message: string): SkillDefinition[];
export declare function buildSkillPrompt(skills: readonly SkillDefinition[]): string;
export declare function skillRequiresReadOnly(skills: readonly SkillDefinition[], message: string): boolean;
