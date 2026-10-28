import { JSPACE_KERNEL } from './skills/jspace.js';
import type { ToolCall, ToolDefinition } from './types.js';
export type BuiltinSkillId = 'frontenddesign' | 'backend' | 'codereview' | 'debuganalysis' | 'imagegen' | 'jspace';
export type SkillId = BuiltinSkillId | (string & {});
export interface SkillDefinition {
    id: SkillId;
    title: string;
    description: string;
    guidance: string;
    triggers?: string[];
    scope?: 'builtin' | 'project' | 'global';
    /** Hidden skills are available to the agent and slash routing but omitted from user-facing lists. */
    hidden?: boolean;
}
export declare const BUILTIN_SKILLS: readonly SkillDefinition[];
export { JSPACE_KERNEL };
export declare const DEFAULT_SKILL_KERNEL = "[J-SPACE DEFAULT KERNEL]\nTreat every request as a real task with a verifiable outcome. Gate the depth before acting: fast for simple checks; full for multi-step work; loop for long or multi-file work; xhigh for architecture and competing designs.\nUse four lenses together: Architect (root cause and clean design), Adversary (edge cases, hidden coupling, hallucination traps), Empiricist (measure, inspect evidence, run the check), Orchestrator (downstream impact and maintainable integration).\nTag claims internally: [V] verified by a tool result or locked derivation; [?] hypothesis awaiting proof; [X] tested and rejected. Never present [?] as [V]. If evidence is missing, say so and verify.\nBefore multi-step work, state the goal, the next 2-5 steps, and the acceptance check. Read the exact symbol before editing; prefer surgical patches. After changes, run a real verification command. Do not claim success without evidence.\nWhen a loop or repeated failure appears, stop, name the failure, reload the goal, and try an orthogonal approach. Keep final output clean and in the user's language; do not expose internal shorthand or audit tags.";
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
/**
 * Autonomous Skill Distillation (Hermes Agent feature).
 * Distills a reusable project skill (.tbot/skills/auto-<slug>.md)
 * from a successful multi-tool engineering turn deterministically without LLM calls.
 */
export declare function autoDistillSkillFromTurn(params: {
    workspaceRoot: string;
    userPrompt: string;
    finalAnswer: string;
    toolsUsed: string[];
    modifiedFiles: string[];
}): Promise<string | null>;
export declare const skillToolDefinitions: ToolDefinition[];
export declare function handleSkillTool(call: ToolCall, workspace: string | {
    workspace: string;
    signal?: AbortSignal;
}): Promise<string>;
export declare function handleSkillTool(name: string, args: Record<string, unknown>, workspaceOrCtx: string | {
    workspace: string;
    signal?: AbortSignal;
}): Promise<string>;
