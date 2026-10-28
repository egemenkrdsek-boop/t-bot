import ts from 'typescript';
import { opendir, open, lstat, realpath } from 'node:fs/promises';
import { extname, join, relative, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { estimateTokens } from './token-optimizer.js';

export interface AstSymbolItem {
  kind: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'const' | 'method';
  name: string;
  signature: string;
  startLine: number;
  endLine: number;
  exported: boolean;
}

export interface FileAstOutline {
  totalLines: number;
  symbols: AstSymbolItem[];
  imports: string[];
  exports: string[];
  formatted: string;
}

const TS_JS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);
const PARSED_SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
  '.py', '.go', '.rs', '.md', '.markdown',
]);
// These files participate in filename retrieval, without claiming a TS AST for
// other languages or reading configuration contents into the map.
const SOURCE_EXTENSIONS = new Set([...PARSED_SOURCE_EXTENSIONS,
  '.java', '.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.cs', '.swift', '.kt', '.kts',
  '.rb', '.php', '.sh', '.bash', '.ps1', '.vue', '.svelte', '.astro', '.sql',
  '.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.xml', '.html', '.css', '.scss',
  '.dart', '.lua', '.ex', '.exs', '.r',
]);
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.tbot',
  'coverage', '.cache', '.turbo', 'out', 'target', '__pycache__', '.venv', 'venv',
]);

interface RepoMapCacheEntry {
  revision: string;
  totalLines: number;
  symbols: Array<Pick<AstSymbolItem, 'name' | 'kind' | 'startLine' | 'endLine' | 'exported'>>;
}

const repoMapCache = new Map<string, RepoMapCacheEntry>();

