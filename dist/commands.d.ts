/**
 * Single source of truth for user-facing slash commands.
 *
 * Surfaces keep their own UI and approval implementations, but command names,
 * usage strings, descriptions and workflow routing must not drift between the
 * CLI/TUI, the desktop renderer and the Telegram bridge.
 */
export type CommandSurface = 'cli' | 'desktop' | 'telegram';
export interface CommandSpec {
    /** Canonical command, including the leading slash. */
    name: string;
    /** Additional accepted spellings. */
    aliases?: readonly string[];
    /** Short usage line shown in help. */
    usage: string;
    description: string;
    surfaces: readonly CommandSurface[];
    /** True when the command may run an agent turn instead of a local action. */
    workflow?: boolean;
    /** How the argument is interpreted. */
    argument?: 'none' | 'optional' | 'required';
}
export interface CommandGroup {
    name: string;
    commands: readonly CommandSpec[];
}
export declare const COMMAND_GROUPS: readonly CommandGroup[];
/** Resolve a canonical name or alias. */
export declare function findCommand(name: string): CommandSpec | undefined;
export declare function commandsFor(surface: CommandSurface): readonly CommandSpec[];
/** All accepted command spellings for a surface, canonical names first. */
export declare function commandNamesFor(surface: CommandSurface): readonly string[];
/**
 * A workflow command needs an agent turn. `/ultracode on` is a mode change,
 * while `/ultracode fix the build` is work; `/goal` always goes through the
 * workflow because it owns its status/pause/resume/cancel forms.
 */
export declare function isWorkflowInvocation(name: string, argument?: string): boolean;
/** Plain-text help block shared by the CLI and the desktop help command. */
export declare function helpFor(surface: CommandSurface): string;
/** Compact command list for a desktop palette or a log line. */
export declare function commandCatalog(surface: CommandSurface): Array<{
    name: string;
    usage: string;
    description: string;
    argument: CommandSpec['argument'];
}>;
export declare const COMMAND_NAMES: string[];
export declare const COMMAND_COUNT: number;
