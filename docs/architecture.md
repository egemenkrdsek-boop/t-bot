# Mimari ve kapsam

T Bot aynı ajan çekirdeğini CLI, Electron masaüstü ve Telegram girişlerinden kullanır. Kaynak bağlantıları aşağıdaki sorumluluk sınırlarını gösterir; bu şema çalışma zamanı başarısı veya ölçülmüş performans iddiası değildir.

```text
CLI: index.ts → app.ts / tui.ts ───────┐
Electron: renderer → preload → main.ts ├→ agent.ts → providers.ts → model hizmeti
Telegram: bot.ts ─────────────────────┘       │
                                             └→ tools/index.ts → yerel / MCP araçları
```

| Katman | Kaynaklar | Sorumluluk |
| --- | --- | --- |
| CLI | [index.ts](../src/index.ts), [app.ts](../src/app.ts), [cli.ts](../src/cli.ts), [tui.ts](../src/tui.ts) | Argümanlar, komutlar, terminal etkileşimi ve ajan olaylarının sunumu |
| Masaüstü | [main.ts](../src/desktop/main.ts), [preload.cjs](../src/desktop/preload.cjs), [renderer](../src/desktop/renderer/) | Electron pencere/IPC yaşam döngüsü, renderer köprüsü, oturum ve onay arayüzü |
| Telegram | [bot.ts](../src/bot.ts), [telegram-security.ts](../src/telegram-security.ts) | Bot API long polling, sohbet yetkisi ve uzak istek/onay akışı |
| Ajan ve sağlayıcı | [agent.ts](../src/agent.ts), [providers.ts](../src/providers.ts), [openai-responses.ts](../src/openai-responses.ts) | Model istekleri, akış olayları, araç çağrısı döngüsü ve sağlayıcı protokolleri |
| Araç yürütme | [tools/index.ts](../src/tools/index.ts), [tools](../src/tools/) | Araç ad/argüman normalleştirmesi; dosya, kabuk, Git, web, tarayıcı, masaüstü ve görsel işlemleri |
| Kalıcı durum | [config.ts](../src/config.ts), [secrets.ts](../src/secrets.ts), [sessions.ts](../src/sessions.ts), [memory.ts](../src/memory.ts) | Kullanıcı ayarları, anahtar saklama, oturumlar ve bellek kayıtları |
| İş akışları | [workflows.ts](../src/workflows.ts), [subagents.ts](../src/subagents.ts), [skills.ts](../src/skills.ts), [ultracode.ts](../src/ultracode.ts) | Hedef/todo durumu, alt görevler, beceriler ve kodlama iş akışı yönergeleri |
| Bağlam ve kontroller | [context-cache.ts](../src/context-cache.ts), [token-optimizer.ts](../src/token-optimizer.ts), [grounding.ts](../src/grounding.ts), [ast-validator.ts](../src/ast-validator.ts) | Tekrarlanan bağlamı azaltma, yerel kullanım tahminleri, dosya erişim kanıtları ve sınırlı sözdizimi kontrolleri |
| MCP | [mcp.ts](../src/mcp.ts), [mcp-config.ts](../src/mcp-config.ts), [mcp-presets.ts](../src/mcp-presets.ts) | Yapılandırılmış MCP sunucularını bağlama ve onların araçlarını ajan döngüsüne sunma |

CLI ve masaüstü aynı iş mantığını çağırır; Electron renderer doğrudan Node.js ajan çekirdeğini çalıştırmaz, preload/IPC üzerinden ana süreçle iletişim kurar. Onay ve iptal davranışları arayüze göre uygulanır. Dış araçlar ve sağlayıcılar ayrı süreçlere veya ağ hizmetlerine erişebilir; “yerel ajan” tüm işlemlerin çevrimdışı olduğu anlamına gelmez.

Tarayıcı katmanı Playwright Core üzerinden Chrome/Chromium kullanır. Masaüstü kontrolü Windows yardımcı betikleri ve yerel işletim sistemi API'lerine bağlıdır. Araç politikaları ile doğrulamalar işletim sistemi sandbox'ı veya tam güvenlik sınırı sayılmaz; kabuk komutları ve modelin yaptığı değişiklikler gerçek kullanıcı yetkileriyle etki edebilir.

## Paketleme kararları

TypeScript `src/` kaynakları `dist/` altına derlenir. HTML/CSS/renderer JS ve CommonJS preload ayrı kopyalanır; zorunlu dosya eksikse derleme hata verir. `prepare` kaynak varsa derlemeyi zorunlu tutar, hazır tarball'da ise zorunlu dağıtım dosyalarını denetler. Böylece başarısız derleme sessizce kurulum başarısına dönüşmez.

Tek Electron yapılandırması [electron-builder.yml](../electron-builder.yml) dosyasıdır. NSIS hedefi Windows x64'tür; `dist:win` yalnızca paket oluşturur. GitHub Release yayımlama sürüm etiketiyle ayrı workflow üzerinden yapılır. CLI kurulum betikleri Electron ikilisi indirmesini atlar; Windows masaüstü yükleyicisi Electron çalışma zamanını içerir.

Depo kendi başlangıç geçmişi ve MIT lisansıyla değerlendirilir. Hermes/OpenCode adları kavramsal esin kaynağıdır; doğrulanmış upstream fork veya kod birleştirme iddiası yapılmaz. Eksiksiz kaynak kökeni denetimi, bağımsız performans kıyaslaması ve “dünya #1” kanıtı mevcut değildir. Bildirimler [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md), doğrulama sınırları [verification.md](verification.md) dosyasındadır.
