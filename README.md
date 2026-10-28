![T Bot logosu](assets/tabit.webp)

# T Bot 4.1

T Bot, terminalden veya Windows masaüstü uygulamasından kullanılan **yerel** bir yapay zekâ kodlama ajanıdır. Aynı çekirdek; CLI/TUI, Electron masaüstü ve Telegram girişlerinden çalışır. Ayrı bir bulut backend'i yoktur; model çağrıları, tarayıcı, MCP ve Telegram gibi dış bağlantılar kullanıcı tarafından yapılandırılır.

4.1'in odağı dört başlıktır:

- **J-Space çekirdeği:** dört lensli akıl yürütme, kanıt disiplini ve derin görev planlaması varsayılan; tam skill gizli ve isteğe bağlı.
- **GUI fast path:** eylem sonrası hafif durum gözlemi, açık görsel doğrulama, sıcak browser/desktop oturumları ve toplu GUI eylemleri.
- **Token ekonomisi:** skill enjeksiyonu azaltıldı; büyük araç çıktıları yerel artifact'lara taşınır; bağlam model profiline göre bütçelenir.
- **Güvenlik ve sade arayüz:** isteğe bağlı OS sandbox, checkpoint/undo, tek vurgu rengi, monospace kod ve klavye öncelikli masaüstü/TUI.

## Kurulum

