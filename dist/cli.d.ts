export interface CliOptions {
    command: 'chat' | 'help' | 'version' | 'config' | 'providers' | 'doctor' | 'sessions';
    message?: string;
    provider?: string;
    model?: string;
    workspace?: string;
    resume?: string;
    args: string[];
}
export declare const HELP = "T Bot \u2014 yerel AI ajan\u0131\n\nKullan\u0131m:\n  tbot                         Etkile\u015Fimli oturum\n  tbot \"iste\u011Finiz\"             Tek seferlik istek\n  tbot --provider <id> --model <model> \"iste\u011Finiz\"\n  tbot --resume <id>           Kaydedilmi\u015F oturuma devam et\n  tbot config                  Sa\u011Flay\u0131c\u0131 ayarlar\u0131\n  tbot providers               Sa\u011Flay\u0131c\u0131lar\u0131 listele\n  tbot sessions                Oturumlar\u0131 listele\n  tbot doctor                  Ortam\u0131 kontrol et\n  tbot --help                  Yard\u0131m\n  tbot --version               S\u00FCr\u00FCm\n\nSe\u00E7enekler:\n  -p, --provider <id>    Sa\u011Flay\u0131c\u0131 se\u00E7\n  -m, --model <model>    Model se\u00E7\n  -w, --workspace <yol>  \u00C7al\u0131\u015Fma dizini\n  -r, --resume <id>      Oturuma devam et\n  -h, --help             Yard\u0131m\n  -v, --version          S\u00FCr\u00FCm";
export declare function parseCli(argv: string[]): CliOptions;
