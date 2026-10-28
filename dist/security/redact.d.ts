/**
 * Credential redaction shared by session persistence, tool artifacts, logs and
 * approval previews. This is a heuristic boundary, not a guarantee: unknown
 * secret formats still need to be kept out of model-visible channels.
 */
export declare function redactSecrets(text: string): string;
