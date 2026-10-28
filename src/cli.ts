import { EFFORT_LEVELS, type EffortLevel } from './effort.js';
import { APP_VERSION } from './version.js';

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

export const HELP = `T Bot ${APP_VERSION} — AI Ajanı ve Komut Merkezi

Kullanım:
  tbot                         Etkileşimli TUI Oturumu
  tbot "isteğiniz"             Tek Seferlik İstek Yürüt
  tbot --bot                   Telegram Bot Köprüsünü Otomatik Başlat
  tbot --provider <id> --model <model> "isteğiniz"
  tbot --resume <id>           Kaydedilmiş Oturuma Devam Et
  tbot config                  Sağlayıcı ve API Anahtarı Ayarları
  tbot providers               Kullanılabilir LLM Sağlayıcılarını Listele
  tbot sessions                Geçmiş Oturumları Listele
  tbot doctor                  Ortam ve Sistem Sağlığı Denetimi
  tbot --help                  Yardım Menüsü
  tbot --version               Sürüm Bilgisi

Seçenekler:
  -p, --provider <id>    Sağlayıcı Seç (openai, anthropic, gemini, openrouter, ollama vb.)
  -m, --model <model>    Model Seç
  -w, --workspace <yol>  Çalışma Dizini (Varsayılan: Aktif Dizin)
  -r, --resume <id>      Oturuma Devam Et
      --bot              Telegram Bot Gateway Köprüsünü Başlatır
      --yolo             Araç Onaylarını Bu Oturumda Otomatik Ver
      --ultracode        Yüksek Doğruluklu Özerk Ultracode Modunu Aç
      --effort <düzey>   Düşünme Eforu: low, medium, high, xhigh, max
  -h, --help             Yardım Menüsünü Gösterir
  -v, --version          Sürüm Bilgisini Gösterir

T Bot 2.0 Komutları ve İş Akışları (Etkileşimli TUI):
  /bot [start|stop|token|status|allow]  Telegram Bot Köprüsü Yönetimi
  /tokens                               Canlı Token Tasarrufu ve Optimizasyon Raporu
  /memory                               RAM Kullanımı ve Kayıtlı Proje/Küresel Bellek
  /remember <anahtar> = <değer>         Kalıcı Proje Belleğine Bilgi Kaydeder
  /forget <anahtar>                     Kayıtlı Hafıza Maddesini Siler
  /gc                                   Bellek Koruyucusu ve Garbage Collection Çalıştırır
  /ultracode [on|off]                   Özerk Araştırma, Kodlama ve Test Modu
  /subagents [model]                    Paralel Alt Ajan Araştırma Koordinatörü
  /goal [hedef|status|pause|cancel]     Otonom Hedef Belirleme ve Döngüsel Yürütme
  /plan [istek|apply]                   Gereksinim Analizi ve Adım Adım Plan Yürütme`;

export function printUsage(): void {
  console.log(HELP);
}

export function parseCli(argv: string[]): CliOptions {
  const options: CliOptions = { command: 'chat', args: [] };
  const positional: string[] = [];
  let literalCommand = false;
  const keys: Record<string, 'provider' | 'model' | 'workspace' | 'resume'> = {
    '-p': 'provider', '--provider': 'provider', '-m': 'model', '--model': 'model',
    '-w': 'workspace', '--workspace': 'workspace', '-r': 'resume', '--resume': 'resume',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') { literalCommand = positional.length === 0; positional.push(...argv.slice(i + 1)); break; }
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
  if (options.command === 'chat' && !literalCommand && commands.includes(positional[0] as typeof commands[number])) {
    options.command = positional.shift() as typeof commands[number];
  }
  options.args = positional;
  if (options.command === 'chat' && positional.length) options.message = positional.join(' ');
  return options;
}
