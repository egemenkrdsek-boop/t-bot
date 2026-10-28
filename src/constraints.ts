/**
 * Deterministic extraction and enforcement of explicit user boundaries.
 *
 * This is intentionally conservative: only concrete paths, commands and tool
 * families are captured. Natural-language ambiguity is left to the model and
 * the approval layer; a guessed constraint is worse than no constraint.
 */
import { isAbsolute, join, resolve } from 'node:path';
import type { ToolCall } from './types.js';

export type ConstraintKind =
  | 'forbid-path'
  | 'only-path'
  | 'forbid-command'
  | 'forbid-tool'
  | 'no-write'
  | 'no-command'
  | 'allow-path'
  | 'release';

export interface Constraint {
  kind: ConstraintKind;
  value: string;
  source: string;
}

const MAX_VALUE = 220;
const MAX_SOURCE = 240;
const MAX_CONSTRAINTS = 32;

const WRITE_TOOLS = new Set([
  'file_write',
  'file_patch',
  'file_delete',
  'file_rename',
  'file_move',
  'skill_create',
  'checkpoint_restore',
  'image_generate',
  'git_add',
  'git_commit',
  'git_branch',
]);

const COMMAND_TOOLS = new Set([
  'shell',
  'project_verify',
  'process_start',
  'process_write',
  'delegate_task',
]);

const TOOL_FAMILIES: Record<string, (name: string) => boolean> = {
  browser: name => name.startsWith('browser_'),
  computer: name => name === 'computer' || name.startsWith('computer_'),
  shell: name => name === 'shell' || name === 'process_start' || name === 'process_write',
  mcp: name => name.startsWith('mcp_'),
  web: name => name === 'web_search' || name === 'url_fetch',
  git: name => name.startsWith('git_'),
};

const GENERIC_VALUES = new Set([
  'it', 'this', 'that', 'them', 'anything', 'everything', 'all', 'any',
  'code', 'file', 'files', 'repo', 'project', 'behavior', 'behaviour',
  'tests', 'test', 'commands', 'command', 'shell', 'terminal',
]);

