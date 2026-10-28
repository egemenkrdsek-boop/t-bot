import type { ToolDefinition } from '../types.js';

/**
 * Deterministic tool-definition registry.
 *
 * The same tool name may arrive from several sources (local modules, workflow
 * tools appended by the agent, MCP catalogs). Sending a name twice makes
 * providers reject the request and wastes schema tokens, so the dispatcher
 * builds one registry and reads definitions from it. Earlier definitions win:
 * the caller's array order is the priority order (local before remote).
 */
export interface ToolDefinitionDuplicate {
  name: string;
  /** Index of the definition that the registry kept. */
  keptIndex: number;
  /** Indexes of definitions that were ignored. */
  droppedIndexes: number[];
}

export interface ToolRegistryBuildResult {
  registry: Map<string, ToolDefinition>;
  duplicates: ToolDefinitionDuplicate[];
}

export function buildToolRegistryWithReport(defs: ToolDefinition[]): ToolRegistryBuildResult {
  const registry = new Map<string, ToolDefinition>();
  const keptIndexes = new Map<string, number>();
  const duplicates = new Map<string, ToolDefinitionDuplicate>();

  for (let index = 0; index < defs.length; index++) {
    const definition = defs[index];
    if (!definition || typeof definition.name !== 'string' || !definition.name) continue;

    if (!registry.has(definition.name)) {
      registry.set(definition.name, definition);
      keptIndexes.set(definition.name, index);
      continue;
    }

    const report = duplicates.get(definition.name);
    if (report) {
      report.droppedIndexes.push(index);
    } else {
      duplicates.set(definition.name, {
        name: definition.name,
        keptIndex: keptIndexes.get(definition.name) ?? 0,
        droppedIndexes: [index],
      });
    }
  }

  return { registry, duplicates: [...duplicates.values()] };
}

export function buildToolRegistry(defs: ToolDefinition[]): Map<string, ToolDefinition> {
  return buildToolRegistryWithReport(defs).registry;
}

export function uniqueToolDefinitions(defs: ToolDefinition[]): ToolDefinition[] {
  return [...buildToolRegistry(defs).values()];
}

export function getToolDefinition(
  registry: Map<string, ToolDefinition>,
  name: string
): ToolDefinition | undefined {
  return registry.get(name);
}
