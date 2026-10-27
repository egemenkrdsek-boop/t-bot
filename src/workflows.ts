import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { runAgent } from './agent.js';
import type { AgentInput, Message } from './types.js';

export interface Goal {
  id: string;
  objective: string;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  revision?: string;
  lastResult?: string;
  lastRun?: 'finished' | 'interrupted' | 'error';
}

const goalPath = (workspace: string) => join(workspace, '.tbot', 'goal.json');

// Serialize read-modify-write operations across processes. Never break a lock
// automatically: a slow live writer must not be mistaken for a stale one.
async function withGoalLock<T>(workspace: string, action: () => Promise<T>): Promise<T> {
  const dir = join(workspace, '.tbot');
  const path = join(dir, 'goal.lock');
  await mkdir(dir, { recursive: true });
  for (let attempt = 0; attempt < 40; attempt++) {
    let handle;
    try { handle = await open(path, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await new Promise(resolve => setTimeout(resolve, 50));
      continue;
    }
    try { return await action(); }
    finally { await handle.close(); await unlink(path); }
  }
  throw new Error('Goal is locked by another process. If no T Bot process is running, remove .tbot/goal.lock and retry.');
}

export async function getGoal(workspace: string): Promise<Goal | undefined> {
  let raw: string;
  try { raw = await readFile(goalPath(workspace), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Invalid saved goal.');
  const goal = value as Goal;
  if (typeof goal.id !== 'string' || typeof goal.objective !== 'string' ||
      !['active', 'paused', 'completed', 'cancelled'].includes(goal.status) ||
      typeof goal.createdAt !== 'string' || typeof goal.updatedAt !== 'string') throw new Error('Invalid saved goal.');
  return goal;
}

async function saveGoal(workspace: string, goal: Goal): Promise<void> {
  const path = goalPath(workspace);
  await mkdir(join(workspace, '.tbot'), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(goal, null, 2), { encoding: 'utf8', mode: 0o600 }); await rename(temp, path); }
  finally { await unlink(temp).catch(() => undefined); }
}

export async function startGoal(workspace: string, objective: string): Promise<Goal> {
  objective = objective.trim();
  if (!objective) throw new Error('Goal objective cannot be empty.');
  return withGoalLock(workspace, async () => {
    const existing = await getGoal(workspace);
    if (existing && (existing.status === 'active' || existing.status === 'paused')) throw new Error('A goal already exists; complete or cancel it before starting another.');
    const now = new Date().toISOString();
    const goal: Goal = { id: randomUUID(), objective, status: 'active', createdAt: now, updatedAt: now, revision: randomUUID() };
    await saveGoal(workspace, goal);
    return goal;
  });
}

async function changeGoal(workspace: string, status: Goal['status'], allowed: Goal['status'][]): Promise<Goal> {
  return withGoalLock(workspace, async () => {
    const goal = await getGoal(workspace);
    if (!goal || !allowed.includes(goal.status)) throw new Error('No goal is available for this action.');
    const updated: Goal = { ...goal, status, updatedAt: new Date().toISOString(), revision: randomUUID() };
    await saveGoal(workspace, updated);
    return updated;
  });
}
export const pauseGoal = (workspace: string) => changeGoal(workspace, 'paused', ['active']);
export const resumeGoal = (workspace: string) => changeGoal(workspace, 'active', ['paused']);
export const cancelGoal = (workspace: string) => changeGoal(workspace, 'cancelled', ['active', 'paused']);
// Completion is explicit; exhausting a run or receiving an assistant response never implies success.
export const completeGoal = (workspace: string) => changeGoal(workspace, 'completed', ['active', 'paused']);

export async function runGoal(input: AgentInput): Promise<Message[]> {
  const goal = await getGoal(input.workspace);
  if (!goal || goal.status !== 'active') throw new Error('No active goal. Start or resume a goal first.');
  let failed = false;
  const message = `Continue the saved goal: ${goal.objective}\n${goal.lastResult ? `Previous progress: ${goal.lastResult}\n` : ''}${input.message.trim() ? `Current instruction: ${input.message.trim()}\n` : ''}Work within the normal tool approvals. Report what was done, what remains, and any blockers. Do not claim completion without evidence.`;
  const result = await runAgent({ ...input, message, onEvent: event => { if (event.type === 'error') failed = true; input.onEvent(event); } });
  await withGoalLock(input.workspace, async () => {
    const current = await getGoal(input.workspace);
    if (current?.id === goal.id && current.revision === goal.revision && current.status === 'active') {
      const last = [...result].reverse().find(m => m.role === 'assistant' && m.content.trim());
      await saveGoal(input.workspace, { ...current, updatedAt: new Date().toISOString(), revision: randomUUID(), lastRun: input.signal?.aborted ? 'interrupted' : failed ? 'error' : 'finished', ...(last ? { lastResult: last.content.slice(0, 8_000) } : {}) });
    }
  });
  return result;
}

/** Planning is a provider-only call: no tools are exposed or executed. */
export async function planTask(input: AgentInput): Promise<Message[]> {
  const user: Message = { role: 'user', content: input.message };
  const prompt: Message = { role: 'system', content: 'Create a concrete, ordered, actionable plan for the user request. Include relevant checks, assumptions, and uncertainties. Do not claim to have inspected files or performed actions. This is planning only; execution requires a separate user choice.' };
  let content = '';
  let reported = false;
  try {
    for await (const event of input.provider.stream([prompt, user], [], { signal: input.signal })) {
      input.signal?.throwIfAborted();
      if (event.type === 'text') {
        content += event.text;
        input.onEvent(event);
        if (content.length > 40_000) throw new Error('Plan exceeds the response limit.');
      } else if (event.type === 'usage') input.onEvent(event);
      else if (event.type === 'error') { input.onEvent(event); reported = true; throw new Error(event.error); }
      else if (event.type === 'tool_calls') throw new Error('Planning cannot execute tool calls.');
    }
    input.signal?.throwIfAborted();
    if (!content.trim()) throw new Error('Provider returned an empty plan.');
    return [...input.history, user, { role: 'assistant', content }];
  } catch (error) {
    if (!reported) input.onEvent({ type: 'error', error: input.signal?.aborted ? 'Planning cancelled.' : error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/** Call only after the user explicitly chooses to execute the displayed plan. */
export function executePlan(input: AgentInput, plan: string): Promise<Message[]> {
  if (!plan.trim()) throw new Error('There is no plan to execute.');
  return runAgent({ ...input, message: `Execute the following user-approved plan for this request: ${input.message}\n\n${plan}\n\nUse normal tool approvals and adapt if the evidence requires it.` });
}
