import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { runAgent } from './agent.js';
import { reclaimMemory } from './memory-guard.js';
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
  notes?: string[];
}

export interface RunGoalOptions {
  session?: any;
  maxAutonomousSteps?: number;
}

const goalPath = (workspace: string) => join(workspace, '.tbot', 'goal.json');

function isPidRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === 'EPERM';
  }
}

// Serialize read-modify-write operations across processes with stale lock detection.
async function withGoalLock<T>(workspace: string, action: () => Promise<T>): Promise<T> {
  const dir = join(workspace, '.tbot');
  const path = join(dir, 'goal.lock');
  await mkdir(dir, { recursive: true });
  for (let attempt = 0; attempt < 40; attempt++) {
    let handle;
    try {
      handle = await open(path, 'wx', 0o600);
      await handle.writeFile(String(process.pid), 'utf8');
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => undefined);
      }
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;

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
      } catch {
        // Dosya eşzamanlı olarak silinmiş olabilir
      }

      await new Promise(resolve => setTimeout(resolve, 50));
      continue;
    }
    try {
      return await action();
    } finally {
      await handle.close().catch(() => undefined);
      await unlink(path).catch(() => undefined);
    }
  }
  throw new Error('Hedef başka bir işlem tarafından kilitlenmiş. Çalışan başka bir T Bot işlemi yoksa .tbot/goal.lock dosyasını silip tekrar deneyin.');
}

export async function getGoal(workspace: string): Promise<Goal | undefined> {
  let raw: string;
  try { raw = await readFile(goalPath(workspace), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Kayıtlı hedef geçersiz.');
  const goal = value as Goal;
  if (typeof goal.id !== 'string' || typeof goal.objective !== 'string' ||
      !['active', 'paused', 'completed', 'cancelled'].includes(goal.status) ||
      typeof goal.createdAt !== 'string' || typeof goal.updatedAt !== 'string') throw new Error('Kayıtlı hedef geçersiz.');
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
  if (!objective) throw new Error('Hedef açıklaması boş olamaz.');
  return withGoalLock(workspace, async () => {
    const existing = await getGoal(workspace);
    if (existing && (existing.status === 'active' || existing.status === 'paused')) throw new Error('Zaten mevcut bir hedef var; yeni bir hedef başlatmadan önce mevcudu tamamlayın veya iptal edin.');
    const now = new Date().toISOString();
    const goal: Goal = { id: randomUUID(), objective, status: 'active', createdAt: now, updatedAt: now, revision: randomUUID(), notes: [] };
    await saveGoal(workspace, goal);
    return goal;
  });
}

async function changeGoal(workspace: string, status: Goal['status'], allowed: Goal['status'][]): Promise<Goal> {
  return withGoalLock(workspace, async () => {
    const goal = await getGoal(workspace);
    if (!goal || !allowed.includes(goal.status)) throw new Error('Bu işlem için uygun bir hedef bulunamadı.');
    const updated: Goal = { ...goal, status, updatedAt: new Date().toISOString(), revision: randomUUID() };
    await saveGoal(workspace, updated);
    return updated;
  });
}
export const pauseGoal = (workspace: string) => changeGoal(workspace, 'paused', ['active']);
export const resumeGoal = (workspace: string) => changeGoal(workspace, 'active', ['paused']);
export const cancelGoal = (workspace: string) => changeGoal(workspace, 'cancelled', ['active', 'paused']);
export const completeGoal = (workspace: string) => changeGoal(workspace, 'completed', ['active', 'paused']);

/** Çok Adımlı Otonom Hedef Döngüsü (Autonomous Goal Loop) */
export async function runGoal(
  input: AgentInput,
  runner: (input: AgentInput) => Promise<Message[]> = runAgent,
  options: RunGoalOptions = {}
): Promise<Message[]> {
  const initialGoal = await getGoal(input.workspace);
  if (!initialGoal || initialGoal.status !== 'active') throw new Error('Aktif bir hedef bulunamadı. Önce bir hedef başlatın veya devam ettirin.');

  const maxSteps = options.maxAutonomousSteps ?? 4;
  let conversation: Message[] = [...input.history];
  let currentGoal = initialGoal;

  for (let step = 1; step <= maxSteps; step++) {
    if (input.signal?.aborted) break;

    const fresh = await getGoal(input.workspace);
    if (!fresh || fresh.status !== 'active') break;
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
        if (event.type === 'error') stepFailed = true;
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
        const updatedGoal: Goal = {
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
    await reclaimMemory(options.session ?? (input as any).session, true).catch(() => undefined);

    if (isCompleted) {
      input.onEvent({ type: 'status', message: 'Otonom Hedef [Tamamlandı] · Hedef Başarıyla Gerçekleştirildi ([GOAL_COMPLETE])' });
      break;
    }

    if (stepFailed || input.signal?.aborted) {
      break;
    }
  }

  return conversation;
}

/** Planlama yalnızca sağlayıcı düzeyinde bir çağrıdır: Araçlar sunulmaz ve yürütülmez. */
export async function planTask(input: AgentInput): Promise<Message[]> {
  const user: Message = { role: 'user', content: input.message };
  const prompt: Message = { role: 'system', content: 'Kullanıcı isteği için somut, sıralı ve uygulanabilir bir plan oluştur. İlgili kontrolleri, varsayımları ve belirsizlikleri dahil et. Dosyaları incelediğini veya eylem gerçekleştirdiğini iddia etme. Bu yalnızca bir planlama adımıdır; yürütme kullanıcının ayrı bir onayını gerektirir.' };
  let content = '';
  let responseItems: Record<string, unknown>[] | undefined;
  let reported = false;
  try {
    for await (const event of input.provider.stream([prompt, user], [], { signal: input.signal })) {
      input.signal?.throwIfAborted();
      if (event.type === 'text') {
        content += event.text;
        input.onEvent(event);
        if (content.length > 40_000) throw new Error('Plan yanıt sınırını aştı.');
      } else if (event.type === 'response_items') responseItems = event.responseItems;
      else if (event.type === 'usage') input.onEvent(event);
      else if (event.type === 'error') { input.onEvent(event); reported = true; throw new Error(event.error); }
      else if (event.type === 'tool_calls') throw new Error('Planlama aşamasında araç çağrıları yürütülemez.');
    }
    input.signal?.throwIfAborted();
    if (!content.trim()) throw new Error('Sağlayıcı boş bir plan döndürdü.');
    return [...input.history, user, { role: 'assistant', content, ...(responseItems ? { responseItems } : {}) }];
  } catch (error) {
    if (!reported) input.onEvent({ type: 'error', error: input.signal?.aborted ? 'Planlama İptal Edildi.' : error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/** Yalnızca kullanıcı görüntülenen planı açıkça onayladıktan sonra çağrılmalıdır. */
export function executePlan(input: AgentInput, plan: string, runner: (input: AgentInput) => Promise<Message[]> = runAgent): Promise<Message[]> {
  if (!plan.trim()) throw new Error('Yürütülecek bir plan bulunmuyor.');
  return runner({ ...input, message: `Bu istek için kullanıcı tarafından onaylanan aşağıdaki planı yürüt: ${input.message}\n\n${plan}\n\nNormal araç onaylarını kullan ve kanıtlar gerektiriyorsa plana uyum sağla.` });
}
