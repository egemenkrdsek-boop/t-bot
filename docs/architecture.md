# Mimari ve kapsam

T Bot 4.1, 4.0'ın yerel ajan çekirdeğini CLI/TUI, Electron masaüstü ve Telegram girişlerinden kullanır. Ayrı bir sunucu backend'i yoktur; dış model, tarayıcı, MCP ve Telegram bağlantıları kullanıcı yapılandırmasına bağlıdır.

```text
CLI / TUI ─────┐
Desktop ───────┼──> Surfaces (sunum) ──> AgentRuntime ──> Providers
Telegram ──────┘                              │
                                              ├──> ContextEngine ──> Artifact / Usage
                                              ├──> ToolRuntime ────> Files / Shell / Browser / Computer / MCP
                                              └──> Policy / Approval / Grounding
                                                       │
                                      Session + Memory + Secrets + Audit
```

## Katmanlar

| Katman | Kaynaklar | Sorumluluk |
| --- | --- | --- |
| Protokol ve tipler | `src/types.ts`, `src/context-budget.ts` | Ortak event, tool çağrısı, onay ve bütçe sözleşmeleri |
| Çekirdek sözleşmeler | `src/core/` | Görev sözleşmesi ve faz/tamamlanma kapısı; araç veya yüzey import etmez |
| Güvenlik ilkeleri | `src/security/` | Yetenekler, taint, yol/URL/ortam/sandbox sınırları; araç veya yüzey import etmez |
| Komut yüzeyi | `src/commands.ts` | Komut adları, kullanım, argüman kuralları ve yüzey desteği; CLI/TUI/masaüstü tek kaynak |
| Ortak host | `src/host-services.ts`, `src/turn-runner.ts` | Görsel sağlayıcı, model kataloğu, API anahtarı doğrulaması ve goal/plan/ultracode/subagent tur dağıtımı |
| Ajan | `src/agent.ts` | Tur döngüsü, faz disiplini, bağlam montajı, sentez ve hata kurtarma |
| Skill çekirdeği | `src/skills.ts`, `src/skills/jspace.ts` | Gizli J-Space skill'i, kompakt varsayılan kernel, isteğe bağlı tam metin |
| Kullanıcı sınırları | `src/constraints.ts` | Açık yol/komut/araç sınırlarının çıkarımı, kalıcılığı ve araç öncesi uygulanması |
| GUI politikası | `src/tools/gui-policy.ts` | `none/state/visual` gözlem, sıcak oturum süresi, batch sınırı |
| Bağlam | `src/token-optimizer.ts`, `src/context-window.ts`, `src/context-cache.ts`, `src/tools/artifacts.ts` | Şema budama, pencereleme, kanıt özeti, büyük çıktı artifact'ları |
| Araçlar | `src/tools/index.ts`, `src/tools/*.ts` | Ad/argüman normalleştirme, onay, risk sınırı, dosya/kabuk/Git/web/tarayıcı/masaüstü/MCP |
| Doğrulama | `src/tools/verify.ts`, `src/tools/diagnostics.ts`, `src/grounding.ts`, `src/ast-validator.ts` | Proje script'leri, yerel TS tanılaması, sözdizimi ve iddia denetimi |
| Sağlayıcılar | `src/providers.ts`, `src/openai-responses.ts` | Streaming, tool-call protokolleri, usage, model yetenekleri |
| Kalıcı durum | `src/config.ts`, `src/secrets.ts`, `src/sessions.ts`, `src/memory.ts`, `src/checkpoints.ts` | Ayar, sır, oturum checkpoint'i, bellek, dosya checkpoint'i |
| Masaüstü | `src/desktop/main.ts`, `preload.cjs`, `renderer/` | Electron yaşam döngüsü, IPC, izole renderer, oturum/onay UI |
| CLI/TUI | `src/index.ts`, `src/app.ts`, `src/tui.ts`, `src/theme.ts` | Argümanlar, terminal etkileşimi, durum satırı |
| Telegram | `src/bot.ts`, `src/telegram-security.ts` | Long polling, sohbet yetkisi, uzak onay |

`npm run check:layers` bu yönü statik olarak denetler: `core/` ve `security/` üst katmanları import edemez, `tools/` yüzeyleri import edemez, Electron yalnızca `desktop/` içinde kullanılır.

## Ajan turu

1. **Intake:** kullanıcı mesajı, görseller ve varsa beceri komutu alınır. Mesaj boyutu ve çalışma alanı doğrulanır; açık kullanıcı sınırları çıkarılıp oturum boyunca korunur.
2. **Locate:** repo haritası, `file_outline`, `file_search` ve `file_glob` ile hedef sembol bulunur.
3. **Plan:** üç veya daha fazla adım varsa `todo_manage` ile plan yazılır. Küçük modeller tek araç/tek adım moduna alınır.
4. **Act:** yalnızca gerekli araçlar çalışır; yazma öncesi okuma, revizyon ve hassas yol kontrolleri uygulanır.
5. **Verify:** `project_verify` proje script'lerini onayla çalıştırır; çıktı tipli sonuç olarak ajana ve kullanıcıya döner.
6. **Report:** nihai metin yalnızca araç kanıtına dayanır. Kanıtsız başarı iddiası grounding denetiminden geçmez.

