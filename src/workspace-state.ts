import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Reject state paths outside the workspace or through existing links/junctions.
 * Checks are synchronous for prompt-loading callers; they do not provide an
 * atomic sandbox against another process changing the filesystem concurrently.
 */
export function workspaceStatePath(workspace: string, input: string): string {
  const lexicalRoot = resolve(workspace);
  const canonicalRoot = realpathSync(lexicalRoot);
  const target = resolve(lexicalRoot, input);
  let rel = relative(lexicalRoot, target);
  // Callers may revalidate a path already returned for a workspace alias.
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) rel = relative(canonicalRoot, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('State path must remain inside the workspace.');
  }
  let current = canonicalRoot;
  for (const component of rel.split(sep).filter(Boolean)) {
    current = join(current, component);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error('Workspace state cannot use symbolic links or junctions.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return current;
}
