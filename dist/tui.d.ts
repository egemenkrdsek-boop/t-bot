import type { AgentEvent, ApprovalRequest, Message, Provider } from './types.js';
export interface TuiOptions {
    workspace: string;
    provider: Provider;
    model: string;
    history: Message[];
    onSubmit: (message: string, emit: (event: AgentEvent) => void, approve: (request: ApprovalRequest) => Promise<boolean>, signal: AbortSignal) => Promise<Message[]>;
    onCommand?: (command: string) => Promise<string | undefined>;
}
export declare function startTui(options: TuiOptions): Promise<void>;
