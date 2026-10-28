import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSession, SessionStore } from './sessions.js';
import { parseCli, HELP, printUsage } from './cli.js';
import { configDirectory, loadConfig, saveConfig, resolveProviderConfig, getEffort, setEffort, getWorkspacePermission, setWorkspacePermission, type AppConfig, type ResolvedProviderConfig } from './config.js';
import { getApiKey, getApiKeySource, prepareApiKey, SecretStorageError, setCustomSecret, getCustomSecret } from './secrets.js';
import { createProvider, PROVIDER_CATALOG } from './providers.js';
import { discoverModels } from './models.js';
import { selectOption, inputSecret } from './menu.js';
import { runTurnMode } from './turn-runner.js';
import { runSubagents } from './subagents.js';
import { runUltracode } from './ultracode.js';
import { EFFORT_LEVELS, describeEffort, type EffortLevel } from './effort.js';
import { BUILTIN_SKILLS, resolveSkills, skillRequiresReadOnly } from './skills.js';
import { IMAGE_MODELS } from './tools/image.js';
import { executeTool, registerGuiKillSwitch } from './tools/index.js';
import { connectMcp, type McpConnection } from './mcp.js';
import { MCP_PRESETS, type McpService } from './mcp-presets.js';
import { loadConnections, saveConnection, getMcpToken, setMcpToken, removeConnection } from './mcp-config.js';
import { getGoal, startGoal, pauseGoal, resumeGoal, cancelGoal, completeGoal, runGoal, planTask, executePlan } from './workflows.js';
import { closeBrowser } from './tools/browser.js';
import { stopAllBackgroundProcesses } from './tools/shell.js';
import { startTelegramBotBridge, stopTelegramBotBridge, getTelegramBotStatus } from './bot.js';
import { globalTokenTracker } from './token-optimizer.js';
import { globalGroundingLedger } from './grounding.js';
import { rememberFact, recallFacts, forgetFact } from './memory.js';
import { reclaimMemory, getMemoryStats, startAutoMemoryGuard, stopAutoMemoryGuard } from './memory-guard.js';
import { resolveImageProviderConfig, storeProviderApiKey } from './host-services.js';
import type { AgentEvent, AgentInput, ApprovalRequest, Provider } from './types.js';
import { APP_VERSION, MINIMUM_NODE_VERSION, supportsNodeVersion } from './version.js';
import { sandboxStatus } from './security/sandbox.js';
import { listCheckpoints, restoreCheckpoint } from './checkpoints.js';

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
    const selected = await selectOption('Sağlayıcı Seçin', ordered.map(p => ({ label: p.label, value: p.id })));
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
      const action = await selectOption(`${spec.label} Anahtarı`, [
        { label: 'Kayıtlı Anahtarı Kullan', value: 'keep' },
        { label: 'Yeni Anahtar Gir', value: 'replace' },
      ]);
      if (!action) throw new Error('İptal edildi.');
      replace = action === 'replace';
    }
    if (replace) {
      const key = await inputSecret(`${spec.label} API Anahtarı`);
      if (!key?.trim()) throw new Error('Anahtar girilmedi; yapılandırma iptal edildi.');
      const result = await storeProviderApiKey(id, key);
      if (result.warning) console.log(safe(result.warning));
      apiKey = (await resolveProviderConfig(selectedConfig)).apiKey;
    }
  }
  const models = await discoverModels(id, apiKey, undefined, selectedConfig.baseUrl);
  const options = models.map(model => ({ label: model.label, value: model.id }));
  if (modelOnly && id === config.provider && config.model && !options.some(model => model.value === config.model)) options.unshift({ label: `${config.model} (Mevcut)`, value: config.model });
  if (!options.length) throw new Error(`${spec.label} için model listesi alınamadı. Yerel sunucunun açık ve modelin yüklü olduğunu kontrol edin veya başka bir sağlayıcı seçin.`);
  const model = await selectOption('Model Seçin', options);
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

async function approveOnce(request: ApprovalRequest, signal?: AbortSignal): Promise<boolean> {
  if (!stdin.isTTY || !stdout.isTTY) { console.error(`Onay gerekli, terminal yok: ${safe(request.description)}`); return false; }
  const rl = createInterface({ input: stdin, output: stdout });
  try { return /^(e|evet|y|yes)$/i.test((await rl.question(`\n${safe(request.description)}\n${safe(JSON.stringify(request.arguments))}\nİzin Verilsin mi? [E/H] `, { signal })).trim()); }
  finally { rl.close(); }
}