function compactWhitespace(text: string, maxLen = 150): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 3)}...`;
}

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  if (!modifiers) return false;
  return modifiers.some(
    m => m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword
  );
}

function getScriptKind(ext: string): ts.ScriptKind {
  switch (ext) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function extractTsJsAst(
  filePath: string,
  content: string,
  ext: string
): { symbols: AstSymbolItem[]; imports: string[]; exports: string[] } {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(ext)
  );

  const symbols: AstSymbolItem[] = [];
  const imports: string[] = [];
  const exportsSet = new Set<string>();

  const getRange = (node: ts.Node): { startLine: number; endLine: number } => {
    const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
    return { startLine, endLine: Math.max(startLine, endLine) };
  };

  const visitTopLevel = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const spec = node.moduleSpecifier.getText(sourceFile).replace(/^['"]|['"]$/g, '');
      if (spec) imports.push(spec);
      return;
    }

    if (ts.isExportDeclaration(node)) {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) {
          exportsSet.add(el.name.getText(sourceFile));
        }
      } else if (node.moduleSpecifier) {
        const spec = node.moduleSpecifier.getText(sourceFile).replace(/^['"]|['"]$/g, '');
        exportsSet.add(`* from ${spec}`);
      }
      return;
    }

    if (ts.isExportAssignment(node)) {
      exportsSet.add('default');
      return;
    }

    if (ts.isFunctionDeclaration(node)) {
      const name = node.name ? node.name.getText(sourceFile) : 'default';
      const exported = hasExportModifier(node);
      if (exported) exportsSet.add(name);
      const { startLine, endLine } = getRange(node);
      const sigEnd = node.body ? node.body.getStart(sourceFile) : node.getEnd();
      const rawSig = content.slice(node.getStart(sourceFile), sigEnd).replace(/\{\s*$/, '');
      symbols.push({
        kind: 'function',
        name,
        signature: compactWhitespace(rawSig),
        startLine,
        endLine,
        exported,
      });
      return;
    }

    if (ts.isClassDeclaration(node)) {
      const name = node.name ? node.name.getText(sourceFile) : 'AnonymousClass';
      const exported = hasExportModifier(node);
      if (exported) exportsSet.add(name);
      const { startLine, endLine } = getRange(node);
      const nodeText = node.getText(sourceFile);
      const braceIdx = nodeText.indexOf('{');
      const headerSig = braceIdx !== -1 ? nodeText.slice(0, braceIdx) : nodeText;

      symbols.push({
        kind: 'class',
        name,
        signature: compactWhitespace(headerSig),
        startLine,
        endLine,
        exported,
      });

      for (const member of node.members) {
        if (
          ts.isMethodDeclaration(member) ||
          ts.isConstructorDeclaration(member) ||
          ts.isGetAccessorDeclaration(member) ||
          ts.isSetAccessorDeclaration(member) ||
          (ts.isPropertyDeclaration(member) && member.initializer && (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer)))
        ) {
          const memberName = ts.isConstructorDeclaration(member)
            ? 'constructor'
            : member.name?.getText(sourceFile) || 'anonymous';
          const mRange = getRange(member);
          const body = ts.isPropertyDeclaration(member)
            ? (member.initializer as ts.ArrowFunction | ts.FunctionExpression).body
            : member.body;
          const mSigEnd = body ? body.getStart(sourceFile) : member.getEnd();
          const mRawSig = content.slice(member.getStart(sourceFile), mSigEnd).replace(/\{\s*$/, '');
          symbols.push({
            kind: 'method',
            name: `${name}.${memberName}`,
            signature: `  ${compactWhitespace(mRawSig, 130)}`,
            startLine: mRange.startLine,
            endLine: mRange.endLine,
            exported,
          });
        }
      }
      return;
    }

    if (ts.isInterfaceDeclaration(node)) {
      const name = node.name.getText(sourceFile);
      const exported = hasExportModifier(node);
      if (exported) exportsSet.add(name);
      const { startLine, endLine } = getRange(node);
      const memberNames = node.members
        .map(m => m.name?.getText(sourceFile))
        .filter((n): n is string => Boolean(n))
        .slice(0, 8);
      const heritage = node.heritageClauses
        ? ' ' + node.heritageClauses.map(h => h.getText(sourceFile)).join(' ')
        : '';
      const prefix = `${exported ? 'export ' : ''}interface ${name}${heritage}`;
      const sig = memberNames.length
        ? `${prefix} { ${memberNames.join(', ')}${node.members.length > 8 ? ', ...' : ''} }`
        : prefix;
      symbols.push({
        kind: 'interface',
        name,
        signature: compactWhitespace(sig),
        startLine,
        endLine,
        exported,
      });
      return;
    }

    if (ts.isTypeAliasDeclaration(node)) {
      const name = node.name.getText(sourceFile);
      const exported = hasExportModifier(node);
      if (exported) exportsSet.add(name);
      const { startLine, endLine } = getRange(node);
      symbols.push({
        kind: 'type',
        name,
        signature: compactWhitespace(node.getText(sourceFile), 140),
        startLine,
        endLine,
        exported,
      });
      return;
    }

    if (ts.isEnumDeclaration(node)) {
      const name = node.name.getText(sourceFile);
      const exported = hasExportModifier(node);
      if (exported) exportsSet.add(name);
      const { startLine, endLine } = getRange(node);
      const members = node.members.map(m => m.name.getText(sourceFile)).slice(0, 8).join(', ');
      symbols.push({
        kind: 'enum',
        name,
        signature: compactWhitespace(`${exported ? 'export ' : ''}enum ${name} { ${members} }`),
        startLine,
        endLine,
        exported,
      });
      return;
    }

    if (ts.isVariableStatement(node)) {
      const exported = hasExportModifier(node);
      const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
      const kw = isConst ? 'const' : 'let';

      for (const decl of node.declarationList.declarations) {
        const name = decl.name.getText(sourceFile);
        const init = decl.initializer;
        const isFunc = Boolean(init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)));

        if (!exported && !isFunc) continue;
        if (exported) exportsSet.add(name);

        const { startLine, endLine } = getRange(node);
        let signature: string;

        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          const bodyStart = init.body.getStart(sourceFile);
          const fnHeader = content.slice(decl.getStart(sourceFile), bodyStart).replace(/=>\s*$/, '=>').trim();
          signature = compactWhitespace(`${exported ? 'export ' : ''}${kw} ${fnHeader}`);
          symbols.push({
            kind: 'function',
            name,
            signature,
            startLine,
            endLine,
            exported,
          });
        } else {
          const typeNode = decl.type ? `: ${decl.type.getText(sourceFile)}` : '';
          signature = compactWhitespace(`${exported ? 'export ' : ''}${kw} ${name}${typeNode}`);
          symbols.push({
            kind: 'const',
            name,
            signature,
            startLine,
            endLine,
            exported,
          });
        }
      }
    }
  };

  ts.forEachChild(sourceFile, visitTopLevel);

  return {
    symbols,
    imports: Array.from(new Set(imports)),
    exports: Array.from(exportsSet),
  };
}

function extractPythonOutline(lines: string[]): { symbols: AstSymbolItem[]; imports: string[]; exports: string[] } {
  const symbols: AstSymbolItem[] = [];
  const imports: string[] = [];
  const exports: string[] = [];

  let currentClass: { name: string; indent: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const importMatch = /^(?:from\s+([A-Za-z0-9_.]+)\s+import\s+.+|import\s+([A-Za-z0-9_.,\s]+))$/.exec(trimmed);
    if (importMatch) {
      imports.push((importMatch[1] || importMatch[2]).trim());
      continue;
    }

    const defMatch = /^(\s*)(async\s+def|def|class)\s+([A-Za-z_][A-Za-z0-9_]*)\b(.*)$/.exec(raw);
    if (!defMatch) continue;

    const indent = defMatch[1].length;
    const kw = defMatch[2];
    const name = defMatch[3];

    if (currentClass && indent <= currentClass.indent) {
      currentClass = null;
    }

    // Collect multi-line signature until ':'
    let sigLines = raw.trim();
    let sigEndIdx = i;
    while (!sigLines.endsWith(':') && !sigLines.includes('):') && sigEndIdx + 1 < lines.length && sigEndIdx - i < 8) {
      sigEndIdx++;
      sigLines += ' ' + lines[sigEndIdx].trim();
    }
    const cleanSig = compactWhitespace(sigLines.replace(/:\s*$/, ''));

    // Find end of indented block
    let endLine = sigEndIdx + 1;
    for (let j = sigEndIdx + 1; j < lines.length; j++) {
      const nextTrim = lines[j].trim();
      if (!nextTrim || nextTrim.startsWith('#')) continue;
      const nextIndent = lines[j].match(/^\s*/)?.[0].length ?? 0;
      if (nextIndent <= indent) break;
      endLine = j + 1;
    }

    const exported = !name.startsWith('_');
    if (exported && indent === 0) exports.push(name);

    if (kw === 'class') {
      currentClass = { name, indent };
      symbols.push({
        kind: 'class',
        name,
        signature: cleanSig,
        startLine: i + 1,
        endLine,
        exported,
      });
    } else if (currentClass && indent > currentClass.indent) {
      symbols.push({
        kind: 'method',
        name: `${currentClass.name}.${name}`,
        signature: `  ${cleanSig}`,
        startLine: i + 1,
        endLine,
        exported,
      });
    } else {
      symbols.push({
        kind: 'function',
        name,
        signature: cleanSig,
        startLine: i + 1,
        endLine,
        exported,
      });
    }
  }

  return { symbols, imports: Array.from(new Set(imports)), exports };
}

function findBraceBlockEnd(lines: string[], startIndex: number): number {
  let depth = 0;
  let opened = false;
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '{') {
        depth++;
        opened = true;
      } else if (ch === '}') {
        depth--;
        if (opened && depth <= 0) {
          return i + 1;
        }
      }
    }
    if (!opened && i > startIndex + 3) break;
  }
  return startIndex + 1;
}

function extractGoOutline(lines: string[]): { symbols: AstSymbolItem[]; imports: string[]; exports: string[] } {
  const symbols: AstSymbolItem[] = [];
  const imports: string[] = [];
  const exports: string[] = [];
  let inImportBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (trimmed.startsWith('import (')) {
      inImportBlock = true;
      continue;
    }
    if (inImportBlock) {
      if (trimmed === ')') {
        inImportBlock = false;
      } else {
        const pkg = trimmed.replace(/^['"`]|['"`]$/g, '').split(/\s+/).pop()?.replace(/['"`]/g, '');
        if (pkg) imports.push(pkg);
      }
      continue;
    }
    const singleImport = /^import\s+(?:[A-Za-z0-9_.]+\s+)?"([^"]+)"/.exec(trimmed);
    if (singleImport) {
      imports.push(singleImport[1]);
      continue;
    }

    const funcMatch = /^func\s+(?:\(([^)]+)\)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(trimmed);
    if (funcMatch) {
      const receiver = funcMatch[1]?.trim();
      const name = funcMatch[2];
      const exported = /^[A-Z]/.test(name);
      if (exported && !receiver) exports.push(name);
      const endLine = findBraceBlockEnd(lines, i);
      const sig = compactWhitespace(trimmed.replace(/\{\s*$/, ''));
      const recvType = receiver ? receiver.split(/\s+/).pop()?.replace(/^\*/, '') : undefined;
      symbols.push({
        kind: recvType ? 'method' : 'function',
        name: recvType ? `${recvType}.${name}` : name,
        signature: sig,
        startLine: i + 1,
        endLine,
        exported,
      });
      continue;
    }

    const typeMatch = /^type\s+([A-Za-z_][A-Za-z0-9_]*)\s+(struct|interface|[^\s{]+)/.exec(trimmed);
    if (typeMatch) {
      const name = typeMatch[1];
      const kindSpec = typeMatch[2];
      const exported = /^[A-Z]/.test(name);
      if (exported) exports.push(name);
      const endLine = trimmed.includes('{') ? findBraceBlockEnd(lines, i) : i + 1;
      const kind: AstSymbolItem['kind'] =
        kindSpec === 'interface' ? 'interface' : kindSpec === 'struct' ? 'class' : 'type';
      symbols.push({
        kind,
        name,
        signature: compactWhitespace(trimmed.replace(/\{\s*$/, '')),
        startLine: i + 1,
        endLine,
        exported,
      });
    }
  }

  return { symbols, imports: Array.from(new Set(imports)), exports };
}

function extractRustOutline(lines: string[]): { symbols: AstSymbolItem[]; imports: string[]; exports: string[] } {
  const symbols: AstSymbolItem[] = [];
  const imports: string[] = [];
  const exports: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    const useMatch = /^(?:pub\s+)?use\s+([^;]+);/.exec(trimmed);
    if (useMatch) {
      imports.push(useMatch[1].trim());
      continue;
    }

    const itemMatch = /^(pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?(fn|struct|enum|trait|impl|type|const)\s+(.+)$/.exec(trimmed);
    if (!itemMatch) continue;

    const exported = Boolean(itemMatch[1]);
    const kw = itemMatch[2];
    const rest = itemMatch[3];

    let name = '';
    if (kw === 'impl') {
      const implName = rest.replace(/<[^>]+>/g, '').split(/\{|where/)[0].trim();
      name = `impl ${implName}`;
    } else {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(rest);
      name = m ? m[1] : kw;
    }

    if (exported && kw !== 'impl') exports.push(name);
    const hasBrace = trimmed.includes('{') || (i + 1 < lines.length && lines[i + 1].includes('{'));
    const endLine = hasBrace ? findBraceBlockEnd(lines, i) : i + 1;
    const sig = compactWhitespace(trimmed.replace(/\{\s*$/, ''));

    const kindMap: Record<string, AstSymbolItem['kind']> = {
      fn: lines[i].startsWith('  ') || lines[i].startsWith('\t') ? 'method' : 'function',
      struct: 'class',
      enum: 'enum',
      trait: 'interface',
      impl: 'class',
      type: 'type',
      const: 'const',
    };

    symbols.push({
      kind: kindMap[kw] ?? 'const',
      name,
      signature: lines[i].startsWith('  ') ? `  ${sig}` : sig,
      startLine: i + 1,
      endLine,
      exported,
    });
  }

  return { symbols, imports: Array.from(new Set(imports)), exports };
}

function extractMarkdownOutline(lines: string[]): { symbols: AstSymbolItem[]; imports: string[]; exports: string[] } {
  const symbols: AstSymbolItem[] = [];
  const headings: { level: number; text: string; line: number }[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+)$/.exec(raw.trim());
    if (m) {
      headings.push({ level: m[1].length, text: m[2].trim(), line: i + 1 });
    }
  }

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    let endLine = lines.length;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= h.level) {
        endLine = Math.max(h.line, headings[j].line - 1);
        break;
      }
    }
    symbols.push({
      kind: 'const',
      name: h.text,
      signature: `${'#'.repeat(h.level)} ${h.text}`,
      startLine: h.line,
      endLine,
      exported: true,
    });
  }

  return { symbols, imports: [], exports: [] };
}

