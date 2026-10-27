import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { resolve } from 'node:path';
import { createSession, SessionStore } from './sessions.js';
import { parseCli, HELP } from './cli.js';
import { configDirectory, loadConfig, saveConfig, resolveProviderConfig, getWorkspacePermission, type AppConfig } from './config.js';
import { setApiKey } from './secrets.js';
import { createProvider, PROVIDER_CATALOG } from './providers.js';
import { discoverModels } from './models.js';
import { selectOption, inputSecret } from './menu.js';
import { runAgent } from './agent.js';
import type { AgentEvent, ApprovalRequest } from './types.js';

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
  let apiKey = (await resolveProviderConfig(selectedConfig)).apiKey;
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
  let resolved = await resolveProviderConfig(config, workspace);
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
  const approve = getWorkspacePermission(config, workspace) === 'allow' ? async () => true : approveOnce;
  if (options.message) {
    const controller = new AbortController();
    const cancel = () => controller.abort(); process.once('SIGINT', cancel);
    try { session.messages = await runAgent({ message: options.message, history: session.messages, provider, workspace, onEvent: event => { showEvent(event); if (event.type === 'error') process.exitCode = 1; }, approve, signal: controller.signal }); await store.save(session); stdout.write('\n'); }
    finally { process.off('SIGINT', cancel); }
    return;
  }
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Etkileşimli mod için terminal gerekli; istek metnini argüman olarak verin.');
  const { startTui } = await import('./tui.js');
  await startTui({ workspace, provider, model: config.model, history: session.messages,
    onSubmit: async (message, emit, tuiApprove, signal) => {
      session.messages = await runAgent({ message, history: session.messages, provider, workspace, onEvent: emit, approve: getWorkspacePermission(config, workspace) === 'allow' ? async () => true : tuiApprove, signal });
      await store.save(session); return session.messages;
    },
    onCommand: async command => {
      if (command === '/clear') { session.messages = []; await store.save(session); return undefined; }
      if (command === '/sessions') return `Oturum kimliği: ${session.id}. Tüm oturumlar için tbot sessions kullanın.`;
      if (command === '/provider' || command === '/model' || command === '/config') {
        config = await configure(config, false, true, command === '/model');
        provider = createProvider(await resolveProviderConfig(config, workspace));
        return `Sağlayıcı: ${provider.label}; model: ${config.model}`;
      }
      if (command === '/resume') return 'Devam etmek için tbot --resume <id> kullanın.';
      return undefined;
    }
  });
}
