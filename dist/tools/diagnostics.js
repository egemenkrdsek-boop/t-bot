/**
 * Local TypeScript diagnostics without a language server.
 *
 * The compiler is loaded only when this tool is actually called. Importing it
 * at module load would add the full TypeScript compiler to every CLI/desktop
 * start, which is unacceptable for a local agent that is often idle.
 *
 * This is a pragmatic coding-intelligence tool: it uses the TypeScript
 * compiler already present in the project, respects tsconfig.json when one
 * exists, and returns a bounded list of syntactic and semantic errors. It is
 * not a full LSP client and it does not claim to diagnose other languages.
 */
import { realpath, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { resolveWorkspacePath } from '../security/paths.js';
const MAX_FILES = 200;
const MAX_DIAGNOSTICS = 100;
const MAX_FILE_BYTES = 1_000_000;
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const EXCLUDED_DIRECTORIES = ['node_modules', 'dist', 'build', '.git', '.tbot', 'release', 'artifacts'];
export const diagnosticsToolDefinitions = [
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
function defaultOptions(ts) {
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
function workspaceFiles(ts, workspace) {
    return ts.sys.readDirectory(workspace, [...SOURCE_EXTENSIONS], EXCLUDED_DIRECTORIES, undefined, MAX_FILES).slice(0, MAX_FILES);
}
function withinWorkspace(workspace, file) {
    const normalize = (value) => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
    const root = normalize(workspace);
    const target = normalize(file);
    const rel = relative(root, target);
    return Boolean(rel) && !rel.startsWith('..') && !rel.includes(`..${process.platform === 'win32' ? '\\' : '/'}`);
}
async function selectSourceFiles(workspace, rootNames) {
    const selected = [];
    for (const file of rootNames) {
        if (selected.length >= MAX_FILES)
            break;
        if (!withinWorkspace(workspace, file))
            continue;
        try {
            const info = await stat(file);
            if (info.isFile() && info.size <= MAX_FILE_BYTES)
                selected.push(file);
        }
        catch { /* missing files are reported by the compiler if referenced */ }
    }
    return selected;
}
function formatDiagnostic(ts, diagnostic, workspace) {
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
export async function handleDiagnosticsTool(name, args, workspace, signal) {
    if (name !== 'diagnostics')
        throw new Error(`Unknown diagnostics tool: ${name}`);
    signal?.throwIfAborted();
    // CI can hand us a short 8.3 alias (RUNNER~1) while TypeScript returns long
    // canonical paths (or vice versa). Diagnose everything against one canonical
    // workspace so containment checks and tsconfig includes agree.
    let canonicalWorkspace;
    try {
        canonicalWorkspace = await realpath(resolve(workspace));
    }
    catch {
        canonicalWorkspace = resolve(workspace);
    }
    const ts = await import('typescript');
    signal?.throwIfAborted();
    const configPath = ts.findConfigFile(canonicalWorkspace, ts.sys.fileExists, 'tsconfig.json');
    let options = defaultOptions(ts);
    let rootNames = [];
    if (configPath) {
        try {
            const config = ts.readConfigFile(configPath, ts.sys.readFile);
            if (!config.error) {
                const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, canonicalWorkspace);
                options = { ...parsed.options, noEmit: true, skipLibCheck: true };
                rootNames = parsed.fileNames;
            }
        }
        catch {
            options = defaultOptions(ts);
        }
    }
    if (typeof args.path === 'string' && args.path.trim()) {
        const target = await resolveWorkspacePath(canonicalWorkspace, args.path.trim());
        let targetIsDirectory = false;
        try {
            targetIsDirectory = (await stat(target)).isDirectory();
        }
        catch { /* compiler reports a missing file */ }
        rootNames = targetIsDirectory
            ? ts.sys.readDirectory(target, [...SOURCE_EXTENSIONS], EXCLUDED_DIRECTORIES, undefined, MAX_FILES)
            : [target];
    }
    else if (!rootNames.length) {
        rootNames = workspaceFiles(ts, canonicalWorkspace);
    }
    const files = await selectSourceFiles(canonicalWorkspace, rootNames);
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
        .map(diagnostic => formatDiagnostic(ts, diagnostic, canonicalWorkspace))
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
/** Exported for component tests without loading the compiler at module import. */
export function _diagnosticsInternals() {
    return { defaultOptions, workspaceFiles };
}
//# sourceMappingURL=diagnostics.js.map