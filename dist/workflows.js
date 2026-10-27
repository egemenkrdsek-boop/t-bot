import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { runAgent } from './agent.js';
import { reclaimMemory } from './memory-guard.js';
const goalPath = (workspace) => join(workspace, '.tbot', 'goal.json');
function isPidRunning(pid) {
    if (!Number.isInteger(pid) || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return error?.code === 'EPERM';
    }
}
// Serialize read-modify-write operations across processes with stale lock detection.
async function withGoalLock(workspace, action) {
    const dir = join(workspace, '.tbot');
    const path = join(dir, 'goal.lock');
    await mkdir(dir, { recursive: true });
    for (let attempt = 0; attempt < 40; attempt++) {
        let handle;
        try {
            handle = await open(path, 'wx', 0o600);
            await handle.writeFile(String(process.pid), 'utf8');
        }
        catch (error) {
            if (handle) {
                await handle.close().catch(() => undefined);
            }
            if (error.code !== 'EEXIST')
                throw error;
            // Bayat kilit (stale lock) kontrolü: 30 saniyeden eskiyse veya PID çalışmıyorsa devral
            try {
                const stats = await stat(path);
                const isStaleByAge = (Date.now() - stats.mtimeMs) > 30_000;
                let isDeadPid = false;
                if (!isStaleByAge) {
                    const content = await readFile(path, 'utf8').catch(() => '');
                    const pid = parseInt(content.trim(), 10);
                    if (content.trim() && !isPidRunning(pid)) {
                        isDeadPid = true;
                    }
                }
                if (isStaleByAge || isDeadPid) {
                    await unlink(path).catch(() => undefined);
                    continue;
                }
            }
            catch {
                // Dosya eşzamanlı olarak silinmiş olabilir
            }
            await new Promise(resolve => setTimeout(resolve, 50));
            continue;
        }
        try {
            return await action();
        }
        finally {
            await handle.close().catch(() => undefined);
            await unlink(path).catch(() => undefined);
        }
    }
    throw new Error('Goal is locked by another process. If no T Bot process is running, remove .tbot/goal.lock and retry.');
}
export async function getGoal(workspace) {
    let raw;
    try {
        raw = await readFile(goalPath(workspace), 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object')
        throw new Error('Invalid saved goal.');
    const goal = value;
    if (typeof goal.id !== 'string' || typeof goal.objective !== 'string' ||
        !['active', 'paused', 'completed', 'cancelled'].includes(goal.status) ||
        typeof goal.createdAt !== 'string' || typeof goal.updatedAt !== 'string')
        throw new Error('Invalid saved goal.');
    return goal;
}
async function saveGoal(workspace, goal) {
    const path = goalPath(workspace);
    await mkdir(join(workspace, '.tbot'), { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
        await writeFile(temp, JSON.stringify(goal, null, 2), { encoding: 'utf8', mode: 0o600 });
        await rename(temp, path);
    }
    finally {
        await unlink(temp).catch(() => undefined);
    }
}
export async function startGoal(workspace, objective) {
    objective = objective.trim();
    if (!objective)
        throw new Error('Goal objective cannot be empty.');
    return withGoalLock(workspace, async () => {
        const existing = await getGoal(workspace);
        if (existing && (existing.status === 'active' || existing.status === 'paused'))
            throw new Error('A goal already exists; complete or cancel it before starting another.');
        const now = new Date().toISOString();
        const goal = { id: randomUUID(), objective, status: 'active', createdAt: now, updatedAt: now, revision: randomUUID(), notes: [] };
        await saveGoal(workspace, goal);
        return goal;
    });
}
async function changeGoal(workspace, status, allowed) {
    return withGoalLock(workspace, async () => {
        const goal = await getGoal(workspace);
        if (!goal || !allowed.includes(goal.status))
            throw new Error('No goal is available for this action.');
        const updated = { ...goal, status, updatedAt: new Date().toISOString(), revision: randomUUID() };
        await saveGoal(workspace, updated);
        return updated;
    });
}
export const pauseGoal = (workspace) => changeGoal(workspace, 'paused', ['active']);
export const resumeGoal = (workspace) => changeGoal(workspace, 'active', ['paused']);
export const cancelGoal = (workspace) => changeGoal(workspace, 'cancelled', ['active', 'paused']);
export const completeGoal = (workspace) => changeGoal(workspace, 'completed', ['active', 'paused']);
/** Çok Adımlı Otonom Hedef Döngüsü (Autonomous Goal Loop) */
export async function runGoal(input, runner = runAgent, options = {}) {
    const initialGoal = await getGoal(input.workspace);
    if (!initialGoal || initialGoal.status !== 'active')
        throw new Error('No active goal. Start or resume a goal first.');
    const maxSteps = options.maxAutonomousSteps ?? 4;
    let conversation = [...input.history];
    let currentGoal = initialGoal;
    for (let step = 0; step < maxSteps; step++) {
        if (input.signal?.aborted)
            break;
        const fresh = await getGoal(input.workspace);
        if (!fresh || fresh.status !== 'active')
            break;
        currentGoal = fresh;
        const notesFormatted = currentGoal.notes && currentGoal.notes.length > 0
            ? currentGoal.notes.map((note, index) => `${index + 1}. ${note}`).join('\n')
            : 'Henüz not yok.';
        const prevProgress = currentGoal.lastResult ? `\nÖnceki İlerleme:\n${currentGoal.lastResult}\n` : '';
        const userInstruction = input.message.trim() ? `\nMevcut Talimat: ${input.message.trim()}\n` : '';
        const message = `[Otonom Hedef Döngüsü - Adım ${step + 1}/${maxSteps}]
Mevcut Hedef: ${currentGoal.objective}
Hedef Durumu: ${currentGoal.status}
Tamamlanan Notlar:
${notesFormatted}
${prevProgress}${userInstruction}
Yönergeler:
1. Hedefe ulaşmak için gereken işlemleri mevcut araçları kullanarak yürüt.
2. Ne yapıldığını, neyin kaldığını ve engelleri açıkça raporla. Kanıt olmadan tamamlandığını öne sürme.
3. ÖNEMLİ: Eğer hedef tamamen gerçekleştirildi, doğrulandı ve bittiyse yanıtının sonuna mutlaka [GOAL_COMPLETE] veya [HEDEF_TAMAMLANDI] yaz!`;
        input.onEvent({ type: 'status', message: `Otonom Hedef: Adım ${step + 1}/${maxSteps} yürütülüyor...` });
        let stepFailed = false;
        const stepResult = await runner({
            ...input,
            history: conversation,
            message,
            onEvent: event => {
                if (event.type === 'error')
                    stepFailed = true;
                input.onEvent(event);
            },
        });
        conversation = stepResult;
        const lastAssistant = [...stepResult].reverse().find(m => m.role === 'assistant' && m.content.trim());
        const assistantContent = lastAssistant?.content || '';
        const isCompleted = /\[(GOAL_COMPLETE|HEDEF_TAMAMLANDI)\]/i.test(assistantContent);
        await withGoalLock(input.workspace, async () => {
            const lockGoal = await getGoal(input.workspace);
            if (lockGoal?.id === currentGoal.id && lockGoal.status === 'active') {
                const nextNotes = Array.isArray(lockGoal.notes) ? [...lockGoal.notes] : [];
                if (assistantContent) {
                    const cleanSummary = assistantContent
                        .replace(/\[(GOAL_COMPLETE|HEDEF_TAMAMLANDI)\]/gi, '')
                        .trim()
                        .slice(0, 1000);
                    if (cleanSummary) {
                        nextNotes.push(`[Adım ${step + 1}] ${cleanSummary}`);
                    }
                }
                const updatedGoal = {
                    ...lockGoal,
                    status: isCompleted ? 'completed' : 'active',
                    updatedAt: new Date().toISOString(),
                    revision: randomUUID(),
                    lastRun: input.signal?.aborted ? 'interrupted' : stepFailed ? 'error' : 'finished',
                    notes: nextNotes,
                    ...(assistantContent ? { lastResult: assistantContent.slice(0, 8_000) } : {}),
                };
                await saveGoal(input.workspace, updatedGoal);
                currentGoal = updatedGoal;
            }
        });
        // Her adım sonunda await reclaimMemory(options.session) çağırarak RAM'i temizle
        await reclaimMemory(options.session ?? input.session).catch(() => undefined);
        if (isCompleted) {
            input.onEvent({ type: 'status', message: 'Otonom Hedef: Hedef başarıyla tamamlandı ([GOAL_COMPLETE]).' });
            break;
        }
        if (stepFailed || input.signal?.aborted) {
            break;
        }
    }
    return conversation;
}
/** Planning is a provider-only call: no tools are exposed or executed. */
export async function planTask(input) {
    const user = { role: 'user', content: input.message };
    const prompt = { role: 'system', content: 'Create a concrete, ordered, actionable plan for the user request. Include relevant checks, assumptions, and uncertainties. Do not claim to have inspected files or performed actions. This is planning only; execution requires a separate user choice.' };
    let content = '';
    let responseItems;
    let reported = false;
    try {
        for await (const event of input.provider.stream([prompt, user], [], { signal: input.signal })) {
            input.signal?.throwIfAborted();
            if (event.type === 'text') {
                content += event.text;
                input.onEvent(event);
                if (content.length > 40_000)
                    throw new Error('Plan exceeds the response limit.');
            }
            else if (event.type === 'response_items')
                responseItems = event.responseItems;
            else if (event.type === 'usage')
                input.onEvent(event);
            else if (event.type === 'error') {
                input.onEvent(event);
                reported = true;
                throw new Error(event.error);
            }
            else if (event.type === 'tool_calls')
                throw new Error('Planning cannot execute tool calls.');
        }
        input.signal?.throwIfAborted();
        if (!content.trim())
            throw new Error('Provider returned an empty plan.');
        return [...input.history, user, { role: 'assistant', content, ...(responseItems ? { responseItems } : {}) }];
    }
    catch (error) {
        if (!reported)
            input.onEvent({ type: 'error', error: input.signal?.aborted ? 'Planning cancelled.' : error instanceof Error ? error.message : String(error) });
        throw error;
    }
}
/** Call only after the user explicitly chooses to execute the displayed plan. */
export function executePlan(input, plan, runner = runAgent) {
    if (!plan.trim())
        throw new Error('There is no plan to execute.');
    return runner({ ...input, message: `Execute the following user-approved plan for this request: ${input.message}\n\n${plan}\n\nUse normal tool approvals and adapt if the evidence requires it.` });
}
//# sourceMappingURL=workflows.js.map