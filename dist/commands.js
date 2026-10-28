/**
 * Single source of truth for user-facing slash commands.
 *
 * Surfaces keep their own UI and approval implementations, but command names,
 * usage strings, descriptions and workflow routing must not drift between the
 * CLI/TUI, the desktop renderer and the Telegram bridge.
 */
const ALL = ['cli', 'desktop', 'telegram'];
const CLI_DESKTOP = ['cli', 'desktop'];
const CLI = ['cli'];
const DESKTOP = ['desktop'];
const TELEGRAM = ['telegram'];
export const COMMAND_GROUPS = [
    {
        name: 'Oturum ve Çekirdek',
        commands: [
            { name: '/help', usage: '/help', description: 'Komut kılavuzunu gösterir', surfaces: ALL, argument: 'none' },
            { name: '/status', usage: '/status', description: 'Canlı oturum, model ve bellek durumunu gösterir', surfaces: ALL, argument: 'none' },
            { name: '/clear', usage: '/clear', description: 'Sohbet geçmişini temizler', surfaces: ALL, argument: 'none' },
            { name: '/exit', usage: '/exit', description: 'CLI/TUI oturumundan ayrılır', surfaces: CLI, argument: 'none', aliases: ['/quit'] },
        ],
    },
    {
        name: 'Model ve Düşünme',
        commands: [
            { name: '/model', usage: '/model', description: 'Model seçer', surfaces: CLI_DESKTOP, argument: 'none' },
            { name: '/provider', usage: '/provider', description: 'Sağlayıcı ve API anahtarını yapılandırır', surfaces: CLI_DESKTOP, argument: 'none' },
            { name: '/config', usage: '/config', description: 'Yapılandırma panelini açar', surfaces: CLI_DESKTOP, argument: 'none' },
            { name: '/auth', usage: '/auth', description: 'Seçili sağlayıcının API anahtarını yeniler', surfaces: CLI_DESKTOP, argument: 'none' },
            { name: '/effort', usage: '/effort [düzey]', description: 'Düşünme eforunu seçer: low, medium, high, xhigh, max', surfaces: CLI_DESKTOP, argument: 'optional' },
            { name: '/ultracode', usage: '/ultracode [görev|on|off]', description: 'Ultracode modunu açar veya görevi çok aşamalı yürütür', surfaces: ALL, argument: 'optional', workflow: true },
            { name: '/yolo', usage: '/yolo [on|off|always]', description: 'Araç onaylarını bu oturum veya çalışma alanı için otomatikleştirir', surfaces: CLI_DESKTOP, argument: 'optional' },
        ],
    },
    {
        name: 'Sistem ve Bellek',
        commands: [
            { name: '/tokens', usage: '/tokens', description: 'Token, önbellek ve bağlam tasarrufu raporunu gösterir', surfaces: CLI_DESKTOP, argument: 'none' },
            { name: '/memory', usage: '/memory', description: 'RAM durumunu ve kayıtlı bellek maddelerini gösterir', surfaces: CLI_DESKTOP, argument: 'none' },
            { name: '/remember', usage: '/remember <anahtar> = <değer>', description: 'Kalıcı proje belleğine bilgi kaydeder', surfaces: CLI_DESKTOP, argument: 'required' },
            { name: '/forget', usage: '/forget <anahtar>', description: 'Kayıtlı bellek maddesini siler', surfaces: CLI_DESKTOP, argument: 'required' },
            { name: '/gc', usage: '/gc', description: 'Bellek koruyucusunu ve çöp toplayıcıyı çalıştırır', surfaces: CLI_DESKTOP, argument: 'none', aliases: ['/ram'] },
            { name: '/doctor', usage: '/doctor', description: 'Ortam, sağlayıcı ve sistem sağlığını denetler', surfaces: CLI_DESKTOP, argument: 'none' },
            { name: '/checkpoints', usage: '/checkpoints', description: 'Son dosya checkpoint\'lerini listeler', surfaces: CLI_DESKTOP, argument: 'none' },
            { name: '/undo', usage: '/undo <checkpoint-id|last>', description: 'Bir checkpoint\'i geri yükler (onay ister)', surfaces: CLI_DESKTOP, argument: 'optional' },
            { name: '/bot', usage: '/bot [start|stop|token|allow|status]', description: 'Telegram bot köprüsünü yönetir', surfaces: CLI_DESKTOP, argument: 'optional' },
            { name: '/gui', usage: '/gui [live|headless|stop]', description: 'Tarayıcı ve masaüstü görünürlüğünü yönetir', surfaces: CLI_DESKTOP, argument: 'optional' },
        ],
    },
    {
        name: 'Ajan ve İş Akışları',
        commands: [
            { name: '/goal', usage: '/goal [hedef|status|pause|cancel]', description: 'Otonom hedefi başlatır veya yönetir', surfaces: ALL, argument: 'optional', workflow: true },
            { name: '/plan', usage: '/plan <istek> | /plan apply', description: 'Görevi planlar veya onaylanmış planı uygular', surfaces: CLI_DESKTOP, argument: 'required', workflow: true },
            { name: '/subagents', usage: '/subagents [görev]', description: 'Alt ajan modelini seçer ve paralel görev yürütür', surfaces: CLI_DESKTOP, argument: 'optional', workflow: true },
            { name: '/mcp', usage: '/mcp', description: 'MCP bağlantılarını yapılandırır', surfaces: CLI_DESKTOP, argument: 'none', workflow: true },
            { name: '/skills', usage: '/skills [id]', description: 'Yerleşik ve özel yetenekleri listeler', surfaces: CLI_DESKTOP, argument: 'optional' },
            { name: '/imagegen', usage: '/imagegen <istek>', description: 'Görsel üretir veya düzenler', surfaces: CLI_DESKTOP, argument: 'required', workflow: true },
            { name: '/sessions', usage: '/sessions', description: 'Kayıtlı oturumları listeler', surfaces: CLI_DESKTOP, argument: 'none' },
            { name: '/resume', usage: '/resume <id>', description: 'Kayıtlı bir oturuma devam eder', surfaces: CLI_DESKTOP, argument: 'required' },
            { name: '/frontenddesign', usage: '/frontenddesign <istek>', description: 'Arayüz tasarımı uzmanlığıyla çalışır', surfaces: CLI_DESKTOP, argument: 'required', workflow: true },
            { name: '/backend', usage: '/backend <istek>', description: 'Arka uç mimarisi uzmanlığıyla çalışır', surfaces: CLI_DESKTOP, argument: 'required', workflow: true },
            { name: '/codereview', usage: '/codereview <istek>', description: 'Kod ve güvenlik incelemesi yürütür', surfaces: CLI_DESKTOP, argument: 'required', workflow: true },
            { name: '/debuganalysis', usage: '/debuganalysis <istek>', description: 'Kök neden hata analizi yürütür', surfaces: CLI_DESKTOP, argument: 'required', workflow: true },
        ],
    },
    {
        name: 'Telegram Köprüsü',
        commands: [
            { name: '/start', usage: '/start', description: 'Telegram köprüsünü başlatır', surfaces: TELEGRAM, argument: 'none' },
            { name: '/onay', usage: '/onay', description: 'Bekleyen araç onayını kabul eder', surfaces: TELEGRAM, argument: 'none' },
            { name: '/red', usage: '/red', description: 'Bekleyen araç onayını reddeder', surfaces: TELEGRAM, argument: 'none' },
            { name: '/screenshot', usage: '/screenshot', description: 'Ekran görüntüsü gönderir', surfaces: TELEGRAM, argument: 'none' },
        ],
    },
];
const COMMANDS = COMMAND_GROUPS.flatMap(group => group.commands);
const LOOKUP = new Map();
for (const command of COMMANDS) {
    LOOKUP.set(command.name, command);
    for (const alias of command.aliases ?? [])
        LOOKUP.set(alias, command);
}
/** Resolve a canonical name or alias. */
export function findCommand(name) {
    return LOOKUP.get(String(name || '').trim().toLowerCase());
}
export function commandsFor(surface) {
    return COMMANDS.filter(command => command.surfaces.includes(surface));
}
/** All accepted command spellings for a surface, canonical names first. */
export function commandNamesFor(surface) {
    return commandsFor(surface).flatMap(command => [command.name, ...(command.aliases ?? [])]);
}
/**
 * A workflow command needs an agent turn. `/ultracode on` is a mode change,
 * while `/ultracode fix the build` is work; `/goal` always goes through the
 * workflow because it owns its status/pause/resume/cancel forms.
 */
