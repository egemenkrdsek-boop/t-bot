/**
 * Tool capability vocabulary.
 *
 * Approval prompts answer "may this run?". Capabilities answer "what kind of
 * effect can this tool have?". Hosts can pass a reduced capability set to a
 * read-only investigator or a specialized worker; the dispatcher then refuses
 * tools outside that set even if the model invents their names.
 */

export type Capability =
  | 'fs.read'
  | 'fs.write'
  | 'proc.read'
  | 'proc.spawn'
  | 'proc.write'
  | 'net.public'
  | 'gui'
  | 'mcp'
  | 'memory.read'
  | 'memory.write'
  | 'image'
  | 'workflow'
  | 'checkpoint.read'
  | 'checkpoint.write'
  | 'diagnostics';

const EXACT: Record<string, Capability[]> = {
  file_read: ['fs.read'],
  file_outline: ['fs.read'],
  file_list: ['fs.read'],
  file_glob: ['fs.read'],
  file_search: ['fs.read'],
  file_write: ['fs.write'],
  file_patch: ['fs.write'],
  artifact_read: ['fs.read'],
  git_status: ['fs.read'],
  git_diff: ['fs.read'],
  git_log: ['fs.read'],
  git_add: ['fs.write'],
  git_commit: ['fs.write'],
  git_branch: ['fs.write'],
  git_push: ['fs.write', 'net.public'],
  shell: ['proc.spawn'],
  process_list: ['proc.read'],
  process_output: ['proc.read'],
  process_stop: ['proc.write'],
  process_write: ['proc.write'],
  project_verify: ['proc.spawn'],
  diagnostics: ['diagnostics'],
  memory_recall: ['memory.read'],
  memory_save: ['memory.write'],
  memory_forget: ['memory.write'],
  todo_manage: ['workflow'],
  goal_manage: ['workflow'],
  skill_list: ['fs.read'],
  skill_create: ['fs.write'],
  delegate_task: ['proc.spawn'],
  checkpoint_list: ['checkpoint.read'],
  checkpoint_restore: ['checkpoint.write'],
  image_generate: ['image', 'net.public'],
  web_search: ['net.public'],
  url_fetch: ['net.public'],
  computer: ['gui', 'proc.spawn'],
  mcp_catalog: ['mcp'],
  mcp_call: ['mcp'],
};

export function capabilitiesForTool(name: string): Capability[] {
  if (EXACT[name]) return EXACT[name];
  if (name.startsWith('browser_')) return ['gui', 'net.public', 'proc.spawn'];
  if (name.startsWith('computer_')) return ['gui', 'proc.spawn'];
  if (name.startsWith('mcp_')) return ['mcp'];
  if (name.startsWith('memory_')) return name === 'memory_recall' ? ['memory.read'] : ['memory.write'];
  if (name.startsWith('process_')) return name === 'process_list' || name === 'process_output' ? ['proc.read'] : ['proc.write'];
  if (name.startsWith('git_')) return ['fs.read'];
  return [];
}

/** A host-provided allowlist. An empty/undefined set means "no extra restriction". */
export function capabilitiesAllowed(name: string, allowed?: ReadonlySet<Capability>): boolean {
  if (!allowed) return true;
  return capabilitiesForTool(name).every(capability => allowed.has(capability));
}

export function defaultCapabilities(readOnly: boolean): ReadonlySet<Capability> {
  if (readOnly) {
    return new Set<Capability>([
      'fs.read',
      'proc.read',
      'net.public',
      'mcp',
      'memory.read',
      'checkpoint.read',
      'diagnostics',
    ]);
  }
  return new Set<Capability>([
    'fs.read',
    'fs.write',
    'proc.read',
    'proc.spawn',
    'proc.write',
    'net.public',
    'gui',
    'mcp',
    'memory.read',
    'memory.write',
    'image',
    'workflow',
    'checkpoint.read',
    'checkpoint.write',
    'diagnostics',
  ]);
}

export function describeCapabilities(name: string): string {
  const capabilities = capabilitiesForTool(name);
  return capabilities.length ? capabilities.join(', ') : 'no declared capability';
}
