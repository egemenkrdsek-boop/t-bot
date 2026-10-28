# T Bot 2.0 Kurulum ve Yapılandırma Kılavuzu

Bu kılavuz; T Bot 2.0'ın (OpenCode + Hermes Sentezi, Crystal-Ice Cyber-Zen TUI) Windows, macOS ve Linux işletim sistemlerinde tek komutla uzaktan terminal kurulumunu, kaynak kodundan derlenmesini, ilk yapılandırma adımlarını ve Telegram Bot ağ geçidi kurulumunu içerir.

---

## Sistem Gereksinimleri

| Bileşen | Minimum Sürüm | Açıklama |
| :--- | :--- | :--- |
| **Node.js** | `>= 20.3.0` | Node.js 20 LTS veya 22 LTS önerilir |
| **npm** | `>= 9.0.0` | Node.js ile birlikte gelir |
| **Git** | `>= 2.30.0` | Depoyu klonlamak ve sürümleri yönetmek için |
| **İşletim Sistemi** | Windows 10/11, macOS (Apple Silicon / Intel), Linux (Ubuntu, Debian, Fedora, Arch vb.) |

---

## 1. Tek Komutla Uzaktan Terminal Kurulumu (Önerilen)

T Bot 2.0, herhangi bir ön yapılandırmaya gerek kalmadan terminalinizden tek bir satırla kurulabilir. Betikler ortamınızı denetler, eksik bağımlılıklar hakkında rehberlik sunar, kullanıcı `PATH` değişkeninizi kalıcı olarak yapılandırır ve T Bot'u global olarak kurar.

### Windows (PowerShell)
PowerShell terminalinizi açın ve şu komutu yapıştırın:

```powershell
irm https://raw.githubusercontent.com/egemenkrdsek-boop/t-bot/main/scripts/install.ps1 | iex
```

> [!NOTE]
> Betik; UTF-8 konsol kodlamasını ayarlar, Node.js >= 20.3, npm ve Git denetimi yapar, `npm install -g --force` ile çakışmasız kurulum sağlar, global npm bin dizinini hem mevcut oturuma hem de kalıcı kullanıcı (`User`) `PATH` ortam değişkenine kaydeder ve `tbot --help` doğrulamasını çalıştırır.

### Linux ve macOS (Bash / Sh)
Terminalinizi açın ve şu komutu çalıştırın:

```bash
curl -fsSL https://raw.githubusercontent.com/egemenkrdsek-boop/t-bot/main/scripts/install.sh | sh
```

> [!TIP]
> Linux/macOS ortamında npm global dizinine yazma izni (EACCES) sorunu yaşarsanız, `npm config set prefix ~/.npm-global` yapılandırmasını yapabilir veya `sudo npm install -g --force git+https://github.com/egemenkrdsek-boop/t-bot.git` komutunu kullanabilirsiniz.

### Doğrudan npm ile Global Kurulum
Dilerseniz doğrudan npm aracılığıyla da kurabilirsiniz:

```bash
npm install -g git+https://github.com/egemenkrdsek-boop/t-bot.git
```

### Kurulum Yapmadan Doğrudan Çalıştırma (npx)
Sisteminize global kurulum yapmadan anında çalıştırmak için:

```bash
npx github:egemenkrdsek-boop/t-bot
```

> [!IMPORTANT]
> T Bot 2.0'da derlenmiş `dist/` klasörü depoda hazır bulunduğu ve `package.json` içindeki `bin` (`tbot`, `t-bot`, `t-bot-cli`) ve `prepare` tanımları korumalı çalıştığı için, üretim ortamlarında (`--omit=dev`) TypeScript derleyicisi (`tsc`) bulunmasa bile hem `npm install -g` hem de `npx github:egemenkrdsek-boop/t-bot` sıfır hatayla anında çalışır.

---

## 2. Kaynak Kodundan Kurulum ve Geliştirme

T Bot üzerinde geliştirme yapmak veya projeyi yerel olarak derlemek için:

```bash
# 1. Depoyu Klonlayın
git clone https://github.com/egemenkrdsek-boop/t-bot.git
cd t-bot

# 2. Bağımlılıkları Yükleyin
npm ci

# 3. Tip Kontrolü ve TypeScript Derlemesi
npm run typecheck
npm run build

# 4. Global Olarak Kurun
npm install -g .
```

