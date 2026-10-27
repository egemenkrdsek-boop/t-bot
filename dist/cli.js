export const HELP = `T Bot — yerel AI ajanı

Kullanım:
  tbot                         Etkileşimli oturum
  tbot "isteğiniz"             Tek seferlik istek
  tbot --provider <id> --model <model> "isteğiniz"
  tbot --resume <id>           Kaydedilmiş oturuma devam et
  tbot config                  Sağlayıcı ayarları
  tbot providers               Sağlayıcıları listele
  tbot sessions                Oturumları listele
  tbot doctor                  Ortamı kontrol et
  tbot --help                  Yardım
  tbot --version               Sürüm

Seçenekler:
  -p, --provider <id>    Sağlayıcı seç
  -m, --model <model>    Model seç
  -w, --workspace <yol>  Çalışma dizini
  -r, --resume <id>      Oturuma devam et
  -h, --help             Yardım
  -v, --version          Sürüm`;
export function parseCli(argv) {
    const options = { command: 'chat', args: [] };
    const positional = [];
    const keys = {
        '-p': 'provider', '--provider': 'provider', '-m': 'model', '--model': 'model',
        '-w': 'workspace', '--workspace': 'workspace', '-r': 'resume', '--resume': 'resume',
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--') {
            positional.push(...argv.slice(i + 1));
            break;
        }
        if (arg === '-h' || arg === '--help') {
            options.command = 'help';
            continue;
        }
        if (arg === '-v' || arg === '--version') {
            options.command = 'version';
            continue;
        }
        const equal = arg.indexOf('=');
        const key = equal < 0 ? arg : arg.slice(0, equal);
        if (keys[key]) {
            const value = equal < 0 ? argv[++i] : arg.slice(equal + 1);
            if (!value || (equal < 0 && value.startsWith('-')))
                throw new Error(`${key} için bir değer gerekli.`);
            options[keys[key]] = value;
        }
        else if (arg.startsWith('-'))
            throw new Error(`Bilinmeyen seçenek: ${arg}`);
        else
            positional.push(arg);
    }
    const commands = ['config', 'providers', 'doctor', 'sessions'];
    if (options.command === 'chat' && commands.includes(positional[0])) {
        options.command = positional.shift();
    }
    options.args = positional;
    if (options.command === 'chat' && positional.length)
        options.message = positional.join(' ');
    return options;
}
//# sourceMappingURL=cli.js.map