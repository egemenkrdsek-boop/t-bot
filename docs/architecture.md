# Mimari ve kapsam

T Bot 5.0, 4.x'in yerel ajan çekirdeğini CLI/TUI, Electron masaüstü ve Telegram girişlerinden kullanır. Ayrı bir sunucu backend'i yoktur; dış model, tarayıcı, MCP ve Telegram bağlantıları kullanıcı yapılandırmasına bağlıdır. 5.0 diliminin ana değişikliği, niyet ve araç davranışını modele bırakmak yerine deterministik modüllere taşımaktır.

```text
CLI / TUI ─────┐
Desktop ───────┼──> Surfaces (sunum) ──> AgentRuntime ──> Providers
Telegram ──────┘                              │
                                              ├──> RequestBrief / TaskContract
                                              ├──> ContextEngine (repo map, LSP/TS, artifacts)
                                              ├──> ToolRuntime (registry, effect, pipeline, outcome)
                                              │       ├── Files / Shell / Git / Verify
                                              │       ├── TS diagnostics
                                              │       └── Browser / Computer / Web / MCP
                                              └──> Evidence / Grounding / Undo
                                                       │
                                      Session + Memory + Secrets + Checkpoints
```

## Katmanlar

| Katman | Kaynaklar | Sorumluluk |
| --- | --- | --- |
| Protokol ve tipler | `src/types.ts`, `src/context-budget.ts` | Ortak event, tool çağrısı, onay ve bütçe sözleşmeleri |
| Dil ve niyet çekirdeği | `src/core/lexicon.ts`, `src/core/request-brief.ts` | Türkçe/İngilizce cümle bölme, söz edimi, eylem/nesne/olumsuzlama çözümlemesi; model çağrısı yok |
| Model profili | `src/core/model-profile.ts` | `small`/`standard`/`reasoning` bütçeleri: tur, araç çağrısı, geçmiş, paralellik, dar araç yüzeyi |
| Çekirdek sözleşmeler | `src/core/task-contract.ts`, `src/core/phase-policy.ts`, `src/core/tool-effect.ts` | Görev sözleşmesi, faz/tamamlanma kapısı ve tek yan etki sınıflandırması; araç veya yüzey import etmez |
| Güvenlik ilkeleri | `src/security/` (`denylist`, `capabilities`, `taint`, `paths`, `url`, `env`, `sandbox`, `redact`) | Hassas dosya/desen listesi, yetenek, taint, yol/URL/ortam/sandbox sınırları; araç veya yüzey import etmez |
| Komut yüzeyi | `src/commands.ts` | Komut adları, kullanım, argüman kuralları ve yüzey desteği; CLI/TUI/masaüstü tek kaynak |
| Ortak host | `src/host-services.ts`, `src/turn-runner.ts` | Görsel sağlayıcı, model kataloğu, API anahtarı doğrulaması ve goal/plan/ultracode/subagent tur dağıtımı |
| Ajan | `src/agent.ts` | Tur döngüsü, faz disiplini, bağlam montajı, sentez ve hata kurtarma |
| Araç kayıt ve hattı | `src/tools/registry.ts`, `effect.ts`, `pipeline.ts`, `outcome.ts` | Tanım tekilleştirme, ortak yan etki sınıfı ve kanonikleştirme yardımcısı; faz/kısıt kapıları ile onay/dağıtım ajan ve araç dağıtıcısı katmanında |
| Araç modülleri | `src/tools/*.ts` | Dosya, kabuk, Git, doğrulama, tarayıcı, masaüstü, web, MCP |
| Bağlam | `src/token-optimizer.ts`, `src/context-window.ts`, `src/context-cache.ts`, `src/tools/artifacts.ts` | Şema budama, pencereleme, kanıt özeti, büyük çıktı artifact'ları |
| Doğrulama | `src/tools/verify.ts`, `src/tools/diagnostics.ts`, `src/grounding.ts`, `src/ast-validator.ts` | Proje script'leri, yerel TS tanılaması, sözdizimi ve iddia denetimi |
| Sağlayıcılar | `src/providers.ts`, `src/openai-responses.ts` | Streaming, tool-call protokolleri, usage, model yetenekleri |
| Kalıcı durum | `src/config.ts`, `src/secrets.ts`, `src/sessions.ts`, `src/memory.ts`, `src/checkpoints.ts` | Ayar, sır, oturum, bellek, dosya checkpoint'i |
| Masaüstü | `src/desktop/main.ts`, `preload.cjs`, `renderer/` | Electron yaşam döngüsü, dar IPC, izole renderer, oturum/onay UI |
| CLI/TUI | `src/index.ts`, `src/app.ts`, `src/tui.ts`, `src/theme.ts` | Argümanlar, terminal etkileşimi, durum satırı |
| Telegram | `src/bot.ts`, `src/telegram-security.ts` | Long polling, sohbet/kullanıcı yetkisi, uzak onay ve redaksiyon |

