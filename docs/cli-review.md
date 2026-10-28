# CLI ve terminal incelemesi — 28 Ekim 2026

Ece'nin sahipliğinde incelenen kaynaklar: `src/app.ts`, `cli.ts`, `index.ts`, `tui.ts`, `menu.ts`, `ast-validator.ts`, `lock.ts`, `logo.ts`, `theme.ts`, `version.ts`. İnceleme statik kaynak takibi ve odaklı unit/component testleriyle yapıldı; E2E çalıştırılmadı.

## Uygulanan düzeltmeler

- Yapılandırma ve alt ajan model keşfi seçili özel/yerel `baseUrl` değerini keşif katmanına iletiyor. `models.ts` uygulaması ve endpoint güvenliği Deniz ile koordine edildi.
- `--` sonrasındaki `config` / `sessions` gibi sözcükler artık gerçek istek metni olarak kullanılabiliyor.
- Tek seferlik çalışmada onay bekleyicisi AbortSignal alıyor; SIGINT ve SIGTERM aynı iptal/temizlik yolunu kullanıyor. Terminal bulunmayan etkileşimli çağrı, Telegram köprüsünü başlatmadan önce reddediliyor. TUI modül yükleme ve başlangıç animasyonu hataları da kaynak temizleme kapsamına alındı.
- ESC/F12, model yanıtı akarken spinner durmuş olsa da etkin isteği iptal ediyor. Gerçek terminal kapanışı isteği iptal ediyor; menü için geçici readline kapatılması iptal etmiyor. İzin isteminden önce kuyruğa giren yazılar yeni bir araç iznini cevaplayamıyor.
- Araç ismi, hedefi, sonuç özeti, model/efor ve bot kullanıcı adındaki dış kaynaklı terminal kontrol karakterleri temizleniyor. `null` / primitive JSON araç argümanları TUI'yi çökertmiyor.
- Model/sağlayıcı değişiklikleri HUD'a canlı yansıyor. `TBOT_NO_ANIMATION` spinner'ı da kapatıyor; iptal durumu animasyon zamanlayıcısından bağımsız. Dar terminallerde spinner en az 40 sütun varsaymıyor.
- Var olmayan `node:` modülleri AST ön kontrolünden geçemiyor; `node:test` gibi yalnız önekle kullanılabilen gerçek modüller korunuyor.
- Logo sürümü merkezi paket sürümünden geliyor. Ölçülmemiş sabit token tasarrufu ve sıfır gecikme iddiaları kaldırıldı. Başarılı yazma bildirimi bütün diller için AST doğruluğu iddia etmiyor; sıfır grounding uyarısı da tam doğrulama olarak sunulmuyor.

## Tamamlanan kapsam ve sınırlar

- `app.ts`: onboarding/anahtar yenileme, sağlayıcı/işçi model değişimi, MCP hydration ve bağlantı değişimi, oturum akışı, slash komutları, izin politikası, Telegram başlatma ve final cleanup yolları incelendi.
- `cli.ts` / `index.ts`: seçenek/değer ayrıştırma, eşittir sözdizimi, literal ayırıcı, alt komutlar, yardım/sürüm ve hata çıkış kodu incelendi.
- `tui.ts` / `menu.ts`: streaming, araç özetleri, spinner, readline dinleyicileri, iptal, geçici menü, ham terminal modu, ESC dizisi parçalanması, maskelenmiş UTF-8 secret girişi ve bracketed paste akışı incelendi.
- `ast-validator.ts`: TS/JS parser seçimi, import/export çözümleme, paket varlığı, async scope export borçları, JSON ve diğer dil ön kontrolleri incelendi. Python/HTML/Shell vb. kontroller tam dil derleyicileri değildir; statik karakter/denge kontrolleri geçerli kod için yanlış alarm veya eksik tanı üretebilir. Bunlar çalışma zamanı/test kanıtı yerine kullanılamaz.
- `lock.ts`: exclusive-create, canlı PID koruması, eksik yazım için yaş toleransı, bekleme/backoff ve nonce ile sahipliğe göre bırakma incelendi. Dosya kilidi yerel işbirliği içindir; düşmanca dosya sistemi değişikliklerine karşı atomik compare-and-delete garantisi yoktur.
- `logo.ts` / `theme.ts`: ASCII/NO_COLOR/TERM yedekleri, animasyon iptali, renk ve ANSI kırpma yardımcıları incelendi. Görünür uzunluk hesabı Unicode kod noktası sayar; geniş CJK/emoji ve birleşik gliflerde tam terminal hücre ölçümü sağlamaz.
- `version.ts`: sürüm paket dosyasından okunuyor; minimum Node 22.12 kontrolü incelendi. Paket sürümü 2.0.2 güncellemesi Emre tarafından yönetildi; çift sürüm sabiti eklenmedi.

## Doğrulama

`node --import tsx --test tests/cli.test.ts`: 6 odaklı test geçti. Ayrıştırma, Node minimumu, gerçek/sahte builtin ayrımı, terminal kontrol temizliği, primitive argüman toleransı ve animasyonsuz düşünme durumu kapsandı. `tests/runtime-tools.test.ts` değiştirilmedi. Ağır build ve tam test paketi şefin sıraya aldığı genel doğrulamaya bırakıldı.