export async function main(argv: string[]): Promise<void> {
  const options = parseCli(argv);
  if (options.command === 'help') { printUsage(); return; }
  if (options.command === 'version') { console.log(`T Bot ${APP_VERSION}`); return; }
  if (options.command === 'providers') { for (const p of PROVIDER_CATALOG) console.log(`${p.id.padEnd(12)} ${p.label}${p.requiresApiKey ? ' (API anahtarı gerekli)' : ' (yerel/özel)'}`); return; }
  if (options.command === 'config') { await configure(await loadConfig()); return; }
  if (options.command === 'sessions') { await listSessions(); return; }
  if (options.command === 'doctor') {
    const config = await loadConfig();
    const resolved = await resolveProviderConfig(config);
    const supportedNode = supportsNodeVersion(process.versions.node);
    const sandbox = sandboxStatus();
    console.log(safe(`T Bot ${APP_VERSION}\nNode ${process.version} (${supportedNode ? 'uygun' : `en az ${MINIMUM_NODE_VERSION} gerekli`})\nPlatform ${process.platform}\nÇalışma Dizini ${resolve(options.workspace || process.cwd())}\nSağlayıcı ${resolved.id}\nModel ${resolved.model}\nAPI Anahtarı ${resolved.apiKey ? 'Mevcut' : 'Ayarlı Değil'}\nKabuk İzolasyonu ${sandbox.kind} (${sandbox.reason})\nYapılandırma ${configDirectory()}`));
    if (!supportedNode) process.exitCode = 1;
    return;
  }
  let config = await loadConfig();
  if (config.guiMode === 'headless') process.env.TBOT_HEADLESS = 'true';
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
  let selectedEffort: EffortLevel = options.effort ?? getEffort(config);
  let ultracode = options.ultracode === true;
  resolved.effort = selectedEffort;
  let provider = createProvider(resolved);
  let keySource = await getApiKeySource(config.provider);
  let workerProvider: Provider | undefined;
  let workerModel = '';
  const mcpTools: McpConnection[] = [];
  let mcpHydrated = false;

  const closeMcp = async () => { await Promise.allSettled(mcpTools.splice(0).map(c => c.close())); };

  const cleanupAllResources = async () => {
    stopAutoMemoryGuard();
    stopTelegramBotBridge();
    stopAllBackgroundProcesses();
    await closeBrowser().catch(() => undefined);
    await closeMcp().catch(() => undefined);
  };

  const hydrateMcp = async (signal?: AbortSignal, emit?: (event: AgentEvent) => void) => {
    if (mcpHydrated) return;
    const mcpConfig = await loadConnections() as Record<string, any>;
    const services = (mcpConfig.services && typeof mcpConfig.services === 'object' ? mcpConfig.services : mcpConfig) as Record<string, any>;
    for (const service of Object.keys(services)) {
      if (service === 'version' || service === 'services') continue;
      const serviceCfg = services[service];
      if (!serviceCfg || typeof serviceCfg !== 'object' || !serviceCfg.enabled || mcpTools.some(c => c.service === service)) continue;
      const isStdio = (typeof serviceCfg.url === 'string' && serviceCfg.url.startsWith('stdio:')) || Boolean(serviceCfg.command);
      const token = await getMcpToken(service);
      if (!token && !isStdio) { emit?.({ type: 'status', message: `${service} MCP tokenı yok; /mcp ile yapılandırın.` }); continue; }
      emit?.({ type: 'status', message: `${service} MCP bağlantısı kuruluyor...` });
      try { mcpTools.push(await connectMcp(service, token, { ...serviceCfg, workspace, signal })); }
      catch { if (signal?.aborted) throw new Error('İptal edildi.'); emit?.({ type: 'status', message: `${service} MCP bağlantısı kurulamadı; /mcp ile kontrol edin.` }); }
    }
    mcpHydrated = true;
  };

  const configureMcp = async (suspendUi: <T>(action: () => Promise<T>) => Promise<T>, signal: AbortSignal): Promise<string> => {
    const service = await suspendUi(() => selectOption('MCP Bağlantısı', MCP_PRESETS.map(p => ({ label: p.label, value: p.id, description: p.description })))) as McpService | undefined;
    if (!service) return 'MCP seçimi iptal edildi.';
    const saved = await loadConnections();
    signal.throwIfAborted();
    const action = await suspendUi(() => selectOption(`${service} MCP`, [
      { label: saved[service].enabled ? 'Bağlantıyı Yenile veya Tokenı Değiştir' : 'Token ile Bağlan', value: 'connect' },
      ...(saved[service].enabled ? [{ label: 'Bağlantıyı Kaldır', value: 'remove' }] : []),
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
      const use = await suspendUi(() => selectOption('Token Seçimi', [{ label: 'Kayıtlı Tokenı Kullan', value: 'existing' }, { label: 'Yeni Token Gir', value: 'new' }]));
      if (!use) return 'MCP seçimi iptal edildi.';
      if (use === 'new') token = undefined;
    }
    let newToken: string | undefined;
    if (!token) {
      const entered = await suspendUi(() => inputSecret(`${service} Erişim Tokenı`));
      if (!entered?.trim()) return 'Token girilmedi; bağlantı değiştirilmedi.';
      newToken = prepareApiKey(entered); token = newToken;
    }
    const readOnly = false;
    let project = saved[service].project;
    if (service === 'supabase' && project) {
      const scope = await suspendUi(() => selectOption('Supabase Kapsamı', [
        { label: 'Hesap Kapsamı (Proje Oluşturma Dahil)', value: 'account' },
        { label: 'Mevcut Proje Kapsamını Koru', value: 'project' },
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
  const imageConfig = async () => resolveImageProviderConfig(config);

  const runRouted = async (input: AgentInput) => {
    const skills = resolveSkills(input.message, input.workspace);
    const mode = skillRequiresReadOnly(skills, input.message) || skills.some(s => s.id === 'imagegen')
      ? 'agent'
      : ultracode
        ? 'ultracode'
        : workerProvider
          ? 'subagents'
          : 'agent';
    return await runTurnMode(input, {
      mode,
      workerProvider: workerProvider ?? provider,
      workspace,
    });
  };

  const modeStatus = () => {
    const mapping = describeEffort(config.provider, config.model, selectedEffort);
    return `Effort: ${selectedEffort}${mapping.effective && mapping.effective !== selectedEffort ? ` → ${mapping.effective}` : mapping.supported ? '' : ' (Varsayılan)'}${ultracode ? ' · Ultracode' : ''}`;
  };

  const withAuth = (emit: (event: AgentEvent) => void) => (event: AgentEvent) => {
    emit(event);
    if (event.type === 'error' && event.code === 'authentication') emit({ type: 'status', message: `Anahtar kaynağı: ${keySource}. /auth ile yeni anahtar girin ve sağlayıcı hesabındaki erişimi kontrol edin.` });
  };

  let yolo = options.yolo === true || getWorkspacePermission(config, workspace) === 'allow';

  const checkApproval = (tuiApprove?: (req: ApprovalRequest) => Promise<boolean>, signal?: AbortSignal) => (request: ApprovalRequest): Promise<boolean> => {
    if (signal?.aborted) return Promise.resolve(false);
    if (yolo || getWorkspacePermission(config, workspace) === 'allow') return Promise.resolve(true);
    return tuiApprove ? tuiApprove(request) : approveOnce(request, signal);
  };

  const ensureBotBridge = async (customToken?: string, suspendUi?: <T>(action: () => Promise<T>) => Promise<T>): Promise<{ ok: boolean; message: string }> => {
    let token = customToken ?? await getCustomSecret('telegram_bot_token');
    if (!token?.trim()) {
      const ask = suspendUi ? () => suspendUi(() => inputSecret('Telegram Bot Token: ')) : () => inputSecret('Telegram Bot Token: ');
      const entered = await ask();
      if (!entered?.trim()) return { ok: false, message: 'Token girilmedi; Telegram Bot başlatılamadı.' };
      token = prepareApiKey(entered);
      await setCustomSecret('telegram_bot_token', token);
      config.telegramBotToken = true;
      await saveConfig(config);
    }
    const res = await startTelegramBotBridge({
      config: config as any,
      session,
      workspace,
      getYolo: () => yolo || getWorkspacePermission(config, workspace) === 'allow',
      mcpTools,
      onLog: (text: string) => {
        if (!stdin.isTTY) console.error(text);
      }
    });
    if (res.ok) {
      return { ok: true, message: `Telegram Bot Köprüsü başarıyla başlatıldı: @${res.username || 'tbot'}` };
    } else {
      return { ok: false, message: `Telegram Bot başlatılamadı: ${res.error || 'Bilinmeyen hata'}` };
    }
  };

  if (!options.message && (!stdin.isTTY || !stdout.isTTY)) throw new Error('Etkileşimli mod için terminal gerekli; istek metnini argüman olarak verin.');

  if (options.bot) {
    try {
      const token = await getCustomSecret('telegram_bot_token');
      if (token?.trim()) {
        const res = await startTelegramBotBridge({
          config: config as any,
          session,
          workspace,
          getYolo: () => yolo || getWorkspacePermission(config, workspace) === 'allow',
          mcpTools,
          onLog: (msg) => { if (!stdin.isTTY) console.error(msg); }
        });
        if (res.ok) console.error(`[Telegram Bot] Köprü arka planda aktif: @${res.username}`);
        else console.error(`[Telegram Bot] Başlatılamadı: ${res.error}`);
      } else {
        console.error('[Telegram Bot] Bot tokenı bulunamadı. Yapılandırmak için /bot token <TOKEN> kullanın.');
      }
    } catch (err) {
      console.error(`[Telegram Bot] Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (options.message) {
    if (yolo) console.error('YOLO açık: araç onayları bu oturumda otomatik verilir.');
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once('SIGINT', cancel);
    process.once('SIGTERM', cancel);
    registerGuiKillSwitch((reason) => {
      showEvent({ type: 'error', error: reason });
      controller.abort();
    });
    try {
      await hydrateMcp(controller.signal, showEvent);
      console.error(describeEffort(config.provider, config.model, selectedEffort).message);
      session.messages = await runRouted({
        processOwner: `cli:${session.id}`,
        message: options.message,
        history: session.messages,
        provider,
        workspace,
        mcpTools,
        imageProvider: await imageConfig(),
        onEvent: withAuth(event => { showEvent(event); if (event.type === 'error') process.exitCode = 1; }),
        approve: checkApproval(undefined, controller.signal),
        signal: controller.signal
      });
      await store.save(session);
      stdout.write('\n');
    } finally {
      registerGuiKillSwitch(null);
      process.off('SIGINT', cancel);
      process.off('SIGTERM', cancel);
      await cleanupAllResources();
    }
    return;
  }

  try {
    startAutoMemoryGuard(() => session);
    const { startTui } = await import('./tui.js');
    await startTui({
      workspace,
      get provider() { return provider; },
      get model() { return config.model; },
      history: session.messages,
      yolo,
      modeStatus,
      onSubmit: async (message, emit, tuiApprove, signal) => {
        await hydrateMcp(signal, emit);
        const input = {
          processOwner: `cli:${session.id}`,
          message,
          history: session.messages,
          provider,
          workspace,
          mcpTools,
          imageProvider: await imageConfig(),
          onEvent: withAuth(emit),
          approve: checkApproval(tuiApprove),
          signal
        };
        session.messages = await runRouted(input);
        await store.save(session);
        return session.messages;
      },
      onWorkflow: async (command, text, emit, tuiApprove, signal, suspendUi) => {
        if (
          ['/frontenddesign', '/backend'].includes(command) ||
          (command === '/goal' && text.trim() && !['status', 'pause', 'cancel', 'done', 'complete'].includes(text.trim().toLowerCase())) ||
          (command === '/plan' && text.trim().toLowerCase() === 'apply') ||
          (command === '/subagents' && text.trim()) ||
          (command === '/ultracode' && text.trim())
        ) {
          await hydrateMcp(signal, emit);
        }

        const input = {
          processOwner: `cli:${session.id}`,
          message: text,
          history: session.messages,
          provider,
          workspace,
          mcpTools,
          imageProvider: await imageConfig(),
          onEvent: withAuth(emit),
          approve: checkApproval(tuiApprove),
          signal
        };

        if (command === '/imagegen') {
          if (!text.trim()) { emit({ type: 'status', message: 'Kullanım: /imagegen <görsel isteği veya düzenleme komutu>' }); return; }
          const available = await Promise.all((['openai', 'gemini', 'openrouter'] as const).map(async id => ({ id, apiKey: await getApiKey(id) })));
          signal.throwIfAborted();
          const usable = available.filter(item => !!item.apiKey);
          if (!usable.length) { emit({ type: 'error', error: 'Görsel üretimi/düzenlemesi için OpenAI, Gemini veya OpenRouter API anahtarı yapılandırın.' }); return; }
          const imageId = await suspendUi(() => selectOption('Görsel Sağlayıcısı', usable.map(item => ({ label: item.id === 'openai' ? 'OpenAI' : item.id === 'gemini' ? 'Gemini' : 'OpenRouter', value: item.id }))));
          if (imageId !== 'openai' && imageId !== 'gemini' && imageId !== 'openrouter') return;
          const chosenKey = usable.find(item => item.id === imageId)?.apiKey;
          if (!chosenKey) return;
          const imageModel = await suspendUi(() => selectOption('Görsel Modeli', IMAGE_MODELS[imageId].choices.map(model => ({ label: model, value: model }))));
          if (!imageModel || signal.aborted) return;
          emit({ type: 'status', message: `${imageId} / ${imageModel}: görsel işlemi hazırlanıyor...` });
          const result = await executeTool(
            { id: randomUUID(), name: 'image_generate', arguments: { prompt: text } },
            { workspace, approve: input.approve, signal, imageProvider: { provider: imageId, apiKey: chosenKey, model: imageModel } }
          );
          emit({ type: result.startsWith('Tool error:') ? 'error' : 'status', ...(result.startsWith('Tool error:') ? { error: result } : { message: result }) } as AgentEvent);
          session.messages.push({ role: 'user', content: `/imagegen ${text}` }, { role: 'assistant', content: result });
          await store.save(session);
          return;
        }

        if (['/frontenddesign', '/backend', '/codereview', '/debuganalysis'].includes(command)) {
          session.messages = await runRouted({ ...input, message: `${command} ${text}`.trim() });
          await store.save(session);
          return;
        }

        if (command === '/mcp') {
          emit({ type: 'status', message: await configureMcp(suspendUi, signal) });
          return;
        }

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
          session.messages = await runGoal({ ...input, message: '' }, runRouted);
          await store.save(session);
          return;
        }

        if (command === '/plan') {
          if (!text.trim()) { emit({ type: 'status', message: 'Kullanım: /plan <istek> veya /plan apply' }); return; }
          if (text.trim().toLowerCase() === 'apply') {
            if (!pendingPlan) { emit({ type: 'status', message: 'Uygulanacak plan yok; önce /plan <istek> kullanın.' }); return; }
            const approved = pendingPlan; pendingPlan = undefined;
            session.messages = await executePlan({ ...input, message: approved.request }, approved.plan, runRouted);
            await store.save(session);
            return;
          }
          const planned = await planTask(input);
          session.messages = planned;
          await store.save(session);
          const plan = [...planned].reverse().find(m => m.role === 'assistant')?.content ?? '';
          pendingPlan = { request: text, plan };
          emit({ type: 'status', message: 'Plan hazır. Uygulamak için /plan apply yazın.' });
          return;
        }

        if (command === '/ultracode') {
          if (!text.trim()) {
            emit({ type: 'status', message: 'Kullanım: /ultracode <görev> veya /ultracode on|off' });
            return;
          }
          session.messages = await runUltracode({
            ...input,
            message: text,
            workerProvider: workerProvider ?? provider,
          });
          await store.save(session);
          return;
        }

        if (command === '/subagents') {
          if (!text.trim() && workerProvider) {
            const action = await suspendUi(() => selectOption('Alt Ajanlar', [
              { label: `Açık: ${workerModel}`, value: 'keep' }, { label: 'Modeli Değiştir', value: 'change' }, { label: 'Kapat', value: 'disable' },
            ]));
            if (!action || action === 'keep') return;
            if (action === 'disable') { workerProvider = undefined; workerModel = ''; emit({ type: 'status', message: 'Alt ajanlar kapatıldı.' }); return; }
          }
          const discoveryConfig = await resolveProviderConfig(config, workspace);
          const models = await discoverModels(config.provider, discoveryConfig.apiKey, signal, discoveryConfig.baseUrl);
          if (signal.aborted) return;
          const selected = await suspendUi(() => selectOption('Alt Ajan Modeli Seçin', models.map(m => ({ label: m.label, value: m.id }))));
          if (!selected) { emit({ type: 'status', message: 'Alt ajan model seçimi iptal edildi veya model yok.' }); return; }
          const workerEffort = getEffort(config, config.provider, selected);
          workerProvider = createProvider({ ...await resolveProviderConfig(config, workspace), model: selected, effort: workerEffort });
          emit({ type: 'status', message: describeEffort(config.provider, selected, workerEffort).message });
          workerModel = selected;
          emit({ type: 'status', message: `Alt ajanlar açık: ${selected}. Araştırma alt ajanları salt okunurdur.` });
          if (text.trim()) { session.messages = await runSubagents({ ...input, workerProvider }); await store.save(session); }
        }
      },
      onCommand: async (command, setYolo) => {
        const [name, argument, extra] = command.trim().toLowerCase().split(/\s+/);

        if (name === '/gui') {
          const sub = argument?.toLowerCase();
          if (sub === 'headless') {
            process.env.TBOT_HEADLESS = 'true';
            config.guiMode = 'headless';
            await saveConfig(config);
            return '[GUI] Arka Plan (Headless) Modu Aktif. Tarayıcı pencereleri gizli çalışacak.';
          }
          if (sub === 'stop') {
            await closeBrowser().catch(() => undefined);
            stopAllBackgroundProcesses();
            return '[GUI] Açık tarayıcı ve masaüstü arka plan süreçleri durduruldu.';
          }
          delete process.env.TBOT_HEADLESS;
          config.guiMode = 'live';
          await saveConfig(config);
          return '[GUI] Canlı Mod Aktif (Canlı HUD ve Tarayıcı Pencereleri Görünür).';
        }

        if (name === '/tokens') {
          const report = globalTokenTracker.getReport();
          return [
            '[TOKEN] Canlı Token Tasarrufu ve Oturum Raporu',
            '────────────────────────────────────────────────',
            `  Toplam Ham Token     : ${report.totalRawTokens.toLocaleString()}`,
            `  Gönderilen Girdi     : ${report.totalSentInputTokens.toLocaleString()}`,
            `  Üretilen Çıktı       : ${report.totalOutputTokens.toLocaleString()}`,
            `  Önbelleklenen Token  : ${report.totalCachedTokens.toLocaleString()}`,
            `  Budanan Şema Token   : ${report.totalPrunedSchemaTokens.toLocaleString()}`,
            `  Sıkıştırılmış Geçmiş : ${report.totalCompressedHistoryTokens.toLocaleString()}`,
            `  Bağlam Önbelleği     : ${report.totalContextCacheSavedTokens.toLocaleString()}`,
            `  Kazanılan (Tasarruf) : ${report.totalSavedTokens.toLocaleString()} tok`,
            `  Tasarruf Oranı       : %${report.savingsPercent}`,
            `  Oturum Tur Sayısı    : ${report.turnsCount}`,
          ].join('\n');
        }

        if (name === '/memory') {
          const facts = await recallFacts(workspace);
          const mem = getMemoryStats();
          const ratioStr = mem.heapTotalMB > 0 ? ` (%${((mem.heapUsedMB / mem.heapTotalMB) * 100).toFixed(1)})` : '';
          const lines = [
            '[BELLEK] Bellek ve RAM Koruma Durumu',
            '────────────────────────────────────────────────',
            `  Heap Kullanımı : ${mem.heapUsedMB} MB / ${mem.heapTotalMB} MB${ratioStr}`,
            `  RSS Fiziksel   : ${mem.rssMB} MB`,
            `  Bellek Baskısı : ${mem.pressure.toUpperCase()}`,
            '',
            `[HAFIZA] Kayıtlı Proje/Genel Hafıza Maddeleri (${facts.length}):`,
            '────────────────────────────────────────────────',
          ];
          if (!facts.length) {
            lines.push('  Henüz kayıtlı hafıza maddesi yok. /remember <anahtar> = <değer> ile ekleyebilirsiniz.');
          } else {
            for (const f of facts) {
              lines.push(`  • [${f.scope.toUpperCase()}] ${f.key}: ${f.value}`);
            }
          }
          return lines.join('\n');
        }

        if (name === '/remember') {
          const raw = command.replace(/^\/remember\s*/i, '').trim();
          if (!raw) return 'Kullanım: /remember <anahtar> = <değer> veya /remember <değer>';
          let key: string;
          let val: string;
          const eqIdx = raw.indexOf('=');
          if (eqIdx >= 0) {
            key = raw.slice(0, eqIdx).trim();
            val = raw.slice(eqIdx + 1).trim();
          } else {
            const words = raw.split(/\s+/).slice(0, 3).join('_').toLowerCase().replace(/[^a-z0-9_]/g, '');
            key = words || `fact_${Date.now().toString().slice(-4)}`;
            val = raw;
          }
          if (!key || !val) return 'Hata: Anahtar ve değer boş olamaz.';
          await rememberFact(workspace, key, val, 'project');
          return `[OK] Kalıcı Proje Hafızasına Kaydedildi: [${key}] = ${val}`;
        }

        if (name === '/forget') {
          const key = command.replace(/^\/forget\s*/i, '').trim();
          if (!key) return 'Kullanım: /forget <anahtar>';
          const removed = await forgetFact(workspace, key);
          return removed ? `[OK] Hafızadan Silindi: ${key}` : `Hafızada "${key}" anahtarı bulunamadı.`;
        }

        if (name === '/doctor') {
          let hasKey = false;
          try { hasKey = Boolean((await resolveProviderConfig(config, workspace)).apiKey); } catch { /* report the failure below */ }
          const mem = getMemoryStats();
          const sandbox = sandboxStatus();
          return [
            `T Bot ${APP_VERSION} · ${process.platform}/${process.arch}`,
            `Node ${process.version} (${supportsNodeVersion(process.versions.node) ? 'uygun' : `en az ${MINIMUM_NODE_VERSION} gerekli`})`,
            `Çalışma alanı: ${workspace}`,
            `Sağlayıcı: ${config.provider} · Model: ${config.model}`,
            `API anahtarı: ${hasKey ? 'mevcut' : 'ayarlı değil'}`,
            `Kabuk izolasyonu: ${sandbox.kind} · ${sandbox.reason}`,
            `Bellek: ${mem.heapUsedMB} MB heap · ${mem.rssMB} MB RSS · baskı ${mem.pressure}`,
            `Yapılandırma: ${configDirectory()}`,
          ].join('\n');
        }

        if (name === '/gc' || name === '/ram') {
          const result = await reclaimMemory(session, true);
          return [
            '[OK] Bellek Koruyucusu Çalıştırıldı (Garbage Collection ve Message Compaction)',
            '────────────────────────────────────────────────',
            `  Boşaltılan RAM : ${result.freedMB} MB`,
            `  Mevcut Heap    : ${result.afterMB} MB`,
            `  Sıkıştırılan   : ${result.compactedCount} mesaj / araç çıktısı`,
            `  Bellek Baskısı : ${result.pressure.toUpperCase()}`
          ].join('\n');
        }

        if (name === '/bot') {
          const sub = argument?.toLowerCase();
          if (!sub || sub === 'status') {
            const st = getTelegramBotStatus();
            const allowedList = st.allowedChats && st.allowedChats.length > 0 ? st.allowedChats.join(', ') : 'Tüm Yetkili Sohbetler / Henüz Kısıtlanmadı';
            return [
              '[BOT] Telegram Bot Köprüsü Durumu',
              '────────────────────────────────────────────────',
              `  Durum         : ${st.running ? 'EVET (Aktif / Çalışıyor)' : 'HAYIR (Pasif / Durduruldu)'}`,
              `  Kullanıcı Adı : ${st.username ? `@${st.username}` : 'Bilinmiyor / Başlatılmadı'}`,
              `  İzinli ChatID : ${allowedList}`,
              `  İşlenen Mesaj : ${st.handledCount}`,
              '',
              'Komutlar: /bot start | /bot stop | /bot token <TOKEN> | /bot allow <CHAT_ID> | /bot status'
            ].join('\n');
          }
          if (sub === 'start') {
            const launch = await ensureBotBridge();
            return launch.message;
          }
          if (sub === 'stop') {
            stopTelegramBotBridge();
            return 'Telegram Bot Köprüsü durduruldu.';
          }
          if (sub === 'token') {
            const tokenVal = command.replace(/^\/bot\s+token\s*/i, '').trim();
            if (!tokenVal) return 'Kullanım: /bot token <BOT_TOKEN>';
            const prepared = prepareApiKey(tokenVal);
            await setCustomSecret('telegram_bot_token', prepared);
            config.telegramBotToken = true;
            await saveConfig(config);
            const launch = await ensureBotBridge(prepared);
            return `Token DPAPI kasasına kaydedildi.\n${launch.message}`;
          }
          if (sub === 'allow') {
            const chatId = command.replace(/^\/bot\s+allow\s*/i, '').trim();
            if (!chatId) return 'Kullanım: /bot allow <CHAT_ID>';
            const allowed = config.telegramAllowedChatIds ?? [];
            if (!allowed.includes(chatId)) {
              allowed.push(chatId);
              config.telegramAllowedChatIds = allowed;
              await saveConfig(config);
              return `[OK] Chat ID ${chatId} İzinli Telegram Sohbetleri Listesine Eklendi.`;
            }
            return `Chat ID ${chatId} zaten izin listesinde.`;
          }
          return 'Kullanım: /bot [start | stop | token <TOKEN> | allow <CHAT_ID> | status]';
        }

        if (name === '/skills') {
          if (argument) {
            const skill = BUILTIN_SKILLS.find(item => item.id === argument);
            return skill ? `/${skill.id} — ${skill.description}\n${skill.guidance}` : 'Beceri bulunamadı. /skills ile listeyi görün.';
          }
          return BUILTIN_SKILLS.filter(skill => !skill.hidden).map(skill => `/${skill.id} — ${skill.description}`).join('\n');
        }

        if (name === '/effort') {
          if (extra || (argument && !EFFORT_LEVELS.includes(argument as EffortLevel))) return 'Kullanım: /effort veya /effort low|medium|high|xhigh|max';
          const choice = argument || await selectOption('Düşünme Düzeyi', EFFORT_LEVELS.map(level => ({ label: level === 'xhigh' ? 'XHigh' : level[0].toUpperCase() + level.slice(1), value: level, description: describeEffort(config.provider, config.model, level).message })));
          if (!choice) return 'Düşünme düzeyi değiştirilmedi.';
          selectedEffort = choice as EffortLevel;
          setEffort(config, selectedEffort);
          await saveConfig(config);
          provider = createProvider({ ...await resolveProviderConfig(config, workspace), effort: selectedEffort });
          if (workerProvider && workerModel) workerProvider = createProvider({ ...await resolveProviderConfig(config, workspace), model: workerModel, effort: getEffort(config, config.provider, workerModel) });
          return describeEffort(config.provider, config.model, selectedEffort).message;
        }

        if (name === '/ultracode') {
          if (extra || (argument && argument !== 'on' && argument !== 'off')) return 'Kullanım: /ultracode, /ultracode on veya /ultracode off';
          let choice: string | undefined = argument;
          if (!choice) choice = await selectOption('Ultracode Modu', [{ label: 'Kapalı', value: 'off' }, { label: 'Açık', value: 'on' }]);
          if (!choice) return 'Ultracode modu değiştirilmedi.';
          ultracode = choice === 'on';
          return ultracode ? 'Ultracode açık: araştırma, uygulama ve bağımsız inceleme.' : 'Ultracode kapalı.';
        }

        if (name === '/yolo') {
          if (argument === 'always' || argument === 'workspace') {
            setWorkspacePermission(config, workspace, 'allow');
            await saveConfig(config);
            yolo = true;
            setYolo?.(yolo);
            return `YOLO kalıcı olarak açıldı: Bu çalışma alanı (${workspace}) için tüm araç onayları otomatik verilecek ve izin kaydedildi.`;
          }
          if (argument === 'ask' || argument === 'off') {
            setWorkspacePermission(config, workspace, 'ask');
            await saveConfig(config);
            yolo = false;
            setYolo?.(yolo);
            return 'YOLO kapalı: Bu çalışma alanı için araç onayları sorulacak.';
          }
          if (extra || (argument && argument !== 'on' && argument !== 'off')) return 'Kullanım: /yolo, /yolo on, /yolo off, /yolo always veya /yolo workspace';
          let choice: string | undefined = argument;
          if (!choice) {
            choice = await selectOption('YOLO Modu', [
              { label: 'Kapalı — Araç İşlemlerinde Onay İste', value: 'off' },
              { label: 'Açık — Araç Onaylarını Bu Oturumda Otomatik Ver', value: 'on' },
              { label: 'Her Zaman (Kalıcı) — Bu Çalışma Alanı için Her Zaman Otomatik İzin Ver', value: 'always' },
            ]);
            if (!choice) return 'YOLO modu değiştirilmedi.';
          }
          if (choice === 'always') {
            setWorkspacePermission(config, workspace, 'allow');
            await saveConfig(config);
            yolo = true;
            setYolo?.(yolo);
            return `YOLO kalıcı olarak açıldı: Bu çalışma alanı (${workspace}) için izin kaydedildi.`;
          }
          if (choice === 'off') {
            if (getWorkspacePermission(config, workspace) === 'allow') {
              setWorkspacePermission(config, workspace, 'ask');
              await saveConfig(config);
            }
            yolo = false;
          } else {
            yolo = true;
          }
          setYolo?.(yolo);
          return yolo ? 'YOLO açık: araç onayları bu oturumda otomatik verilir.' : 'YOLO kapalı: araç onayları sorulur.';
        }

        if (command === '/clear') {
          session.messages = [];
          pendingPlan = undefined;
          globalGroundingLedger.clear();
          await store.save(session);
          return undefined;
        }

        if (command === '/checkpoints') {
          const checkpoints = await listCheckpoints(workspace, 20);
          if (!checkpoints.length) return 'Henüz dosya checkpoint\'i yok.';
          return [
            'Son dosya checkpoint\'leri:',
            ...checkpoints.map(item => `  ${item.id}  ${item.path}  ${item.createdAt}  ${item.tool}  ${item.bytes} bayt`),
            'Geri yüklemek için: /undo <checkpoint-id> veya /undo last',
          ].join('\n');
        }

        if (command === '/undo') {
          const argument = command.replace(/^\/undo\s*/i, '').trim();
          const checkpoints = await listCheckpoints(workspace, 20);
          if (!checkpoints.length) return 'Geri yüklenecek checkpoint yok.';
          const target = !argument || argument.toLowerCase() === 'last'
            ? checkpoints[0]
            : checkpoints.find(item => item.id === argument);
          if (!target) return `Checkpoint bulunamadı: ${argument}`;
          const restored = await restoreCheckpoint(workspace, target.id);
          return `[OK] Geri yüklendi: ${restored.path} (${restored.bytes} bayt). Bu geri yükleme de checkpoint olarak saklandı.`;
        }

        if (command === '/sessions') return `Oturum kimliği: ${session.id}. Tüm oturumlar için tbot sessions kullanın.`;

        if (command === '/auth') {
          const spec = PROVIDER_CATALOG.find(p => p.id === config.provider);
          if (!spec?.requiresApiKey) return 'Bu sağlayıcı için API anahtarı gerekli değil.';
          const key = await inputSecret(`${spec.label} için yeni API anahtarı`);
          if (!key?.trim()) return 'Anahtar değiştirilmedi.';
          if (/^\*+$/.test(key.trim())) return 'Maskelenmiş yıldızlar anahtar değildir; sağlayıcıdan anahtarın kendisini kopyalayın.';
          const status = await storeProviderApiKey(spec.id, key);
          provider = createProvider({ ...await resolveProviderConfig(config, workspace), effort: selectedEffort });
          keySource = await getApiKeySource(config.provider);
          workerProvider = undefined;
          workerModel = '';
          return `Yeni anahtar kaydedildi. Önceki istek yeniden çalıştırılmadı; devam etmek için isteğinizi tekrar gönderin.${status.warning ? ` ${status.warning}` : ''}`;
        }

        if (command === '/provider' || command === '/model' || command === '/config') {
          config = await configure(config, false, true, command === '/model');
          selectedEffort = getEffort(config);
          provider = createProvider({ ...await resolveProviderConfig(config, workspace), effort: selectedEffort });
          keySource = await getApiKeySource(config.provider);
          workerProvider = undefined;
          workerModel = '';
          return `Sağlayıcı: ${provider.label}; model: ${config.model}`;
        }

        if (command === '/resume') return 'Devam etmek için tbot --resume <id> kullanın.';

        return undefined;
      }
    });
  } finally {
    await cleanupAllResources();
  }
}
