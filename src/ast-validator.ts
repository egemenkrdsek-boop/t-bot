import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import ts from 'typescript';

export interface AstValidationResult {
  valid: boolean;
  error?: string;
  warnings?: string[];
}

const BUILTIN_SET = new Set<string>([
  ...builtinModules,
  ...builtinModules.map(m => (m.startsWith('node:') ? m.slice(5) : `node:${m}`)),
]);

const HTML_VOID_ELEMENTS = new Set<string>([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Resolves a relative import specifier (./ or ../) against the filesystem.
 * Supports TypeScript ESM conventions (.js -> .ts/.tsx) and index files.
 */
export function resolveRelativeImport(
  filePath: string,
  spec: string,
  workspace: string
): string | null {
  try {
    const fullFilePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(workspace, filePath);
    const baseDir = path.dirname(fullFilePath);
    const cleanSpec = spec.split(/[?#]/)[0];
    const targetBase = path.resolve(baseDir, cleanSpec);

    const isFile = (p: string): boolean => {
      try {
        return fs.existsSync(p) && fs.statSync(p).isFile();
      } catch {
        return false;
      }
    };

    if (isFile(targetBase)) {
      return targetBase;
    }

    // Handle TypeScript ESM .js / .jsx / .mjs / .cjs -> .ts / .tsx / .mts / .cts mapping
    if (/\.(m|c)?jsx?$/i.test(cleanSpec)) {
      const stripped = targetBase.replace(/\.(m|c)?jsx?$/i, '');
      const candidates = [
        `${stripped}.ts`,
        `${stripped}.tsx`,
        `${stripped}.d.ts`,
        `${stripped}.mts`,
        `${stripped}.cts`,
        `${stripped}.js`,
        `${stripped}.jsx`,
        path.join(stripped, 'index.ts'),
        path.join(stripped, 'index.tsx'),
        path.join(stripped, 'index.d.ts'),
        path.join(stripped, 'index.js'),
        path.join(stripped, 'index.jsx'),
      ];
      for (const candidate of candidates) {
        if (isFile(candidate)) return candidate;
      }
    }

    const extensions = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.json'];
    for (const ext of extensions) {
      const candidate = `${targetBase}${ext}`;
      if (isFile(candidate)) return candidate;
    }

    for (const ext of extensions) {
      const candidate = path.join(targetBase, `index${ext}`);
      if (isFile(candidate)) return candidate;
    }

    return null;
  } catch {
    return null;
  }
}

function collectBindingNames(name: ts.BindingName, out: Set<string>): void {
  if (ts.isIdentifier(name)) {
    out.add(name.text);
  } else if (ts.isObjectBindingPattern(name)) {
    for (const el of name.elements) {
      collectBindingNames(el.name, out);
    }
  } else if (ts.isArrayBindingPattern(name)) {
    for (const el of name.elements) {
      if (ts.isBindingElement(el)) {
        collectBindingNames(el.name, out);
      }
    }
  }
}

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  return Boolean(modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword));
}

function hasDefaultModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  return Boolean(modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword));
}

/**
 * Parses a target TypeScript/JavaScript module and extracts its exported symbol names.
 */
