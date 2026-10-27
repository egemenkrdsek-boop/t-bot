import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { runAgent } from './agent.js';
import { withFileLock } from './lock.js';
import { reclaimMemory } from './memory-guard.js';
import { estimateMessagesTokens, globalTokenTracker } from './token-optimizer.js';
const goalPath = (workspace) => join(workspace, '.tbot', 'goal.json');
const goalLockPath = (workspace) => join(workspace, '.tbot', 'goal.lock');
async function withGoalLock(workspace, action) {
    try {
        return await withFileLock(goalLockPath(workspace), action, 30_000);
    }
    catch (error) {
        if (error.code === 'EEXIST') {
            throw new Error('Hedef başka bir işlem tarafından kilitlenmiş. Çalışan başka bir T Bot işlemi yoksa .tbot/goal.lock dosyasını silip tekrar deneyin.');
        }
        throw error;
    }
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
        throw new Error('Kayıtlı hedef geçersiz.');
    const goal = value;
    if (typeof goal.id !== 'string' ||
        typeof goal.objective !== 'string' ||
        !['active', 'paused', 'completed', 'cancelled'].includes(goal.status) ||
        typeof goal.createdAt !== 'string' ||
        typeof goal.updatedAt !== 'string') {
        throw new Error('Kayıtlı hedef geçersiz.');
    }
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
        throw new Error('Hedef açıklaması boş olamaz.');
    return withGoalLock(workspace, async () => {
        const existing = await getGoal(workspace);
        if (existing && (existing.status === 'active' || existing.status === 'paused')) {
            throw new Error('Zaten mevcut bir hedef var; yeni bir hedef başlatmadan önce mevcudu tamamlayın veya iptal edin.');
        }
        const now = new Date().toISOString();
        const goal = {
            id: randomUUID(),
            objective,
            status: 'active',
            createdAt: now,
            updatedAt: now,
            revision: randomUUID(),
            notes: [],
        };
        await saveGoal(workspace, goal);
        return goal;
    });
}
async function changeGoal(workspace, status, allowed) {
    return withGoalLock(workspace, async () => {
        const goal = await getGoal(workspace);
        if (!goal || !allowed.includes(goal.status)) {
            throw new Error('Bu işlem için uygun bir hedef bulunamadı.');
        }
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
    if (!initialGoal || initialGoal.status !== 'active') {
        throw new Error('Aktif bir hedef bulunamadı. Önce bir hedef başlatın veya devam ettirin.');
    }
    const maxSteps = options.maxAutonomousSteps ?? 4;
    let conversation = [...input.history];
    let currentGoal = initialGoal;
    for (let step = 1; step <= maxSteps; step++) {
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
        const message = `[Otonom Hedef Döngüsü - Adım ${step}/${maxSteps}]
Mevcut Hedef: ${currentGoal.objective}
Hedef Durumu: ${currentGoal.status}
Tamamlanan Notlar:
${notesFormatted}
${prevProgress}${userInstruction}
Yönergeler:
1. Hedefe ulaşmak için gereken işlemleri mevcut araçları kullanarak yürüt.
2. Ne yapıldığını, neyin kaldığını ve engelleri açıkça raporla. Kanıt olmadan tamamlandığını öne sürme.
3. ÖNEMLİ: Eğer hedef tamamen gerçekleştirildi, doğrulandı ve bittiyse yanıtının sonuna mutlaka [GOAL_COMPLETE] veya [HEDEF_TAMAMLANDI] yaz!`;
        input.onEvent({ type: 'status', message: `Otonom Hedef [Adım ${step}/${maxSteps}] · ${currentGoal.objective}` });
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
                        nextNotes.push(`[Adım ${step}] ${cleanSummary}`);
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
        // Her adım sonunda hızlı JS/V8 RAM temizliği (PowerShell bloklaması olmadan)
        await reclaimMemory(options.session ?? input.session, false).catch(() => undefined);
        if (isCompleted) {
            input.onEvent({
                type: 'status',
                message: 'Otonom Hedef [Tamamlandı] · Hedef Başarıyla Gerçekleştirildi ([GOAL_COMPLETE])',
            });
            break;
        }
        if (stepFailed || input.signal?.aborted) {
            break;
        }
    }
    return conversation;
}
/** Planlama yalnızca sağlayıcı düzeyinde bir çağrıdır: Araçlar sunulmaz ve yürütülmez. */
export async function planTask(input) {
    const user = { role: 'user', content: input.message };
    const prompt = {
        role: 'system',
        content: 'Kullanıcı isteği için somut, sıralı ve uygulanabilir bir plan oluştur. İlgili kontrolleri, varsayımları ve belirsizlikleri dahil et. Dosyaları incelediğini veya eylem gerçekleştirdiğini iddia etme. Bu yalnızca bir planlama adımıdır; yürütme kullanıcının ayrı bir onayını gerektirir.',
    };
    const planMessages = [prompt, user];
    let content = '';
    let responseItems;
    let reported = false;
    let usageRecorded = false;
    try {
        for await (const event of input.provider.stream(planMessages, [], { signal: input.signal })) {
            input.signal?.throwIfAborted();
            if (event.type === 'text') {
                content += event.text;
                input.onEvent(event);
                if (content.length > 40_000)
                    throw new Error('Plan yanıt sınırını aştı.');
            }
            else if (event.type === 'response_items') {
                responseItems = event.responseItems;
            }
            else if (event.type === 'usage') {
                usageRecorded = true;
                const sentInputTokens = event.inputTokens ?? estimateMessagesTokens(planMessages);
                const outputTokens = event.outputTokens ?? estimateMessagesTokens([{ role: 'assistant', content }]);
                const report = globalTokenTracker.recordTurn({
                    rawTokens: sentInputTokens,
                    sentInputTokens,
                    outputTokens,
                    cachedTokens: event.cachedTokens,
                    prunedSchemaTokens: 0,
                    compressedHistoryTokens: 0,
                });
                input.onEvent({
                    type: 'usage',
                    inputTokens: sentInputTokens,
                    outputTokens,
                    cachedTokens: report.turnCachedTokens ?? 0,
                    savedTokens: report.turnSavedTokens ?? 0,
                    savingsPercent: report.savingsPercent,
                });
            }
            else if (event.type === 'error') {
                input.onEvent(event);
                reported = true;
                throw new Error(event.error);
            }
            else if (event.type === 'tool_calls') {
                throw new Error('Planlama aşamasında araç çağrıları yürütülemez.');
            }
        }
        input.signal?.throwIfAborted();
        if (!content.trim())
            throw new Error('Sağlayıcı boş bir plan döndürdü.');
        if (!usageRecorded) {
            const sentInputTokens = estimateMessagesTokens(planMessages);
            const outputTokens = estimateMessagesTokens([{ role: 'assistant', content }]);
            const report = globalTokenTracker.recordTurn({
                rawTokens: sentInputTokens,
                sentInputTokens,
                outputTokens,
                cachedTokens: 0,
                prunedSchemaTokens: 0,
                compressedHistoryTokens: 0,
            });
            input.onEvent({
                type: 'usage',
                inputTokens: sentInputTokens,
                outputTokens,
                cachedTokens: report.turnCachedTokens ?? 0,
                savedTokens: report.turnSavedTokens ?? 0,
                savingsPercent: report.savingsPercent,
            });
        }
        return [...input.history, user, { role: 'assistant', content, ...(responseItems ? { responseItems } : {}) }];
    }
    catch (error) {
        if (!reported) {
            input.onEvent({
                type: 'error',
                error: input.signal?.aborted ? 'Planlama İptal Edildi.' : error instanceof Error ? error.message : String(error),
            });
        }
        throw error;
    }
}
/** Yalnızca kullanıcı görüntülenen planı açıkça onayladıktan sonra çağrılmalıdır. */
export function executePlan(input, plan, runner = runAgent) {
    if (!plan.trim())
        throw new Error('Yürütülecek bir plan bulunmuyor.');
    return runner({
        ...input,
        message: `Bu istek için kullanıcı tarafından onaylanan aşağıdaki planı yürüt: ${input.message}\n\n${plan}\n\nNormal araç onaylarını kullan ve kanıtlar gerektiriyorsa plana uyum sağla.`,
    });
}
//# sourceMappingURL=workflows.js.map