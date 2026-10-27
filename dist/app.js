import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { resolve } from 'node:path';
import { createSession, SessionStore } from './sessions.js';
import { parseCli, HELP } from './cli.js';
import { configDirectory, loadConfig, saveConfig, resolveProviderConfig, getWorkspacePermission } from './config.js';
import { setApiKey } from './secrets.js';
import { createProvider, PROVIDER_CATALOG } from './providers.js';
import { runAgent } from './agent.js';
const safe = (text) => text.replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '');
async function listSessions() {
    const sessions = await new SessionStore(configDirectory()).list();
    if (!sessions.length) {
        console.log('Henüz kaydedilmiş oturum yok.');
        return;
    }
    for (const session of sessions)
        console.log(safe(`${session.id}  ${session.updatedAt}  ${session.workspace}  ${session.title}`));
}
async function configure() {
    if (!stdin.isTTY || !stdout.isTTY)
        throw new Error('Yapılandırma için etkileşimli terminal gerekli.');
    const config = await loadConfig();
    const rl = createInterface({ input: stdin, output: stdout });
    try {
        console.log('Sağlayıcılar: ' + PROVIDER_CATALOG.map(p => p.id).join(', '));
        const id = (await rl.question(`Sağlayıcı [${safe(config.provider)}]: `)).trim() || config.provider;
        if (!PROVIDER_CATALOG.some(p => p.id === id))
            throw new Error('Bilinmeyen sağlayıcı.');
        const model = (await rl.question(`Model [${safe(config.model)}]: `)).trim() || config.model;
        const previousBase = id === config.provider ? config.baseUrl ?? '' : '';
        const baseUrl = (await rl.question(`Özel API adresi (varsayılan için boş) [${safe(previousBase)}]: `)).trim() || previousBase;
        console.log('API anahtarını ortam değişkeniyle de verebilirsiniz: ' + id.toUpperCase().replace(/-/g, '_') + '_API_KEY.');
        const store = (await rl.question('API anahtarı kaydedilsin mi? [e/H]: ')).trim().toLowerCase();
        if (store === 'e' || store === 'y') {
            rl.close();
            const key = await readSecret('API anahtarı: ');
            if (!key)
                throw new Error('Anahtar boş olamaz.');
            const result = await setApiKey(id, key);
            console.log(`Anahtar saklama: ${result.method}${result.warning ? ` — ${result.warning}` : ''}`);
        }
        config.provider = id;
        config.model = model;
        if (baseUrl)
            config.baseUrl = baseUrl;
        else
            delete config.baseUrl;
        await saveConfig(config);
        console.log('Ayarlar kaydedildi.');
    }
    finally {
        rl.close();
    }
}
async function readSecret(prompt) {
    stdout.write(prompt);
    return new Promise((resolveSecret, reject) => {
        let value = '';
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');
        const cleanup = () => { stdin.off('data', onData); stdin.off('end', onEnd); stdin.off('error', onError); stdin.setRawMode(false); stdin.pause(); stdout.write('\n'); };
        const onEnd = () => { cleanup(); reject(new Error('Girdi kapandı.')); };
        const onError = (error) => { cleanup(); reject(error); };
        const onData = (chunk) => {
            for (const char of chunk) {
                if (char === '\u0003') {
                    cleanup();
                    reject(new Error('İptal edildi.'));
                    return;
                }
                if (char === '\r' || char === '\n') {
                    cleanup();
                    resolveSecret(value);
                    return;
                }
                if (char === '\u007f' || char === '\b')
                    value = value.slice(0, -1);
                else if (char >= ' ')
                    value += char;
            }
        };
        stdin.on('data', onData);
        stdin.once('end', onEnd);
        stdin.once('error', onError);
    });
}
function showEvent(event) {
    if (event.type === 'text')
        stdout.write(safe(event.text));
    else if (event.type === 'tool_start')
        console.error(`\n[araç] ${safe(event.call.name)}`);
    else if (event.type === 'error')
        console.error(`\nHata: ${safe(event.error)}`);
    else if (event.type === 'status')
        console.error(`\n${safe(event.message)}`);
}
async function approveOnce(request) {
    if (!stdin.isTTY || !stdout.isTTY) {
        console.error(`Onay gerekli, terminal yok: ${safe(request.description)}`);
        return false;
    }
    const rl = createInterface({ input: stdin, output: stdout });
    try {
        return /^(e|evet|y|yes)$/i.test((await rl.question(`\n${safe(request.description)}\n${safe(JSON.stringify(request.arguments))}\nİzin verilsin mi? [e/H] `)).trim());
    }
    finally {
        rl.close();
    }
}
export async function main(argv) {
    const options = parseCli(argv);
    if (options.command === 'help') {
        console.log(HELP);
        return;
    }
    if (options.command === 'version') {
        console.log('T Bot 0.1.0');
        return;
    }
    if (options.command === 'providers') {
        for (const p of PROVIDER_CATALOG)
            console.log(`${p.id.padEnd(12)} ${p.label}${p.requiresApiKey ? ' (API anahtarı gerekli)' : ' (yerel/özel)'}`);
        return;
    }
    if (options.command === 'config') {
        await configure();
        return;
    }
    if (options.command === 'sessions') {
        await listSessions();
        return;
    }
    if (options.command === 'doctor') {
        const config = await loadConfig();
        const resolved = await resolveProviderConfig(config);
        console.log(safe(`Node ${process.version}\nPlatform ${process.platform}\nÇalışma dizini ${process.cwd()}\nSağlayıcı ${resolved.id}\nModel ${resolved.model}\nAPI anahtarı ${resolved.apiKey ? 'mevcut' : 'ayarlı değil'}\nYapılandırma ${configDirectory()}`));
        return;
    }
    const config = await loadConfig();
    if (options.provider && options.provider !== config.provider) {
        config.provider = options.provider;
        delete config.baseUrl;
    }
    if (options.model)
        config.model = options.model;
    const workspace = resolve(options.workspace || process.cwd());
    const store = new SessionStore(configDirectory());
    const session = options.resume ? await store.get(options.resume, workspace) : createSession(workspace);
    if (!session)
        throw new Error('Oturum bulunamadı.');
    const provider = createProvider(await resolveProviderConfig(config, workspace));
    const approve = getWorkspacePermission(config, workspace) === 'allow' ? async () => true : approveOnce;
    if (options.message) {
        const controller = new AbortController();
        const cancel = () => controller.abort();
        process.once('SIGINT', cancel);
        try {
            session.messages = await runAgent({ message: options.message, history: session.messages, provider, workspace, onEvent: event => { showEvent(event); if (event.type === 'error')
                    process.exitCode = 1; }, approve, signal: controller.signal });
            await store.save(session);
            stdout.write('\n');
        }
        finally {
            process.off('SIGINT', cancel);
        }
        return;
    }
    if (!stdin.isTTY || !stdout.isTTY)
        throw new Error('Etkileşimli mod için terminal gerekli; istek metnini argüman olarak verin.');
    const { startTui } = await import('./tui.js');
    await startTui({ workspace, provider, model: config.model, history: session.messages,
        onSubmit: async (message, emit, tuiApprove, signal) => {
            session.messages = await runAgent({ message, history: session.messages, provider, workspace, onEvent: emit, approve: getWorkspacePermission(config, workspace) === 'allow' ? async () => true : tuiApprove, signal });
            await store.save(session);
            return session.messages;
        },
        onCommand: async (command) => {
            if (command === '/clear') {
                session.messages = [];
                await store.save(session);
                return undefined;
            }
            if (command === '/sessions')
                return `Oturum kimliği: ${session.id}. Tüm oturumlar için tbot sessions kullanın.`;
            if (command === '/provider' || command === '/model')
                return `Sağlayıcı: ${provider.label}; model: ${config.model}. Değiştirmek için tbot config kullanın.`;
            if (command === '/resume')
                return 'Devam etmek için tbot --resume <id> kullanın.';
            if (command === '/config')
                return 'Ayarları değiştirmek için oturumdan çıkıp tbot config kullanın.';
            return undefined;
        }
    });
}
//# sourceMappingURL=app.js.map