Geliştirme modunda anlık çalıştırmak için:
```bash
npm run dev
```

---

## 3. Mimari Özellikler ve Yerleşik Araçlar Özeti

Kurulumla birlikte aşağıdaki yeni nesil yetenekler ve araçlar doğrudan aktif olur:
* **Açık Renk Kristal Logo & Cyber-Zen TUI:** Parlak beyaz ve cam göbeği (Crystal-Ice) renk paleti, canlı HUD çubuğu ve diferansiyel diff görünümü.
* **Gerçek TypeScript AST + Çapraz Dosya Sembol/Paket Doğrulama:** `ts.createSourceFile` ile tam AST ayrıştırma, bozuk kodda anında otomatik rollback, göreli importlarda sembol ihracı (`export`) doğrulaması ve `package.json` bağımlılık kontrolü.
* **Diferansiyel Okuma Önbelleği ve %67+ Token Tasarrufu:** Değişmeyen dosyaları tekrar göndermeyen SHA-256 diferansiyel önbellek ve niyet-duyarlı araç şeması budama.
* **Zengin Araç Seti:**
  - Dosya & Kod: `file_read`, `file_write`, `file_patch`, `file_outline`, `file_glob`, `file_search`, `file_list`
  - Kabuk & Süreç: `shell`, `process_list`, `process_output`, `process_write`, `process_stop`
  - Ağ & Web: `web_search`, `url_fetch`
  - Tarayıcı (Playwright): `browser_open`, `browser_inspect`, `browser_click`, `browser_type`, `browser_scroll`, `browser_press`, `browser_hover`, `browser_evaluate`, `browser_tabs`, `browser_screenshot`
  - Masaüstü: `computer` (Win32 DLL önbellekli fare, klavye, ekran görüntüsü ve pencere kontrolü)
  - Görev & Hedef: `todo_manage`, `goal_manage`, `delegate_task`
  - Bellek & Evrim: `memory_save`, `memory_recall`, `memory_forget`, `skill_create`, `skill_list`
  - Görsel & Git: `image_generate`, `git_*` (`git_status`, `git_diff`, `git_log`, `git_add`, `git_commit`, `git_branch`, `git_push`)

---

## 4. İlk Yapılandırma ve Sağlayıcı Ayarları

Kurulum tamamlandıktan sonra terminalde etkileşimli yapılandırmayı başlatın:

```bash
tbot config
```

### Desteklenen Model Sağlayıcıları
1. **Google Gemini (`gemini`):** `gemini-2.5-pro`, `gemini-2.5-flash` vb. Hızlı, güçlü ve geniş bağlam penceresi.
2. **OpenAI (`openai`):** `gpt-4o`, `gpt-4o-mini`, `o1`, `o3-mini` vb.
3. **Anthropic (`anthropic`):** `claude-3-7-sonnet-20250219`, `claude-3-5-sonnet` vb. Doğal Prompt Caching destekli.
4. **OpenRouter (`openrouter`):** Yüzlerce açık ve kapalı kaynak modele tek anahtarla erişim (DeepSeek-R1, Llama 3.3, Qwen vb.).
5. **Yerel Sunucular (Ollama / LM Studio):** Tamamen çevrimdışı ve ücretsiz yerel LLM çalıştırma.

Tüm desteklenen sağlayıcı listesini görmek için:
```bash
tbot providers
```

### API Anahtarı Saklama ve Güvenlik
* **Windows:** Yeni girilen API anahtarları kullanıcı kimliğine bağlı olarak Windows **DPAPI (Data Protection API)** ile şifrelenir.
* **Linux / macOS:** Anahtarlar `~/.config/TBot/secrets.json` altında sadece mevcut kullanıcının okuyabileceği kısıtlı dosya izinleriyle tutulur.
* **Ortam Değişkenleri:** Dilerseniz anahtarları ortam değişkeni olarak da tanımlayabilirsiniz:
  - `GEMINI_API_KEY`
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `OPENROUTER_API_KEY`
  - Ortak yedek: `TBOT_API_KEY`

---

## 5. Sıfır-Backend Yerel Telegram Bot Kurulumu