export function isWorkflowInvocation(name, argument = '') {
    const command = findCommand(name);
    if (!command?.workflow)
        return false;
    const text = String(argument || '').trim().toLowerCase();
    if (command.name === '/ultracode')
        return Boolean(text) && text !== 'on' && text !== 'off';
    return true;
}
/** Plain-text help block shared by the CLI and the desktop help command. */
export function helpFor(surface) {
    const lines = [];
    for (const group of COMMAND_GROUPS) {
        const available = group.commands.filter(command => command.surfaces.includes(surface));
        if (!available.length)
            continue;
        lines.push(`${group.name}:`);
        for (const command of available) {
            const label = [command.usage, ...(command.aliases ?? [])].join('  ');
            lines.push(`  ${label.padEnd(42)} ${command.description}`);
        }
        lines.push('');
    }
    const unavailable = commandsFor('cli').filter(command => !command.surfaces.includes(surface) && surface !== 'cli');
    if (unavailable.length) {
        lines.push(`Yalnızca CLI/TUI: ${unavailable.map(command => command.name).join(', ')}`);
    }
    return lines.join('\n').trimEnd();
}
/** Compact command list for a desktop palette or a log line. */
export function commandCatalog(surface) {
    return commandsFor(surface)
        .map(command => ({
        name: command.name,
        usage: command.usage,
        description: command.description,
        argument: command.argument ?? 'none',
    }));
}
export const COMMAND_NAMES = COMMANDS.map(command => command.name);
export const COMMAND_COUNT = COMMANDS.length;
//# sourceMappingURL=commands.js.map