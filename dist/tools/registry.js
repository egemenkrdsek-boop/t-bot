export function buildToolRegistryWithReport(defs) {
    const registry = new Map();
    const keptIndexes = new Map();
    const duplicates = new Map();
    for (let index = 0; index < defs.length; index++) {
        const definition = defs[index];
        if (!definition || typeof definition.name !== 'string' || !definition.name)
            continue;
        if (!registry.has(definition.name)) {
            registry.set(definition.name, definition);
            keptIndexes.set(definition.name, index);
            continue;
        }
        const report = duplicates.get(definition.name);
        if (report) {
            report.droppedIndexes.push(index);
        }
        else {
            duplicates.set(definition.name, {
                name: definition.name,
                keptIndex: keptIndexes.get(definition.name) ?? 0,
                droppedIndexes: [index],
            });
        }
    }
    return { registry, duplicates: [...duplicates.values()] };
}
export function buildToolRegistry(defs) {
    return buildToolRegistryWithReport(defs).registry;
}
export function uniqueToolDefinitions(defs) {
    return [...buildToolRegistry(defs).values()];
}
export function getToolDefinition(registry, name) {
    return registry.get(name);
}
//# sourceMappingURL=registry.js.map