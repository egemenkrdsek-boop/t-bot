/**
 * Credential redaction shared by session persistence, tool artifacts, logs and
 * approval previews. This is a heuristic boundary, not a guarantee: unknown
 * secret formats still need to be kept out of model-visible channels.
 */
export function redactSecrets(text) {
    if (typeof text !== 'string' || !text)
        return text;
    return text
        .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, '$1 [REDACTED]')
        .replace(/\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|AIza[0-9A-Za-z_-]{35}|(?:AKIA|ASIA)[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g, '[REDACTED]')
        .replace(/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, '[REDACTED TELEGRAM TOKEN]')
        // URL userinfo and secret-bearing query parameters.
        .replace(/([a-z][a-z0-9+.-]{0,20}:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1[REDACTED]@')
        .replace(/([?&](?:api[_-]?key|key|token|access[_-]?token|apikey|password|passwd|secret|sig|signature|auth)=)[^&#\s"']+/gi, '$1[REDACTED]')
        // Key names are preserved so a reader can see which value was masked.
        .replace(/((?:api[_-]?key|token|password|secret|credential|authorization|private[_-]?key)["']?\s*[=:]\s*["']?)[^\s"',;]+/gi, '$1[REDACTED]')
        .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]');
}
//# sourceMappingURL=redact.js.map