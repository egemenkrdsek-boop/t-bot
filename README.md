![T Bot Logosu](assets/tabit.webp)

# T Bot 2.0

> **Tri-Core Local AI Coding Agent, Autonomous Desktop Agent & Zero-Backend Telegram Bot Gateway with 50%–75% Token Savings and Deterministic Anti-Hallucination**

T Bot 2.0; terminalinizde çalışan, çoklu model sağlayıcılarıyla (Gemini, OpenAI, Anthropic, OpenRouter, yerel Ollama/LM Studio) uyumlu, OpenCode + Hermes sentezli yeni nesil yerel bir yapay zekâ ajanıdır. Üçlü çekirdek (Tri-Core) mimarisiyle kodlama projelerinizi yönetir, masaüstü ve tarayıcı işlemlerini otonom gerçekleştirir ve sıfır arka uç altyapısıyla Telegram üzerinden cep telefonunuzdan uzaktan yönetilebilir.

---

## Tek Komutla Uzaktan Terminal Kurulumu

T Bot 2.0'ı uzaktan terminal yoluyla tek komutla sıfır hatayla anında kurabilir veya doğrudan çalıştırabilirsiniz:

### Windows (PowerShell)
```powershell
irm https://raw.githubusercontent.com/egemenkrdsek-boop/t-bot/main/scripts/install.ps1 | iex
```

### Linux ve macOS (Bash / Sh)
```bash
curl -fsSL https://raw.githubusercontent.com/egemenkrdsek-boop/t-bot/main/scripts/install.sh | sh
```

### Doğrudan npm ile Global Kurulum
```bash
npm install -g git+https://github.com/egemenkrdsek-boop/t-bot.git
```

### Kurulum Yapmadan Anında Çalıştırma (npx)
```bash
npx github:egemenkrdsek-boop/t-bot
```

> [!TIP]
> Kurulum scriptleri Node.js >= 20.3, npm ve Git kontrollerini otomatik yapar, kullanıcı `PATH` ortam değişkeninizi kalıcı olarak senkronize eder ve `tbot --help` doğrulamasını tamamlar. Ayrıntılı adımlar için [Kurulum Kılavuzuna](docs/install.md) bakın.

---

## Üçlü Çekirdek (Tri-Core) Mimarisi

