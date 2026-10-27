![T Bot logosu](assets/tabit.webp)

# T Bot 2.0

> **Tri-Core Local AI Coding Agent, Autonomous Desktop Agent & Zero-Backend Telegram Bot Gateway with 50%–75% Token Savings and Deterministic Anti-Hallucination**

T Bot 2.0; terminalinizde çalışan, çoklu model sağlayıcılarıyla (Gemini, OpenAI, Anthropic, OpenRouter, yerel Ollama/LM Studio) uyumlu, yeni nesil yerel bir yapay zekâ ajanıdır. Üçlü çekirdek (Tri-Core) mimarisiyle kodlama projelerinizi yönetir, masaüstü ve tarayıcı işlemlerini otonom gerçekleştirir ve sıfır arka uç altyapısıyla Telegram üzerinden cep telefonunuzdan uzaktan yönetilebilir.

---

## ⚡ Tek Komutla Uzaktan Terminal Kurulumu

T Bot 2.0'ı uzaktan terminal yoluyla tek komutla sıfır hatayla anında kurabilirsiniz:

### Windows (PowerShell)
```powershell
irm https://raw.githubusercontent.com/egemenkrdsek-boop/t-bot/main/scripts/install.ps1 | iex
```

### Linux & macOS (Bash / Sh)
```bash
curl -fsSL https://raw.githubusercontent.com/egemenkrdsek-boop/t-bot/main/scripts/install.sh | sh
```

### Doğrudan npm ile Global Kurulum
```bash
npm install --global git+https://github.com/egemenkrdsek-boop/t-bot.git
```

> [!TIP]
> Kurulum scriptleri Node.js >= 20.3, npm ve Git kontrollerini otomatik yapar, PATH değişkeninizi senkronize eder ve `tbot --help` doğrulamasını tamamlar. Ayrıntılı adımlar için [Kurulum Kılavuzuna](docs/install.md) bakın.

---

## 🏛️ Üçlü Çekirdek (Tri-Core) Mimarisi

