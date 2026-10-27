import { type EffortLevel } from './effort.js';
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
export declare const HELP = "T Bot 2.0 \u2014 Siber-Minimalist Ak\u0131ll\u0131 AI Ajan\u0131 & Komut Merkezi\n\nKullan\u0131m:\n  tbot                         Etkile\u015Fimli TUI oturumu\n  tbot \"iste\u011Finiz\"             Tek seferlik istek y\u00FCr\u00FCt\n  tbot --bot                   Telegram Bot k\u00F6pr\u00FCs\u00FCn\u00FC otomatik ba\u015Flat\n  tbot --provider <id> --model <model> \"iste\u011Finiz\"\n  tbot --resume <id>           Kaydedilmi\u015F oturuma devam et\n  tbot config                  Sa\u011Flay\u0131c\u0131 ve API anahtar\u0131 ayarlar\u0131\n  tbot providers               Kullan\u0131labilir LLM sa\u011Flay\u0131c\u0131lar\u0131n\u0131 listele\n  tbot sessions                Ge\u00E7mi\u015F oturumlar\u0131 listele\n  tbot doctor                  Ortam ve sistem sa\u011Fl\u0131\u011F\u0131 denetimi\n  tbot --help                  Yard\u0131m men\u00FCs\u00FC\n  tbot --version               S\u00FCr\u00FCm bilgisi\n\nSe\u00E7enekler:\n  -p, --provider <id>    Sa\u011Flay\u0131c\u0131 se\u00E7 (openai, anthropic, gemini, openrouter, ollama vb.)\n  -m, --model <model>    Model se\u00E7\n  -w, --workspace <yol>  \u00C7al\u0131\u015Fma dizini (varsay\u0131lan: aktif dizin)\n  -r, --resume <id>      Oturuma devam et\n      --bot              Telegram Bot Gateway k\u00F6pr\u00FCs\u00FCn\u00FC ba\u015Flat\u0131r\n      --yolo             Ara\u00E7 onaylar\u0131n\u0131 bu oturumda otomatik ver\n      --ultracode        Y\u00FCksek do\u011Fruluklu \u00F6zerk Ultracode modunu a\u00E7\n      --effort <d\u00FCzey>   D\u00FC\u015F\u00FCnme eforu: low, medium, high, xhigh, max\n  -h, --help             Yard\u0131m men\u00FCs\u00FCn\u00FC g\u00F6sterir\n  -v, --version          S\u00FCr\u00FCm bilgisini g\u00F6sterir\n\nT Bot 2.0 Komutlar\u0131 & \u0130\u015F Ak\u0131\u015Flar\u0131 (Etkile\u015Fimli TUI):\n  /bot [start|stop|token|status|allow]  Telegram Bot K\u00F6pr\u00FCs\u00FC y\u00F6netimi\n  /tokens                               Canl\u0131 Token Tasarrufu & Optimizasyon raporu\n  /memory                               RAM kullan\u0131m\u0131 & kay\u0131tl\u0131 proje/k\u00FCresel bellek\n  /remember <anahtar> = <de\u011Fer>         Kal\u0131c\u0131 proje belle\u011Fine bilgi kaydeder\n  /forget <anahtar>                     Kay\u0131tl\u0131 haf\u0131za maddesini siler\n  /gc                                   Bellek koruyucusu & Garbage Collection \u00E7al\u0131\u015Ft\u0131r\u0131r\n  /ultracode [on|off]                   \u00D6zerk ara\u015Ft\u0131rma, kodlama ve test modu\n  /subagents [model]                    Paralel alt ajan ara\u015Ft\u0131rma koordinat\u00F6r\u00FC\n  /goal [hedef|status|pause|cancel]     Otonom hedef belirleme ve d\u00F6ng\u00FCsel y\u00FCr\u00FCtme\n  /plan [istek|apply]                   Gereksinim analizi ve ad\u0131m ad\u0131m plan y\u00FCr\u00FCtme";
export declare function printUsage(): void;
export declare function parseCli(argv: string[]): CliOptions;