T Bot 2.0, üç özelleşmiş özerk çekirdeğin entegrasyonuyla çalışır:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                 T BOT 2.0                                   │
├───────────────────────┬─────────────────────────────┬───────────────────────┤
│  1. KODLAMA AJANI     │  2. OTONOM MASAÜSTÜ AJANI   │  3. TELEGRAM GATEWAY  │
│  • file_outline/glob  │  • Çok Adımlı /goal         │  • Sıfır-Backend      │
│  • Multi-Hunk Patch   │  • delegate_task Alt Ajan   │  • Long-Polling       │
│  • Gerçek TS AST      │  • skill_create & Bellek    │  • Uzaktan Kontrol    │
│  • process_stop/list  │  • Ultra Hızlı Win DLL      │  • Mobil Ekran Görüntü│
│  • 4 Aşamalı Ultracode│  • browser_fill & /imagegen │  • Mobil Buton Onayı  │
└───────────────────────┴─────────────────────────────┴───────────────────────┘
```

### 1. Üstün Yerel Kodlama Ajanı (Elite Coding Agent — OpenCode Sentezi)
* **Hızlı Glob ve Sembol Haritalama (`file_glob`, `file_outline`, `code_search`):** Büyük kod tabanlarında gereksiz token tüketmeden dosya ağacını tarar; sınıfları, fonksiyonları, arayüzleri ve başlıkları satır numaralarıyla çıkarır.
* **Diferansiyel Okuma Önbelleği (`file_read`):** SHA-256 tabanlı diferansiyel okuma önbelleği sayesinde değişmemiş dosyaları tekrar tekrar modele göndermez (`[UNCHANGED_SINCE_LAST_READ]`), yalnızca değişen satırların özetini aktarır.
* **Atomik Yazma ve Multi-Hunk Yama (`file_write`, `file_patch`):** Tüm dosyayı baştan yazmak yerine tam bağlam eşleşmeli parçalı yamalar uygular.
* **Tam Git Araç Seti:** `git_status`, `git_diff`, `git_log`, `git_commit`, `git_branch`, `git_push` ile güvenli sürüm kontrolü.
* **Arka Plan Süreç Yöneticisi:** `process_list`, `process_output`, `process_stop` ve `shell` (`background: true`) ile dev sunucularını ve test süreçlerini kesintisiz izler ve sonlandırır.
* **4 Aşamalı Öz-Onarımlı `Ultracode` (`/ultracode`):**
  1. *Derin Paralel Araştırma:* Proje mimarisini ve bağımlılıkları haritalar.
  2. *Grounded Uygulama:* Read-Before-Write prensibiyle atomik değişiklikleri hayata geçirir.
  3. *Gerçek TypeScript AST ve Sözdizimi Öz-Onarımı:* Ayrıştırıcı hatalarını tespit edip otomatik rollback ve telafi adımları uygular.
  4. *Bağımsız Salt-Okunur Denetim ve İddia Doğrulaması:* Yapılan işleri bağımsız gözle denetler ve doğrular.

### 2. Otonom Masaüstü ve Öz-Evrimleşen Ajan (Autonomous Agent — Hermes Sentezi)
* **Çok Adımlı Hedef Yönetimi (`/goal`, `goal_manage`):** Karmaşık görevleri alt hedeflere böler, durumunu izler (`/goal status`, `/goal pause`, `/goal complete`).
* **Otonom Görev Devri ve Paralel Alt Ajanlar (`delegate_task`, `/subagents`):** Ana ajan, karmaşık araştırma veya doğrulama işlerini kendi kendine Türkçe isimli paralel alt ajanlara (`delegate_task`) devrederek ana bağlam penceresini temiz tutar.
* **Öz-Evrimleşen Beceri Sistemi (`skill_create`, `skill_list`, `/skills`):** Ajan çözdüğü karmaşık iş akışlarını `.tbot/skills/<isim>/SKILL.md` altında kalıcı beceriye dönüştürür ve gelecekteki oturumlarda otomatik kullanır.
* **Proje ve Küresel Kalıcı Bellek (`memory_save`, `memory_recall`, `memory_forget`):** `/remember <anahtar> = <değer>` ve hafıza araçlarıyla proje tercihlerini ve mimari kuralları oturumlar arasında hatırlar veya unutur.
* **DLL Önbellekli Hızlı Windows Masaüstü Kontrolü:** C# / User32 API'lerini bellekte önbelleğe alarak fare, klavye, pencere yönetimi ve ekran görüntüsü almayı sıfır gecikmeyle yürütür.
* **İzole Playwright Tarayıcı (`browser_open`, `browser_click`, `browser_type`, `browser_fill`, `browser_evaluate`, `browser_screenshot`):** Web sitelerinde gezinme, DOM denetimi, ekran görüntüsü ve hızlı form doldurma (`browser_fill`) işlemleri.
* **Görsel Üretim (`/imagegen`, `image_generate`):** DALL-E 3, Imagen 3 gibi modellerle doğrudan çalışma alanının `generated-images/` dizinine görsel üretir.

### 3. Sıfır-Backend Yerel Telegram Bot Ağ Geçidi (Zero-Backend Gateway)
* **Sıfır Altyapı:** Webhook, sabit IP veya aracı sunucu gerekmez; Telegram Bot API ile doğrudan yerel makinenizden güvenli Long-Polling yapar.
* **Mobil Uzaktan Yönetim (`/bot`, `--bot`):** Dışarıdayken veya masadan uzaktayken telefonunuzdan T Bot'a görev verin.
* **Ekran Görüntüsü ve Durum İzleme:** `/screenshot` ile bilgisayarınızın o anki ekranını Telegram'dan talep edin.
* **Mobil Onay Butonları:** Onay gerektiren kritik işlemler için (kod çalıştırma, dosya değiştirme) Telegram ekranınıza `[Evet]` / `[Hayır]` butonları gönderir ve onayınızı alır.

---

## Dünya #1 Canlı Görsel Tarayıcı (Browser Use) & Masaüstü GUI (Computer Use)

T Bot 2.0; pikselleri ve UI ağaçlarını anlayan, ekranda insan gibi gezinip işlem yapabilen, canlı geri bildirim döngüsüne sahip gelişmiş bir görsel otomasyon motoru içerir:

* **Doğrudan Ekranı Görme (Multimodal Vision):** Multimodal LLM'ler (Gemini, Claude, GPT-4o) ekranı ve web sayfalarını doğrudan insan gözüyle görür. Her eylemin (tıklama, yazma, kısayol vb.) ardından sistem **otomatik olarak işaretli ekran görüntüsü doğrulaması** gerçekleştirir ve görsel teyit alarak bir sonraki adıma geçer (Closed-Loop Autonomous Feedback).
* **Windows UI Automation (`[u1]`, `[u2]` Semantik Ağacı + `target`):** Ekrandaki pencereleri, butonları, menüleri ve giriş kutularını semantik düzeyde ayrıştırır. Ajan doğrudan `target: "u1"` parametresiyle piksellerle uğraşmadan nokta atışı tıklar, çift tıklar veya metin yazar.
* **Koordinat Cetveli & Hedef Nişangahı (`⊕`):** Alınan her masaüstü ekran görüntüsüne 50px aralıklı floresan koordinat cetveli ve son tıklanan noktaya net bir hedef nişangahı (`⊕`) basılır; böylece ajan ve kullanıcı yapılan eylemi pikseller seviyesinde anında doğrular.
* **Canlı Görünür Tarayıcı (`headless: false` varsayılan):** Playwright tarayıcısı arka planda gizli kalmak yerine kullanıcının gözü önünde canlı açılır. Yapılan her tıklama ve metin girişinde sayfa üzerinde **Neon Tıklama/Yazma Hedef Halkası** parıldar ve sayfanın en üstünde canlı durum kontrol çubuğu enjekte edilir.
* **Ekran Üstü Siber-Zen Masaüstü HUD Penceresi:** Masaüstü kontrolü çalışırken ekranın köşesinde yarı şeffaf Cyber-Zen Masaüstü HUD penceresi (`[⏹ DURDUR]` butonu ile) aktif kalarak kullanıcının kontrolü elinde tutmasını sağlar.
* **3 Katmanlı Donanımsal & Yazılımsal Acil Durdurma (Fail-Safe Kill-Switch):**
  1. *Ekran Üstü HUD:* Masaüstü HUD penceresindeki `[⏹ DURDUR]` butonuna tek tık.
  2. *Global Klavye Kısayolu:* Herhangi bir anda `F12` veya `ESC` tuşuna basarak anında dondurma.
  3. *Fail-Safe Köşe Koruması:* Fareyi fiziksel olarak ekranın sol-üst köşesine `(0, 0)` çekmek tüm GUI döngüsünü donanımsal olarak durdurur.
  4. *Terminal Komutu:* `/gui live | headless | stop` ile canlı/arka plan modunu değiştirin veya anında acil durdurma tetikleyin.

---

## Yerleşik Araçlar (Built-in Tools) Tablosu

| Kategori | Araç İsimleri | Açıklama |
| :--- | :--- | :--- |
| **Dosya & Kod** | `file_read`, `file_write`, `file_patch`, `file_outline`, `file_glob`, `file_search`, `file_list` | Diferansiyel önbellekli okuma, atomik yama (`file_patch`), regex arama (`file_search`), dosya listeleme (`file_list`), hızlı glob ve AST sembol haritalama |
| **Kabuk & Süreç** | `shell`, `process_list`, `process_output`, `process_write`, `process_stop` | Komut yürütme, arka plan süreçlerini izleme, süreç girdisi yazma (`process_write`) ve güvenli süreç sonlandırma (`process_stop`) |
| **Ağ & Web** | `web_search`, `url_fetch` | Canlı internet araştırması ve web sayfası içeriğini temiz metin olarak ayrıştırma |
| **Tarayıcı (Playwright)** | `browser_open`, `browser_inspect`, `browser_click`, `browser_type`, `browser_scroll`, `browser_press`, `browser_hover`, `browser_evaluate`, `browser_tabs`, `browser_screenshot` | İzole Chromium profilinde gezinme, DOM analizi, sekme yönetimi, etkileşimli tıklama, kaydırma ve tam sayfa ekran görüntüsü |
| **Masaüstü & Sistem** | `computer` | Sıfır gecikmeli C# Win32 DLL önbellekli masaüstü kontrolü (ekran görüntüsü alma, fare/klavye kontrolü ve pencere yönetimi) |
| **Görev & Hedef** | `todo_manage`, `goal_manage`, `delegate_task` | Çok adımlı otonom hedef planlama, yapılacaklar listesi yönetimi ve paralel izole alt ajanlara görev devri |
| **Bellek & Evrim** | `memory_save`, `memory_recall`, `memory_forget`, `skill_create`, `skill_list` | Proje ve küresel kalıcı bellek yönetimi ile `.tbot/skills/` altında öz-evrimleşen kalıcı beceriler üretme |
| **Görsel Üretim** | `image_generate` | DALL-E 3 ve Imagen 3 modelleriyle doğrudan çalışma alanında görsel üretimi |
| **Git Sürüm Kontrol** | `git_status`, `git_diff`, `git_log`, `git_add`, `git_commit`, `git_branch`, `git_push` (`git_*`) | Tam kapsamlı yerel ve uzak Git operasyonları |

---

## %50–%75 Gerçek Token Tasarrufu Motoru

T Bot 2.0, API maliyetlerinizi ve gecikmelerinizi dramatik ölçüde azaltan özel bir optimizasyon motoruna sahiptir:

* **Sağlayıcı Düzeyinde Prompt Caching:** Anthropic Claude (`cache_control: ephemeral`), OpenAI sistem mesajı önbelleklemesi ve Gemini bağlam önbelleği tam desteklenir.
* **Diferansiyel Dosya Okuma Önbelleği (Differential Read Cache):** Aynı oturumda tekrar okunan dosyalar SHA-256 özetiyle karşılaştırılır; dosya değişmemişse tam metin yerine sıfır maliyetli referans özeti döndürülür.
* **Niyet-Duyarlı Araç Şeması Budama (Intent-Aware Pruning):** İstek bağlamında ihtiyaç duyulmayan araç şemalarını filtreleyerek LLM girdi boyutunu anında %60–%80 oranında küçültür.
* **Sembol İskeleti ve Kanıt Sıkıştırma:** Dosya içerikleri yerine sembol taslakları ve bounded diff'ler kullanılarak bağlam penceresi korunur.
* **Canlı Token HUD ve Raporlama (`/tokens`):** Oturum boyunca kullanılan ham tokenları, önbellek kazancını ve net tasarruf oranını anlık görüntüler.

---

## Deterministik Anti-Halüsinasyon Motoru

T Bot 2.0, LLM'lerin "yapmadığı işi yapmış gibi gösterme", "sözdizimi bozuk kod üretme" ve "var olmayan paket/sembol import etme" hatalarını deterministik koruma kapılarıyla engeller:

1. **Read-Before-Write İnvariantı:** Ajan bir dosyayı okumadan veya taslağını çıkarmadan (`file_read` / `file_outline`), o dosyayı asla değiştiremez veya yamayamaz (`file_write` / `file_patch`).
2. **Gerçek TypeScript AST (`ts.createSourceFile`) ve Sözdizimi Rollback Kapısı:** Yazılan her dosya (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.json`, `.py`, `.yaml`, `.html`) gerçek TypeScript derleyici AST ayrıştırıcısı ve sözdizimi denetiminden geçer. Sözdizimi hatası tespit edilirse dosya derhal önceki güvenli durumuna geri döndürülür (`rollback`) ve kesin satır/sütun tanısıyla ajanın kendini onarması sağlanır.
3. **Çapraz Dosya Sembol ve Paket Doğrulama (Cross-File & Package Grounding):** Yazılan kod içindeki göreli importların hedef dosyada gerçekten `export` edilip edilmediği ve dış paketlerin `package.json` içinde tanımlı olup olmadığı anında denetlenir; hayali (halüsinasyon) importlar engellenir.
4. **Claim-Evidence Doğrulaması:** Ajanın "kod derlendi" veya "testler başarılı oldu" iddiaları, gerçek komut çıktıları ve süreç kayıtları ile karşılaştırılır; kanıtsız başarı iddiaları engellenir.

