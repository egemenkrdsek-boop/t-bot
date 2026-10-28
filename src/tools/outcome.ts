/**
 * Structured tool result plus the legacy text contract.
 *
 * Surfaces can read `ok`/`status`/`durationMs` directly while the model keeps
 * receiving the same string shape as before. Failures always render with the
 * `Tool error:` prefix that `isToolResultOk` recognises.
 */
export interface ToolOutcome {
  ok: boolean;
  status: string;
  summary: string;
  detail?: string;
  data?: unknown;
  error?: string;
  durationMs?: number;
}

export interface ToolOutcomeOptions {
  status?: string;
  detail?: string;
  data?: unknown;
  durationMs?: number;
}

export function okOutcome(summary: string, options: ToolOutcomeOptions = {}): ToolOutcome {
  return {
    ok: true,
    status: options.status ?? 'ok',
    summary,
    ...(options.detail !== undefined ? { detail: options.detail } : {}),
    ...(options.data !== undefined ? { data: options.data } : {}),
    ...(options.durationMs !== undefined ? { durationMs: options.durationMs } : {}),
  };
}

export function errorOutcome(
  error: string,
  options: ToolOutcomeOptions & { summary?: string } = {}
): ToolOutcome {
  return {
    ok: false,
    status: options.status ?? 'error',
    summary: options.summary ?? error,
    ...(options.detail !== undefined ? { detail: options.detail } : {}),
    ...(options.data !== undefined ? { data: options.data } : {}),
    error,
    ...(options.durationMs !== undefined ? { durationMs: options.durationMs } : {}),
  };
}

const ERROR_PREFIXES = [
  'Tool error:',
  'Araç Hatası:',
  'Araç hatası:',
  'Tool action denied',
  'Tool denied:',
  'Araç reddedildi',
  'Unknown tool:',
];

export function renderOutcome(outcome: ToolOutcome): string {
  const primary = String(outcome.ok ? outcome.summary : outcome.error ?? outcome.summary ?? '').trim();
  const detail = String(outcome.detail ?? '').trim();
  let text = primary && detail && !primary.includes(detail) ? `${primary}\n${detail}` : primary || detail;

  if (!outcome.ok) {
    if (!text) text = 'unknown failure';
    return ERROR_PREFIXES.some(prefix => text.startsWith(prefix)) ? text : `Tool error: ${text}`;
  }

  if (!text && outcome.data !== undefined) {
    try {
      return JSON.stringify(outcome.data);
    } catch {
      return String(outcome.data);
    }
  }
  return text;
}
