import { type EffortLevel } from './effort.js';
export interface CliOptions {
    command: 'chat' | 'help' | 'version' | 'config' | 'providers' | 'doctor' | 'sessions';
    message?: string;
    provider?: string;
    model?: string;
    workspace?: string;
    resume?: string;
    yolo?: boolean;
    ultracode?: boolean;
    bot?: boolean;
    effort?: EffortLevel;
    args: string[];
}
export declare const HELP: string;
export declare function printUsage(): void;
export declare function parseCli(argv: string[]): CliOptions;