---

## Açık Renk Kristal Logo, Cyber-Zen TUI ve `MemoryGuard`

* **Açık Renk Kristal (Crystal-Ice) Logo & Cyber-Zen TUI:** Göz yormayan parlak beyaz (`#FFFFFF`) ve kristal cam göbeği (`#67E8F9` / `#22D3EE`) renk paleti, 3D blok logo, Braille animasyonlu canlı spinner, akış halinde renklendirilen diff'ler ve tek satırlık **Canlı HUD Çubuğu**:
  ```text
  [gemini-2.5-pro · normal+Ultra · YOLO · %67 Token Tasarrufu · 84MB RAM · 3/3 Grounded]
  ```
* **`MemoryGuard` ve `/gc`:** Node.js bellek kullanımını (Heap & RSS) sürekli gözetler, bellek sızıntılarını önler. `/memory` ile anlık RAM kullanımını gösterir, `/gc` komutuyla çöp toplayıcıyı tetikler.

---

## Kullanım ve CLI Seçenekleri

```text
tbot                              Etkileşimli Crystal-Ice Cyber-Zen TUI oturumu
tbot "isteğiniz"                  Tek seferlik istek (CLI modu)
tbot -p <sağlayıcı> -m <model>    Bu oturum için sağlayıcı ve model seçimi
tbot -w <dizin>                   Çalışma dizini (workspace) seçimi
tbot sessions                     Kayıtlı oturumları listele
tbot --resume <id>                Oturuma devam et
tbot config                       Sağlayıcı ve API anahtarı yapılandırması
tbot providers                    Tüm desteklenen sağlayıcıları listele
tbot doctor                       Ortam ve sistem sağlığını denetle
tbot --effort <düzey>             Akıl yürütme düzeyi (low, medium, high, xhigh, max)
tbot --ultracode                  4 aşamalı öz-onarımlı Ultracode modunu aç
tbot --yolo                       Araç onaylarını bu oturumda otomatik ver
tbot --bot                        Sıfır-backend Telegram Bot ağ geçidini başlat
tbot --help                       Yardım kılavuzu
tbot --version                    Sürüm bilgisi (2.0.0)
```