/**
 * Extracts AST symbols, line ranges [L<start>-L<end>], imports, exports, and a formatted outline.
 */
export function extractFileAstOutline(
  filePath: string,
  content: string
): FileAstOutline {
  const lines = content.length === 0 ? [] : content.split(/\r?\n/);
  const totalLines = lines.length;
  const ext = extname(filePath).toLowerCase();

  let extracted: { symbols: AstSymbolItem[]; imports: string[]; exports: string[] };

  if (TS_JS_EXTENSIONS.has(ext)) {
    extracted = extractTsJsAst(filePath, content, ext);
  } else if (ext === '.py') {
    extracted = extractPythonOutline(lines);
  } else if (ext === '.go') {
    extracted = extractGoOutline(lines);
  } else if (ext === '.rs') {
    extracted = extractRustOutline(lines);
  } else if (ext === '.md' || ext === '.markdown') {
    extracted = extractMarkdownOutline(lines);
  } else {
    extracted = extractTsJsAst(filePath, content, '.ts');
  }

  const { symbols, imports, exports } = extracted;
  const headerParts: string[] = [`File: ${filePath} (${totalLines} lines)`];
  if (imports.length > 0) {
    headerParts.push(`Imports (${imports.length}): ${imports.slice(0, 12).join(', ')}${imports.length > 12 ? ', ...' : ''}`);
  }
  if (exports.length > 0) {
    headerParts.push(`Exports (${exports.length}): ${exports.slice(0, 16).join(', ')}${exports.length > 16 ? ', ...' : ''}`);
  }

  if (symbols.length > 0) {
    const symbolLines = symbols.map(
      s => `  [L${s.startLine}-L${s.endLine}] ${s.signature}`
    );
    headerParts.push(`Outline (${symbols.length} symbols):\n${symbolLines.join('\n')}`);
  } else if (totalLines > 0) {
    const preview = lines
      .slice(0, Math.min(25, totalLines))
      .map((l, idx) => `  [L${idx + 1}] ${l}`)
      .join('\n');
    headerParts.push(`Preview:\n${preview}`);
  }

  return {
    totalLines,
    symbols,
    imports,
    exports,
    formatted: headerParts.join('\n'),
  };
}

