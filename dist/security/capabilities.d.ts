/**
 * Tool capability vocabulary.
 *
 * Approval prompts answer "may this run?". Capabilities answer "what kind of
 * effect can this tool have?". Hosts can pass a reduced capability set to a
 * read-only investigator or a specialized worker; the dispatcher then refuses
 * tools outside that set even if the model invents their names.
 */
export type Capability = 'fs.read' | 'fs.write' | 'proc.read' | 'proc.spawn' | 'proc.write' | 'net.public' | 'gui' | 'mcp.read' | 'mcp.write' | 'memory.read' | 'memory.write' | 'image' | 'workflow' | 'checkpoint.read' | 'checkpoint.write' | 'diagnostics';
export declare function capabilitiesForTool(name: string): Capability[];
/** A host-provided allowlist. An empty/undefined set means "no extra restriction". */
export declare function capabilitiesAllowed(name: string, allowed?: ReadonlySet<Capability>): boolean;
export declare function defaultCapabilities(readOnly: boolean): ReadonlySet<Capability>;
export declare function describeCapabilities(name: string): string;
