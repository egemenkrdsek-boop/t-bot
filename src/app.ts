import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { resolve } from 'node:path';
import { createSession, SessionStore } from './sessions.js';
import { parseCli, HELP } from './cli.js';
import { configDirectory, loadConfig, saveConfig, resolveProviderConfig, type AppConfig, type ResolvedProviderConfig } from './config.js';
import { setApiKey, getApiKeySource, prepareApiKey, SecretStorageError } from './secrets.js';
import { createProvider, PROVIDER_CATALOG, validateOpenRouterKey } from './providers.js';
import { discoverModels } from './models.js';
import { selectOption, inputSecret } from './menu.js';
import { runAgent } from './agent.js';
import { runSubagents } from './subagents.js';
import { connectMcp, type McpConnection } from './mcp.js';
import { MCP_PRESETS, type McpService } from './mcp-presets.js';
import { loadConnections, saveConnection, getMcpToken, setMcpToken, removeConnection } from './mcp-config.js';
import { getGoal, startGoal, pauseGoal, resumeGoal, cancelGoal, completeGoal, runGoal, planTask, executePlan } from './workflows.js';
import type { AgentEvent, ApprovalRequest, Provider } from './types.js';

const safe = (text: string): string => text.replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '');
async function listSessions(): Promise<void> {
  const sessions = await new SessionStore(configDirectory()).list();
  if (!sessions.length) { console.log('Henüz kaydedilmiş oturum yok.'); return; }
  for (const session of sessions) console.log(safe(`${session.id}  ${session.updatedAt}  ${session.workspace}  ${session.title}`));
}
async function configure(config: AppConfig, onboarding = false, presetProvider = false, modelOnly = false): Promise<AppConfig> {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Yapılandırma için etkileşimli terminal gerekli.');
  const choices = PROVIDER_CATALOG.filter(p => p.id !== 'custom');
  let id = config.provider;
  if (!modelOnly) {
    const ordered = presetProvider ? [...choices].sort((a, b) => Number(b.id === config.provider) - Number(a.id === config.provider)) : choices;
    const selected = await selectOption('Sağlayıcı seçin', ordered.map(p => ({ label: p.label, value: p.id })));
    if (!selected) throw new Error('İptal edildi.');
    id = selected;
  }
  const spec = PROVIDER_CATALOG.find(p => p.id === id);
  if (!spec) throw new Error('Sağlayıcı bulunamadı.');
  const selectedConfig = { ...config, provider: id, ...(id === config.provider && config.baseUrl ? { baseUrl: config.baseUrl } : { baseUrl: undefined }) };
  let apiKey: string | undefined;
  try { apiKey = (await resolveProviderConfig(selectedConfig)).apiKey; }
  catch (error) { if (!(error instanceof SecretStorageError) || !['read', 'decrypt'].includes(error.code)) throw error; console.log('Kayıtlı anahtar okunamadı; yeni anahtar girin.'); }
  if (spec.requiresApiKey && (!apiKey?.trim() || (!onboarding && !modelOnly))) {
    let replace = !apiKey?.trim();
    if (!replace) {
      const action = await selectOption(`${spec.label} anahtarı`, [
        { label: 'Kayıtlı anahtarı kullan', value: 'keep' },
        { label: 'Yeni anahtar gir', value: 'replace' },
      ]);
      if (!action) throw new Error('İptal edildi.');
      replace = action === 'replace';
    }
    if (replace) {
      const key = await inputSecret(`${spec.label} API anahtarı`);
      if (!key?.trim()) throw new Error('Anahtar girilmedi; yapılandırma iptal edildi.');
      if (id === 'openrouter') await validateOpenRouterKey(prepareApiKey(key));
      const result = await setApiKey(id, key);
      if (result.warning) console.log(safe(result.warning));
      apiKey = (await resolveProviderConfig(selectedConfig)).apiKey;
    }
  }
  const models = await discoverModels(id, apiKey);
  const options = models.map(model => ({ label: model.label, value: model.id }));
  if (modelOnly && id === config.provider && config.model && !options.some(model => model.value === config.model)) options.unshift({ label: `${config.model} (mevcut)`, value: config.model });
  if (!options.length) throw new Error(`${spec.label} için model listesi alınamadı. Yerel sunucunun açık ve modelin yüklü olduğunu kontrol edin veya başka bir sağlayıcı seçin.`);
  const model = await selectOption('Model seçin', options);
  if (!model) throw new Error('Model seçimi iptal edildi veya model listesi boş.');
  if (id !== config.provider) delete config.baseUrl;
  config.provider = id; config.model = model;
  await saveConfig(config);
  console.log('Ayarlar kaydedildi.');
  return config;
}
function showEvent(event: AgentEvent): void {
  if (event.type === 'text') stdout.write(safe(event.text));
  else if (event.type === 'tool_start') console.error(`\n[araç] ${safe(event.call.name)}`);
  else if (event.type === 'error') console.error(`\nHata: ${safe(event.error)}`);
  else if (event.type === 'status') console.error(`\n${safe(event.message)}`);
}
async function approveOnce(request: ApprovalRequest): Promise<boolean> {
  if (!stdin.isTTY || !stdout.isTTY) { console.error(`Onay gerekli, terminal yok: ${safe(request.description)}`); return false; }
  const rl = createInterface({ input: stdin, output: stdout });
  try { return /^(e|evet|y|yes)$/i.test((await rl.question(`\n${safe(request.description)}\n${safe(JSON.stringify(request.arguments))}\nİzin verilsin mi? [e/H] `)).trim()); }
  finally { rl.close(); }
}
export async function main(argv: string[]): Promise<void> {
  const options = parseCli(argv);
  if (options.command === 'help') { console.log(HELP); return; }
  if (options.command === 'version') { console.log('T Bot 0.1.0'); return; }
  if (options.command === 'providers') { for (const p of PROVIDER_CATALOG) console.log(`${p.id.padEnd(12)} ${p.label}${p.requiresApiKey ? ' (API anahtarı gerekli)' : ' (yerel/özel)'}`); return; }
  if (options.command === 'config') { await configure(await loadConfig()); return; }
  if (options.command === 'sessions') { await listSessions(); return; }
  if (options.command === 'doctor') {
    const config = await loadConfig();
    const resolved = await resolveProviderConfig(config);
    console.log(safe(`Node ${process.version}\nPlatform ${process.platform}\nÇalışma dizini ${process.cwd()}\nSağlayıcı ${resolved.id}\nModel ${resolved.model}\nAPI anahtarı ${resolved.apiKey ? 'mevcut' : 'ayarlı değil'}\nYapılandırma ${configDirectory()}`));
    return;
  }
  let config = await loadConfig();
  if (options.provider && options.provider !== config.provider) { config.provider = options.provider; delete config.baseUrl; }
  if (options.model) config.model = options.model;
  const workspace = resolve(options.workspace || process.cwd());
  const store = new SessionStore(configDirectory());
  const session = options.resume ? await store.get(options.resume, workspace) : createSession(workspace);
  if (!session) throw new Error('Oturum bulunamadı.');
  let resolved: ResolvedProviderConfig;
  try { resolved = await resolveProviderConfig(config, workspace); }
  catch (error) {
    if (!(error instanceof SecretStorageError) || !['read', 'decrypt'].includes(error.code) || !stdin.isTTY || !stdout.isTTY) throw error;
    console.log('Kayıtlı anahtar okunamadı; yeni anahtar ile yapılandırın.');
    config = await configure(config, true, true);
    resolved = await resolveProviderConfig(config, workspace);
  }
  const spec = PROVIDER_CATALOG.find(p => p.id === resolved.id);
  if (!spec) throw new Error(`Bilinmeyen sağlayıcı: ${safe(resolved.id)}. Seçenekler için tbot providers, ayarlamak için tbot config kullanın.`);
  if (spec.requiresApiKey && !resolved.apiKey?.trim()) {
    if (!stdin.isTTY || !stdout.isTTY) {
      const envName = `${spec.id.toUpperCase().replace(/-/g, '_')}_API_KEY`;
      throw new Error(`${spec.label} için API anahtarı gerekli. Etkileşimli terminalde tbot config çalıştırın veya ${envName} ortam değişkenini ayarlayın.`);
    }
    config = await configure(config, true, Boolean(options.provider));
    resolved = await resolveProviderConfig(config, workspace);
  }
  let provider = createProvider(resolved);
  let keySource = await getApiKeySource(config.provider);
  let workerProvider: Provider | undefined;
  let workerModel = '';
  const mcpTools: McpConnection[] = [];
  let mcpHydrated = false;
  const closeMcp = async () => { await Promise.allSettled(mcpTools.splice(0).map(c => c.close())); };
  const hydrateMcp = async (signal?: AbortSignal, emit?: (event: AgentEvent) => void) => {
    if (mcpHydrated) return;
    const saved = await loadConnections();
    for (const service of ['supabase', 'vercel', 'github'] as const) {
      if (!saved[service].enabled || mcpTools.some(c => c.service === service)) continue;
      const token = await getMcpToken(service);
      if (!token) { emit?.({ type: 'status', message: `${service} MCP tokenı yok; /mcp ile yapılandırın.` }); continue; }
      emit?.({ type: 'status', message: `${service} MCP bağlantısı kuruluyor...` });
      try { mcpTools.push(await connectMcp(service, token, { ...saved[service], signal })); }
      catch { if (signal?.aborted) throw new Error('İptal edildi.'); emit?.({ type: 'status', message: `${service} MCP bağlantısı kurulamadı; /mcp ile kontrol edin.` }); }
    }
    mcpHydrated = true;
  };
  const configureMcp = async (suspendUi: <T>(action: () => Promise<T>) => Promise<T>, signal: AbortSignal): Promise<string> => {
        const service = await suspendUi(() => selectOption('MCP bağlantısı', MCP_PRESETS.map(p => ({ label: p.label, value: p.id, description: p.description })))) as McpService | undefined;
        if (!service) return 'MCP seçimi iptal edildi.';
        const saved = await loadConnections();
        signal.throwIfAborted();
        const action = await suspendUi(() => selectOption(`${service} MCP`, [
          { label: saved[service].enabled ? 'Bağlantıyı yenile veya tokenı değiştir' : 'Token ile bağlan', value: 'connect' },
          ...(saved[service].enabled ? [{ label: 'Bağlantıyı kaldır', value: 'remove' }] : []),
        ]));
        if (!action) return 'MCP seçimi iptal edildi.';
        if (action === 'remove') {
          signal.throwIfAborted();
          await removeConnection(service);
          const old = mcpTools.findIndex(c => c.service === service);
          if (old >= 0) { const [connection] = mcpTools.splice(old, 1); await connection.close(); }
          return `${service} MCP bağlantısı yerel olarak kaldırıldı; sağlayıcı tokenı iptal edilmedi.`;
        }
        let token = await getMcpToken(service);
        signal.throwIfAborted();
        if (token) {
          const use = await suspendUi(() => selectOption('Token seçimi', [{ label: 'Kayıtlı tokenı kullan', value: 'existing' }, { label: 'Yeni token gir', value: 'new' }]));
          if (!use) return 'MCP seçimi iptal edildi.';
          if (use === 'new') token = undefined;
        }
        let newToken: string | undefined;
        if (!token) {
          const entered = await suspendUi(() => inputSecret(`${service} erişim tokenı`));
          if (!entered?.trim()) return 'Token girilmedi; bağlantı değiştirilmedi.';
          newToken = prepareApiKey(entered); token = newToken;
        }
        const readOnly = false;
        let project = saved[service].project;
        if (service === 'supabase' && project) {
          const scope = await suspendUi(() => selectOption('Supabase kapsamı', [
            { label: 'Hesap kapsamı (proje oluşturma dahil)', value: 'account' },
            { label: 'Mevcut proje kapsamını koru', value: 'project' },
          ]));
          if (!scope) return 'MCP seçimi iptal edildi.';
          if (scope === 'account') project = undefined;
        }
        const connection = await connectMcp(service, token, { ...saved[service], project, readOnly, signal });
        try {
          signal.throwIfAborted();
          if (newToken) { const result = await setMcpToken(service, newToken); if (result.warning) console.log(safe(result.warning)); }
          signal.throwIfAborted();
          await saveConnection(service, { enabled: true, readOnly, ...(service === 'supabase' ? { project: project ?? '' } : {}) });
        } catch (error) { await connection.close(); throw error; }
        const old = mcpTools.findIndex(c => c.service === service);
        if (old >= 0) { const [previous] = mcpTools.splice(old, 1); await previous.close(); }
        mcpTools.push(connection);
        return `${service} MCP bağlı: ${connection.definitions.length} araç${service === 'vercel' ? ' (T Bot yerel Vercel adaptörü)' : ''}. Araç işlemleri onay politikasına uyar.`;
  };
  let pendingPlan: { request: string; plan: string } | undefined;
  const withAuth = (emit: (event: AgentEvent) => void) => (event: AgentEvent) => {
    emit(event);
    if (event.type === 'error' && event.code === 'authentication') emit({ type: 'status', message: `Anahtar kaynağı: ${keySource}. /auth ile yeni anahtar girin ve sağlayıcı hesabındaki erişimi kontrol edin.` });
  };
  let yolo = options.yolo === true;
  const approve = (request: ApprovalRequest) => yolo ? Promise.resolve(true) : approveOnce(request);
  if (options.message) {
    if (yolo) console.error('YOLO açık: araç onayları bu oturumda otomatik verilir.');
    const controller = new AbortController();
    const cancel = () => controller.abort(); process.once('SIGINT', cancel);
    try { await hydrateMcp(controller.signal, showEvent); session.messages = await runAgent({ message: options.message, history: session.messages, provider, workspace, mcpTools, onEvent: withAuth(event => { showEvent(event); if (event.type === 'error') process.exitCode = 1; }), approve, signal: controller.signal }); await store.save(session); stdout.write('\n'); }
    finally { process.off('SIGINT', cancel); await closeMcp(); }
    return;
  }
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Etkileşimli mod için terminal gerekli; istek metnini argüman olarak verin.');
  const { startTui } = await import('./tui.js');
  try { await startTui({ workspace, provider, model: config.model, history: session.messages, yolo,
    onSubmit: async (message, emit, tuiApprove, signal) => {
      await hydrateMcp(signal, emit);
      const input = { message, history: session.messages, provider, workspace, mcpTools, onEvent: withAuth(emit), approve: (request: ApprovalRequest) => yolo ? Promise.resolve(true) : tuiApprove(request), signal };
      session.messages = workerProvider ? await runSubagents({ ...input, workerProvider }) : await runAgent(input);
      await store.save(session); return session.messages;
    },
    onWorkflow: async (command, text, emit, tuiApprove, signal, suspendUi) => {
      if ((command === '/goal' && text.trim() && !['status', 'pause', 'cancel', 'done', 'complete'].includes(text.trim().toLowerCase())) || (command === '/plan' && text.trim().toLowerCase() === 'apply') || (command === '/subagents' && text.trim())) await hydrateMcp(signal, emit);
      const input = { message: text, history: session.messages, provider, workspace, mcpTools, onEvent: withAuth(emit), approve: (request: ApprovalRequest) => yolo ? Promise.resolve(true) : tuiApprove(request), signal };
      if (command === '/mcp') { emit({ type: 'status', message: await configureMcp(suspendUi, signal) }); return; }
      if (command === '/goal') {
        const action = text.trim().toLowerCase();
        if (!action || action === 'status') {
          const goal = await getGoal(workspace);
          emit({ type: 'status', message: goal ? `Hedef: ${goal.objective} | Durum: ${goal.status} | Son çalışma: ${goal.lastRun ?? 'yok'}` : 'Kayıtlı hedef yok. /goal <hedef> ile başlayın.' });
          return;
        }
        if (action === 'pause') { await pauseGoal(workspace); emit({ type: 'status', message: 'Hedef duraklatıldı.' }); return; }
        if (action === 'cancel') { await cancelGoal(workspace); emit({ type: 'status', message: 'Hedef iptal edildi.' }); return; }
        if (action === 'done' || action === 'complete') { await completeGoal(workspace); emit({ type: 'status', message: 'Hedef tamamlandı olarak işaretlendi.' }); return; }
        if (action === 'resume') await resumeGoal(workspace);
        else if (action !== 'run') await startGoal(workspace, text);
        session.messages = await runGoal({ ...input, message: '' });
        await store.save(session); return;
      }
      if (command === '/plan') {
        if (!text.trim()) { emit({ type: 'status', message: 'Kullanım: /plan <istek> veya /plan apply' }); return; }
        if (text.trim().toLowerCase() === 'apply') {
          if (!pendingPlan) { emit({ type: 'status', message: 'Uygulanacak plan yok; önce /plan <istek> kullanın.' }); return; }
          const approved = pendingPlan; pendingPlan = undefined;
          session.messages = await executePlan({ ...input, message: approved.request }, approved.plan);
          await store.save(session); return;
        }
        const planned = await planTask(input);
        session.messages = planned;
        await store.save(session);
        const plan = [...planned].reverse().find(m => m.role === 'assistant')?.content ?? '';
        pendingPlan = { request: text, plan };
        emit({ type: 'status', message: 'Plan hazır. Uygulamak için /plan apply yazın.' });
        return;
      }
      if (command === '/subagents') {
        if (!text.trim() && workerProvider) {
          const action = await suspendUi(() => selectOption('Alt ajanlar', [
            { label: `Açık: ${workerModel}`, value: 'keep' }, { label: 'Modeli değiştir', value: 'change' }, { label: 'Kapat', value: 'disable' },
          ]));
          if (!action || action === 'keep') return;
          if (action === 'disable') { workerProvider = undefined; workerModel = ''; emit({ type: 'status', message: 'Alt ajanlar kapatıldı.' }); return; }
        }
        const models = await discoverModels(config.provider, (await resolveProviderConfig(config, workspace)).apiKey, signal);
        if (signal.aborted) return;
        const selected = await suspendUi(() => selectOption('Alt ajan modeli seçin', models.map(m => ({ label: m.label, value: m.id }))));
        if (!selected) { emit({ type: 'status', message: 'Alt ajan model seçimi iptal edildi veya model yok.' }); return; }
        workerProvider = createProvider({ ...await resolveProviderConfig(config, workspace), model: selected });
        workerModel = selected;
        emit({ type: 'status', message: `Alt ajanlar açık: ${selected}. Araştırma alt ajanları salt okunurdur.` });
        if (text.trim()) { session.messages = await runSubagents({ ...input, workerProvider }); await store.save(session); }
      }
    },
    onCommand: async (command, setYolo) => {
      const [name, argument, extra] = command.trim().toLowerCase().split(/\s+/);
      if (name === '/yolo') {
        if (extra || (argument && argument !== 'on' && argument !== 'off')) return 'Kullanım: /yolo, /yolo on veya /yolo off';
        let choice: string | undefined = argument;
        if (!choice) {
          choice = await selectOption('YOLO modu', [
            { label: 'Kapalı — araç işlemlerinde onay iste', value: 'off' },
            { label: 'Açık — araç onaylarını otomatik ver', value: 'on' },
          ]);
          if (!choice) return 'YOLO modu değiştirilmedi.';
        }
        yolo = choice === 'on'; setYolo?.(yolo);
        return yolo ? 'YOLO açık: araç onayları bu oturumda otomatik verilir.' : 'YOLO kapalı: araç onayları sorulur.';
      }
      if (command === '/clear') { session.messages = []; pendingPlan = undefined; await store.save(session); return undefined; }
      if (command === '/sessions') return `Oturum kimliği: ${session.id}. Tüm oturumlar için tbot sessions kullanın.`;
      if (command === '/auth') {
        const spec = PROVIDER_CATALOG.find(p => p.id === config.provider);
        if (!spec?.requiresApiKey) return 'Bu sağlayıcı için API anahtarı gerekli değil.';
        const key = await inputSecret(`${spec.label} için yeni API anahtarı`);
        if (!key?.trim()) return 'Anahtar değiştirilmedi.';
        if (/^\*+$/.test(key.trim())) return 'Maskelenmiş yıldızlar anahtar değildir; sağlayıcıdan anahtarın kendisini kopyalayın.';
        if (spec.id === 'openrouter') await validateOpenRouterKey(prepareApiKey(key));
        const status = await setApiKey(spec.id, key);
        provider = createProvider(await resolveProviderConfig(config, workspace));
        keySource = await getApiKeySource(config.provider);
        workerProvider = undefined; workerModel = '';
        return `Yeni anahtar kaydedildi. Önceki istek yeniden çalıştırılmadı; devam etmek için isteğinizi tekrar gönderin.${status.warning ? ` ${status.warning}` : ''}`;
      }
      if (command === '/provider' || command === '/model' || command === '/config') {
        config = await configure(config, false, true, command === '/model');
        provider = createProvider(await resolveProviderConfig(config, workspace));
        keySource = await getApiKeySource(config.provider);
        workerProvider = undefined; workerModel = '';
        return `Sağlayıcı: ${provider.label}; model: ${config.model}`;
      }
      if (command === '/resume') return 'Devam etmek için tbot --resume <id> kullanın.';
      return undefined;
    }
  }); } finally { await closeMcp(); }
}
