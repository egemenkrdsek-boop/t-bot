/** User-facing effort levels; provider controls vary by model. */
export declare const EFFORT_LEVELS: readonly ["low", "medium", "high", "xhigh", "max"];
export type EffortLevel = (typeof EFFORT_LEVELS)[number];
export interface EffortMapping {
    supported: boolean;
    effective?: string;
    message: string;
}
/** Conservative capability table based on the providers' published model documentation. */
export declare function describeEffort(provider: string, model: string, level?: EffortLevel): EffortMapping;