T Bot 2.0, üç özelleşmiş özerk çekirdeğin entegrasyonuyla çalışır:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                 T BOT 2.0                                   │
├───────────────────────┬─────────────────────────────┬───────────────────────┤
│  1. KODLAMA AJANI     │  2. OTONOM MASAÜSTÜ AJANI   │  3. TELEGRAM GATEWAY  │
│  • file_outline       │  • Çok Adımlı /goal         │  • Sıfır-Backend      │
│  • Multi-Hunk Patch   │  • Paralel /subagents       │  • Long-Polling       │
│  • Tam Git Seti       │  • Kalıcı Bellek (.tbot/)   │  • Uzaktan Kontrol    │
│  • process_* Kontrolü │  • Ultra Hızlı Win DLL      │  • Mobil Ekran Görüntü│
│  • 4 Aşamalı Ultracode│  • Playwright & /imagegen   │  • Mobil Buton Onayı  │
└───────────────────────┴─────────────────────────────┴───────────────────────┘
```

### 1. Üstün Yerel Kodlama Ajanı (Elite Coding Agent)
* **Sembol Haritalama (`file_outline`):** Büyük kod tabanlarında gereksiz token tüketmeden sınıfları, fonksiyonları, arayüzleri ve başlıkları satır numaralarıyla çıkarır.
* **Multi-Hunk Yama (`file_patch`):** Tüm dosyayı baştan yazmak yerine tam bağlam eşleşmeli parçalı yamalar uygular.
* **Tam Git Araç Seti:** `git_status`, `git_diff`, `git_log`, `git_commit`, `git_branch`, `git_push` ile güvenli sürüm kontrolü.
* **Arka Plan Süreç Yöneticisi:** `process_list`, `process_output`, `process_kill` ve `shell` (background: true) ile dev sunucularını ve test süreçlerini kesintisiz izler.
* **4 Aşamalı Öz-Onarımlı `Ultracode` (`/ultracode`):**
  1. *Derin Paralel Araştırma:* Proje mimarisini ve bağımlılıkları haritalar.
  2. *Grounded Uygulama:* Read-Before-Write prensibiyle atomik değişiklikleri hayata geçirir.
  3. *AST & Sözdizimi Öz-Onarımı:* Ayrıştırıcı hatalarını tespit edip otomatik rollback ve telafi adımları uygular.
  4. *Bağımsız Salt-Okunur Denetim & İddia Doğrulaması:* Yapılan işleri bağımsız gözle denetler ve doğrular.

### 2. Otonom Masaüstü ve Genel Ajan (Autonomous Desktop Agent)
* **Çok Adımlı Hedef Yönetimi (`/goal`):** Karmaşık görevleri alt hedeflere böler, durumunu izler (`/goal status`, `/goal pause`, `/goal complete`).
* **Türkçe İsimli Paralel Alt Ajanlar (`/subagents`):** Araştırmacı ve analizci alt ajanları paralel çalıştırarak ana ajanın bağlamını kirletmeden bilgi toplar.
* **Proje ve Küresel Kalıcı Bellek (`.tbot/memory.json`):** `/remember <anahtar> = <değer>` ve hafıza araçlarıyla proje tercihlerini ve mimari kuralları oturumlar arasında hatırlar.
* **DLL Önbellekli Hızlı Windows Masaüstü Kontrolü:** C# / User32 API'lerini bellekte önbelleğe alarak fare, klavye, pencere yönetimi ve ekran görüntüsü almayı sıfır gecikmeyle yürütür.
* **İzole Playwright Tarayıcı:** Web sitelerinde gezinme, DOM denetimi, ekran görüntüsü ve form doldurma işlemleri.
* **Görsel Üretim (`/imagegen`):** DALL-E 3, Imagen 3 gibi modellerle doğrudan çalışma alanının `generated-images/` dizinine görsel üretir.

### 3. Sıfır-Backend Yerel Telegram Bot Ağ Geçidi (Zero-Backend Gateway)
* **Sıfır Altyapı:** Webhook, sabit IP veya aracı sunucu gerekmez; Telegram Bot API ile doğrudan yerel makinenizden güvenli Long-Polling yapar.
* **Mobil Uzaktan Yönetim (`/bot`, `--bot`):** Dışarıdayken veya masadan uzaktayken telefonunuzdan T Bot'a görev verin.
* **Ekran Görüntüsü ve Durum İzleme:** `/screenshot` ile bilgisayarınızın o anki ekranını Telegram'dan talep edin.
* **Mobil Onay Butonları:** Onay gerektiren kritik işlemler için (kod çalıştırma, dosya değiştirme) Telegram ekranınıza `[Evet]` / `[Hayır]` butonları gönderir ve onayınızı alır.

---

## 💎 %50–%75 Gerçek Token Tasarrufu Motoru

T Bot 2.0, API maliyetlerinizi ve gecikmelerinizi dramatik ölçüde azaltan özel bir optimizasyon motoruna sahiptir:

* **Sağlayıcı Düzeyinde Prompt Caching:** Anthropic Claude (`cache_control: ephemeral`), OpenAI sistem mesajı önbelleklemesi ve Gemini bağlam önbelleği tam desteklenir.
* **Niyet-Duyarlı Araç Şeması Budama (Intent-Aware Pruning):** İstek bağlamında ihtiyaç duyulmayan onlarca araç şemasını filtreleyerek LLM girdi boyutunu anında %60–%80 oranında küçültür.
* **Sembol İskeleti & Kanıt Sıkıştırma:** Dosya içerikleri yerine sembol taslakları ve bounded diff'ler kullanılarak bağlam penceresi korunur.
* **Canlı Token HUD & Raporlama (`/tokens`):** Oturum boyunca kullanılan ham tokenları, önbellek kazancını ve net tasarruf oranını anlık görüntüler.

---

## 🛡️ Deterministik Anti-Halüsinasyon Motoru

T Bot 2.0, LLM'lerin "yapmadığı işi yapmış gibi gösterme" ve "var olmayan dosyalarda değişiklik üretme" hatalarını deterministik koruma kapılarıyla engeller:

1. **Read-Before-Write İnvariantı:** Ajan bir dosyayı okumadan veya taslağını çıkarmadan (`file_read` / `file_outline`), o dosyayı asla değiştiremez veya yamayamaz (`file_write` / `file_patch`).
2. **Post-Write AST / Syntax Rollback Kapısı:** Yazılan her dosya (JSON, JS, TS, Python, YAML, HTML vb.) otomatik sözdizimi denetiminden geçer. Hata tespit edilirse dosya derhal önceki güvenli durumuna geri döndürülür (`rollback`) ve ajanın kendini onarması sağlanır.
3. **Claim-Evidence Doğrulaması:** Ajanın "kod derlendi" veya "testler başarılı oldu" iddiaları, gerçek komut çıktıları ve süreç kayıtları ile karşılaştırılır; kanıtsız başarı iddiaları engellenir.

---

## ⚡ Hafif RAM & CPU Bekçisi (`MemoryGuard`) ve Siber TUI

* **`MemoryGuard` & `/gc`:** Node.js bellek kullanımını (Heap & RSS) sürekli gözetler, bellek sızıntılarını önler. `/memory` ile anlık RAM kullanımını gösterir, `/gc` komutuyla çöp toplayıcıyı tetikler.
* **Siber-Minimalist TUI:** Braille animasyonlu canlı spinner, akış halinde renklendirilen diff'ler ve tek satırlık **Canlı HUD Çubuğu**:
  ```text
  [gemini-2.5-pro · normal+Ultra · YOLO · %68 Token Tasarrufu · 84MB RAM · 3/3 Grounded]
  ```

---

## 🚀 Kullanım ve CLI Seçenekleri

```text
tbot                              Etkileşimli Siber-Minimalist TUI oturumu
tbot "isteğiniz"                  Tek seferlik istek (CLI modu)
tbot -p <sağlayıcı> -m <model>    Bu oturum için sağlayıcı ve model seçimi
tbot -w <dizin>                   Çalışma dizini (workspace) seçimi
tbot sessions                     Kayıtlı oturumları listele
tbot --resume <id>                Oturuma devam et
tbot config                       Sağlayıcı ve API anahtarı yapılandırması
tbot providers                    Tüm desteklenen sağlayıcıları listele
tbot doctor                       Ortam ve sistem sağlığını denetle
tbot --effort <düzey>            Akıl yürütme düzeyi (low, medium, high, xhigh, max)
tbot --ultracode                 4 aşamalı öz-onarımlı Ultracode modunu aç
tbot --yolo                      Araç onaylarını bu oturumda otomatik ver
tbot --bot                       Sıfır-backend Telegram Bot ağ geçidini başlat
tbot --help                      Yardım kılavuzu
tbot --version                   Sürüm bilgisi (2.0.0)
```

### Terminal İçi Slash Komutları Kılavuzu

| Komut | Açıklama |
| :--- | :--- |
| `/help` | Komut menüsünü ve kullanım ipuçlarını listeler |
| `/status` | Canlı Siber HUD durum çubuğunu görüntüler |
| `/tokens` | Token tasarrufu, önbellek ve kullanım raporunu gösterir |
| `/memory` | Heap ve RSS RAM kullanımını denetler |
| `/gc` | Manuel bellek temizliği (Garbage Collection) yapar |
| `/remember <k> = <v>` | Projeye veya küresele kalıcı hafıza kuralı kaydeder |
| `/bot` | Telegram botu canlı durum ve bağlantı kontrolü |
| `/goal <hedef>` | Çok adımlı otonom hedef başlatır ve yönetir |
| `/plan <istek>` | Görevi adıma döker; `/plan apply` ile yürütür |
| `/subagents <istek>` | Paralel salt-okunur alt ajan araştırması başlatır |
| `/ultracode [on\|off]` | 4 aşamalı özerk kodlama modunu açar veya kapatır |
| `/yolo [on\|off]` | Araç onaylarını otomatik onaylama moduna alır |
| `/effort [düzey]` | Düşünme eforunu ayarlar (low, medium, high, xhigh, max) |
| `/provider`, `/model` | Sağlayıcı ve model seçim menüsünü açar |
| `/config`, `/auth` | Ayarları yapılandırır veya yeni API anahtarı girer |
| `/mcp` | Vercel, Supabase, GitHub MCP sunucularını yönetir |
| `/skills` | Yerleşik uzmanlık becerilerini listeler (`/frontenddesign`, vb.) |
| `/imagegen <istek>` | Görsel üretim modelini çağırır |
| `/clear` | Ekranı ve oturum geçmişini sıfırlar |
| `/exit`, `/quit` | T Bot'tan güvenle ayrılır |

---

## 🔌 MCP (Model Context Protocol) Desteği

Etkileşimli oturumda `/mcp` menüsünden bulut araçlarınızı kolayca bağlayabilirsiniz:
* **Vercel:** Projeleri listeleme, önizleme ve üretim dağıtımı oluşturma (`create_deployment`).
* **Supabase:** Projeleri yönetme, SQL yürütme ve Edge Function dağıtımı (`deploy_edge_function`).
* **GitHub:** Depo yönetimi, branch oluşturma, pull request açma ve kod arama.

---

## 🔒 Güvenlik ve Gizlilik

* **Korumalı Anahtar Saklama:** Windows'ta API anahtarları işletim sistemi düzeyinde DPAPI ile şifrelenir. Linux/macOS ortamında kısıtlanmış dosya izinleriyle saklanır.
* **Onay Mekanizması:** Dosya değişiklikleri ve kabuk komutları varsayılan olarak kullanıcı onayı ister; istem dışı zararlı işlemler engellenir.
* **İzole Çalışma Alanı:** Çalışma alanı (`workspace`) sınırları gözetilir; tarayıcı izole Chromium profilinde çalışır.

---

## 📄 Lisans

Bu proje [MIT Lisansı](LICENSE) altında dağıtılmaktadır. Üçüncü taraf bildirimleri için [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) dosyasına bakın.