function cleanValue(raw: string): string | undefined {
  const value = String(raw || '')
    .trim()
    .replace(/^[`"'“”‘’(\[]+/, '')
    .replace(/[`"'“”‘’)\].,;:!?]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value || value.length > MAX_VALUE) return undefined;
  if (GENERIC_VALUES.has(value.toLowerCase())) return undefined;
  return value;
}

function looksLikePath(value: string): boolean {
  if (value.length > 220) return false;
  return value.startsWith('~') ||
    /[\\/]/.test(value) ||
    /\.[a-z0-9]{1,16}$/i.test(value) ||
    /^(?:readme|license|makefile|dockerfile)$/i.test(value);
}

function addPath(list: Constraint[], kind: ConstraintKind, raw: string, source: string): void {
  const value = cleanValue(raw);
  if (!value || !looksLikePath(value)) return;
  list.push({ kind, value, source });
}

function addCommand(list: Constraint[], raw: string, source: string): void {
  const value = cleanValue(raw);
  if (!value) return;
  list.push({ kind: 'forbid-command', value, source });
}

function addTool(list: Constraint[], raw: string, source: string): void {
  const value = String(raw || '').toLowerCase();
  const family = value.includes('browser') || value.includes('tarayıcı') ? 'browser'
    : value.includes('computer') || value.includes('desktop') || value.includes('masaüstü') ? 'computer'
      : value.includes('shell') || value.includes('terminal') || value.includes('kabuk') ? 'shell'
        : value.includes('mcp') ? 'mcp'
          : value.includes('git') ? 'git'
            : value.includes('web') || value.includes('internet') ? 'web'
              : undefined;
  if (family) list.push({ kind: 'forbid-tool', value: family, source });
}

/**
 * Extract only unambiguous constraints. A sentence such as "don't forget to
 * run tests" is deliberately not treated as "do not run tests".
 */
export function extractConstraints(text: string): Constraint[] {
  const input = String(text || '');
  const source = input.replace(/\s+/g, ' ').trim().slice(0, MAX_SOURCE);
  const found: Constraint[] = [];
  if (!input.trim()) return found;

  const release = /\b(?:ignore|forget|discard|drop)\s+(?:all\s+)?(?:previous|earlier|prior|the)\s+(?:constraints?|restrictions?)\b|(?:önceki|tüm)\s+(?:kısıtları|kısıtlamaları|sınırlamaları)\s+(?:yoksay|unut|iptal\s+et)/iu;
  if (release.test(input)) found.push({ kind: 'release', value: '*', source });

  const allowPathPatterns = [
    /\b(?:you (?:can|may) now|now you can|it'?s (?:ok|fine) to)\s+(?:edit|modify|change|touch|delete)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"',;]+)/giu,
    /(?:artık|şimdi)\s+[`"']?([^\s`"',;]+)[`"']?(?:['’][a-zçğıöşü]+)?\s+(?:dosyasını|dosyayı|dosyasına)?\s*(?:düzenleyebilirsin|değiştirebilirsin|dokunabilirsin|silebilirsin)/giu,
  ];
  for (const pattern of allowPathPatterns) {
    for (const match of input.matchAll(pattern)) addPath(found, 'allow-path', match[1] ?? '', source);
  }

  const forbidPathPatterns = [
    /\b(?:do not|don't|never|must not|mustn't|should not|shouldn't)\s+(?:touch|edit|modify|change|delete|remove|overwrite|write(?:\s+to)?|patch)\s+(?:the\s+)?(?:file\s+|path\s+)?[`"']?([^\s`"',;]+)/giu,
    /\b(?:leave|keep)\s+[`"']?([^\s`"',;]+)[`"']?\s+(?:unchanged|untouched|alone|as\s+is)\b/giu,
    /([^\s,;:`"']+)(?:['’][a-zçğıöşü]+)?\s+(?:dosyasına|dosyasını|dosyasında|dosya yoluna|yoluna|path'?ine)\s+(?:dokunma|dokunmayın|değiştirme|değiştirmeyin|silme|silmeyin|yazma|yazmayın)/giu,
    /([^\s,;:`"']+)(?:['’][a-zçğıöşü]+)?\s+(?:dokunma|dokunmayın|değiştirme|değiştirmeyin|silme|silmeyin|yazma|yazmayın)\b/giu,
  ];
  for (const pattern of forbidPathPatterns) {
    for (const match of input.matchAll(pattern)) addPath(found, 'forbid-path', match[1] ?? '', source);
  }

  const onlyPathPatterns = [
    /\b(?:only|just)\s+(?:edit|modify|change|patch|touch|write(?:\s+to)?)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"',;]+)/giu,
    /(?:sadece|yalnızca)\s+[`"']?([^\s`"',;]+)[`"']?(?:['’][a-zçğıöşü]+)?\s+(?:dosyasını|dosyasına|dosyayı)?\s*(?:değiştir|düzenle|güncelle|yamala)/giu,
  ];
  for (const pattern of onlyPathPatterns) {
    for (const match of input.matchAll(pattern)) addPath(found, 'only-path', match[1] ?? '', source);
  }

  const commandPatterns = [
    /\b(?:do not|don't|never|must not|mustn't|should not|shouldn't)\s+(?:run|execute|invoke)\s+(?:the\s+)?(?:command\s+)?[`"']([^`"']{1,220})[`"']/giu,
    /\b(?:do not|don't|never)\s+(?:run|execute)\s+(npm\s+test|npm\s+run\s+[a-z0-9:_-]+|pytest|typecheck|lint|tests?)\b/giu,
    /[`"']([^`"']{1,220})[`"']\s*(?:komutunu|komutu)?\s*(?:çalıştırma|çalıştırmayın|koşturma)/giu,
    /\b(npm\s+test|npm\s+run\s+[a-z0-9:_-]+|pytest|typecheck|lint|testleri|test)\s+(?:çalıştırma|çalıştırmayın|koşturma)\b/giu,
  ];
  for (const pattern of commandPatterns) {
    for (const match of input.matchAll(pattern)) addCommand(found, match[1] ?? '', source);
  }

  const toolPatterns = [
    /\b(?:do not|don't|never|must not|mustn't)\s+(?:use|call)\s+(?:the\s+)?(browser|computer|desktop|shell|terminal|mcp|web|internet|git)(?:\s+tools?)?\b/giu,
    /\b(tarayıcıyı|tarayıcı|masaüstünü|masaüstü|terminali|terminal|kabuk|mcp|interneti|web'i|git'i)\s+(?:kullanma|kullanmayın)\b/giu,
  ];
  for (const pattern of toolPatterns) {
    for (const match of input.matchAll(pattern)) addTool(found, match[1] ?? '', source);
  }

  if (/\b(?:do not|don't|never)\s+(?:write|edit|modify|change|touch|delete|remove)\s+(?:any\s+)?(?:files?|the\s+codebase|the\s+repo|the\s+project|anything)\b/iu.test(input) ||
      /(?:hiçbir|hiç\s+bir)?\s*(?:dosyayı|dosyaları|kodu|projeyi)\s+(?:değiştirme|değiştirmeyin|düzenleme|düzenlemeyin|silme|silmeyin)/iu.test(input)) {
    found.push({ kind: 'no-write', value: '*', source });
  }

  if (/\b(?:do not|don't|never)\s+(?:run|execute)\s+(?:any\s+)?(?:commands?|shell|terminal|tests?)\b/iu.test(input) ||
      /(?:komut|komutları|terminali)\s+(?:çalıştırma|çalıştırmayın|koşturma)/iu.test(input)) {
    found.push({ kind: 'no-command', value: '*', source });
  }

  return found;
}

/** Merge constraints from oldest to newest; later explicit releases win. */
export function collectConstraints(userMessages: readonly string[]): Constraint[] {
  let current: Constraint[] = [];
  for (const text of userMessages) {
    const found = extractConstraints(text);
    if (found.some(constraint => constraint.kind === 'release')) current = [];
    for (const constraint of found) {
      if (constraint.kind === 'release') continue;
      if (constraint.kind === 'allow-path') {
        const key = normalizeConstraintPath(constraint.value);
        current = current.filter(item =>
          !((item.kind === 'forbid-path' || item.kind === 'only-path') && normalizeConstraintPath(item.value) === key));
        continue;
      }
      if (constraint.kind === 'only-path') {
        current = current.filter(item => item.kind !== 'only-path');
      }
      const duplicate = current.some(item =>
        item.kind === constraint.kind && item.value.toLowerCase() === constraint.value.toLowerCase());
      if (!duplicate) current.push(constraint);
    }
  }
  return current.slice(-MAX_CONSTRAINTS);
}

function platformPath(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function normalizeConstraintPath(value: string): string {
  return platformPath(String(value || '').replace(/\\/g, '/').replace(/\/+$/, ''));
}

function normalizedTarget(workspace: string, raw: string): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  const absolute = isAbsolute(value) ? value : join(workspace, value);
  return platformPath(resolve(absolute).replace(/\\/g, '/'));
}

function isWithin(target: string, boundary: string): boolean {
  return target === boundary || target.startsWith(`${boundary}/`);
}

function argumentPath(args: Record<string, unknown>): string | undefined {
  for (const key of ['path', 'filePath', 'file_path', 'file', 'filename', 'target_file', 'source', 'destination']) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function toolFamilyMatches(family: string, name: string): boolean {
  const matcher = TOOL_FAMILIES[family];
  return matcher ? matcher(name) : name === family;
}

/**
 * Return an actionable error when a proposed call violates a hard boundary.
 * The caller must not execute the tool when this returns a string.
 */
export function constraintViolation(call: ToolCall, constraints: readonly Constraint[], workspace: string): string | undefined {
  if (!constraints.length) return undefined;
  const name = String(call.name || '');
  const args = call.arguments && typeof call.arguments === 'object' && !Array.isArray(call.arguments)
    ? call.arguments as Record<string, unknown>
    : {};
  const rawTarget = argumentPath(args);
  const target = rawTarget ? normalizedTarget(workspace, rawTarget) : '';
  const rawCommand = typeof args.command === 'string' ? args.command.toLowerCase() : '';
  const shellWrites = /(?:^|[^<>\-=])>{1,2}|set-content|out-file|add-content|remove-item|\b(?:rm|del|erase|mv|move|copy|cp|tee|sed\s+-i)\b/iu.test(rawCommand);

  for (const constraint of constraints) {
    if (constraint.kind === 'no-write' && (WRITE_TOOLS.has(name) || (name === 'shell' && shellWrites))) {
      return `Tool error: user constraint blocks file writes: "${constraint.source}".`;
    }

    if (constraint.kind === 'no-command' && COMMAND_TOOLS.has(name)) {
      return `Tool error: user constraint blocks command execution: "${constraint.source}".`;
    }

    if (constraint.kind === 'forbid-tool' && toolFamilyMatches(constraint.value, name)) {
      return `Tool error: user constraint blocks the ${constraint.value} tool family: "${constraint.source}".`;
    }

    if (constraint.kind === 'forbid-command') {
      const command = typeof args.command === 'string' ? args.command : '';
      const scripts = Array.isArray(args.commands) ? args.commands.filter(value => typeof value === 'string') : [];
      const haystack = [command, ...scripts].join(' ').toLowerCase();
      const needle = constraint.value.toLowerCase();
      if (haystack && (haystack.includes(needle) || (name === 'project_verify' && scripts.some(script => needle.includes(script.toLowerCase()))))) {
        return `Tool error: user constraint blocks command "${constraint.value}": "${constraint.source}".`;
      }
    }

    if ((constraint.kind === 'forbid-path' || constraint.kind === 'only-path') && WRITE_TOOLS.has(name)) {
      const boundary = normalizedTarget(workspace, constraint.value);
      if (constraint.kind === 'forbid-path' && target && isWithin(target, boundary)) {
        return `Tool error: user constraint blocks changes to "${constraint.value}": "${constraint.source}".`;
      }
      if (constraint.kind === 'only-path' && (!target || !isWithin(target, boundary))) {
        return `Tool error: user constraint allows changes only under "${constraint.value}": "${constraint.source}".`;
      }
    }

    // Do not let a model bypass a protected path by asking the shell to write it.
    if (constraint.kind === 'forbid-path' && shellWrites && rawCommand.includes(constraint.value.toLowerCase())) {
      return `Tool error: user constraint blocks commands that reference "${constraint.value}": "${constraint.source}".`;
    }
    if (constraint.kind === 'only-path' && name === 'shell' && shellWrites) {
      return `Tool error: user constraint allows file changes only under "${constraint.value}"; use the file tools inside that boundary: "${constraint.source}".`;
    }
  }
  return undefined;
}

/** Compact, stable prompt section. No user quotes are needed here. */
export function constraintPrompt(constraints: readonly Constraint[]): string {
  if (!constraints.length) return '';
  const lines = ['[USER CONSTRAINTS - HARD BOUNDARIES]', 'The host enforces these before tool execution. A violating call is a failure, not a preference.'];
  for (const constraint of constraints) {
    if (constraint.kind === 'forbid-path') lines.push(`- Do not modify: ${constraint.value}`);
    else if (constraint.kind === 'only-path') lines.push(`- Only modify under: ${constraint.value}`);
    else if (constraint.kind === 'forbid-command') lines.push(`- Do not run command: ${constraint.value}`);
    else if (constraint.kind === 'forbid-tool') lines.push(`- Do not use tool family: ${constraint.value}`);
    else if (constraint.kind === 'no-write') lines.push('- Do not write or modify files.');
    else if (constraint.kind === 'no-command') lines.push('- Do not run commands.');
  }
  return lines.join('\n');
}