### Terminal İçi Slash Komutları Kılavuzu

| Komut | Açıklama |
| :--- | :--- |
| `/help` | Komut menüsünü ve kullanım ipuçlarını listeler |
| `/status` | Canlı Siber HUD durum çubuğunu görüntüler |
| `/tokens` | Token tasarrufu, diferansiyel önbellek ve kullanım raporunu gösterir |
| `/memory` | Heap ve RSS RAM kullanımını denetler |
| `/gc` | Manuel bellek temizliği (Garbage Collection) yapar |
| `/remember <k> = <v>` | Projeye veya küresele kalıcı hafıza kuralı kaydeder |
| `/bot` | Telegram botu canlı durum ve bağlantı kontrolü |
| `/goal <hedef>` | Çok adımlı otonom hedef başlatır ve yönetir |
| `/plan <istek>` | Görevi adıma döker; `/plan apply` ile yürütür |
| `/subagents <istek>` | Paralel salt-okunur alt ajan araştırması başlatır |
| `/ultracode [on\|off]` | 4 aşamalı özerk kodlama modunu açar veya kapatır |
| `/yolo [on\|off]` | Araç onaylarını otomatik onaylama moduna alır |
| `/gui [live\|headless\|stop]` | Görsel tarayıcı ve masaüstü GUI modunu yönetir veya acil durdurma tetikler |
| `/effort [düzey]` | Düşünme eforunu ayarlar (low, medium, high, xhigh, max) |
| `/provider`, `/model` | Sağlayıcı ve model seçim menüsünü açar |
| `/config`, `/auth` | Ayarları yapılandırır veya yeni API anahtarı girer |
| `/mcp` | Vercel, Supabase, GitHub MCP sunucularını yönetir |
| `/skills` | Yerleşik ve öz-evrimleşen (`.tbot/skills/`) uzmanlık becerilerini listeler |
| `/imagegen <istek>` | Görsel üretim modelini çağırır |
| `/clear` | Ekranı ve oturum geçmişini sıfırlar |
| `/exit`, `/quit` | T Bot'tan güvenle ayrılır |

