/**
 * Adapted from OpenCode, Copyright (c) 2025 opencode, MIT License.
 * Source: anomalyco/opencode@fa1260d6ca484fe0fd868aa992ad81ab85343cf3
 * packages/core/src/tool/plugin/edit.ts
 * Source blob: 5165e7a5547b94c638d847da9d16f5066bb481b1
 * License: THIRD_PARTY_NOTICES.md (OpenCode adapted components).
 * Changes: dependency-free single unique edit, overlapping-match rejection,
 * bounded input/LCS/line comparisons; no replaceAll, formatter or permissions.
 */
/** Match the model's LF view, then replace only the corresponding original span. */
export declare function applyEdit(source: string, oldText: string, newText: string): {
    content: string;
    line: number;
};