export function extractModuleExports(targetFilePath: string): {
  exports: Set<string>;
  hasWildcard: boolean;
} {
  const exports = new Set<string>();
  let hasWildcard = false;

  const ext = path.extname(targetFilePath).toLowerCase();
  if (ext === '.json') {
    exports.add('default');
    hasWildcard = true;
    return { exports, hasWildcard };
  }

  let content = '';
  try {
    content = fs.readFileSync(targetFilePath, 'utf8');
  } catch {
    return { exports, hasWildcard: true };
  }

  const scriptKind =
    ext === '.tsx'
      ? ts.ScriptKind.TSX
      : ext === '.jsx'
        ? ts.ScriptKind.JSX
        : ext === '.js' || ext === '.mjs' || ext === '.cjs'
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS;

  const sourceFile = ts.createSourceFile(
    targetFilePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );

  for (const stmt of sourceFile.statements) {
    if (hasExportModifier(stmt)) {
      if (hasDefaultModifier(stmt)) {
        exports.add('default');
      }
      if (
        (ts.isFunctionDeclaration(stmt) ||
          ts.isClassDeclaration(stmt) ||
          ts.isInterfaceDeclaration(stmt) ||
          ts.isTypeAliasDeclaration(stmt) ||
          ts.isEnumDeclaration(stmt) ||
          ts.isModuleDeclaration(stmt)) &&
        stmt.name &&
        ts.isIdentifier(stmt.name)
      ) {
        exports.add(stmt.name.text);
      } else if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          collectBindingNames(decl.name, exports);
        }
      }
    } else if (ts.isExportDeclaration(stmt)) {
      if (!stmt.exportClause) {
        // export * from '...'
        hasWildcard = true;
      } else if (ts.isNamespaceExport(stmt.exportClause)) {
        // export * as ns from '...'
        exports.add(stmt.exportClause.name.text);
      } else if (ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          exports.add(el.name.text);
        }
      }
    } else if (ts.isExportAssignment(stmt)) {
      exports.add('default');
      if (stmt.isExportEquals) {
        hasWildcard = true;
      }
    }
  }

  // Fallback for CommonJS modules using module.exports / exports.*
  if (/\b(?:module\.exports|exports\.[a-zA-Z0-9_$]+)\b/.test(content)) {
    hasWildcard = true;
  }

  return { exports, hasWildcard };
}

function getBarePackageName(spec: string): string | null {
  if (
    !spec ||
    spec.startsWith('.') ||
    spec.startsWith('/') ||
    spec.startsWith('#') ||
    spec.startsWith('@/') ||
    spec.startsWith('~/') ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(spec)
  ) {
    return null;
  }
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    if (parts.length < 2 || !parts[0] || parts[0] === '@' || !parts[1]) return null;
    return `${parts[0]}/${parts[1]}`;
  }
  return spec.split('/')[0] || null;
}

function isPackageInstalledInWorkspace(pkgName: string, filePath: string, workspace: string): boolean {
  if (BUILTIN_SET.has(pkgName)) return true;

  const fullFilePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(workspace, filePath);

  // Collect candidate directories containing package.json from fileDir up to workspace
  const candidateDirs: string[] = [];
  const resolvedWorkspace = path.resolve(workspace);
  let curr = path.dirname(fullFilePath);
  while (true) {
    candidateDirs.push(curr);
    if (curr.toLowerCase() === resolvedWorkspace.toLowerCase()) break;
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  if (!candidateDirs.some(d => d.toLowerCase() === resolvedWorkspace.toLowerCase())) {
    candidateDirs.push(resolvedWorkspace);
  }

  let foundAnyPackageJson = false;

  for (const dir of candidateDirs) {
    const pkgJsonPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      foundAnyPackageJson = true;
      try {
        const raw = fs.readFileSync(pkgJsonPath, 'utf8');
        const pkg = JSON.parse(raw) as {
          name?: string;
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
          peerDependencies?: Record<string, string>;
          optionalDependencies?: Record<string, string>;
        };
        if (pkg.name === pkgName) return true;
        const deps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
          ...pkg.optionalDependencies,
        };
        const typesPkgName = pkgName.startsWith('@')
          ? `@types/${pkgName.slice(1).replace('/', '__')}`
          : `@types/${pkgName}`;
        if (pkgName in deps || typesPkgName in deps) {
          return true;
        }
      } catch {
        // Ignore malformed package.json during check
      }
    }

    const nodeModulesPkg = path.join(dir, 'node_modules', ...pkgName.split('/'));
    if (fs.existsSync(nodeModulesPkg)) {
      return true;
    }
  }

  // If no package.json exists in the workspace at all, skip check
  if (!foundAnyPackageJson) {
    return true;
  }

  return false;
}

