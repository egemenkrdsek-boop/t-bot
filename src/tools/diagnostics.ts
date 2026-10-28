/**
 * Local TypeScript diagnostics without a language server.
 *
 * This is a pragmatic coding-intelligence tool: it uses the TypeScript
 * compiler already present in the project, respects tsconfig.json when one
 * exists, and returns a bounded list of syntactic and semantic errors. It is
 * not a full LSP client and it does not claim to diagnose other languages.
 */
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import * as ts from 'typescript';
import type { ToolDefinition } from '../types.js';
import { resolveWorkspacePath } from '../security/paths.js';

const MAX_FILES = 200;
const MAX_DIAGNOSTICS = 100;
const MAX_FILE_BYTES = 1_000_000;

export const diagnosticsToolDefinitions: ToolDefinition[] = [
  {
    name: 'diagnostics',
    description: 'Run local TypeScript/JavaScript diagnostics using the project tsconfig. Returns bounded syntactic and semantic errors. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Optional workspace file or directory to check. Defaults to the project files.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum diagnostics to return (default 50).' },
      },
      additionalProperties: false,
    },
  },
];

function defaultOptions(): ts.CompilerOptions {
  return {
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    allowJs: true,
    checkJs: false,
  };
}

function workspaceFiles(workspace: string): string[] {
  return ts.sys.readDirectory(
    workspace,
    ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'],
    ['node_modules', 'dist', 'build', '.git', '.tbot', 'release', 'artifacts'],
    undefined,
    MAX_FILES
  ).slice(0, MAX_FILES);
}

async function safeSourceFiles(workspace: string, rootNames: string[]): Promise<string[]> {
  const selected: string[] = [];
  for (const file of rootNames) {
    if (selected.length >= MAX_FILES) break;
    try {
      const info = await readFile(file);
      if (info.length <= MAX_FILE_BYTES) selected.push(file);
    } catch { /* missing files are reported by the compiler if referenced */ }
  }
  return selected;
}

function formatDiagnostic(diagnostic: ts.Diagnostic, workspace: string): Record<string, unknown> {
  const file = diagnostic.file;
  const position = file && diagnostic.start !== undefined
    ? file.getLineAndCharacterOfPosition(diagnostic.start)
    : undefined;
  return {
    file: file ? relative(workspace, file.fileName).replace(/\\/g, '/') : undefined,
    line: position ? position.line + 1 : undefined,
    column: position ? position.character + 1 : undefined,
    code: diagnostic.code,
    severity: diagnostic.category === ts.DiagnosticCategory.Error ? 'error'
      : diagnostic.category === ts.DiagnosticCategory.Warning ? 'warning' : 'info',
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ').slice(0, 500),
  };
}

export async function handleDiagnosticsTool(
  name: string,
  args: Record<string, unknown>,
  workspace: string,
  signal?: AbortSignal
): Promise<string> {
  if (name !== 'diagnostics') throw new Error(`Unknown diagnostics tool: ${name}`);
  signal?.throwIfAborted();

  const configPath = ts.findConfigFile(workspace, ts.sys.fileExists, 'tsconfig.json');
  let options = defaultOptions();
  let rootNames: string[] = [];

  if (configPath) {
    try {
      const config = ts.readConfigFile(configPath, ts.sys.readFile);
      if (!config.error) {
        const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, workspace);
        options = { ...parsed.options, noEmit: true, skipLibCheck: true };
        rootNames = parsed.fileNames;
      }
    } catch {
      options = defaultOptions();
    }
  }

  if (typeof args.path === 'string' && args.path.trim()) {
    const target = await resolveWorkspacePath(workspace, args.path.trim());
    rootNames = [target];
  } else if (!rootNames.length) {
    rootNames = workspaceFiles(workspace);
  }

  const files = await safeSourceFiles(workspace, rootNames);
  if (!files.length) {
    return JSON.stringify({
      ok: false,
      outcome: 'unavailable',
      summary: 'No TypeScript or JavaScript source files were found to diagnose.',
      diagnostics: [],
    });
  }

  signal?.throwIfAborted();
  const program = ts.createProgram(files, options);
  const diagnostics = [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
  ];
  signal?.throwIfAborted();

  const limit = typeof args.limit === 'number' && Number.isFinite(args.limit)
    ? Math.max(1, Math.min(MAX_DIAGNOSTICS, Math.floor(args.limit)))
    : 50;
  const formatted = diagnostics
    .map(diagnostic => formatDiagnostic(diagnostic, workspace))
    .sort((a, b) => Number(a.severity !== 'error') - Number(b.severity !== 'error'))
    .slice(0, limit);
  const errors = formatted.filter(item => item.severity === 'error').length;

  return JSON.stringify({
    ok: errors === 0,
    outcome: errors === 0 ? 'ok' : 'error',
    summary: `${diagnostics.length} diagnostic${diagnostics.length === 1 ? '' : 's'}; ${errors} error${errors === 1 ? '' : 's'} shown.`,
    filesChecked: files.length,
    totalDiagnostics: diagnostics.length,
    diagnostics: formatted,
  }, null, 2);
}

/** Exported for component tests without touching the tool registry. */
export function _diagnosticsInternals(): { defaultOptions: typeof defaultOptions; workspaceFiles: typeof workspaceFiles } {
  return { defaultOptions, workspaceFiles };
}