/**
 * Detects overly broad or system directories (homedir, desktop root, AppData, etc.)
 * where generating an AST repository map would scan thousands of unrelated files.
 */
export function isBroadOrSystemWorkspace(ws?: string): boolean {
  if (!ws) return true;
  const resolved = resolve(ws).toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
  const home = homedir().toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');

  // 1. Kullanıcının ana dizini (os.homedir())
  if (resolved === home) return true;

  // 2. Masaüstü kök dizini (Desktop / Masaüstü)
  if (resolved === `${home}/desktop` || resolved === `${home}/masaüstü`) return true;

  // 3. AppData / Local / Programs kurulu Electron dizini
  if (resolved.includes('/appdata/local/programs') || resolved.includes('/appdata/roaming')) {
    return true;
  }

  // 4. Sürücü kök dizini (C:, D:, /)
  if (/^[a-z]:$/i.test(resolved) || resolved === '') return true;

  return false;
}

const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_SCAN_ENTRIES = 10_000;
const MAX_SCAN_DIRECTORIES = 512;
const MAX_INSPECTED_FILES = 80;
const MAX_CACHE_SYMBOLS = 8192;
const MAX_FILE_SYMBOLS = 512;
const comparePath = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function queryTerms(query: string): string[] {
  const raw = query.slice(0, 4000);
  const words = `${raw} ${raw.replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, '$1 $2').replace(/_/g, ' ')}`
    .normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}_]+/u);
  return [...new Set(words.filter(word => word.length >= 2))].slice(0, 24);
}

