/**
 * Static dependency-direction check. This does not execute T Bot; it parses
 * imports with the TypeScript compiler and fails when a lower layer reaches
 * upward into a surface or when Electron leaks outside the desktop shell.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const files = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'renderer' || entry.name === 'node_modules') continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) files.push(full);
  }
}
walk(join(root, 'src'));

const errors = [];
for (const file of files) {
  const rel = relative(root, file).replace(/\\/g, '/');
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier)) continue;
    const target = specifier.text;

    if (rel.startsWith('src/core/') || rel.startsWith('src/security/')) {
      const forbidden = ['/tools/', '/desktop/', '/agent.js', '/providers.js', '/sessions.js', '/app.js', '/bot.js', '/turn-runner.js'];
      if (target.startsWith('.') && forbidden.some(part => target.includes(part))) {
        errors.push(`${rel}: lower layer imports upward: ${target}`);
      }
    }

    if (rel.startsWith('src/tools/') && target.startsWith('.')) {
      const forbidden = ['/agent.js', '/desktop/', '/app.js', '/bot.js', '/turn-runner.js'];
      if (forbidden.some(part => target.includes(part))) {
        errors.push(`${rel}: tool layer imports a surface/runtime: ${target}`);
      }
    }

    if (!rel.startsWith('src/desktop/') && (target === 'electron' || target.startsWith('electron/'))) {
      errors.push(`${rel}: Electron imported outside the desktop shell`);
    }
  }
}

if (errors.length) {
  console.error('Layer check failed:\n' + errors.map(error => `  - ${error}`).join('\n'));
  process.exit(1);
}
console.log(`Layer check passed for ${files.length} TypeScript files.`);
