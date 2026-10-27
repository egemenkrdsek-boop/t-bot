import type { AgentInput, Message, Provider } from './types.js';
export type SubagentInput = AgentInput & {
    workerProvider: Provider;
};
export interface SubtaskItem {
    role: string;
    title: string;
    task: string;
}
/** Model çıktısından markdown veya ek metinleri temizleyip ilk [ ile son ] arasındaki JSON dizisini ayıklar. */
export declare function extractJsonArray(text: string): string;
/** Plan independent, read-only investigations with specialized Turkish subagents, then let the primary agent act. */
export declare function runSubagents(input: SubagentInput): Promise<Message[]>;
