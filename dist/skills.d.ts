import type { ToolCall, ToolDefinition } from './types.js';
export type BuiltinSkillId = 'frontenddesign' | 'backend' | 'codereview' | 'debuganalysis' | 'imagegen';
export type SkillId = BuiltinSkillId | (string & {});
export interface SkillDefinition {
    id: SkillId;
    title: string;
    description: string;
    guidance: string;
    triggers?: string[];
    scope?: 'builtin' | 'project' | 'global';
}
export declare const BUILTIN_SKILLS: readonly SkillDefinition[];
export declare const SKILLS: readonly SkillDefinition[];
/**
 * Loads custom skills from global (`<configDirectory>/skills/*.md`) and workspace (`.tbot/skills/*.md`).
 * Project skills override global skills with the same ID.
 */
export declare function loadCustomSkills(workspace?: string): SkillDefinition[];
export declare function stripSkillCommand(message: string, workspace?: string): string;
/** Resolve all applicable builtin and custom skills; slash commands are exact, keywords use word boundaries. */
export declare function resolveSkills(message: string, workspace?: string): SkillDefinition[];
export declare function buildSkillPrompt(skills?: readonly (SkillDefinition | string)[], workspace?: string): string;
export declare function skillRequiresReadOnly(skills: readonly SkillDefinition[], message: string): boolean;
export declare const skillToolDefinitions: ToolDefinition[];
export declare function handleSkillTool(call: ToolCall, workspace: string | {
    workspace: string;
    signal?: AbortSignal;
}): Promise<string>;
export declare function handleSkillTool(name: string, args: Record<string, unknown>, workspaceOrCtx: string | {
    workspace: string;
    signal?: AbortSignal;
}): Promise<string>;
