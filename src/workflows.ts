import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { runAgent } from './agent.js';
import { withFileLock } from './lock.js';
import { reclaimMemory } from './memory-guard.js';
import { estimateMessagesTokens, globalTokenTracker } from './token-optimizer.js';
import type { AgentInput, Message, ToolDefinition } from './types.js';

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
const goalLockPath = (workspace: string) => join(workspace, '.tbot', 'goal.lock');

async function withGoalLock<T>(workspace: string, action: () => Promise<T>): Promise<T> {
  try {
    return await withFileLock(goalLockPath(workspace), action, 30_000);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(
        'Hedef başka bir işlem tarafından kilitlenmiş. Çalışan başka bir T Bot işlemi yoksa .tbot/goal.lock dosyasını silip tekrar deneyin.'
      );
    }
    throw error;
  }
}

export async function getGoal(workspace: string): Promise<Goal | undefined> {
  let raw: string;
  try {
    raw = await readFile(goalPath(workspace), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Kayıtlı hedef geçersiz.');
  const goal = value as Goal;
  if (
    typeof goal.id !== 'string' ||
    typeof goal.objective !== 'string' ||
    !['active', 'paused', 'completed', 'cancelled'].includes(goal.status) ||
    typeof goal.createdAt !== 'string' ||
    typeof goal.updatedAt !== 'string'
  ) {
    throw new Error('Kayıtlı hedef geçersiz.');
  }
  return goal;
}

async function saveGoal(workspace: string, goal: Goal): Promise<void> {
  const path = goalPath(workspace);
  await mkdir(join(workspace, '.tbot'), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(goal, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}

export async function startGoal(workspace: string, objective: string): Promise<Goal> {
  objective = objective.trim();
  if (!objective) throw new Error('Hedef açıklaması boş olamaz.');
  return withGoalLock(workspace, async () => {
    const existing = await getGoal(workspace);
    if (existing && (existing.status === 'active' || existing.status === 'paused')) {
      throw new Error(
        'Zaten mevcut bir hedef var; yeni bir hedef başlatmadan önce mevcudu tamamlayın veya iptal edin.'
      );
    }
    const now = new Date().toISOString();
    const goal: Goal = {
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

async function changeGoal(workspace: string, status: Goal['status'], allowed: Goal['status'][]): Promise<Goal> {
  return withGoalLock(workspace, async () => {
    const goal = await getGoal(workspace);
    if (!goal || !allowed.includes(goal.status)) {
      throw new Error('Bu işlem için uygun bir hedef bulunamadı.');
    }
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
  if (!initialGoal || initialGoal.status !== 'active') {
    throw new Error('Aktif bir hedef bulunamadı. Önce bir hedef başlatın veya devam ettirin.');
  }

  const maxSteps = options.maxAutonomousSteps ?? 4;
  let conversation: Message[] = [...input.history];
  let currentGoal = initialGoal;

  for (let step = 1; step <= maxSteps; step++) {
    if (input.signal?.aborted) break;

    const fresh = await getGoal(input.workspace);
    if (!fresh || fresh.status !== 'active') break;
    currentGoal = fresh;

    const notesFormatted =
      currentGoal.notes && currentGoal.notes.length > 0
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

    // Her adım sonunda hızlı JS/V8 RAM temizliği (PowerShell bloklaması olmadan)
    await reclaimMemory(options.session ?? (input as any).session, false).catch(() => undefined);

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
export async function planTask(input: AgentInput): Promise<Message[]> {
  const user: Message = { role: 'user', content: input.message };
  const prompt: Message = {
    role: 'system',
    content:
      'Kullanıcı isteği için somut, sıralı ve uygulanabilir bir plan oluştur. İlgili kontrolleri, varsayımları ve belirsizlikleri dahil et. Dosyaları incelediğini veya eylem gerçekleştirdiğini iddia etme. Bu yalnızca bir planlama adımıdır; yürütme kullanıcının ayrı bir onayını gerektirir.',
  };
  const planMessages = [prompt, user];
  let content = '';
  let responseItems: Record<string, unknown>[] | undefined;
  let reported = false;
  let usageRecorded = false;
  try {
    for await (const event of input.provider.stream(planMessages, [], { signal: input.signal })) {
      input.signal?.throwIfAborted();
      if (event.type === 'text') {
        content += event.text;
        input.onEvent(event);
        if (content.length > 40_000) throw new Error('Plan yanıt sınırını aştı.');
      } else if (event.type === 'response_items') {
        responseItems = event.responseItems;
      } else if (event.type === 'usage') {
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
      } else if (event.type === 'error') {
        input.onEvent(event);
        reported = true;
        throw new Error(event.error);
      } else if (event.type === 'tool_calls') {
        throw new Error('Planlama aşamasında araç çağrıları yürütülemez.');
      }
    }
    input.signal?.throwIfAborted();
    if (!content.trim()) throw new Error('Sağlayıcı boş bir plan döndürdü.');
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
  } catch (error) {
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
export function executePlan(
  input: AgentInput,
  plan: string,
  runner: (input: AgentInput) => Promise<Message[]> = runAgent
): Promise<Message[]> {
  if (!plan.trim()) throw new Error('Yürütülecek bir plan bulunmuyor.');
  return runner({
    ...input,
    message: `Bu istek için kullanıcı tarafından onaylanan aşağıdaki planı yürüt: ${input.message}\n\n${plan}\n\nNormal araç onaylarını kullan ve kanıtlar gerektiriyorsa plana uyum sağla.`,
  });
}

export interface TodoItem {
  id: string;
  text: string;
  status: 'pending' | 'in_progress' | 'completed';
}

const todosCache = new Map<string, TodoItem[]>();
const todosPath = (workspace: string) => join(workspace, '.tbot', 'todos.json');

export async function getTodos(workspace: string): Promise<TodoItem[]> {
  try {
    const raw = await readFile(todosPath(workspace), 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      todosCache.set(workspace, parsed);
      return parsed;
    }
  } catch {
    // Diskten okunamadıysa bellek içi cache kullanılır
  }
  return todosCache.get(workspace) || [];
}

export async function saveTodos(workspace: string, todos: TodoItem[]): Promise<void> {
  todosCache.set(workspace, todos);
  try {
    await mkdir(join(workspace, '.tbot'), { recursive: true });
    await writeFile(todosPath(workspace), JSON.stringify(todos, null, 2), 'utf8');
  } catch {
    // Disk yazma hatası göz ardı edilir
  }
}

/**
 * Aktif /goal hedefini ve varsa aktif todo maddelerini ([✓], [◉], [ ])
 * maksimum 6-8 satırlık çok kompakt bir canlı görev pusulası olarak döndürür.
 */
export function getActiveFocusSummary(workspaceRoot?: string): string {
  const ws = workspaceRoot || process.cwd();
  const lines: string[] = [];

  // Goal kontrolü
  try {
    const gPath = goalPath(ws);
    if (existsSync(gPath)) {
      const parsed = JSON.parse(readFileSync(gPath, 'utf8'));
      if (parsed && parsed.status === 'active' && parsed.objective) {
        lines.push(`🎯 Hedef: ${parsed.objective}`);
      }
    }
  } catch {
    // ignore
  }

  // Todos kontrolü
  let todos: TodoItem[] = todosCache.get(ws) || [];
  if (todos.length === 0) {
    try {
      const tPath = todosPath(ws);
      if (existsSync(tPath)) {
        const parsed = JSON.parse(readFileSync(tPath, 'utf8'));
        if (Array.isArray(parsed)) {
          todos = parsed;
          todosCache.set(ws, todos);
        }
      }
    } catch {
      // ignore
    }
  }

  if (todos.length > 0) {
    lines.push('📋 Görev Pusulası:');
    for (let i = 0; i < Math.min(5, todos.length); i++) {
      const t = todos[i];
      const icon = t.status === 'completed' ? '[✓]' : t.status === 'in_progress' ? '[◉]' : '[ ]';
      lines.push(`${i + 1}. ${icon} ${t.text}`);
    }
    if (todos.length > 5) {
      lines.push(`... (+${todos.length - 5} madde daha)`);
    }
  }

  return lines.slice(0, 8).join('\n');
}

export async function executeWorkflowTool(
  name: string,
  args: Record<string, unknown>,
  workspaceRoot: string
): Promise<string> {
  if (name === 'todo_manage') {
    const action = String(args.action || 'list').toLowerCase();
    let currentTodos = await getTodos(workspaceRoot);

    if (action === 'set') {
      const rawItems = args.items;
      const itemsList: string[] = Array.isArray(rawItems)
        ? rawItems.map(String)
        : typeof rawItems === 'string'
          ? rawItems.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
          : [];
      currentTodos = itemsList.map((text, idx) => ({
        id: `todo_${Date.now()}_${idx}`,
        text,
        status: (args.status as TodoItem['status']) || 'pending',
      }));
      await saveTodos(workspaceRoot, currentTodos);
    } else if (action === 'add') {
      const rawItems = args.items;
      const itemsList: string[] = Array.isArray(rawItems)
        ? rawItems.map(String)
        : typeof rawItems === 'string'
          ? [rawItems.trim()]
          : [];
      for (let i = 0; i < itemsList.length; i++) {
        const text = itemsList[i];
        if (text) {
          currentTodos.push({
            id: `todo_${Date.now()}_${i}`,
            text,
            status: (args.status as TodoItem['status']) || 'pending',
          });
        }
      }
      await saveTodos(workspaceRoot, currentTodos);
    } else if (action === 'update') {
      const rawIndex = Number(args.index);
      if (Number.isFinite(rawIndex)) {
        const idx = rawIndex > 0 ? rawIndex - 1 : rawIndex;
        if (idx >= 0 && idx < currentTodos.length) {
          if (args.status && ['pending', 'in_progress', 'completed'].includes(String(args.status))) {
            currentTodos[idx].status = args.status as TodoItem['status'];
          }
          if (args.text && typeof args.text === 'string') {
            currentTodos[idx].text = args.text.trim();
          }
          await saveTodos(workspaceRoot, currentTodos);
        } else {
          return `Hata: Belirtilen görev indeksi (${rawIndex}) bulunamadı. Toplam ${currentTodos.length} madde mevcut.`;
        }
      }
    } else if (action === 'clear') {
      currentTodos = [];
      await saveTodos(workspaceRoot, currentTodos);
      return 'Görev pusulası başarıyla temizlendi.';
    } else if (action === 'list') {
      // currentTodos already fetched
    } else {
      return `Bilinmeyen action: "${action}". Geçerli eylemler: set, add, update, clear, list.`;
    }

    if (currentTodos.length === 0) {
      return 'Görev listesi boş.';
    }

    return currentTodos
      .map((t, i) => {
        const icon = t.status === 'completed' ? '[✓]' : t.status === 'in_progress' ? '[◉]' : '[ ]';
        return `${i + 1}. ${icon} ${t.text} (${t.status})`;
      })
      .join('\n');
  }

  if (name === 'goal_manage') {
    const action = String(args.action || 'status').toLowerCase();
    if (action === 'status') {
      const g = await getGoal(workspaceRoot);
      if (!g || g.status !== 'active') {
        return 'Aktif bir hedef bulunmuyor.';
      }
      const notes = g.notes?.length ? `\nNotlar:\n${g.notes.join('\n')}` : '';
      return `[Aktif Hedef]: ${g.objective} (Durum: ${g.status})${notes}`;
    }
    if (action === 'set') {
      const objective = String(args.goal || args.objective || '').trim();
      if (!objective) return 'Hata: Hedef açıklaması (goal) belirtilmelidir.';
      const existing = await getGoal(workspaceRoot);
      if (existing && (existing.status === 'active' || existing.status === 'paused')) {
        await cancelGoal(workspaceRoot).catch(() => undefined);
      }
      const newGoal = await startGoal(workspaceRoot, objective);
      return `Hedef başarıyla başlatıldı: "${newGoal.objective}"`;
    }
    if (action === 'add_note') {
      const note = String(args.note || '').trim();
      if (!note) return 'Hata: Eklenecek not (note) belirtilmelidir.';
      const g = await getGoal(workspaceRoot);
      if (!g || g.status !== 'active') return 'Hata: Not eklenebilecek aktif bir hedef yok.';
      return await withGoalLock(workspaceRoot, async () => {
        const fresh = await getGoal(workspaceRoot);
        if (!fresh) return 'Hedef bulunamadı.';
        const notes = Array.isArray(fresh.notes) ? [...fresh.notes] : [];
        notes.push(note);
        await saveGoal(workspaceRoot, { ...fresh, notes, updatedAt: new Date().toISOString() });
        return `Not kaydedildi: "${note}"`;
      });
    }
    if (action === 'complete') {
      const g = await getGoal(workspaceRoot);
      if (!g || g.status !== 'active') return 'Tamamlanacak aktif hedef bulunamadı.';
      await completeGoal(workspaceRoot);
      return `Hedef tamamlandı olarak işaretlendi: "${g.objective}"`;
    }
    if (action === 'clear') {
      const g = await getGoal(workspaceRoot);
      if (g) {
        await cancelGoal(workspaceRoot).catch(() => undefined);
        return 'Hedef iptal edildi ve temizlendi.';
      }
      return 'Temizlenecek hedef bulunamadı.';
    }
    return `Bilinmeyen action: "${action}". Geçerli eylemler: status, set, add_note, complete, clear.`;
  }

  throw new Error(`Bilinmeyen workflow aracı: ${name}`);
}

export const WORKFLOW_TOOLS: ToolDefinition[] = [
  {
    name: 'todo_manage',
    description: 'Manage task step list and progress tracking (.tbot/todos.json). Supports actions: set, add, update, clear, list.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['set', 'add', 'update', 'clear', 'list'],
          description: 'Action to perform: set (replace all), add (append), update (status/text), clear (remove all), list (view)',
        },
        items: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of task descriptions for set or add actions',
        },
        index: {
          type: 'integer',
          description: '1-based index of the task item to update',
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed'],
          description: 'Task progress status',
        },
        text: {
          type: 'string',
          description: 'Updated text content for the task item',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'goal_manage',
    description: 'Manage high-level project goals (.tbot/goal.json). Supports actions: status, set, add_note, complete, clear.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'set', 'add_note', 'complete', 'clear'],
          description: 'Action to perform: status (view), set (new goal), add_note (record progress), complete (finish), clear (cancel)',
        },
        goal: {
          type: 'string',
          description: 'High-level objective description when action is set',
        },
        note: {
          type: 'string',
          description: 'Progress or milestone note when action is add_note',
        },
      },
      required: ['action'],
    },
  },
];
