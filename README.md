![T Bot logosu](assets/tabit.webp)

# T Bot 3.1

T Bot, terminalden veya Windows masaüstü uygulamasından kullanılan **yerel** bir yapay zekâ kodlama ajanıdır. Aynı çekirdek; CLI/TUI, Electron masaüstü ve Telegram girişlerinden çalışır. Ayrı bir bulut backend'i yoktur; model çağrıları, tarayıcı, MCP ve Telegram gibi dış bağlantılar kullanıcı tarafından yapılandırılır.

3.1'in odağı dört başlıktır:

- **Odaklı ajan:** görev sözleşmesi, faz sırası, cerrahi okuma/yama ve gerçek doğrulama.
- **Token ekonomisi:** büyük araç çıktıları yerel artifact'lara taşınır; bağlam model profiline göre bütçelenir; prompt önbelleği korunur.
- **Sade arayüz:** OpenCode'un terminal estetiğinden ilham alan, tek vurgu rengi, monospace kod, düşük gürültü ve klavye öncelikli masaüstü/TUI.
- **Tek komut ve sınır katmanı:** CLI/TUI ve masaüstü aynı komut kataloğunu kullanır; kullanıcının açık “dokunma/çalıştırma” sınırları oturum boyunca saklanır ve araç çalışmadan önce uygulanır.

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

Betikler uzak `main` commitini geçici bir checkout'ta kilitli bağımlılıklarla derler, sürüm/yardım kontrolü yapar ve hazır tarball'ı global kurar. Derleme veya paketleme başarısızsa mevcut global CLI'ye dokunulmaz. Kurulumdan sonra:

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

Bu akış `release/T-Bot-Setup-3.1.0.exe` ve `release/build-manifest.json` üretir. Kurulum betiği yükleyicinin SHA256 değerini, çıkış kodunu, kurulan uygulamanın sürümünü ve `app.asar` SHA256 değerini denetler. Manifest ve yükleyiciyi birlikte saklayın. Yayımlama işlemi bu deponun sorumluluğunda değildir.

Geliştirme için:

```powershell
npm run desktop
```

## 3.1 ile gelenler

### Ajan çekirdeği

- Görev sözleşmesi ve üç veya daha fazla adımlı işlerde plan/todo disiplini.
- `locate → plan → act → verify → report` fazları; her fazda yalnızca uygun araçlar.
- `project_verify`: `package.json` içinde tanımlı `typecheck`, `lint`, `check` veya `test` script'lerini onayla çalıştırır; keyfi komut kabul etmez.
- Okuma-sonrası-yazma, revizyon kontrolü, atomik yama ve hata sonrası alternatif yaklaşım.
- Kullanıcının açık sınırları (`README.md` dosyasına dokunma, `npm test` çalıştırma, yalnızca belirli bir dosyayı değiştirme) oturum boyunca saklanır; araç onaya gitmeden önce yerel olarak reddedilir. Sınırlar yalnızca açık ifadelerden çıkarılır; “testleri unutma” gibi cümleler yanlış yorumlanmaz.
- CLI/TUI, masaüstü ve Telegram aynı komut kataloğunu kullanır; `/effort`, `/skills`, `/sessions`, `/resume`, `/imagegen`, `/gui`, `/mcp` ve `/bot` masaüstünde de çalışır. Desteklenmeyen komut sessizce yok sayılmaz, açıkça bildirilir.
- Görsel sağlayıcı, model kataloğu ve API anahtarı doğrulaması `host-services.ts` üzerinden iki yüzeyde ortaktır; özel uç nokta model listesi base URL'i korur.
- Küçük modeller için tek araç/tek adım modu, daraltılmış şema seti ve daha kısa bağlam bütçesi.

### Token ve bağlam

