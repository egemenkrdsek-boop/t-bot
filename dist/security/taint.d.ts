export declare function isUntrustedTool(name: string): boolean;
export declare class TaintLedger {
    private readonly lines;
    beginTurn(): void;
    record(toolName: string, output: string): void;
    /** Return the first tainted line repeated inside any string argument. */
    findIn(value: unknown): string | undefined;
    get size(): number;
}
export declare function currentTaintLedger(): TaintLedger;
export declare function withTaintLedger<T>(fn: () => Promise<T>): Promise<T>;
export declare function taintedArgument(value: unknown): string | undefined;
