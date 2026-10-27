import type { AgentEvent, ApprovalRequest, Message, Provider } from './types.js';
export interface TuiOptions {
    workspace: string;
    provider: Provider;
    model: string;
    history: Message[];
    onSubmit: (message: string, emit: (event: AgentEvent) => void, approve: (request: ApprovalRequest) => Promise<boolean>, signal: AbortSignal) => Promise<Message[]>;
    onCommand?: (command: string, setYolo: (enabled: boolean) => void) => Promise<string | undefined>;
    yolo?: boolean;
    onWorkflow?: (command: string, input: string, emit: (event: AgentEvent) => void, approve: (request: ApprovalRequest) => Promise<boolean>, signal: AbortSignal, suspendUi: <T>(action: () => Promise<T>) => Promise<T>) => Promise<void>;
}
export declare function startTui(options: TuiOptions): Promise<void>;
