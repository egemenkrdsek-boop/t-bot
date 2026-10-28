/**
 * Adapted from OpenCode, Copyright (c) 2025 opencode, MIT License.
 * Source: anomalyco/opencode@fa1260d6ca484fe0fd868aa992ad81ab85343cf3
 * packages/core/src/tool/plugin/edit.ts
 * Source blob: 5165e7a5547b94c638d847da9d16f5066bb481b1
 * License: THIRD_PARTY_NOTICES.md (OpenCode adapted components).
 * Changes: dependency-free single unique edit, overlapping-match rejection,
 * bounded input/LCS/line comparisons; no replaceAll, formatter or permissions.
 */

const MAX_EDIT_CHARS = 1_000_000;
const MAX_ALIGNMENT_CELLS = 1_000_000;
const MAX_LINE_COMPARISONS = 1_000_000;
const MAX_MATCH_LINES = 20_000;
interface Match { start: number; end: number }
interface AlignmentBudget { remaining: number }

const normalizeForMatch = (value: string): string => value
  .replace(/[‘’‚‛]/g, "'")
  .replace(/[“”„‟]/g, '"')
  .replace(/[‐‑‒–—―−]/g, '-')
  .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, ' ');

function findOccurrences(content: string, search: string): Match[] {
  const result: Match[] = [];
  let offset = 0;
  while ((offset = content.indexOf(search, offset)) !== -1) {
    result.push({ start: offset, end: offset + search.length });
    if (result.length === 2) break; // Two candidates already make the edit ambiguous.
    offset++; // Preserve T Bot's conservative rejection of overlapping matches.
  }
  return result;
}

function findLineOccurrences(content: string, search: string): Match[] {
  let searchLines = 1;
  for (const char of search) {
    if (char === '\n' && ++searchLines > MAX_MATCH_LINES) throw new Error('Edit line budget exceeded; use a smaller patch');
  }
  const trailingNewline = search.endsWith('\n');
  const expected = search.split('\n');
  if (trailingNewline) expected.pop();
  const keys = expected.map(line => normalizeForMatch(line.trimEnd()));
  const lines: Array<Match & { contentEnd: number; newline: boolean; key: string }> = [];
  for (const match of content.matchAll(/[^\n]*(?:\n|$)/g)) {
    if (!match[0]) continue;
    if (lines.length >= MAX_MATCH_LINES) throw new Error('Edit line budget exceeded; use a smaller patch');
    const newline = match[0].endsWith('\n');
    const text = newline ? match[0].slice(0, -1) : match[0];
    lines.push({ start: match.index, end: match.index + match[0].length,
      contentEnd: match.index + text.length, newline, key: normalizeForMatch(text.trimEnd()) });
  }
  const result: Match[] = [];
  let comparisons = 0;
  for (let i = 0; i + keys.length <= lines.length; i++) {
    let matched = true;
    for (let j = 0; j < keys.length; j++) {
      if (++comparisons > MAX_LINE_COMPARISONS) throw new Error('Edit matching budget exceeded; use a smaller patch');
      if (lines[i + j].key !== keys[j]) { matched = false; break; }
    }
    if (!matched) continue;
    const last = lines[i + keys.length - 1];
    if (trailingNewline && !last.newline) continue;
    result.push({ start: lines[i].start, end: trailingNewline ? last.end : last.contentEnd });
    if (result.length === 2) break;
  }
  return result;
}

function lineEnding(text: string, fallback: string): string {
  let crlf = 0, lf = 0, offset = -1;
  while ((offset = text.indexOf('\n', offset + 1)) !== -1) {
    if (text[offset - 1] === '\r') crlf++;
    else lf++;
  }
  return crlf === lf ? fallback : crlf > lf ? '\r\n' : '\n';
}

function countNewlines(text: string, end = text.length): number {
  let count = 0, offset = -1;
  while ((offset = text.indexOf('\n', offset + 1)) !== -1 && offset < end) count++;
  return count;
}

/** LCS maps kept lines, and positional gaps map changed lines to their predecessors. */
function alignLines(before: string[], after: string[], budget: AlignmentBudget): Array<number | undefined> {
  const width = after.length + 1;
  const cells = (before.length + 1) * width;
  if (cells > budget.remaining) throw new Error('Edit alignment budget exceeded; use a smaller patch');
  budget.remaining -= cells;
  const table = new Uint32Array(cells);
  for (let i = before.length - 1; i >= 0; i--)
    for (let j = after.length - 1; j >= 0; j--)
      table[i * width + j] = before[i] === after[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  const result: Array<number | undefined> = [];
  let oldGap: number[] = [], newGap: number[] = [];
  const flush = () => {
    newGap.forEach((index, gapIndex) => { result[index] = oldGap[gapIndex]; });
    oldGap = []; newGap = [];
  };
  let i = 0, j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) { flush(); result[j++] = i++; continue; }
    if (table[(i + 1) * width + j] >= table[i * width + j + 1]) oldGap.push(i++);
    else newGap.push(j++);
  }
  while (i < before.length) oldGap.push(i++);
  while (j < after.length) newGap.push(j++);
  flush();
  return result;
}