function nameScore(name: string, terms: string[]): number {
  const lower = name.normalize('NFKC').toLowerCase();
  const parts = lower.split(/[^\p{L}\p{N}_]+/u);
  return terms.reduce((score, term) => score + (lower === term ? 40 : parts.includes(term) ? 16 : lower.includes(term) ? 5 : 0), 0);
}

function pathScore(file: string, terms: string[]): number {
  const normalized = file.replace(/\\/g, '/');
  const base = normalized.slice(normalized.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
  return nameScore(base, terms) * 3 + nameScore(normalized, terms) + (/(?:^|\/)src\//.test(normalized) ? 4 : 0)
    - (/(?:^|\/)(?:test|tests|docs)\//.test(normalized) ? 1 : 0);
}

/** Deterministic filename selection; no disk access, embeddings or model calls. */
export function rankRepoPaths(paths: string[], query: string, limit = MAX_INSPECTED_FILES): string[] {
  const terms = queryTerms(query);
  const count = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : MAX_INSPECTED_FILES;
  if (!count) return [];
  return [...new Set(paths)].map(file => ({ file, score: pathScore(file, terms) }))
    .sort((a, b) => b.score - a.score || comparePath(a.file, b.file)).slice(0, count).map(item => item.file);
}

type IgnoreToken = { kind: 'literal'; value: string } | { kind: 'star' | 'all' | 'directories' | 'any' } | { kind: 'class'; test: RegExp };
interface IgnoreRule { base: string; tokens: IgnoreToken[]; directory: boolean; negate: boolean }

function ignorePattern(pattern: string, anchored: boolean): IgnoreToken[] {
  if (pattern.length > 256) throw new Error('Ignore pattern exceeds budget');
  const tokens: IgnoreToken[] = !anchored && !pattern.includes('/') ? [{ kind: 'directories' }] : [];
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        const globstar = (i === 0 || pattern[i - 1] === '/') && (pattern[i + 2] === '/' || pattern[i + 2] === undefined);
        i++;
        if (globstar && pattern[i + 1] === '/') { tokens.push({ kind: 'directories' }); i++; }
        else tokens.push({ kind: globstar ? 'all' : 'star' });
      } else tokens.push({ kind: 'star' });
    } else if (char === '?') tokens.push({ kind: 'any' });
    else if (char === '[' && pattern.indexOf(']', i + 1) > i + 1) {
      const end = pattern.indexOf(']', i + 1);
      const value = pattern.slice(i + 1, end).replace(/^!/, '^');
      tokens.push({ kind: 'class', test: new RegExp(`^[${value}]$`) });
      i = end;
    } else tokens.push({ kind: 'literal', value: char === '\\' && i + 1 < pattern.length ? pattern[++i] : char });
  }
  return tokens;
}

