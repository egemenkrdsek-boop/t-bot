/**
 * Untrusted-content taint tracking.
 *
 * A label in a prompt is not a security boundary. When a tool returns web,
 * MCP, browser, or desktop text, distinctive lines are retained in the turn's
 * taint ledger. If a later dangerous tool call repeats one of those lines, the
 * dispatcher raises the approval requirement and explains why. Strict mode
 * can refuse the call outright.
 *
 * This is a heuristic defense in depth, not a formal information-flow system.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const MIN_LINE = 32;
const MAX_LINE = 240;
const MAX_LINES = 80;

const UNTRUSTED_EXACT = new Set(['web_search', 'url_fetch']);

export function isUntrustedTool(name: string): boolean {
  return UNTRUSTED_EXACT.has(name) ||
    name.startsWith('browser_') ||
    name === 'computer' ||
    name.startsWith('computer_') ||
    name.startsWith('mcp_');
}

function cleanLines(text: string): string[] {
  return String(text || '')
    .replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07/g, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length >= MIN_LINE && line.length <= MAX_LINE);
}

export class TaintLedger {
  private readonly lines = new Set<string>();

  beginTurn(): void {
    this.lines.clear();
  }

  record(toolName: string, output: string): void {
    if (!isUntrustedTool(toolName) || this.lines.size >= MAX_LINES) return;
    for (const line of cleanLines(output)) {
      if (this.lines.size >= MAX_LINES) break;
      this.lines.add(line);
    }
  }

  /** Return the first tainted line repeated inside any string argument. */
  findIn(value: unknown): string | undefined {
    if (this.lines.size === 0) return undefined;
    if (typeof value === 'string') {
      for (const line of this.lines) {
        if (value.includes(line)) return line;
      }
      return undefined;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = this.findIn(item);
        if (found) return found;
      }
      return undefined;
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value as Record<string, unknown>)) {
        const found = this.findIn(item);
        if (found) return found;
      }
    }
    return undefined;
  }

  get size(): number {
    return this.lines.size;
  }
}

const storage = new AsyncLocalStorage<TaintLedger>();
const fallback = new TaintLedger();

export function currentTaintLedger(): TaintLedger {
  return storage.getStore() ?? fallback;
}

export function withTaintLedger<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run(new TaintLedger(), fn);
}

export function taintedArgument(value: unknown): string | undefined {
  return currentTaintLedger().findIn(value);
}