- 6 KB üzerindeki araç çıktıları `.tbot/artifacts/` altında saklanır; modele özet + `artifact_read` kimliği döner. Aynı içerik tekrar üretilirse aynı artifact kimliği kullanılır; disk ve bağlam şişmez.
- `context-budget.ts` model ailesine göre yerel geçmiş bütçesi, tur ve araç limitleri belirler.
- Sistem prompt'u İngilizce ve kararlı; yanıt dili kullanıcının diliyle eşleşir.
- Prompt sırası önbellek dostudur: güvenlik → görev → beceriler → repo haritası → bellek → odak.
- Sağlayıcı `usage` değeri ile yerel tahmin ayrı raporlanır; tasarruf iddiası ölçümsüz sunulmaz.

### Arayüz

- Masaüstü: sade üç bölge (oturumlar, transcript, inspector), tek Tabit yeşili vurgu, emoji yok.
- `Run Spine`: gerçek araç olaylarından türetilen `Keşif → Plan → Uygulama → Doğrulama` düğümleri; aktif faz görünür.
- Masaüstü ve CLI'da `/plan`, `/plan apply`, `/ultracode` ve `/subagents` akışları; `/tokens`, `/memory`, `/remember`, `/forget` ve `/doctor` iki yüzeyde de çalışır.
- Browser Use, Computer Use ve arka plan geliştirme sunucuları için araç yönergeleri.
- Kapalı araç kartlarında DOM üretilmez; büyük geçmiş 40 kayıtla sınırlıdır.
- Komut paleti `Ctrl+K`; `Esc` durdur; `Enter` gönder.
- Animasyonlar yalnızca opacity/transform ve 120–160 ms; `prefers-reduced-motion` tümünü kapatır.
- TUI paleti aynı grafit/Tabit yeşili dile taşındı.

### Güvenlik

- Gizli anahtarlar Windows'ta DPAPI + kullanıcıya özel ACL ile saklanır; alt süreç ortamından sır adları çıkarılır.
- Açık kullanıcı sınırları model talimatından bağımsız olarak araç çağrısı katmanında uygulanır; kabuk üzerinden korunan bir dosyaya yazma denemesi de reddedilir. Bu, eksiksiz bir OS sandbox değildir.
- Kabuk, dosya yazma, GUI, URL indirme ve doğrulama komutları varsayılan olarak onay ister.
- Hassas yollar okumada onaya, yazmada redde tabidir.
- Web/MCP/tool içeriği güvenilmeyen kanıt olarak işaretlenir; prompt injection için kesin garanti değildir.
- Kabuk gerçek kullanıcı izinleriyle çalışır. OS sandbox yoktur; süreç ağacı, ortam filtresi ve onay sınırı uygulanır.

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
- 3.1 kaynak doğrulaması: **224 test, 0 hata/atlama**, typecheck ve build başarılı. Ayrıntılar [doğrulama kaydında](docs/verification.md).
- “Dünya #1” veya rakiplere göre %50–75 tasarruf iddiası bu depoda bağımsız benchmark olmadan kanıtlanmış sayılmaz. Ölçülebilir hedef, aynı fixture setinde 2.2.1'e göre daha az bağlam göndermektir.
- TypeScript/JavaScript ve JSON kontrolleri tüm diller için doğrulama garantisi değildir.
- Gizli anahtar redaksiyonu sezgiseldir; bilinmeyen biçimleri yakalama garantisi yoktur.
- Windows dışı masaüstü kontrolü vaat edilmez.

## Üçüncü taraf bileşenler

OpenCode'un sabit commit'ten uyarlanmış Unicode düzenleme eşleştirme/satır sonu koruma yordamları ve Hermes Agent'ın token bütçesine göre bağlam penceresi planlaması kullanılır. Bunlar MIT lisanslı bileşen uyarlamalarıdır; upstream çalışma zamanının tamamı veya fork geçmişi taşınmaz. Kaynaklar, commit'ler ve lisans metinleri [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) ve [THIRD_PARTY_DEPENDENCIES.md](THIRD_PARTY_DEPENDENCIES.md) dosyalarındadır.

Ayrıntılar: [Mimari](docs/architecture.md), [Kurulum](docs/install.md), [Doğrulama](docs/verification.md), [Rakiplik boşluk matrisi](docs/competitor-gaps.md), [Lisans](LICENSE).
