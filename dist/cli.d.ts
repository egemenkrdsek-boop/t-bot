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
export declare const HELP = "T Bot 2.0 \u2014 Siber-Minimalist Ak\u0131ll\u0131 AI Ajan\u0131 ve Komut Merkezi\n\nKullan\u0131m:\n  tbot                         Etkile\u015Fimli TUI Oturumu\n  tbot \"iste\u011Finiz\"             Tek Seferlik \u0130stek Y\u00FCr\u00FCt\n  tbot --bot                   Telegram Bot K\u00F6pr\u00FCs\u00FCn\u00FC Otomatik Ba\u015Flat\n  tbot --provider <id> --model <model> \"iste\u011Finiz\"\n  tbot --resume <id>           Kaydedilmi\u015F Oturuma Devam Et\n  tbot config                  Sa\u011Flay\u0131c\u0131 ve API Anahtar\u0131 Ayarlar\u0131\n  tbot providers               Kullan\u0131labilir LLM Sa\u011Flay\u0131c\u0131lar\u0131n\u0131 Listele\n  tbot sessions                Ge\u00E7mi\u015F Oturumlar\u0131 Listele\n  tbot doctor                  Ortam ve Sistem Sa\u011Fl\u0131\u011F\u0131 Denetimi\n  tbot --help                  Yard\u0131m Men\u00FCs\u00FC\n  tbot --version               S\u00FCr\u00FCm Bilgisi\n\nSe\u00E7enekler:\n  -p, --provider <id>    Sa\u011Flay\u0131c\u0131 Se\u00E7 (openai, anthropic, gemini, openrouter, ollama vb.)\n  -m, --model <model>    Model Se\u00E7\n  -w, --workspace <yol>  \u00C7al\u0131\u015Fma Dizini (Varsay\u0131lan: Aktif Dizin)\n  -r, --resume <id>      Oturuma Devam Et\n      --bot              Telegram Bot Gateway K\u00F6pr\u00FCs\u00FCn\u00FC Ba\u015Flat\u0131r\n      --yolo             Ara\u00E7 Onaylar\u0131n\u0131 Bu Oturumda Otomatik Ver\n      --ultracode        Y\u00FCksek Do\u011Fruluklu \u00D6zerk Ultracode Modunu A\u00E7\n      --effort <d\u00FCzey>   D\u00FC\u015F\u00FCnme Eforu: low, medium, high, xhigh, max\n  -h, --help             Yard\u0131m Men\u00FCs\u00FCn\u00FC G\u00F6sterir\n  -v, --version          S\u00FCr\u00FCm Bilgisini G\u00F6sterir\n\nT Bot 2.0 Komutlar\u0131 ve \u0130\u015F Ak\u0131\u015Flar\u0131 (Etkile\u015Fimli TUI):\n  /bot [start|stop|token|status|allow]  Telegram Bot K\u00F6pr\u00FCs\u00FC Y\u00F6netimi\n  /tokens                               Canl\u0131 Token Tasarrufu ve Optimizasyon Raporu\n  /memory                               RAM Kullan\u0131m\u0131 ve Kay\u0131tl\u0131 Proje/K\u00FCresel Bellek\n  /remember <anahtar> = <de\u011Fer>         Kal\u0131c\u0131 Proje Belle\u011Fine Bilgi Kaydeder\n  /forget <anahtar>                     Kay\u0131tl\u0131 Haf\u0131za Maddesini Siler\n  /gc                                   Bellek Koruyucusu ve Garbage Collection \u00C7al\u0131\u015Ft\u0131r\u0131r\n  /ultracode [on|off]                   \u00D6zerk Ara\u015Ft\u0131rma, Kodlama ve Test Modu\n  /subagents [model]                    Paralel Alt Ajan Ara\u015Ft\u0131rma Koordinat\u00F6r\u00FC\n  /goal [hedef|status|pause|cancel]     Otonom Hedef Belirleme ve D\u00F6ng\u00FCsel Y\u00FCr\u00FCtme\n  /plan [istek|apply]                   Gereksinim Analizi ve Ad\u0131m Ad\u0131m Plan Y\u00FCr\u00FCtme";
export declare function printUsage(): void;
export declare function parseCli(argv: string[]): CliOptions;
