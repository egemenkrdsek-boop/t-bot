import { EFFORT_LEVELS, type EffortLevel } from './effort.js';

export interface CliOptions {
  command: 'chat' | 'help' | 'version' | 'config' | 'providers' | 'doctor' | 'sessions';
  message?: string;
  provider?: string;
  model?: string;
  workspace?: string;
  resume?: string;
  yolo?: boolean;
  ultracode?: boolean;
  bot?: boolean;
  effort?: EffortLevel;
  args: string[];
}

export const HELP = `T Bot 2.0 — Siber-Minimalist Akıllı AI Ajanı & Komut Merkezi

Kullanım:
  tbot                         Etkileşimli TUI oturumu
  tbot "isteğiniz"             Tek seferlik istek yürüt
  tbot --bot                   Telegram Bot köprüsünü otomatik başlat
  tbot --provider <id> --model <model> "isteğiniz"
  tbot --resume <id>           Kaydedilmiş oturuma devam et
  tbot config                  Sağlayıcı ve API anahtarı ayarları
  tbot providers               Kullanılabilir LLM sağlayıcılarını listele
  tbot sessions                Geçmiş oturumları listele
  tbot doctor                  Ortam ve sistem sağlığı denetimi
  tbot --help                  Yardım menüsü
  tbot --version               Sürüm bilgisi

Seçenekler:
  -p, --provider <id>    Sağlayıcı seç (openai, anthropic, gemini, openrouter, ollama vb.)
  -m, --model <model>    Model seç
  -w, --workspace <yol>  Çalışma dizini (varsayılan: aktif dizin)
  -r, --resume <id>      Oturuma devam et
      --bot              Telegram Bot Gateway köprüsünü başlatır
      --yolo             Araç onaylarını bu oturumda otomatik ver
      --ultracode        Yüksek doğruluklu özerk Ultracode modunu aç
      --effort <düzey>   Düşünme eforu: low, medium, high, xhigh, max
  -h, --help             Yardım menüsünü gösterir
  -v, --version          Sürüm bilgisini gösterir

T Bot 2.0 Komutları & İş Akışları (Etkileşimli TUI):
  /bot [start|stop|token|status|allow]  Telegram Bot Köprüsü yönetimi
  /tokens                               Canlı Token Tasarrufu & Optimizasyon raporu
  /memory                               RAM kullanımı & kayıtlı proje/küresel bellek
  /remember <anahtar> = <değer>         Kalıcı proje belleğine bilgi kaydeder
  /forget <anahtar>                     Kayıtlı hafıza maddesini siler
  /gc                                   Bellek koruyucusu & Garbage Collection çalıştırır
  /ultracode [on|off]                   Özerk araştırma, kodlama ve test modu
  /subagents [model]                    Paralel alt ajan araştırma koordinatörü
  /goal [hedef|status|pause|cancel]     Otonom hedef belirleme ve döngüsel yürütme
  /plan [istek|apply]                   Gereksinim analizi ve adım adım plan yürütme`;

export function printUsage(): void {
  console.log(HELP);
}

export function parseCli(argv: string[]): CliOptions {
  const options: CliOptions = { command: 'chat', args: [] };
  const positional: string[] = [];
  const keys: Record<string, 'provider' | 'model' | 'workspace' | 'resume'> = {
    '-p': 'provider', '--provider': 'provider', '-m': 'model', '--model': 'model',
    '-w': 'workspace', '--workspace': 'workspace', '-r': 'resume', '--resume': 'resume',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') { positional.push(...argv.slice(i + 1)); break; }
    if (arg === '--ultracode') { options.ultracode = true; continue; }
    if (arg === '--yolo') { options.yolo = true; continue; }
    if (arg === '--bot') { options.bot = true; continue; }
    if (arg === '-h' || arg === '--help') { options.command = 'help'; continue; }
    if (arg === '-v' || arg === '--version') { options.command = 'version'; continue; }
    const equal = arg.indexOf('=');
    const key = equal < 0 ? arg : arg.slice(0, equal);
    if (key === '--effort') {
      const value = (equal < 0 ? argv[++i] : arg.slice(equal + 1))?.toLowerCase();
      if (!value || !EFFORT_LEVELS.includes(value as EffortLevel)) throw new Error('--effort: low, medium, high, xhigh veya max seçin.');
      options.effort = value as EffortLevel; continue;
    }
    if (keys[key]) {
      const value = equal < 0 ? argv[++i] : arg.slice(equal + 1);
      if (!value || (equal < 0 && value.startsWith('-'))) throw new Error(`${key} için bir değer gerekli.`);
      options[keys[key]] = value;
    } else if (arg.startsWith('-')) throw new Error(`Bilinmeyen seçenek: ${arg}`);
    else positional.push(arg);
  }
  const commands = ['config', 'providers', 'doctor', 'sessions'] as const;
  if (options.command === 'chat' && commands.includes(positional[0] as typeof commands[number])) {
    options.command = positional.shift() as typeof commands[number];
  }
  options.args = positional;
  if (options.command === 'chat' && positional.length) options.message = positional.join(' ');
  return options;
}