/** Bounded wildcard DP avoids catastrophic regex backtracking on repository input. */
function ignoreMatches(tokens: IgnoreToken[], input: string, budget: { remaining: number }): boolean {
  const work = tokens.length * (input.length + 1);
  if (work > budget.remaining) throw new Error('Ignore matching budget exceeded');
  budget.remaining -= work;
  let previous = new Uint8Array(input.length + 1);
  previous[0] = 1;
  for (const token of tokens) {
    const row = new Uint8Array(input.length + 1);
    if (token.kind === 'star' || token.kind === 'all' || token.kind === 'directories') row[0] = previous[0];
    let prefix = Boolean(previous[0]);
    for (let i = 1; i <= input.length; i++) {
      const char = input[i - 1];
      if (token.kind === 'star' || token.kind === 'all') row[i] = Number(Boolean(previous[i] || (row[i - 1] && (token.kind === 'all' || char !== '/'))));
      else if (token.kind === 'directories') row[i] = Number(Boolean(previous[i] || (prefix && char === '/')));
      else row[i] = Number(Boolean(previous[i - 1] && (token.kind === 'literal' ? char === token.value : char !== '/' && (token.kind === 'any' || (token.kind === 'class' && token.test.test(char))))));
      prefix ||= Boolean(previous[i]);
    }
    previous = row;
  }
  return Boolean(previous[input.length]);
}

async function readIgnoreRules(directory: string, base: string): Promise<IgnoreRule[]> {
  const file = join(directory, '.gitignore');
  let info;
  try { info = await lstat(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024) throw new Error('Ignore file cannot be safely read');
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(32 * 1024 + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 32 * 1024) throw new Error('Ignore file exceeds size limit');
    const rules: IgnoreRule[] = [];
    for (let line of buffer.toString('utf8', 0, bytesRead).replace(/^\uFEFF/, '').split(/\r?\n/)) {
      line = line.replace(/(?<!\\) +$/, '');
      if (!line || line.startsWith('#')) continue;
      const negate = line.startsWith('!');
      if (negate) line = line.slice(1);
      const directoryOnly = line.endsWith('/');
      if (directoryOnly) line = line.slice(0, -1);
      const anchored = line.startsWith('/');
      if (anchored) line = line.slice(1);
      if (!line) continue;
      rules.push({ base, tokens: ignorePattern(line, anchored), directory: directoryOnly, negate });
      if (rules.length >= 512) throw new Error('Ignore rule budget exceeded');
    }
    return rules;
  } finally { await handle.close(); }
}