`npm run check:layers` bu yönü statik olarak denetler: `core/` ve `security/` üst katmanları import edemez, `tools/` yüzeyleri import edemez, Electron yalnızca `desktop/` içinde kullanılır. `tools/effect.ts` geriye uyum için `core/tool-effect.ts` modülünü yeniden dışa aktarır; sınıflandırmanın tek kaynağı `core` tarafıdır.

## Ajan turu

1. **Intake:** kullanıcı mesajı, görseller ve varsa beceri komutu alınır. `deriveBrief()` söz edimini (soru/emir/devam/sohbet), eylem türünü ve açık sınırları çıkarır; sonuç `TaskContract` ve prompt'a girer. Mesaj boyutu ve çalışma alanı doğrulanır.
2. **Locate:** repo haritası, `file_outline`, `file_search` ve `file_glob` ile hedef sembol bulunur. Arama hassas dosyaları atlar ve çıktıyı redakte eder.
3. **Plan:** üç veya daha fazla adım varsa `todo_manage` ile plan yazılır. `small` profilde tek araç/tek adım modu uygulanır.
4. **Act:** araç çağrısı `canonicalizeToolCall` ile tek kez kanonikleştirilir; yan etki sınıfı, faz, kullanıcı kısıtı, hassas yol ve taint kapılarından geçer, onaydan sonra yürütülür.
5. **Verify:** `project_verify` proje script'lerini onayla çalıştırır; çıktı tipli sonuç olarak ajana ve kullanıcıya döner. Son yazmadan sonra doğrulama yoksa "tamamlandı" denemez.
6. **Report:** nihai metin yalnızca araç kanıtına dayanır. Kanıtsız başarı iddiası grounding denetiminden geçmez.

## Araç hattı

```text
model çağrısı
  -> canonicalizeToolCall   (alias + argüman normalleştirme, tek tablo)
  -> registry               (isim çakışmasında tek tanım; yerel önce)
  -> şema doğrulama         (eksik/yanlış alan, eyleme dönük hata)
  -> effect sınıfı          (read | write | shell-write | shell-read | external | observe)
  -> faz / kısıt / hassas yol / taint kapıları
  -> onay                   (payload redakte edilerek gösterilir)
  -> yürütme
  -> ToolOutcome            (ok/status/summary/durationMs; model için eski metin sözleşmesi)
```

- `getToolDefinitions()` tanımları registry üzerinden tekilleştirir; aynı araç adı iki kez sağlayıcıya gönderilmez.
- `pipeline.ts` bugün yalnız kanonikleştirme yardımcısıdır; faz/kısıt kapıları ve onay/yürütme sırası `agent.ts` ile `tools/index.ts` dağıtıcısında uygulanır. Yukarıdaki akış kavramsaldır, tek bir pipeline modülünün davranışı değildir.
- Kapılar kanonik adı görür; alias'lar kapılardan sonra yeniden normalize edilmez.
- Yapısal sonuç sözleşmesi `ToolOutcome` (`ok/status/summary/durationMs`) olarak tanımlanır; `renderOutcome()` modelin gördüğü `Tool error:` uyumlu metni üretir ve eski metin sözleşmesi korunur. Entegrasyon Deniz'in diliminde tamamlanacaktır; o zamana kadar bu, tüm araçların yapısal sonuç döndürdüğü anlamına gelmez.

## Renderer ve masaüstü sınırları

- Renderer hâlâ tek `app.js` denetleyicisidir. 5.0'da davranışı koruyan hedefli düzeltmeler yapılır; framework, bundler veya yeni build adımı eklenmez.
- `preload.cjs` yalnızca beyaz listeye alınmış IPC kanallarını açar; renderer Node veya dosya sistemine doğrudan erişmez.
- Tur yarıda kesilirse veya pencere kapanırsa ana süreç yarım mesajları ve araç sonuçlarını oturuma yazar; kapanış öncesi flush sınırlı süreyle beklenir.
- Screenshot önizlemesi çalışma alanıyla sınırlı bir yol üzerinden sunulur; base64 görseller ana süreçte sınırsız birikmez.

## GUI gözlem ve eşzamanlılık

- Varsayılan gözlem `state`'tir: browser URL/başlık, desktop pencere durumu. `visual` yalnızca açıkça istenirse Set-of-Marks screenshot/UIA ağacı üretir.
- `computer` pencere kimlikleri oturum içinde kararlıdır (`w1`, `w2`); başlık/süreç eşleşmesi ve aktif pencere varsayılanı desteklenir.
- Browser sekmeleri oturum kimliği taşır; bilinmeyen sekme aktif sekmeye düşer, bayat element ref'i tek otomatik yeniden inceleme tetikler.
- Browser ve desktop sıcak oturumları 10 dakika korunur; `/gui stop`, boşta kalma veya bellek baskısı kapatır.
- `browser_batch` ve `computer_batch` en fazla 12 adımı tek onayla çalıştırır; ilk hatada durur ve tamamlanan adımları raporlar.
- GUI mutasyonları seri, saf gözlemler ve dosya/terminal işleri paralel çalışabilir.

