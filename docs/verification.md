# Doğrulama sonuçları — 2.0.1

2026-10-28 tarihinde Windows yerel çalışma alanında, Node.js 24.15.0 ve npm 11.12 ile aşağıdaki kontroller tamamlandı:

| Kontrol | Gözlenen sonuç |
| --- | --- |
| `npm test` | 50/50 bağımsız test geçti: 10 masaüstü, 7 çalışma zamanı, 17 çekirdek ve toplam 16 sağlayıcı/güvenlik testi |
| `npm run typecheck` | Başarılı |
| Renderer/preload `node --check` | Başarılı |
| TypeScript ve masaüstü asset derlemesi | Başarılı |
| `npm run dist:win` | NSIS Windows x64 yükleyicisi başarıyla üretildi; imzasız |
| Paket/ASAR incelemesi | CLI, Electron ana süreç, preload, renderer HTML/CSS/JS, belgeler ve lisans bildirimleri mevcut; `scripts/computer.ps1` unpacked konumda bulundu |
| `npm pack --ignore-scripts` | Önceden derlenmiş çıktıdan tarball üretildi: 171 dosya, 510.339 byte paket, 1.992.659 byte açılmış içerik |
| Yerel global CLI kurulumu | Üretilen tarball ile `npm install -g --ignore-scripts` başarılı; 97 paket eklendi; global `tbot.cmd --version` çıktısı `T Bot 2.0.1`, `--help` başarılı |
| Gerçek masaüstü kurulumu | `deploy-local.ps1` başarılı; kurulu executable `ProductVersion=2.0.1.0`, `FileVersion=2.0.1` |
| Görsel açılış incelemesi | Kurulu 2.0.1 açıldı; okunabilir üç sütunlu arayüz, kullanıcının home dizini çalışma alanı ve görünür render hatası bulunmadığı gözlendi |
| `npm audit` | Geliştirme bağımlılıkları dahil sıfır bilinen açık raporlandı |

Paket boyutları ilk başarılı yerel tarball'a aittir; belge ve kurulum yardımcısı güncellemelerini içeren son yeniden paketlemede küçük farklar beklenir. Bu dosya son yeniden paketlemeden önce kaydedilmiştir. Son yükleyicinin yeniden kurulması, GitHub push/CI/Release sonucu ve yayımlanan dosyanın özeti teslim mesajında ayrıca bildirilmelidir; yukarıdaki sonuçlar uzak CI veya yayımlama başarısı iddiası değildir.

Ek dar kapsamlı kontrollerde PowerShell kurulum betikleri parse edildi, Unix betiği Git Bash `sh -n` ile doğrulandı ve workflow/YAML dosyaları parse edildi. İzole `prepare` denetimleri; eksik dağıtım dosyalarını reddetti, tam kaynak içermeyen paketi kabul etti ve kaynak derlemesindeki sıfırdan farklı çıkış kodunu korudu. Yerel dağıtım sürüm kontrolü `2.0.1`/`2.0.1.0` değerlerini kabul edip `2.0.1.9`, `2.0.0.0`, `2.0.2.0` değerlerini reddetti.

## Kapsam ve sınırlamalar

Testler bağımsız birim/regresyon kontrolleridir; kullanıcı talebiyle uçtan uca uygulama, canlı sağlayıcı, Telegram, tarayıcı ve masaüstü otomasyon senaryoları çalıştırılmadı. Gerçek kurulum ve CLI yardım/sürüm kontrolü yapıldı; bunlar bütün uygulama akışlarının çalıştığını doğrulamaz. Kurulu uygulama Computer Use ile açılıp yalnızca yerleşim yönünden incelendi. Mesaj gönderilmedi, dış sağlayıcıya istek yapılmadı ve GUI araç eylemi çalıştırılmadı. Bu açılış gözlemi birim testlerinden ayrıdır; görev tamamlama testi sayılmaz. Arayüzün o andaki toplam Electron RAM göstergesi yaklaşık 470,8 MB idi; tek gözlem performans kıyaslaması değildir. Kişisel oturum geçmişi içerdiği için ekran görüntüsü kaydedilmedi.

Tamamlanmış bir yerel Codex Security taraması veya resmi güvenlik sertifikası yoktur. `npm audit` belirli bir anda bilinen bağımlılık açıklarını kontrol eder; kaynak güvenliği denetimi veya gelecekte açık bulunmayacağı garantisi değildir.

Sözdizimi ve dosya kontrolleri tüm dilleri, bağımlılık sözleşmelerini veya model iddialarını doğrulamaz. Token tasarrufu hesapları sağlayıcı faturasıyla eşdeğer değildir. Bağımsız benchmark veya “dünya #1” kanıtı bulunmaz. Depo geçmişi ve lisanslar incelenmiştir; eksiksiz kaynak benzerliği/köken denetimi yapılmamıştır. Önceki tamamlanmamış güvenlik taraması başarı kanıtı sayılmaz.