function isIgnored(file: string, directory: boolean, rules: IgnoreRule[], budget: { remaining: number }): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.directory && !directory) continue;
    const rel = rule.base ? file.slice(rule.base.length + 1) : file;
    if (ignoreMatches(rule.tokens, rel, budget)) ignored = !rule.negate;
  }
  return ignored;
}

async function collectWorkspaceSourceFiles(root: string, query: string, deadline: number): Promise<{ files: string[]; limited: boolean }> {
  const files: string[] = [];
  const terms = queryTerms(query);
  const requestedNames = new Set((query.slice(0, 4000).match(/[\p{L}\p{N}_.-]+\.[\p{L}\p{N}]{1,12}(?=$|[^\p{L}\p{N}])/gu) ?? []).map(name => name.toLowerCase()));
  const queue: Array<{ directory: string; rules: IgnoreRule[]; score: number }> = [{ directory: root, rules: [], score: 0 }];
  let entriesSeen = 0, directoriesSeen = 0, limited = false;
  const ignoreBudget = { remaining: 2_000_000 };
  while (queue.length) {
    if (Date.now() >= deadline || entriesSeen >= MAX_SCAN_ENTRIES || directoriesSeen >= MAX_SCAN_DIRECTORIES) { limited = true; break; }
    queue.sort((a, b) => b.score - a.score || comparePath(a.directory, b.directory));
    const current = queue.shift()!;
    directoriesSeen++;
    try {
      if ((await lstat(current.directory)).isSymbolicLink() || await realpath(current.directory) !== current.directory) { limited = true; continue; }
      const base = relative(root, current.directory).replace(/\\/g, '/');
      const rules = [...current.rules, ...await readIgnoreRules(current.directory, base)];
      if (rules.length > 1024) { limited = true; continue; }
      const directory = await opendir(current.directory);
      const entries = [];
      for await (const entry of directory) {
        if (entriesSeen++ >= MAX_SCAN_ENTRIES || Date.now() >= deadline) { limited = true; break; }
        entries.push(entry);
      }
      entries.sort((a, b) => comparePath(a.name, b.name));
      for (const entry of entries) {
        if (Date.now() >= deadline) { limited = true; break; }
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
        const rel = base ? `${base}/${entry.name}` : entry.name;
        if (isIgnored(rel, entry.isDirectory(), rules, ignoreBudget)) continue;
        const full = join(current.directory, entry.name);
        if (entry.isDirectory()) {
          queue.push({ directory: full, rules, score: pathScore(rel, terms) });
        } else if (entry.isFile() && (SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase()) || requestedNames.has(entry.name.toLowerCase())) && (!/\.d\.(?:ts|mts|cts)$/i.test(entry.name) || requestedNames.has(entry.name.toLowerCase()))) files.push(full);
      }
    } catch { limited = true; /* Unreadable or unsafe directories remain visibly outside coverage. */ }
  }
  return { files, limited };
}

function cacheFile(file: string, entry: RepoMapCacheEntry): void {
  const chars = (item: RepoMapCacheEntry) => item.symbols.reduce((count, symbol) => count + symbol.name.length, 0);
  const entryChars = chars(entry);
  if (entry.symbols.length > MAX_FILE_SYMBOLS || entryChars > 256 * 1024) return;
  repoMapCache.delete(file);
  while (repoMapCache.size >= 128 || [...repoMapCache.values()].reduce((count, item) => count + item.symbols.length, 0) + entry.symbols.length > MAX_CACHE_SYMBOLS || [...repoMapCache.values()].reduce((count, item) => count + chars(item), 0) + entryChars > 256 * 1024) {
    const first = repoMapCache.keys().next().value;
    if (first === undefined) break;
    repoMapCache.delete(first);
  }
  repoMapCache.set(file, entry);
}