---

## MCP (Model Context Protocol) Desteği

Etkileşimli oturumda `/mcp` menüsünden bulut araçlarınızı kolayca bağlayabilirsiniz:
* **Vercel:** Projeleri listeleme, önizleme ve üretim dağıtımı oluşturma (`create_deployment`).
* **Supabase:** Projeleri yönetme, SQL yürütme ve Edge Function dağıtımı (`deploy_edge_function`).
* **GitHub:** Depo yönetimi, branch oluşturma, pull request açma ve kod arama.

---

## Güvenlik ve Gizlilik

* **Korumalı Anahtar Saklama:** Windows'ta API anahtarları işletim sistemi düzeyinde DPAPI ile şifrelenir. Linux/macOS ortamında kısıtlanmış dosya izinleriyle saklanır.
* **Onay Mekanizması:** Dosya değişiklikleri ve kabuk komutları varsayılan olarak kullanıcı onayı ister; istem dışı zararlı işlemler engellenir.
* **İzole Çalışma Alanı:** Çalışma alanı (`workspace`) sınırları gözetilir; tarayıcı izole Chromium profilinde çalışır.

---

## Lisans

Bu proje [MIT Lisansı](LICENSE) altında dağıtılmaktadır. Üçüncü taraf bildirimleri için [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) dosyasına bakın.