## Bağlam ve token politikası

- `context-budget.ts` model profiline ve sağlayıcı/model ailesine göre yerel geçmiş bütçesi, tur ve araç limitleri üretir. Bunlar sağlayıcının sert context limiti değil, yerel çalışma kümesi hedefleridir.
- `prepareContext` bağlamı `compressConversationHistory` ile pencereler; kullanıcı kısıtları, kararlar, değişen dosyalar ve doğrulama kanıtları korunur.
- 6 KB üzerindeki araç çıktıları `.tbot/artifacts/` altında redakte edilerek saklanır. Model özet ve `artifact_read` kimliği görür; tam çıktı sonraki turlarda yeniden gönderilmez.
- Sistem prompt'u kararlı İngilizce sözleşme ile volatil bağlamı ayırır; sabit blok cache dostudur, yanıt dili kullanıcının diline bırakılır.
- Sağlayıcı `usage` değeri ile yerel token tahmini ayrı tutulur. HUD'daki yüzde ölçülmüş fatura değil, yerel bağlam göstergesidir.

## Güvenlik sınırı

- Dosya araçları çalışma alanı dışına çıkmayı ve görülen symlink/junction'ları reddeder; atomik sandbox garantisi yoktur.
- `security/denylist` tek hassas dosya/desen kaynağıdır: dosya arama, onay metni, Vercel paketleme, screenshot ve Telegram yolu aynı politikayı okur.
- Kabuk, dosya yazma, GUI, URL indirme, checkpoint geri yükleme ve `project_verify` onay ister. `TBOT_SANDBOX=required` seçilirse Linux'ta bubblewrap, macOS'ta sandbox-exec aranır; adaptör yoksa kabuk fail-closed durur. Windows'ta OS sandbox adaptörü yoktur.
- Alt süreç ortamından API anahtarı, token, parola ve bulut kimlik bilgileri çıkarılır.
- Gizli anahtarlar Windows'ta DPAPI + ACL ile korunur. Redaksiyon sezgiseldir; bilinmeyen biçimler için garanti yoktur.
- Telegram'da araç onayı kullanıcı kimliği bazındadır; grup onayları `TELEGRAM_ALLOWED_USERS` dolmadan kapalıdır. Onay payload'ı gösterilmeden önce sırlar maskelenir.
- Web, MCP, dosya ve araç içeriği güvenilmeyen kanıt sayılır; taint tekrarı onay gerektirir. Prompt injection için kesin engel iddiası yoktur.

## Paketleme ve kurulum

- TypeScript kaynakları `dist/` altına derlenir; renderer HTML/CSS/JS ve CommonJS preload ayrı kopyalanır. `*.js.map` dosyaları npm paketinden ve masaüstü çıktısından çıkarılır.
- Tek Electron yapılandırması `electron-builder.yml` dosyasıdır. Windows x64 NSIS hedefi `release/T-Bot-Setup-<version>.exe` üretir.
- Kurulum betikleri varsayılan olarak `release` dalını klonlar ve `HEAD` eşitliğini doğrular. Global yazma öncesi önceki `t-bot-cli` paketi ve bin shim'leri yedeklenir; hata veya sürüm uyuşmazlığında geri yüklenir. Rollback atomik değildir ve paylaşılan bağımlılıkları kapsamaz.
- `main` dalına push yapılmaz; yayın dalı `release`, isteğe bağlı sürüm etiketi `v5.0.0`'dır.
- Testler E2E değildir; canlı sağlayıcı, gerçek tarayıcı veya gerçek Telegram akışı birim testi sayılmaz.

## Bilinen sınırlar

- Genel LSP istemcisi ve PTY yoktur; TS/JS tanılaması ve `git grep` sınırlıdır.
- Windows dışı masaüstü kontrolü desteklenmez.
- Tarayıcı/masaüstü otomasyonunun gerçek donanım davranışı birim testleriyle tam doğrulanamaz.
- Token tahmini sağlayıcının tokenizer'ıyla birebir aynı değildir; gerçek `usage` varsa o esas alınır.
- "Dünya #1" ve rakiplere göre yüzde tasarruf iddiası bağımsız benchmark olmadan kanıtlanmamıştır.
- Kabuk komutları ve modelin yaptığı değişiklikler kullanıcı yetkileriyle gerçek etki üretebilir.