function preserveContext(actual: string, expected: string, replacement: string, budget: AlignmentBudget): string {
  if (actual === expected) return replacement;
  if (expected === replacement) return actual;
  const oldCore = expected.trimEnd();
  const actualCore = actual.trimEnd();
  const newCore = replacement.trimEnd();
  if (normalizeForMatch(actualCore) !== normalizeForMatch(oldCore)) {
    throw new Error('Tolerant edit context is ambiguous; read exact source and use a smaller patch');
  }
  if ((oldCore.length + 1) * (newCore.length + 1) > budget.remaining) {
    throw new Error('Edit alignment budget exceeded; use a smaller patch');
  }
  const indices = alignLines(oldCore.split(''), newCore.split(''), budget);
  const text = newCore.split('').map((char, index) => {
    const original = indices[index];
    return original !== undefined && oldCore[original] === char ? actualCore[original] : char;
  }).join('');
  const oldTrailing = expected.slice(oldCore.length);
  const newTrailing = replacement.slice(newCore.length);
  return text + (oldTrailing === newTrailing ? actual.slice(actualCore.length) : newTrailing);
}

function withRegionEndings(region: string, search: string, replacement: string, fallback: string, budget: AlignmentBudget): string {
  if ((countNewlines(region) + 2) * (countNewlines(replacement) + 2) > budget.remaining) {
    throw new Error('Edit alignment budget exceeded; use a smaller patch');
  }
  const before = region.split(/\r?\n/);
  const endings = Array.from(region.matchAll(/\r?\n/g), match => match[0]);
  const after = replacement.split('\n');
  const requested = search.split('\n');
  const key = (line: string) => normalizeForMatch(line.trimEnd());
  const source = alignLines(before.map(key), after.map(key), budget);
  return after.map((line, index) => {
    const original = source[index];
    // T Bot addition: an unchanged context line may contain source typography
    // or trailing spaces absent from the model's normalized search string.
    const text = original !== undefined ? preserveContext(before[original], requested[original], line, budget) : line;
    return index === after.length - 1 ? text : text + (endings[original!] ?? fallback);
  }).join('');
}

function countBefore(positions: number[], offset: number): number {
  let low = 0, high = positions.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (positions[middle] < offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Match the model's LF view, then replace only the corresponding original span. */
export function applyEdit(source: string, oldText: string, newText: string): { content: string; line: number } {
  if (!oldText) throw new Error('old_text must be a non-empty string');
  if ([source, oldText, newText].some(text => text.length > MAX_EDIT_CHARS)) throw new Error('Edit input exceeds 1 million characters');
  if (oldText === newText) throw new Error('No changes to apply: old_text and new_text are identical');
  const endingsOnly = oldText.replaceAll('\r', '') === newText.replaceAll('\r', '');
  const view = endingsOnly ? source : source.replaceAll('\r\n', '\n');
  const search = endingsOnly ? oldText : oldText.replaceAll('\r\n', '\n');
  const replacement = endingsOnly ? newText : newText.replaceAll('\r\n', '\n');
  let matches = findOccurrences(view, search);
  if (!endingsOnly && !matches.length) matches = findOccurrences(normalizeForMatch(view), normalizeForMatch(search));
  if (!endingsOnly && !matches.length) matches = findLineOccurrences(view, search);
  if (!matches.length) throw new Error('old_text was not found in file');
  if (matches.length !== 1) throw new Error('old_text must occur exactly once');
  const match = matches[0];
  const removed: number[] = [];
  if (!endingsOnly) {
    let offset = -1;
    while ((offset = source.indexOf('\r\n', offset + 1)) !== -1) removed.push(offset - removed.length);
  }
  const start = match.start + countBefore(removed, match.start);
  const end = match.end + countBefore(removed, match.end);
  const region = source.slice(start, end);
  const insert = endingsOnly ? replacement : withRegionEndings(region, search, replacement, lineEnding(region, lineEnding(source, '\n')), { remaining: MAX_ALIGNMENT_CELLS });
  const content = source.slice(0, start) + insert + source.slice(end);
  if (content === source) throw new Error('No changes to apply: edit leaves file unchanged');
  return { content, line: countNewlines(source, start) + 1 };
}
