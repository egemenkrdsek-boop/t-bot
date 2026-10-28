import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getCustomSecret, getApiKey } from './secrets.js';
import { loadConfig, saveConfig, resolveProviderConfig, configDirectory } from './config.js';
import { createProvider } from './providers.js';
import { getMemoryStats, reclaimMemory } from './memory-guard.js';
import { globalTokenTracker } from './token-optimizer.js';
import { globalGroundingLedger } from './grounding.js';
import { recallFacts } from './memory.js';
import { runAgent } from './agent.js';
import { runUltracode } from './ultracode.js';
import { startGoal, runGoal, getGoal, pauseGoal, resumeGoal, cancelGoal, completeGoal } from './workflows.js';
import { SessionStore } from './sessions.js';
import { handleComputerTool } from './tools/computer.js';
import { createApprovalNonce, parseApprovalCallback, formatApprovalArguments, createPairingChallenge, acceptPairingCode } from './telegram-security.js';
// Module-level bridge state
let isRunning = false;
let currentBotUsername;
let abortController = null;
let currentOptions = null;
let activeApproval = null;
let handledCount = 0;
let isAgentBusy = false;
let pairingChallenge = null;
/**
 * Escapes characters that have special meaning in Telegram Markdown v1.
 */
function escapeMarkdown(text) {
    return text.replace(/([*_`\[\]])/g, '\\$1');
}
/**
 * Sends a chat action (e.g. typing) to Telegram.
 */
async function sendChatAction(token, chatId, action = 'typing') {
    try {
        await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, action }),
        });
    }
    catch {
        // Ignore transient chat action failures
    }
}
/**
 * Answers a Telegram inline keyboard callback query.
 */
async function answerCallbackQuery(token, callbackQueryId, text) {
    try {
        await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callback_query_id: callbackQueryId,
                ...(text ? { text } : {}),
            }),
        });
    }
    catch {
        // Ignore transient callback query errors
    }
}
/**
 * Merges TELEGRAM_ALLOWED_CHATS environment variable into config.telegramAllowedChatIds.
 */
function syncEnvAllowedChats(config) {
    if (!Array.isArray(config.telegramAllowedChatIds)) {
        config.telegramAllowedChatIds = [];
    }
    const envRaw = process.env.TELEGRAM_ALLOWED_CHATS;
    if (envRaw && envRaw.trim()) {
        for (const id of envRaw.split(/[,\s;]+/).map((s) => s.trim()).filter(Boolean)) {
            if (!config.telegramAllowedChatIds.includes(id)) {
                config.telegramAllowedChatIds.push(id);
            }
        }
    }
    return config.telegramAllowedChatIds;
}
/**
 * Sends a raw text message chunk, falling back to plain text if Markdown parsing fails.
 */
async function sendRawTelegramChunk(token, chatId, text, replyMarkup) {
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: 'Markdown',
                ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
            }),
        });
        if (res.ok)
            return true;
        // If Telegram returned 400 Bad Request (commonly markdown parse error), retry without parse_mode
        const fallback = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
            }),
        });
        return fallback.ok;
    }
    catch {
        return false;
    }
}
/**
 * Splits text into chunks conforming to Telegram's 4096 character limit and sends each chunk.
 */
export async function sendTelegramMessage(token, chatId, text, replyMarkup) {
    const MAX_CHUNK = 4000;
    if (!text)
        return;
    if (text.length <= MAX_CHUNK) {
        await sendRawTelegramChunk(token, chatId, text, replyMarkup);
        return;
    }
    let remaining = text;
    while (remaining.length > 0) {
        if (remaining.length <= MAX_CHUNK) {
            await sendRawTelegramChunk(token, chatId, remaining, replyMarkup);
            break;
        }
        let splitIdx = remaining.lastIndexOf('\n', MAX_CHUNK);
        if (splitIdx < MAX_CHUNK / 3) {
            splitIdx = MAX_CHUNK;
        }
        const chunk = remaining.slice(0, splitIdx);
        await sendRawTelegramChunk(token, chatId, chunk);
        remaining = remaining.slice(splitIdx).trimStart();
    }
}
/**
 * Sends a photo to a Telegram chat using native FormData, Blob, and fs.readFile.
 */
export async function sendTelegramPhoto(token, chatId, filePath, caption) {
    try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile() || stat.size === 0 || stat.size > 20 * 1024 * 1024) {
            return false;
        }
        const buffer = await fs.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
        const blob = new Blob([buffer], { type: mimeType });
        const form = new FormData();
        form.append('chat_id', chatId);
        form.append('photo', blob, path.basename(filePath));
        if (caption) {
            form.append('caption', caption.slice(0, 1000));
        }
        const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
            method: 'POST',
            body: form,
        });
        return res.ok;
    }
    catch {
        return false;
    }
}
/**
 * Persists an allowed chat ID to the configuration file using saveConfig.
 */
async function persistAllowedChatId(config, chatId, onLog) {
    if (!Array.isArray(config.telegramAllowedChatIds)) {
        config.telegramAllowedChatIds = [];
    }
    if (!config.telegramAllowedChatIds.includes(chatId)) {
        config.telegramAllowedChatIds.push(chatId);
    }
    try {
        await saveConfig(config);
        onLog?.(`[Telegram Bot] Yetkili Chat ID kaydedildi: ${chatId}`);
    }
    catch {
        // If the revision is outdated or missing, reload fresh config and persist
        try {
            const fresh = await loadConfig();
            if (!Array.isArray(fresh.telegramAllowedChatIds)) {
                fresh.telegramAllowedChatIds = [];
            }
            if (!fresh.telegramAllowedChatIds.includes(chatId)) {
                fresh.telegramAllowedChatIds.push(chatId);
            }
            await saveConfig(fresh);
            config.telegramAllowedChatIds = fresh.telegramAllowedChatIds;
            onLog?.(`[Telegram Bot] Yetkili Chat ID (fresh config) kaydedildi: ${chatId}`);
        }
        catch (saveErr) {
            onLog?.(`[Telegram Bot] Konfigürasyon kaydedilemedi: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}`);
        }
    }
}
/**
 * Resolves optional image provider configuration if supported.
 */
async function getImageProviderConfig(config) {
    if (config.provider !== 'openai' && config.provider !== 'gemini' && config.provider !== 'openrouter') {
        return undefined;
    }
    const apiKey = await getApiKey(config.provider);
    return apiKey ? { provider: config.provider, apiKey } : undefined;
}
/**
 * Scans workspace directories for screenshots and generated images created during a run turn.
 */
async function collectGeneratedImages(workspace, startTime) {
    const discovered = [];
    const searchDirs = [
        path.join(workspace, 'generated-images'),
        path.join(workspace, '.tbot', 'screenshots'),
        workspace,
    ];
    for (const dir of searchDirs) {
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isSymbolicLink() || !entry.isFile())
                    continue;
                const lower = entry.name.toLowerCase();
                if (dir === workspace && (!lower.startsWith('screenshot-') || !/\.(png|jpg|jpeg|webp)$/.test(lower))) {
                    continue;
                }
                if (!/\.(png|jpg|jpeg|webp)$/i.test(lower))
                    continue;
                const fullPath = path.join(dir, entry.name);
                try {
                    const stats = await fs.lstat(fullPath);
                    if (stats.isSymbolicLink() || !stats.isFile())
                        continue;
                    if (stats.mtimeMs >= startTime - 2000) {
                        discovered.push(fullPath);
                    }
                }
                catch { }
            }
        }
        catch { }
    }
    return discovered;
}
/**
 * Handles remote tool approval dialog with 60-second timeout.
 */
async function requestRemoteToolApproval(request, chatId, token, getYolo) {
    // If YOLO is enabled, approve immediately without prompting
    if (getYolo()) {
        return true;
    }
    // Clear previous pending approval if any
    if (activeApproval) {
        clearTimeout(activeApproval.timeoutId);
        activeApproval.resolve(false);
        activeApproval = null;
    }
    let argsSnippet;
    try {
        argsSnippet = formatApprovalArguments(request.arguments);
    }
    catch {
        await sendTelegramMessage(token, chatId, '[REDDEDİLDİ] Onay içeriği gösterim sınırını aşıyor. İşlemi daha küçük adımlara ayırın.');
        return false;
    }
    const promptText = `*[ONAY GEREKİYOR] Araç Onayı:* \`${request.tool}\`
${request.description ? `*Açıklama:* ${request.description}\n` : ''}*Argümanlar:*
\`\`\`json
${argsSnippet}
\`\`\`

Onaylamak için \`/onay\`, reddetmek için \`/red\` yazın veya aşağıdaki butonları kullanın (60sn)`;
    const nonce = createApprovalNonce();
    const reply_markup = {
        inline_keyboard: [[
                { text: '✓ Onayla', callback_data: `approve_yes:${nonce}` },
                { text: '✗ Reddet', callback_data: `approve_no:${nonce}` },
            ]],
    };
    await sendTelegramMessage(token, chatId, promptText, reply_markup);
    return new Promise((resolve) => {
        const timeoutId = setTimeout(async () => {
            if (activeApproval && activeApproval.resolve === resolve) {
                activeApproval = null;
                await sendTelegramMessage(token, chatId, `*[ZAMAN AŞIMI] Araç Onayı (60 Saniye)*\n\`${request.tool}\` işlemi zamanında yanıtlanmadığı için iptal edildi.`);
                resolve(false);
            }
        }, 60_000);
        timeoutId.unref();
        activeApproval = {
            nonce,
            tool: request.tool,
            chatId,
            resolve,
            timeoutId,
        };
    });
}
/**
 * Dispatches and executes an autonomous or user turn via T Bot's agent engine.
 */
async function executeAgentTurn(message, chatId, token, options, signal, mode = 'agent') {
    isAgentBusy = true;
    const startTime = Date.now();
    const discoveredPaths = new Set();
    // Send periodic "typing" notification every 4.5 seconds
    void sendChatAction(token, chatId, 'typing');
    const typingTimer = setInterval(() => {
        void sendChatAction(token, chatId, 'typing');
    }, 4500);
    typingTimer.unref();
    try {
        const resolved = await resolveProviderConfig(options.config, options.workspace);
        const provider = createProvider(resolved);
        const imageProvider = await getImageProviderConfig(options.config);
        let lastReportedTool = '';
        const onEvent = (event) => {
            if (event.type === 'tool_start') {
                const name = event.call.name;
                const majorTools = {
                    computer: '[DURUM] Bilgisayar İşlemi Yürütülüyor...',
                    image_generate: '[DURUM] Görsel Üretimi Başlatıldı...',
                    browser_navigate: '[DURUM] Web Tarayıcısı Başlatılıyor...',
                    shell: '[DURUM] Sistem Komutu Yürütülüyor...',
                    file_glob: '[DURUM] Dosyalar Taranıyor...',
                    delegate_task: '[DURUM] Alt Ajan Görevi Çalıştırılıyor...',
                    skill_create: '[DURUM] Yeni Beceri Oluşturuluyor...',
                };
                if (majorTools[name] && lastReportedTool !== name) {
                    lastReportedTool = name;
                    void sendTelegramMessage(token, chatId, majorTools[name]);
                }
            }
            if (event.type === 'tool_end') {
                // Capture generated images from image_generate
                if (event.call.name === 'image_generate' && event.result.startsWith('Generated image saved: ')) {
                    const imgPath = event.result.slice('Generated image saved: '.length).trim();
                    if (imgPath)
                        discoveredPaths.add(path.resolve(options.workspace, imgPath));
                }
                // Capture screenshots from browser_screenshot
                if (event.call.name === 'browser_screenshot' && event.result.startsWith('Screenshot saved: ')) {
                    const shotPath = event.result.slice('Screenshot saved: '.length).trim();
                    if (shotPath)
                        discoveredPaths.add(path.resolve(options.workspace, shotPath));
                }
                // Capture computer screenshots
                if (event.call.name === 'computer' && event.call.arguments?.action === 'screenshot') {
                    try {
                        const parsed = JSON.parse(event.result);
                        if (typeof parsed.path === 'string') {
                            discoveredPaths.add(path.resolve(options.workspace, parsed.path));
                        }
                    }
                    catch {
                        const match = event.result.match(/([a-zA-Z]:[\\/][^"'\r\n]+\.png)/i);
                        if (match && match[1])
                            discoveredPaths.add(match[1]);
                    }
                }
            }
        };
        const approve = (request) => requestRemoteToolApproval(request, chatId, token, options.getYolo);
        const agentInput = {
            processOwner: `telegram:${chatId}:${options.session.id}`,
            message,
            history: options.session.messages,
            provider,
            workspace: options.workspace,
            mcpTools: options.mcpTools,
            onEvent,
            approve,
            signal,
            imageProvider,
        };
        let updatedMessages = [];
        if (mode === 'ultracode') {
            updatedMessages = await runUltracode({ ...agentInput, workerProvider: provider });
        }
        else if (mode === 'goal') {
            updatedMessages = await runGoal(agentInput, runAgent);
        }
        else {
            updatedMessages = await runAgent(agentInput);
        }
        options.session.messages = updatedMessages;
        let persisted = true;
        try {
            await new SessionStore(configDirectory()).save(options.session);
        }
        catch {
            persisted = false;
            options.onLog?.('[Telegram Bot] Üretilen turun oturum kaydı saklanamadı; son mesajlar yalnızca bellekte olabilir.');
        }
        // Send latest assistant response
        const lastAssistant = [...updatedMessages]
            .reverse()
            .find((m) => m.role === 'assistant' && typeof m.content === 'string' && m.content.trim().length > 0);
        if (lastAssistant && lastAssistant.content.trim()) {
            await sendTelegramMessage(token, chatId, lastAssistant.content);
        }
        else {
            await sendTelegramMessage(token, chatId, '[BİLGİ] Ajan turu sona erdi; gösterilecek metin yanıtı bulunmuyor.');
        }
        if (!persisted) {
            await sendTelegramMessage(token, chatId, '[KAYIT UYARISI] Yanıt üretilmiş veya araç işlemleri gerçekleşmiş olabilir; bu turun oturum kaydı saklanamadı. Son mesajlar yalnızca bellekte olabilir ve yeniden başlatmada kaybolabilir. Bu uyarı araç işlemlerinin geri alındığı anlamına gelmez.');
        }
        // Inspect disk for newly produced images or screenshots
        const scanned = await collectGeneratedImages(options.workspace, startTime);
        for (const p of scanned) {
            discoveredPaths.add(p);
        }
        // Send any generated photos or screenshots directly to the user
        for (const imgPath of discoveredPaths) {
            const base = path.basename(imgPath);
            const isScreenshot = base.toLowerCase().startsWith('screenshot') || base.toLowerCase().startsWith('browser');
            const caption = isScreenshot ? `[EKRAN GÖRÜNTÜSÜ] \`${base}\`` : `[GÖRSEL] \`${base}\``;
            await sendTelegramPhoto(token, chatId, imgPath, caption);
        }
    }
    catch {
        // Provider/transport errors may contain credential-bearing URLs or response bodies.
        options.onLog?.('[Telegram Bot] Ajan turu tamamlanamadı; hata ayrıntıları hassas bilgi içerebileceği için gösterilmedi.');
        await sendTelegramMessage(token, chatId, '[HATA] Ajan turu tamamlanamadı. Önceden gerçekleşmiş araç işlemleri olabilir; yeniden denemeden önce mevcut durumu kontrol edin.');
    }
    finally {
        clearInterval(typingTimer);
        isAgentBusy = false;
    }
}
/**
 * Handles incoming Telegram message updates.
 */
async function handleIncomingMessage(msg, token, signal, options) {
    const chatId = String(msg.chat.id);
    const text = (msg.text || '').trim();
    if (!text)
        return;
    const allowed = syncEnvAllowedChats(options.config);
    // Short-lived local challenge; guesses share a global budget across all chats.
    if (allowed.length === 0) {
        const pairMatch = text.match(/^\/pair(?:\s+|=)(\S+)$/i);
        if (pairMatch && pairingChallenge && acceptPairingCode(pairingChallenge, pairMatch[1])) {
            pairingChallenge = null;
            await persistAllowedChatId(options.config, chatId, options.onLog);
            const welcome = `*[BİLGİ] Eşleştirme Başarılı!*\n\nChat ID (\`${chatId}\`) ana yönetici olarak kaydedildi. Artık yerel ajana tüm komutları gönderebilirsiniz.`;
            await sendTelegramMessage(token, chatId, welcome);
            options.onLog?.(`[Telegram Bot] Yönetici başarıyla eşleştirildi: Chat ID ${chatId} (${msg.from?.first_name || 'Kullanıcı'})`);
            return;
        }
        else {
            await sendTelegramMessage(token, chatId, "🔒 Bu bot henüz eşleştirilmemiştir. Terminaldeki '/pair <KOD>' komutunu gönderin. Kod 10 dakika ve toplam 10 deneme için geçerlidir; süre veya deneme sınırı dolduysa köprüyü yerel olarak yeniden başlatın.");
            return;
        }
    }
    else if (!allowed.includes(chatId)) {
        options.onLog?.(`[Telegram Bot] Yetkisiz erişim denemesi: Chat ID ${chatId} (${msg.from?.username || msg.from?.first_name || 'Bilinmeyen'})`);
        await sendTelegramMessage(token, chatId, '*[YETKİSİZ ERİŞİM]*\nBu T Bot yerel köprüsü özeldir ve yalnızca yetkili kullanıcıya açıktır.');
        return;
    }
    // 1. Tool Approval Handling (/onay and /red)
    if (text === '/onay' || text.toLowerCase() === '/onay') {
        if (activeApproval && activeApproval.chatId === chatId) {
            clearTimeout(activeApproval.timeoutId);
            const { resolve, tool } = activeApproval;
            activeApproval = null;
            await sendTelegramMessage(token, chatId, `*[ONAYLANDI]* \`${tool}\` çalıştırılıyor...`);
            resolve(true);
        }
        else {
            await sendTelegramMessage(token, chatId, '[BİLGİ] Şu anda bekleyen bir araç onayı bulunmuyor.');
        }
        return;
    }
    if (text === '/red' || text.toLowerCase() === '/red') {
        if (activeApproval && activeApproval.chatId === chatId) {
            clearTimeout(activeApproval.timeoutId);
            const { resolve, tool } = activeApproval;
            activeApproval = null;
            await sendTelegramMessage(token, chatId, `*[REDDEDİLDİ]* \`${tool}\` işlemi iptal edildi.`);
            resolve(false);
        }
        else {
            await sendTelegramMessage(token, chatId, '[BİLGİ] Şu anda bekleyen bir araç onayı bulunmuyor.');
        }
        return;
    }
    // If a tool approval is currently pending, prompt the user to resolve it first
    if (activeApproval && activeApproval.chatId === chatId) {
        await sendTelegramMessage(token, chatId, `*[UYARI] Bekleyen Araç Onayı Var:*\n\`${activeApproval.tool}\` için onay bekleniyor. Lütfen önce \`/onay\` veya \`/red\` yazın.`);
        return;
    }
    // 2. /start or /help
    if (text === '/start' || text === '/help') {
        const helpText = `*[BOT] T Bot 2.0 Yerel Bot Köprüsü*

T Bot yerel terminal ajanı ile doğrudan Telegram üzerinden iletişimdesiniz. %100 yerel ve DPAPI korumalı.

*[KOMUTLAR] Kullanılabilir Komutlar:*
• \`/status\` - Sistem Durumu (Sağlayıcı, RAM, Token Tasarrufu, Grounding)
• \`/screenshot\` - Anlık Masaüstü Ekran Görüntüsü Al ve Gönder
• \`/goal <hedef>\` - Otonom Hedefi Başlat, Durumunu Gör veya Yönet
• \`/ultracode <görev>\` - Ultracode Çoklu Ajan Akışı ile Araştır, Uygula ve İncele
• \`/memory\` - Proje Hafızasındaki Bilgileri Listele
• \`/clear\` - Oturum Geçmişini ve RAM'i Temizle
• \`/onay\` - Bekleyen Araç İşlemini Onayla
• \`/red\` - Bekleyen Araç İşlemini Reddet

*[BİLGİ] Doğrudan İstek:*
Herhangi bir metin göndererek doğrudan T Bot ajanını çalıştırabilirsiniz. Oluşan ekran görüntüleri ve üretilen görseller doğrudan telefonunuza gönderilir.`;
        await sendTelegramMessage(token, chatId, helpText);
        return;
    }
    // 2.5. /screenshot
    if (text === '/screenshot' || text.toLowerCase() === '/screenshot') {
        try {
            await sendTelegramMessage(token, chatId, '[DURUM] Masaüstü ekran görüntüsü alınıyor...');
            const raw = await handleComputerTool('computer', { action: 'screenshot' }, { workspace: options.workspace, signal });
            let shotPath;
            try {
                const parsed = JSON.parse(raw);
                if (typeof parsed.path === 'string') {
                    shotPath = path.resolve(options.workspace, parsed.path);
                }
            }
            catch {
                const match = raw.match(/([a-zA-Z]:[\\/][^"'\r\n]+\.png)/i);
                if (match && match[1])
                    shotPath = match[1];
            }
            if (shotPath) {
                const sent = await sendTelegramPhoto(token, chatId, shotPath, `[EKRAN GÖRÜNTÜSÜ] \`${path.basename(shotPath)}\``);
                if (!sent) {
                    await sendTelegramMessage(token, chatId, `[HATA] Ekran görüntüsü dosyası gönderilemedi: \`${shotPath}\``);
                }
            }
            else {
                await sendTelegramMessage(token, chatId, '[HATA] Ekran görüntüsü yolu alınamadı.');
            }
        }
        catch (err) {
            await sendTelegramMessage(token, chatId, `*[HATA]* Ekran görüntüsü alınamadı: ${escapeMarkdown(err instanceof Error ? err.message : String(err))}`);
        }
        return;
    }
    // 3. /status
    if (text === '/status') {
        const mem = getMemoryStats();
        const tokenReport = globalTokenTracker.getReport();
        const grounding = globalGroundingLedger.getStatus();
        const yolo = options.getYolo() ? '[AÇIK] Otomatik Onay' : '[KAPALI] Kullanıcı Onayı';
        const statusText = `*[DURUM] T Bot 2.0 Sistem Durumu*

*[MODEL VE SAĞLAYICI]*
• Sağlayıcı: \`${options.config.provider}\`
• Model: \`${options.config.model}\`
• YOLO Modu: ${yolo}

*[BELLEK] Bellek (RAM) Durumu:*
• Heap Kullanımı: \`${mem.heapUsedMB} MB / ${mem.heapTotalMB} MB\`
• RSS: \`${mem.rssMB} MB\`
• Bellek Baskısı: \`${mem.pressure.toUpperCase()}\`

*[TOKEN] Token Tasarrufu:*
• Gönderilen Girdi: \`${tokenReport.totalSentInputTokens.toLocaleString()} tokens\`
• Üretilen Çıktı: \`${tokenReport.totalOutputTokens.toLocaleString()} tokens\`
• Tasarruf Edilen: \`${tokenReport.totalSavedTokens.toLocaleString()} tokens\` (%${tokenReport.savingsPercent})
• Toplam Tur: \`${tokenReport.turnsCount}\`

*[DOĞRULAMA] Grounding ve Doğrulama:*
• Doğrulama Durumu: ${grounding.verified ? '[DOĞRULANDI]' : '[UYARI] Uyarılar Mevcut'}
• İncelenen Dosyalar: \`${grounding.inspectedCount}\`
• Değiştirilen Dosyalar: \`${grounding.modifiedCount}\`
• Doğrulanan Komutlar: \`${grounding.verifiedCommands}\`
${grounding.warnings.length ? `• Uyarılar:\n${grounding.warnings.map((w) => `  - ${w}`).join('\n')}` : ''}

*[KÖPRÜ] Telegram Köprüsü:*
• İşlenen Mesaj: \`${handledCount}\`
• Durum: \`Aktif ve Dinliyor\``;
        await sendTelegramMessage(token, chatId, statusText);
        return;
    }
    // 4. /memory
    if (text === '/memory') {
        try {
            const facts = await recallFacts(options.workspace);
            if (facts.length === 0) {
                await sendTelegramMessage(token, chatId, '*[HAFIZA] Proje Hafızası*\n\nHenüz kayıtlı bir bilgi bulunmuyor.');
            }
            else {
                const list = facts
                    .map((f) => `• *${escapeMarkdown(f.key)}* (${f.scope}):\n  \`${escapeMarkdown(f.value)}\``)
                    .join('\n\n');
                await sendTelegramMessage(token, chatId, `*[HAFIZA] Proje Hafızası (${facts.length} Kayıt):*\n\n${list}`);
            }
        }
        catch (err) {
            await sendTelegramMessage(token, chatId, `[HATA] Hafıza okunamadı: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
    }
    // Guard against concurrent execution on mutating tasks
    if (isAgentBusy) {
        await sendTelegramMessage(token, chatId, '*[MEŞGUL] T Bot Meşgul*\nŞu anda devam eden bir görevi işliyor. Lütfen tamamlanmasını bekleyin.');
        return;
    }
    // 5. /clear (Yarış durumunu önlemek için isAgentBusy kontrolünden sonra çalıştırılır)
    if (text === '/clear') {
        isAgentBusy = true;
        try {
            // Preserve the live transcript and its private revision until durable commit.
            const cleared = { ...options.session, messages: [] };
            try {
                await new SessionStore(configDirectory()).save(cleared);
            }
            catch {
                options.onLog?.('[Telegram Bot] Oturum temizleme kaydı saklanamadı; mevcut mesaj geçmişi korunuyor.');
                await sendTelegramMessage(token, chatId, '[KAYIT HATASI] Oturum temizlenemedi; mevcut mesaj geçmişi korunuyor. Kalıcı kayıt tamamlanmadığı için temizleme uygulanmadı.');
                return;
            }
            // Object.assign also transfers the committed symbol revision to the shared host object.
            Object.assign(options.session, cleared);
            globalGroundingLedger.clear();
            let memory = '\nBellek temizliği doğrulanamadı.';
            try {
                const result = await reclaimMemory(options.session, true);
                memory = `\n• Öncesi: \`${result.beforeMB} MB\`\n• Sonrası: \`${result.afterMB} MB\`\n• Geri Kazanılan: \`${result.freedMB} MB\``;
            }
            catch {
                options.onLog?.('[Telegram Bot] Oturum kaydı temizlendi; bellek temizliği tamamlanamadı.');
            }
            await sendTelegramMessage(token, chatId, `*[TEMİZLENDİ] Oturum Temizlendi*\n\nMesaj geçmişi kalıcı olarak sıfırlandı.${memory}`);
        }
        finally {
            isAgentBusy = false;
        }
        return;
    }
    // 6. /ultracode <görev>
    if (text.startsWith('/ultracode')) {
        const task = text.replace(/^\/ultracode\s*/i, '').trim();
        if (!task) {
            await sendTelegramMessage(token, chatId, '*[BİLGİ] Kullanım:* `/ultracode <görev>`\nÖrnek: `/ultracode API hata yönetimini refactor et`');
            return;
        }
        await sendTelegramMessage(token, chatId, `*[BAŞLATILDI] Ultracode Akışı Başlatıldı*\n\nGörev: \`${task}\`\nAraştırma, uygulama ve bağımsız inceleme adımları çalıştırılıyor...`);
        void executeAgentTurn(task, chatId, token, options, signal, 'ultracode');
        return;
    }
    // 7. /goal <hedef>
    if (text.startsWith('/goal')) {
        const sub = text.replace(/^\/goal\s*/i, '').trim();
        const action = sub.toLowerCase();
        if (!sub || action === 'status') {
            const goal = await getGoal(options.workspace).catch(() => undefined);
            if (goal) {
                await sendTelegramMessage(token, chatId, `*[HEDEF] Aktif Hedef Durumu*\n\n• Hedef: \`${goal.objective}\`\n• Durum: \`${goal.status}\`\n• Son Çalışma: \`${goal.lastRun ?? 'bilinmiyor'}\`${goal.lastResult ? `\n• Son İlerleme:\n\`${goal.lastResult.slice(0, 500)}\`` : ''}`);
            }
            else {
                await sendTelegramMessage(token, chatId, '[HEDEF] Kayıtlı Hedef Yok. Başlatmak İçin: `/goal <hedef>`');
            }
            return;
        }
        if (action === 'pause') {
            await pauseGoal(options.workspace).catch(() => { });
            await sendTelegramMessage(token, chatId, '[DURAKLATILDI] Hedef Duraklatıldı.');
            return;
        }
        if (action === 'cancel') {
            await cancelGoal(options.workspace).catch(() => { });
            await sendTelegramMessage(token, chatId, '[İPTAL EDİLDİ] Hedef İptal Edildi.');
            return;
        }
        if (action === 'done' || action === 'complete') {
            await completeGoal(options.workspace).catch(() => { });
            await sendTelegramMessage(token, chatId, '[TAMAMLANDI] Hedef Tamamlandı Olarak İşaretlendi.');
            return;
        }
        if (action === 'resume') {
            await resumeGoal(options.workspace).catch(() => { });
            await sendTelegramMessage(token, chatId, '[SÜRDÜRÜLÜYOR] Hedef Sürdürülüyor...');
            void executeAgentTurn('', chatId, token, options, signal, 'goal');
            return;
        }
        // New goal initialization and run
        try {
            const existing = await getGoal(options.workspace).catch(() => undefined);
            if (existing && (existing.status === 'active' || existing.status === 'paused')) {
                await cancelGoal(options.workspace).catch(() => { });
            }
            await startGoal(options.workspace, sub);
            await sendTelegramMessage(token, chatId, `*[HEDEF] Yeni Hedef Başlatıldı:*\n\`${sub}\`\nOtonom Ajan Çalıştırılıyor...`);
            void executeAgentTurn('', chatId, token, options, signal, 'goal');
        }
        catch (err) {
            await sendTelegramMessage(token, chatId, `[HATA] Hedef başlatılamadı: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
    }
    // 8. Normal text messages -> Standard agent run
    await sendTelegramMessage(token, chatId, `*[ALINDI] İstek Alındı:* \`${text.slice(0, 100)}${text.length > 100 ? '...' : ''}\`\nT Bot Çalışıyor...`);
    void executeAgentTurn(text, chatId, token, options, signal, 'agent');
}
/**
 * Long-polling loop using native fetch and Telegram getUpdates.
 */
async function runPollingLoop(token, signal, options) {
    let offset = 0;
    options.onLog?.('[Telegram Bot] Long-Polling döngüsü başlatıldı.');
    while (!signal.aborted && isRunning) {
        try {
            const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    offset,
                    timeout: 25,
                    limit: 100,
                    allowed_updates: ['message', 'callback_query'],
                }),
                signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]),
            });
            if (!res.ok) {
                if (signal.aborted || !isRunning)
                    break;
                await new Promise((r) => setTimeout(r, 3000));
                continue;
            }
            const data = (await res.json());
            if (!data.ok || !Array.isArray(data.result)) {
                await new Promise((r) => setTimeout(r, 2000));
                continue;
            }
            for (const update of data.result) {
                if (update.update_id >= offset) {
                    offset = update.update_id + 1;
                }
                if (update.callback_query) {
                    const cq = update.callback_query;
                    const cqChatId = String(cq.message?.chat.id ?? cq.from.id);
                    const allowed = syncEnvAllowedChats(options.config);
                    if (allowed.includes(cqChatId)) {
                        await answerCallbackQuery(token, cq.id);
                        const pendingApproval = activeApproval;
                        const approved = pendingApproval ? parseApprovalCallback(cq.data, pendingApproval.nonce) : undefined;
                        if (pendingApproval && pendingApproval.chatId === cqChatId && approved !== undefined) {
                            clearTimeout(pendingApproval.timeoutId);
                            const { resolve, tool } = pendingApproval;
                            activeApproval = null;
                            if (approved) {
                                await sendTelegramMessage(token, cqChatId, `*[ONAYLANDI]* \`${tool}\` çalıştırılıyor...`);
                            }
                            else {
                                await sendTelegramMessage(token, cqChatId, `*[REDDEDİLDİ]* \`${tool}\` işlemi iptal edildi.`);
                            }
                            resolve(approved);
                        }
                    }
                    else {
                        await answerCallbackQuery(token, cq.id, 'Yetkisiz erişim.');
                    }
                }
                if (update.message) {
                    handledCount++;
                    await handleIncomingMessage(update.message, token, signal, options);
                }
            }
            if (data.result.length === 0) {
                await new Promise((r) => setTimeout(r, 200));
            }
        }
        catch (err) {
            if (signal.aborted || !isRunning) {
                break;
            }
            if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
                continue;
            }
            options.onLog?.('[Telegram Bot] Güncelleme isteği başarısız oldu; yeniden denenecek.');
            await new Promise((r) => setTimeout(r, 3000));
        }
    }
    options.onLog?.('[Telegram Bot] Long-Polling döngüsü sonlandırıldı.');
}
/**
 * Starts the Zero-Backend Local Telegram Bot Gateway Bridge.
 */
export async function startTelegramBotBridge(options) {
    if (isRunning) {
        return { ok: true, username: currentBotUsername };
    }
    const allowed = syncEnvAllowedChats(options.config);
    if (allowed.length === 0) {
        pairingChallenge = createPairingChallenge();
        options.onLog?.(`[Telegram Güvenlik] Yönetici eşleştirmesi için Telegram'dan bota şu komutu gönderin (10 dakika / toplam 10 deneme): /pair ${pairingChallenge.code}`);
    }
    else {
        pairingChallenge = null;
    }
    // Retrieve token securely stored via Windows DPAPI or environment variable
    const token = (await getCustomSecret('telegram_bot_token')) || process.env.TELEGRAM_BOT_TOKEN;
    if (!token || !token.trim()) {
        return {
            ok: false,
            error: 'Telegram bot token bulunamadı. Lütfen secrets içinde telegram_bot_token değerini kaydedin veya TELEGRAM_BOT_TOKEN ortam değişkenini ayarlayın.',
        };
    }
    // Validate bot token using getMe
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        const data = (await res.json());
        if (!res.ok || !data.ok || !data.result) {
            return {
                ok: false,
                error: `Telegram Bot API doğrulaması başarısız oldu: HTTP ${res.status}`,
            };
        }
        currentBotUsername = data.result.username || data.result.first_name || 'tbot';
        options.onLog?.(`[Telegram Bot] @${currentBotUsername} başarıyla doğrulandı.`);
    }
    catch {
        return {
            ok: false,
            error: 'Telegram sunucularına erişilemedi. Ağ bağlantısını ve bot yapılandırmasını kontrol edin.',
        };
    }
    // Mark as running and start background long-polling
    isRunning = true;
    currentOptions = options;
    abortController = new AbortController();
    void runPollingLoop(token, abortController.signal, options);
    return { ok: true, username: currentBotUsername };
}
/**
 * Gracefully stops the Telegram Bot Gateway Bridge and releases resources.
 */
export function stopTelegramBotBridge() {
    if (!isRunning)
        return;
    isRunning = false;
    if (activeApproval) {
        clearTimeout(activeApproval.timeoutId);
        activeApproval.resolve(false);
        activeApproval = null;
    }
    if (abortController) {
        abortController.abort();
        abortController = null;
    }
    currentOptions = null;
    currentBotUsername = undefined;
    pairingChallenge = null;
}
/**
 * Returns the current runtime status of the Telegram Bot Gateway Bridge.
 */
export function getTelegramBotStatus() {
    return {
        running: isRunning,
        username: currentBotUsername,
        allowedChats: currentOptions?.config.telegramAllowedChatIds || [],
        handledCount,
    };
}
/**
 * Checks whether the Telegram Bot Bridge is actively running.
 */
export function isTelegramBotRunning() {
    return isRunning;
}
//# sourceMappingURL=bot.js.map