T Bot 2.0; harici bir sunucu, port yönlendirme veya ters tünel (ngrok/cloudflare) gerektirmeden, doğrudan yerel makineniz üzerinden Telegram Bot API'ye Long-Polling ile bağlanır.

### Adım 1: Bot Tokenı Alma
1. Telegram'da [@BotFather](https://t.me/BotFather) botunu açın.
2. `/newbot` komutunu verin ve yönergeleri izleyerek botunuza bir ad ve kullanıcı adı verin.
3. BotFather'ın size verdiği `HTTP API token` metnini kopyalayın.

### Adım 2: Token ve Yetkilendirme Yapılandırması
Terminalinizde ortam değişkenini belirleyin veya `.env` dosyasına ekleyin:

```bash
# Telegram Bot Tokenı
export TELEGRAM_BOT_TOKEN="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"

# Güvenlik: Yalnızca sizin sohbet kimliğinizin bota erişmesine izin verin
export TELEGRAM_ALLOWED_CHATS="123456789"
```

*(Windows PowerShell için: `$env:TELEGRAM_BOT_TOKEN="..."; $env:TELEGRAM_ALLOWED_CHATS="..."`)*

### Adım 3: Botu Başlatma
Terminalden doğrudan bot modunda başlatmak için:
```bash
tbot --bot
```

Veya etkileşimli TUI açıkken `/bot` yazarak botun durumunu ve bağlantısını kontrol edebilirsiniz.

Telefondan Telegram botunuza mesaj yazdığınızda:
* İstemleriniz doğrudan yerel T Bot ajanı tarafından işlenir.
* `/screenshot` yazdığınızda bilgisayarınızın masaüstü ekran görüntüsü Telegram'a gelir.
* Onay gerektiren komut veya dosya değişikliklerinde Telegram'dan anlık `[Evet]` / `[Hayır]` onay butonları gönderilir.

---

## 6. Güncelleme ve Kaldırma

### Güncelleme
En son sürümdeki yenilikleri almak için kurulum komutunu tekrar çalıştırmanız yeterlidir:

**Windows:**
```powershell
irm https://raw.githubusercontent.com/egemenkrdsek-boop/t-bot/main/scripts/install.ps1 | iex
```

**Linux / macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/egemenkrdsek-boop/t-bot/main/scripts/install.sh | sh
```

**npm ile:**
```bash
npm install -g --force git+https://github.com/egemenkrdsek-boop/t-bot.git
```

### Kaldırma
```bash
npm uninstall -g t-bot-cli
```

---

## 7. Sorun Giderme (FAQ)

### S: `tbot` Komutu Tanınmıyor / Bulunamadı
* **Cevap:** npm global ikili klasörü işletim sisteminizin `PATH` çevre değişkeninde yer almıyor olabilir.
  - Windows'ta: `install.ps1` betiği `%APPDATA%\npm` dizinini kullanıcı `PATH` değişkenine kalıcı olarak ekler; yeni bir terminal penceresi açmanız yeterlidir.
  - Linux/macOS'ta: `export PATH="$(npm prefix -g)/bin:$PATH"` satırını `~/.bashrc` veya `~/.zshrc` dosyanıza ekleyin.

### S: Kurulum Sırasında `EACCES: permission denied` Hatası Alıyorum
* **Cevap:** Linux veya macOS'ta global npm dizinine yazma yetkisi gerekebilir:
  `sudo npm install -g --force git+https://github.com/egemenkrdsek-boop/t-bot.git`
  veya npm belgelerine uygun olarak global prefix'inizi ev dizininize yönlendirin.

### S: Sağlayıcıdan `401 Unauthorized` Hatası Alıyorum
* **Cevap:** Girdiğiniz API anahtarı geçersiz, eksik veya süresi dolmuş olabilir. T Bot oturumunda `/auth` yazarak yeni anahtarı doğrudan girebilir veya `tbot config` ile ayarları tazeleyebilirsiniz.

### S: Sistem Sağlığını Nasıl Kontrol Edebilirim?
* **Cevap:** Terminalde `tbot doctor` komutunu çalıştırarak Node sürümünüzü, çalışma ortamınızı, yapılandırma dosya yolunu ve kayıtlı anahtar durumunu tek ekranda inceleyebilirsiniz.