Önce **Node.js >=22.12.0, npm ve Git** kurulu olmalıdır.

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/egemenkrdsek-boop/t-bot/main/scripts/install.ps1 -ErrorAction Stop | iex
```

Linux / macOS:

```sh
sh -c 'script=$(curl -fsSL https://raw.githubusercontent.com/egemenkrdsek-boop/t-bot/main/scripts/install.sh) && printf "%s\n" "$script" | sh'
```

Betikler uzak `main` commitini geçici bir checkout'ta kilitli bağımlılıklarla derler, sürüm/yardım kontrolü yapar ve hazır tarball'ı global kurar. Derleme veya paketleme başarısızsa mevcut global CLI'ye dokunulmaz. Belirli bir sürüm dalını/tag'ini kurmak için `TBOT_INSTALL_REF=v4.0.0` (PowerShell: `$env:TBOT_INSTALL_REF='v4.0.0'`) ayarlanabilir; tam commit sabitlemek için `TBOT_INSTALL_REVISION` kullanılır. Kurulumdan sonra:

```text
tbot config                 Sağlayıcı ve API anahtarını yapılandır
tbot providers              Sağlayıcıları listele
tbot doctor                 Ortamı denetle
tbot -w <dizin>             Çalışma alanı seç
tbot "isteğiniz"            Tek istek çalıştır
tbot --help                 Seçenekleri göster
tbot --version              Sürümü göster
```

## Windows masaüstü uygulaması

Kaynaktan Windows x64 yükleyicisi üretmek için:

```powershell
git clone https://github.com/egemenkrdsek-boop/t-bot.git
cd t-bot
npm ci
npm run dist:win
powershell -ExecutionPolicy Bypass -File scripts/deploy-local.ps1
```

Bu akış `release/T-Bot-Setup-4.1.0.exe` ve `release/build-manifest.json` üretir. Kurulum betiği yükleyicinin SHA256 değerini, çıkış kodunu, kurulan uygulamanın sürümünü ve `app.asar` SHA256 değerini denetler. Manifest ve yükleyiciyi birlikte saklayın. Yayımlama işlemi bu deponun sorumluluğunda değildir.

Geliştirme için:

```powershell
npm run desktop
```

## 4.1 ile gelenler

### Ajan çekirdeği

- Gizli `jspace` skill'i tam Ultra J-Space metnini taşır; normal turlarda yalnızca kompakt `[J-SPACE DEFAULT KERNEL]` gönderilir. `/jspace` veya açık "deep reasoning / complex architecture" tetikleyicisi tam metni yükler.
- CLI/TUI ve Telegram artık tüm built-in skill'leri her turda göndermez; selamlaşma gibi işler fast path'te kalır.
- Görev sözleşmesi, doğrulama-sonrası-yazma kapısı ve checkpoint/undo 4.0'dan korunur.

### GUI fast path

- `browser_*` ve `computer` eylemleri varsayılan olarak yalnızca hafif durum döndürür. Screenshot/UIA ağacı için `observe: "visual"`, `auto_screenshot: true` veya açık `inspect`/`screenshot` gerekir.
- `browser_batch` ve `computer_batch` en fazla 12 doğrulanmış adımı tek onayla çalıştırır; ilk hatada durur.
- Browser/desktop sıcak oturumları 10 dakika açık kalır; model ve onay gecikmesi artık cold-start'a yol açmaz.
- Saf gözlemler ayrı onay istemez; GUI mutasyonları, screenshot'lar ve batch'ler onay sınırını korur.
- Screenshot birikimi 40 dosya / 32 MB ile sınırlandırılır; eylem süreleri tool event'lerinde raporlanır.

### Token ve bağlam

- 6 KB üzerindeki araç çıktıları `.tbot/artifacts/` altında saklanır; modele özet + `artifact_read` kimliği döner. Aynı içerik tekrar üretilirse aynı artifact kimliği kullanılır; disk ve bağlam şişmez.
- `context-budget.ts` model ailesine göre yerel geçmiş bütçesi, tur ve araç limitleri belirler.
- Sistem prompt'u İngilizce ve kararlı; yanıt dili kullanıcının diliyle eşleşir.
- Prompt sırası önbellek dostudur: güvenlik → görev → beceriler → repo haritası → bellek → odak.
- Sağlayıcı `usage` değeri ile yerel tahmin ayrı raporlanır; tasarruf iddiası ölçümsüz sunulmaz.

### Arayüz

- Masaüstü: sade üç bölge (oturumlar, transcript, inspector), tek Tabit yeşili vurgu, emoji yok.
- `Run Spine`: gerçek araç olaylarından türetilen `Keşif → Plan → Uygulama → Doğrulama` düğümleri; aktif faz görünür.
- Masaüstü ve CLI'da `/plan`, `/plan apply`, `/ultracode` ve `/subagents` akışları; `/tokens`, `/memory`, `/remember`, `/forget`, `/checkpoints`, `/undo` ve `/doctor` iki yüzeyde de çalışır.
- Browser Use, Computer Use ve arka plan geliştirme sunucuları için araç yönergeleri.
- Kapalı araç kartlarında DOM üretilmez; büyük geçmiş 40 kayıtla sınırlıdır.
- Komut paleti `Ctrl+K`; `Esc` durdur; `Enter` gönder.
- Animasyonlar yalnızca opacity/transform ve 120–160 ms; `prefers-reduced-motion` tümünü kapatır.
- TUI paleti aynı grafit/Tabit yeşili dile taşındı.

### Güvenlik

- Gizli anahtarlar Windows'ta DPAPI + kullanıcıya özel ACL ile saklanır; alt süreç ortamından sır adları çıkarılır.
- Açık kullanıcı sınırları model talimatından bağımsız olarak araç çağrısı katmanında uygulanır; kabuk üzerinden korunan bir dosyaya yazma denemesi de reddedilir. `no-write` checkpoint, Git yazımı ve skill oluşturmayı; `no-command` süreç kontrolü ve alt ajan devrini kapsar. Bu, eksiksiz bir OS sandbox değildir.
- Kabuk, dosya yazma, GUI, URL indirme, checkpoint geri yükleme ve doğrulama komutları varsayılan olarak onay ister.
- `TBOT_SANDBOX=required` seçildiğinde Linux'ta bubblewrap, macOS'ta sandbox-exec aranır; adaptör yoksa kabuk çalışmaz. Windows'ta OS sandbox adaptörü yoktur ve bu açıkça raporlanır.
- Hassas yollar okumada onaya, yazmada redde tabidir; kabuk komutunda kimlik dosyası benzeri bir yol geçerse onay metni ek uyarı gösterir.
- Web/MCP/tool içeriği güvenilmeyen kanıt olarak işaretlenir; taint tekrarı onay gerektirir. Prompt injection için kesin garanti yoktur.
- Kabuk gerçek kullanıcı izinleriyle çalışır. OS sandbox yoksa süreç ağacı, ortam filtresi ve onay sınırı uygulanır.

## Sağlayıcılar

Gemini, OpenAI (Chat Completions ve Responses), Anthropic, OpenRouter, Groq, DeepSeek, xAI, Mistral, Ollama, LM Studio ve OpenAI uyumlu özel uç noktalar desteklenir. Model listesi sağlayıcıdan canlı alınır; çevrimdışıysa yerel fallback kullanılır.

## Telegram

BotFather'dan aldığınız tokenı ve izin verilen sohbet kimliklerini yapılandırın:

```powershell
$env:TELEGRAM_BOT_TOKEN = '<bot-token>'
$env:TELEGRAM_ALLOWED_CHATS = '<chat-id>'
tbot --bot
```

İlk eşleştirme için yerel terminalde tek kullanımlık `/pair <32-karakter hex kod>` gösterilir. Kod 10 dakika geçerlidir ve toplam 10 deneme hakkı vardır. Yetkili grup sohbetindeki tüm üyeler ortak yetkiyi paylaşır.

## Doğrulama ve sınırlar

- Testler birim/bileşen ve kaydedilmiş protokol fixture'larıdır; E2E, canlı sağlayıcı, gerçek tarayıcı veya gerçek Telegram akışı çalıştırılmaz.
- 4.1 kaynak doğrulaması: test/typecheck/build sonuçları [doğrulama kaydında](docs/verification.md) güncellenir. Aşağıdaki sınırlar değişmez: E2E, canlı sağlayıcı, gerçek tarayıcı ve gerçek Telegram akışı çalıştırılmaz.
- “Dünya #1” veya rakiplere göre %50–75 tasarruf iddiası bu depoda bağımsız benchmark olmadan kanıtlanmış sayılmaz. Ölçülebilir hedef, aynı fixture setinde 2.2.1'e göre daha az bağlam göndermektir.
- TypeScript/JavaScript ve JSON kontrolleri tüm diller için doğrulama garantisi değildir.
- Gizli anahtar redaksiyonu sezgiseldir; bilinmeyen biçimleri yakalama garantisi yoktur.
- Windows dışı masaüstü kontrolü vaat edilmez.

## Üçüncü taraf bileşenler

OpenCode'un sabit commit'ten uyarlanmış Unicode düzenleme eşleştirme/satır sonu koruma yordamları ve Hermes Agent'ın token bütçesine göre bağlam penceresi planlaması kullanılır. Bunlar MIT lisanslı bileşen uyarlamalarıdır; upstream çalışma zamanının tamamı veya fork geçmişi taşınmaz. Kaynaklar, commit'ler ve lisans metinleri [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) ve [THIRD_PARTY_DEPENDENCIES.md](THIRD_PARTY_DEPENDENCIES.md) dosyalarındadır.

Ayrıntılar: [Mimari](docs/architecture.md), [Kurulum](docs/install.md), [Doğrulama](docs/verification.md), [Rakiplik boşluk matrisi](docs/competitor-gaps.md), [Lisans](LICENSE).