async function inspectSource(root: string, file: string): Promise<RepoMapCacheEntry | undefined> {
  if (!PARSED_SOURCE_EXTENSIONS.has(extname(file).toLowerCase())) return;
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) return;
  const canonical = await realpath(file);
  const rel = relative(root, canonical);
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel) || canonical !== file) return;
  if (info.size > MAX_SOURCE_BYTES) return;
  const handle = await open(file, 'r');
  try {
    const before = await handle.stat({ bigint: true });
    if (before.size > BigInt(MAX_SOURCE_BYTES)) return;
    const revision = [before.dev, before.ino, before.size, before.mtimeNs, before.ctimeNs].join(':');
    const cached = repoMapCache.get(file);
    if (cached?.revision === revision) return cached;
    const buffer = Buffer.alloc(Math.min(MAX_SOURCE_BYTES + 1, Number(before.size) + 1));
    let read = 0;
    while (read < buffer.length) {
      const { bytesRead } = await handle.read(buffer, read, buffer.length - read, null);
      if (!bytesRead) break;
      read += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (read !== Number(before.size) || buffer.subarray(0, read).includes(0) || [after.dev, after.ino, after.size, after.mtimeNs, after.ctimeNs].join(':') !== revision) return;
    const outline = extractFileAstOutline(relative(root, file), buffer.toString('utf8', 0, read));
    const entry = { revision, totalLines: outline.totalLines,
      symbols: outline.symbols.map(({ name, kind, startLine, endLine, exported }) => ({ name: Buffer.from(name).toString('utf8'), kind, startLine, endLine, exported })) };
    cacheFile(file, entry);
    return entry;
  } finally { await handle.close(); }
}

/** Bounded inventory, filename selection and query-ranked source symbols. */
export async function buildWorkspaceRepoMap(workspace: string, query = '', maxTokens = 900): Promise<string> {
  if (!workspace || isBroadOrSystemWorkspace(workspace) || !Number.isFinite(maxTokens) || maxTokens <= 0) return '';
  let root: string;
  try { root = await realpath(workspace); } catch { return ''; }
  if (isBroadOrSystemWorkspace(root)) return '';
  const start = Date.now();
  const inventory = await collectWorkspaceSourceFiles(root, query, start + 100);
  if (!inventory.files.length) {
    const notice = '[Workspace AST Repo Map; partial]\n[Coverage: inventory/time/ignore limit reached; use file_glob or file_search.]';
    return inventory.limited && estimateTokens(notice) <= maxTokens ? notice : '';
  }
  const paths = new Map(inventory.files.map(file => [relative(root, file).replace(/\\/g, '/'), file]));
  const terms = queryTerms(query);
  const rankedPaths = rankRepoPaths([...paths.keys()], query, MAX_INSPECTED_FILES);
  const entries: Array<{ file: string; score: number; totalLines?: number; symbols: string[] }> = [];
  let inspected = 0;
  for (const file of rankedPaths) {
    let outline: RepoMapCacheEntry | undefined;
    if (Date.now() - start < 250) {
      try { outline = await inspectSource(root, paths.get(file)!); } catch { /* A vanished file grants no source evidence. */ }
    }
    if (outline) inspected++;
    const symbols = outline?.symbols.filter(symbol => symbol.exported || symbol.kind !== 'method' || nameScore(symbol.name, terms) > 0)
      .map(symbol => ({ symbol, score: nameScore(symbol.name, terms) }))
      .sort((a, b) => b.score - a.score || Number(b.symbol.exported) - Number(a.symbol.exported) || a.symbol.startLine - b.symbol.startLine) ?? [];
    entries.push({ file, score: pathScore(file, terms) + (symbols[0]?.score ?? 0), totalLines: outline?.totalLines,
      symbols: symbols.slice(0, 10).map(({ symbol }) => `${symbol.name}[L${symbol.startLine}-${symbol.endLine}]`) });
  }
  entries.sort((a, b) => b.score - a.score || comparePath(a.file, b.file));
  const footer = `[Coverage: ${inventory.files.length} candidate files, ${inspected} inspected; ${inventory.limited ? 'inventory/time limit; ' : ''}partial map, search omitted files.]`;
  const lines = ['[Workspace AST Repo Map; partial]'];
  for (const entry of entries) {
    const symbols = [...entry.symbols];
    let line: string;
    do {
      line = `- ${entry.file} (${entry.totalLines === undefined ? 'not inspected' : `${entry.totalLines}L`})${symbols.length ? `: ${symbols.join(', ')}` : ''}`;
      if (estimateTokens([...lines, line, footer].join('\n')) <= maxTokens) break;
      symbols.pop();
    } while (symbols.length);
    if (estimateTokens([...lines, line, footer].join('\n')) <= maxTokens) lines.push(line);
  }
  if (lines.length === 1) return '';
  return [...lines, footer].join('\n');
}