## GUI gözlem ve eşzamanlılık

- Varsayılan gözlem `state`'tir: browser URL/başlık, desktop pencere durumu. `visual` yalnızca açıkça istenirse Set-of-Marks screenshot/UIA ağacı üretir.
- Browser ve desktop sıcak oturumları 10 dakika korunur; `/gui stop`, boşta kalma veya bellek baskısı kapatır.
- `browser_batch` ve `computer_batch` en fazla 12 adımı tek onayla çalıştırır; ilk hatada durur ve tamamlanan adımları raporlar.
- GUI mutasyonları seri, saf gözlemler ve dosya/terminal işleri paralel çalışabilir. Bu, aynı pencereye eşzamanlı tıklama yarışını önler.
- Screenshot'lar `.tbot/screenshots` altında 40 dosya / 32 MB ile sınırlandırılır.

## Bağlam ve token politikası

- `context-budget.ts` sağlayıcı/model ailesine göre yerel geçmiş bütçesi, tur ve araç limitleri üretir. Bunlar sağlayıcının sert context limiti değil, yerel optimizasyon hedefleridir.
- `prepareContext` bağlamı `compressConversationHistory` ile pencereler; kullanıcı kısıtları ve bölünemez tool/native çiftleri korunur.
- 6 KB üzerindeki araç çıktıları `.tbot/artifacts/` altında redakte edilerek saklanır. Model, özet ve `artifact_read` kimliği görür; tam çıktı sonraki turlarda yeniden gönderilmez.
- Sistem prompt'u kararlı bir İngilizce sözleşmedir; yanıt dili kullanıcının diline bırakılır. Bu, küçük modellerde talimat takibini ve prompt cache kullanımını iyileştirir.
- Sağlayıcı `usage` değeri ile yerel token tahmini ayrı tutulur. HUD'daki yüzde, ölçülmüş fatura değil yerel bağlam tasarrufu göstergesidir.

## Güvenlik sınırı

- Dosya araçları çalışma alanı dışına çıkmayı ve görülen symlink/junction'ları reddeder; atomik sandbox garantisi yoktur.
- Kabuk, dosya yazma, GUI, URL indirme, checkpoint geri yükleme ve `project_verify` onay ister. `TBOT_SANDBOX=required` seçilirse Linux'ta bubblewrap, macOS'ta sandbox-exec aranır; adaptör yoksa kabuk fail-closed durur. Windows'ta OS sandbox adaptörü yoktur; onay ve yetenek politikası sınırdır.
- Alt süreç ortamından API anahtarı, token, parola ve bulut kimlik bilgileri çıkarılır.
- Gizli anahtarlar Windows'ta DPAPI + ACL ile korunur. Windows dışında dosya izinleri kullanılır; şifreleme garantisi yoktur.
- Web, MCP, dosya ve araç içeriği güvenilmeyen kanıt olarak etiketlenir; taint tekrarı onay gerektirir. Prompt injection için kesin engel iddiası yoktur; onay ve araç yetkisi asıl sınırdır.
- Dosya checkpoint'leri `.tbot/checkpoints` altında tutulur; geri yükleme öncesi mevcut içerik de checkpoint'lenir. Bu, tüm işlemleri kapsayan bir transaction değildir.

## Paketleme

- TypeScript kaynakları `dist/` altına derlenir; renderer HTML/CSS/JS ve CommonJS preload ayrı kopyalanır.
- Tek Electron yapılandırması `electron-builder.yml` dosyasıdır. Windows x64 NSIS hedefi `release/T-Bot-Setup-<version>.exe` üretir.
- `dist:win` yalnızca paket üretir; GitHub yayımlama ayrı bir sorumluluktur. Yerel `deploy-local.ps1` yükleyici ve `app.asar` hash'lerini manifestle karşılaştırır.
- Testler E2E değildir; canlı sağlayıcı, gerçek tarayıcı veya gerçek Telegram akışı çalıştırılmaz.

## Bilinen sınırlar

- “Dünya #1” ve rakiplere göre %50–75 tasarruf iddiası bağımsız benchmark olmadan kanıtlanmamıştır.
- Görsel/tarayıcı/masaüstü otomasyonunun gerçek donanım davranışı birim testleriyle tam doğrulanamaz.
- Windows dışı masaüstü kontrolü desteklenmez.
- Token tahmini sağlayıcının tokenizer'ıyla birebir aynı değildir; gerçek `usage` varsa o esas alınır.
- Kabuk komutları ve modelin yaptığı değişiklikler kullanıcı yetkileriyle gerçek etki üretebilir.