function validateJsonSyntax(content: string): AstValidationResult {
  try {
    JSON.parse(content);
    return { valid: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const posMatch = msg.match(/position\s+(\d+)/i);
    if (posMatch) {
      const pos = Number(posMatch[1]);
      const upToPos = content.slice(0, pos);
      const lines = upToPos.split(/\r?\n/);
      const line = lines.length;
      const col = (lines[lines.length - 1]?.length ?? 0) + 1;
      return {
        valid: false,
        error: `JSON Sözdizimi Hatası (Satır ${line}:${col}): ${msg}`,
      };
    }
    return {
      valid: false,
      error: `JSON Sözdizimi Hatası: ${msg}`,
    };
  }
}

function validateTsJsAstAndGrounding(
  filePath: string,
  content: string,
  workspace: string,
  ext: string
): AstValidationResult {
  const warnings: string[] = [];

  const scriptKind =
    ext === '.tsx'
      ? ts.ScriptKind.TSX
      : ext === '.jsx'
        ? ts.ScriptKind.JSX
        : ext === '.js' || ext === '.mjs' || ext === '.cjs'
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS;

  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );

  const parseDiagnostics = (
    sourceFile as unknown as { parseDiagnostics?: ts.DiagnosticWithLocation[] }
  ).parseDiagnostics;

  if (parseDiagnostics && parseDiagnostics.length > 0) {
    const formatted = parseDiagnostics.slice(0, 5).map(d => {
      const pos =
        typeof d.start === 'number'
          ? sourceFile.getLineAndCharacterOfPosition(d.start)
          : { line: 0, character: 0 };
      const line = pos.line + 1;
      const col = pos.character + 1;
      const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
      return `TS${d.code} (Satır ${line}:${col}): ${msg}`;
    });
    return {
      valid: false,
      error: formatted.join('\n'),
      warnings,
    };
  }

  // Traverse top-level and nested ImportDeclaration / ExportDeclaration nodes
  const checkNode = (node: ts.Node): AstValidationResult | null => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const moduleSpec = node.moduleSpecifier;
      if (moduleSpec && ts.isStringLiteral(moduleSpec)) {
        const spec = moduleSpec.text.trim();

        if (spec.startsWith('./') || spec.startsWith('../')) {
          const resolvedTarget = resolveRelativeImport(filePath, spec, workspace);
          if (!resolvedTarget) {
            warnings.push(
              `Uyarı: '${spec}' göreli import hedefi henüz diskte bulunamadı (çok dosyalı değişiklikte sonraki adımda oluşturulacak olabilir).`
            );
          } else {
            // Check named imports/exports against actual exports of the target file on disk
            const requestedSymbols: string[] = [];

            if (ts.isImportDeclaration(node) && node.importClause?.namedBindings) {
              if (ts.isNamedImports(node.importClause.namedBindings)) {
                for (const el of node.importClause.namedBindings.elements) {
                  const origName = (el.propertyName ?? el.name).text;
                  if (origName) requestedSymbols.push(origName);
                }
              }
            } else if (
              ts.isExportDeclaration(node) &&
              node.exportClause &&
              ts.isNamedExports(node.exportClause)
            ) {
              for (const el of node.exportClause.elements) {
                const origName = (el.propertyName ?? el.name).text;
                if (origName) requestedSymbols.push(origName);
              }
            }

            if (requestedSymbols.length > 0) {
              const { exports: actualExports, hasWildcard } = extractModuleExports(resolvedTarget);
              if (!hasWildcard) {
                for (const sym of requestedSymbols) {
                  if (!actualExports.has(sym)) {
                    const exportList = Array.from(actualExports);
                    return {
                      valid: false,
                      error: `[HALÜSİNASYON ENGELİ - UYDURMA SEMBOL] '${spec}' dosyasında '${sym}' adında bir export bulunmuyor! Mevcut exportlar: [${exportList.join(', ')}]`,
                      warnings,
                    };
                  }
                }
              }
            }
          }
        } else if (spec.startsWith('node:')) {
          // Always valid built-in prefix
        } else {
          const pkgName = getBarePackageName(spec);
          if (pkgName && !BUILTIN_SET.has(pkgName)) {
            if (!isPackageInstalledInWorkspace(pkgName, filePath, workspace)) {
              return {
                valid: false,
                error: `[HALÜSİNASYON ENGELİ - OLMAYAN PAKET] '${pkgName}' paketi package.json veya node_modules içinde kurulu değil!`,
                warnings,
              };
            }
          }
        }
      }
    }

    let childError: AstValidationResult | null = null;
    ts.forEachChild(node, child => {
      if (!childError) {
        childError = checkNode(child);
      }
    });
    return childError;
  };

  const groundingFailure = checkNode(sourceFile);
  if (groundingFailure) {
    return groundingFailure;
  }

  return {
    valid: true,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

function validatePythonSyntax(content: string): AstValidationResult {
  const bracketStack: Array<{ char: '(' | '[' | '{'; line: number; col: number }> = [];
  const pairs: Record<string, '(' | '[' | '{'> = { ')': '(', ']': '[', '}': '{' };

  let i = 0;
  let line = 1;
  let col = 1;
  let inString: null | { quote: string; triple: boolean; line: number; col: number } = null;

  while (i < content.length) {
    const ch = content[i];

    if (inString) {
      if (ch === '\\') {
        i += 2;
        col += 2;
        continue;
      }
      if (inString.triple) {
        if (content.startsWith(inString.quote, i)) {
          i += 3;
          col += 3;
          inString = null;
          continue;
        }
      } else {
        if (ch === inString.quote) {
          i++;
          col++;
          inString = null;
          continue;
        }
        if (ch === '\n') {
          return {
            valid: false,
            error: `Python Sözdizimi Hatası (Satır ${inString.line}:${inString.col}): Kapatılmamış string literali (${inString.quote}).`,
          };
        }
      }
      if (ch === '\n') {
        line++;
        col = 1;
      } else {
        col++;
      }
      i++;
      continue;
    }

    // Comment
    if (ch === '#') {
      while (i < content.length && content[i] !== '\n') {
        i++;
        col++;
      }
      continue;
    }

    // String start
    if (ch === "'" || ch === '"') {
      const tripleQuote = ch.repeat(3);
      if (content.startsWith(tripleQuote, i)) {
        inString = { quote: tripleQuote, triple: true, line, col };
        i += 3;
        col += 3;
      } else {
        inString = { quote: ch, triple: false, line, col };
        i++;
        col++;
      }
      continue;
    }

    if (ch === '(' || ch === '[' || ch === '{') {
      bracketStack.push({ char: ch, line, col });
    } else if (ch === ')' || ch === ']' || ch === '}') {
      const expected = pairs[ch];
      if (bracketStack.length === 0) {
        return {
          valid: false,
          error: `Python Sözdizimi Hatası (Satır ${line}:${col}): Beklenmeyen kapatma parantezi '${ch}'.`,
        };
      }
      const top = bracketStack.pop()!;
      if (top.char !== expected) {
        return {
          valid: false,
          error: `Python Sözdizimi Hatası (Satır ${line}:${col}): '${top.char}' (Satır ${top.line}:${top.col}) ile '${ch}' parantez uyuşmazlığı.`,
        };
      }
    }

    if (ch === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
    i++;
  }

  if (inString) {
    return {
      valid: false,
      error: `Python Sözdizimi Hatası (Satır ${inString.line}:${inString.col}): Kapatılmamış string literali (${inString.quote}).`,
    };
  }

  if (bracketStack.length > 0) {
    const top = bracketStack[bracketStack.length - 1];
    return {
      valid: false,
      error: `Python Sözdizimi Hatası (Satır ${top.line}:${top.col}): Kapatılmamış parantez '${top.char}'.`,
    };
  }

  // Check indentation consistency and block colon structure on logical lines
  const lines = content.split(/\r?\n/);
  let expectIndentAfterLine: number | null = null;
  let prevIndent = 0;

  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx];
    const strippedComment = rawLine.replace(/#.*$/, '');
    if (!strippedComment.trim()) continue;

    const leadingMatch = strippedComment.match(/^[ \t]*/);
    const leading = leadingMatch ? leadingMatch[0] : '';
    if (leading.includes(' ') && leading.includes('\t')) {
      return {
        valid: false,
        error: `Python Girinti Hatası (Satır ${idx + 1}): Aynı satırda tab ve boşluk (space) birlikte kullanılamaz.`,
      };
    }

    const indent = leading.length;
    if (expectIndentAfterLine !== null) {
      if (indent <= prevIndent) {
        return {
          valid: false,
          error: `Python Girinti Hatası (Satır ${idx + 1}): Satır ${expectIndentAfterLine}'deki ':' bloğundan sonra girintili (indented) blok bekleniyordu.`,
        };
      }
      expectIndentAfterLine = null;
    }

    const trimmed = strippedComment.trim();
    if (/^(?:else|finally)\s+[^:]/.test(trimmed)) {
      return {
        valid: false,
        error: `Python Sözdizimi Hatası (Satır ${idx + 1}): '${trimmed.split(/\s+/)[0]}' ifadesinden sonra ':' bekleniyor.`,
      };
    }

    // If line ends with ':' and is not a single-line suite
    if (trimmed.endsWith(':') && !trimmed.endsWith('\\')) {
      expectIndentAfterLine = idx + 1;
      prevIndent = indent;
    }
  }

  return { valid: true };
}

function validateHtmlSyntax(content: string): AstValidationResult {
  // Strip comments, doctype, and script/style bodies before checking tag balance
  const cleaned = content
    .replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '))
    .replace(/<!DOCTYPE[^>]*>/gi, m => m.replace(/[^\n]/g, ' '))
    .replace(/<(script|style)\b[^>]*>([\s\S]*?)<\/\1>/gi, (m, tag) => {
      const newlines = m.match(/\n/g)?.length ?? 0;
      return `<${tag}>${'\n'.repeat(newlines)}</${tag}>`;
    });

  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9-]*)(\s+[^>]*?)?(\/?)>/g;
  const stack: Array<{ tag: string; line: number }> = [];

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(cleaned)) !== null) {
    const fullTag = match[0];
    const tagName = match[1].toLowerCase();
    const selfClosing = match[3] === '/' || HTML_VOID_ELEMENTS.has(tagName);
    const isClosing = fullTag.startsWith('</');

    const line = cleaned.slice(0, match.index).split('\n').length;

    if (selfClosing && !isClosing) {
      continue;
    }

    if (isClosing) {
      if (stack.length === 0) {
        return {
          valid: false,
          error: `HTML Sözdizimi Hatası (Satır ${line}): Açılmamış '</${tagName}>' kapatma etiketi.`,
        };
      }
      const top = stack.pop()!;
      if (top.tag !== tagName) {
        return {
          valid: false,
          error: `HTML Sözdizimi Hatası (Satır ${line}): '<${top.tag}>' (Satır ${top.line}) etiketi '</${tagName}>' ile kapatıldı.`,
        };
      }
    } else {
      stack.push({ tag: tagName, line });
    }
  }

  if (stack.length > 0) {
    const top = stack[stack.length - 1];
    return {
      valid: false,
      error: `HTML Sözdizimi Hatası (Satır ${top.line}): Açılan '<${top.tag}>' etiketi kapatılmadı.`,
    };
  }

  return { valid: true };
}

/**
 * Deterministic in-memory AST and Grounding validator that runs BEFORE writing to disk.
 */
export async function validateCodeAstAndGrounding(
  filePath: string,
  content: string,
  workspace: string
): Promise<AstValidationResult> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.json') {
    return validateJsonSyntax(content);
  }

  if (
    ext === '.ts' ||
    ext === '.tsx' ||
    ext === '.js' ||
    ext === '.jsx' ||
    ext === '.mjs' ||
    ext === '.cjs' ||
    ext === '.mts' ||
    ext === '.cts'
  ) {
    return validateTsJsAstAndGrounding(filePath, content, workspace, ext);
  }

  if (ext === '.py') {
    return validatePythonSyntax(content);
  }

  if (ext === '.html' || ext === '.htm') {
    return validateHtmlSyntax(content);
  }

  return { valid: true };
}
