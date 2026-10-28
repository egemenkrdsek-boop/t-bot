![T Bot Logosu](assets/tabit.webp)

# T Bot 2.0.2

T Bot; terminalden veya Windows masaüstü uygulamasından kullanılan yerel bir yapay zekâ ajanıdır. Kod ve dosya araçları, sağlayıcı bağlantıları, Windows masaüstü kontrolü, Playwright tarayıcısı ve Telegram ağ geçidi içerir. Gemini, OpenAI, Anthropic, OpenRouter ve uyumlu yerel model sunucularıyla yapılandırılabilir.

## Tek komutla CLI kurulumu / güncelleme

Önce **Node.js >=22.12.0, npm ve Git** kurulu olmalıdır. Komutlar GitHub `main` dalını indirir ve derler; internet erişimi ve npm global dizinine yazma izni gerekir. İndirdiğiniz betiğin içeriğini çalıştırmadan önce inceleyebilirsiniz.

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/egemenkrdsek-boop/t-bot/main/scripts/install.ps1 | iex
```

Linux / macOS:

```sh
curl -fsSL https://raw.githubusercontent.com/egemenkrdsek-boop/t-bot/main/scripts/install.sh | sh
```

Betikler CLI kurar, `--help` ve `--version` başarısız olursa hata verir. Windows kullanıcı PATH'ini günceller; Unix betiği gerekiyorsa shell profilinizde eklemeniz gereken dizini gösterir. Aynı komutu tekrar çalıştırarak güncelleyebilirsiniz. Bunlar Windows masaüstü yükleyicisini kurmaz.

Doğrudan npm alternatifi:

```sh
npm install -g 'git+https://github.com/egemenkrdsek-boop/t-bot.git#main'
tbot config
tbot
```

## Windows masaüstü uygulaması

Dağıtılmış bir yükleyici varsa [Releases](https://github.com/egemenkrdsek-boop/t-bot/releases) sayfasındaki sürümü ve dosyayı kontrol edin. Kaynaktan **Windows x64** yükleyicisi oluşturmak ve yerelde kurmak için PowerShell'de:

```powershell
git clone https://github.com/egemenkrdsek-boop/t-bot.git
cd t-bot
npm ci
npm run dist:win
powershell -ExecutionPolicy Bypass -File scripts/deploy-local.ps1
```

Bu akış Electron ve NSIS derleme araçlarını indirir. `release/T-Bot-Setup-2.0.2.exe` ve `release/build-manifest.json` üretir. Kurulum betiği yükleyicinin SHA256 değerini, çıkış kodunu, kurulan uygulamanın sürümünü ve `app.asar` SHA256 değerini denetler; böylece aynı sürüm numaralı eski bir kurulum başarı sayılmaz. Manifest ve yükleyiciyi birlikte saklayın. Mevcut uygulamayı kapatır; açık çalışmalarınızı kaydedin. Geliştirme için `npm run desktop` kullanın. CLI kurulumu Electron indirmesini atladıysa önce `node node_modules/electron/install.js` çalıştırın.

## Başlangıç

```text
tbot config                    Sağlayıcı ve API anahtarını yapılandır
tbot providers                 Sağlayıcıları listele
tbot doctor                    Ortamı denetle
tbot -w <dizin>                 Çalışma alanı seç
tbot "isteğiniz"                Tek istek çalıştır
tbot --help                    Geçerli seçenekleri göster
tbot --version                 Kurulu sürümü göster
```

Etkileşimli oturumda `/help` komutuyla güncel komutları görün. Dosya okuma/yazma/yama, sembol arama, kabuk ve süreç yönetimi, Git, hedefler, bellek, beceriler ve alt ajan araçları bulunur. `/ultracode`, `/goal`, `/tokens`, `/gui`, `/mcp` gibi komutların kullanılabilirliği ve etkisi yapılandırmaya bağlıdır.

Tarayıcı araçları Google Chrome'u veya Playwright ile uyumlu bir Chromium kurulumunu gerektirir. Windows masaüstü araçları etkileşimli Windows oturumu ister; Linux/macOS için aynı masaüstü kontrolü vaat edilmez. Model hizmetleri ve Telegram internet bağlantısı gerektirir; bulut sağlayıcısı kullanıldığında gönderilen içerik o sağlayıcıya gider. Yerel çalıştırma, tüm verilerin cihazda kaldığı anlamına gelmez.

## Telegram

BotFather'dan aldığınız tokenı ve izin verilen sohbet kimliklerini yapılandırın; ardından `tbot --bot` çalıştırın. PowerShell örneği:

```powershell
$env:TELEGRAM_BOT_TOKEN = '<bot-token>'
$env:TELEGRAM_ALLOWED_CHATS = '<chat-id>'
tbot --bot
```

Ağ geçidi yerel makineden long polling yapar; makine ve T Bot açık kalmalıdır. Bot tokenınızı paylaşmayın. Araç onayları ve yetkilendirme ayarlarını ihtiyacınıza göre inceleyin. `--yolo` otomatik onay verdiği için yalnızca güvendiğiniz görevlerde kullanın.

İzin verilen chat listesi boşsa ilk bağlantı için yerel terminalde `/pair <32-karakter hex kod>` gösterilir. Bu tek kullanımlık kod 10 dakika geçerlidir ve tüm chatler için toplam 10 denemeye izin verir. Kodu yalnızca yetkilendireceğiniz chat'e gönderin. Süre veya deneme sınırı dolarsa ağ geçidini yerelden durdurup yeniden başlatın; uzaktan yeni kod üretilemez. Allowlist önceden yapılandırılmışsa eşleştirme açılmaz. Yetkili grup chat'indeki üyeler ortak chat yetkisini paylaşır.

## Doğruluk ve performans sınırları

Diferansiyel dosya okuma, bağlam sıkıştırma ve araç şeması seçimi tekrarlanan bağlamı azaltmayı amaçlar. Token tasarrufu görev, model ve önbellek kullanımına bağlıdır; ölçülmüş genel bir %50–%75 tasarruf veya dünya sıralaması iddiası yoktur. Yerel tasarruf tahminleri sağlayıcının fatura ölçümü değildir.

Dosya erişimi ve sözdizimi kontrolleri bazı hataları erken yakalayabilir. Bunlar model yanılgılarını, çalışma zamanı hatalarını veya yanlış kodu ortadan kaldırmaz; gerçek derleme/test sonuçlarıyla birlikte değerlendirin. TypeScript/JavaScript ve JSON denetimleri tüm diller için doğrulama garantisi sağlamaz. Bellek izleme de tüm bellek sızıntılarını önleme garantisi vermez.

T Bot deposunun geçmişi kendi `Initial T Bot CLI` başlangıcını içerir. OpenCode ve Hermes ürün fikirleriyle anılan bir projedir; bu depoda doğrulanmış bir upstream fork veya kod birleştirme geçmişi yoktur. Kaynak kodunun eksiksiz köken denetimi yapılmış sayılmaz. Lisans ve üçüncü taraf bilgileri [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) dosyasındadır.

Ayrıntılar: [Mimari](docs/architecture.md), [Kurulum](docs/install.md), [Doğrulama kapsamı](docs/verification.md), [MIT lisansı](LICENSE).
