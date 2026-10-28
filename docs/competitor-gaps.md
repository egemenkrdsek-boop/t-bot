# Rakiplik boşluk matrisi (iç mühendislik notu)

Bu dosya bağımsız bir rakip denetimi veya sıralama kanıtı değildir. Amaç, kodlama ajanlarında tekrar eden sorunları T Bot'un somut davranışlarıyla eşlemek ve 3.0 kapsamını görünür tutmaktır. Kaynaklar ürünlerin genel kullanım deneyimi ve açık dokümantasyonudur; her iddia sürüm bazında ayrıca doğrulanmalıdır.

| Yaygın sorun | T Bot 4.1 karşılığı | Durum |
| --- | --- | --- |
| Ağır varsayılan reasoning prompt'u | Gizli J-Space skill'i; normal turda kompakt kernel, tam metin isteğe bağlı | Uygulandı |
| GUI'de her eylemde screenshot/UIA taraması | Varsayılan `state`; görsel gözlem açık istek | Uygulandı |
| Model/onay gecikmesinde browser/daemon cold start | 10 dakika sıcak oturum | Uygulandı |
| Form doldurmada çok sayıda model turu/onay | `browser_batch` / `computer_batch`, tek onay | Uygulandı |
| Gözlem için bile onay istemek | Saf gözlemler onaysız; mutasyon/screenshot/batch onaylı | Uygulandı |
| Screenshot disk şişmesi | 40 dosya / 32 MB retention | Uygulandı |
| Uzun oturumda bağlam şişmesi | Model profiline göre yerel bütçe, pencereleme, kanıt özeti | Uygulandı; gerçek model kalitesi ölçülmedi |
| Büyük araç çıktısının her turda tekrar gönderilmesi | `.tbot/artifacts` + `artifact_read` | Uygulandı |
| Modelin var olmayan dosya/export uydurması | Repo map, `file_outline`, okuma-sonrası-yazma, grounding | Kısmen; model hatası tümüyle engellenemez |
| Aynı hatalı araç çağrısının döngüye girmesi | Tekrar sayacı, döngü uyarısı, kurtarma ipucu, bütçe sentezi | Uygulandı |
| Test/typecheck çalıştırmadan “tamamlandı” demek | `project_verify`, kanıt defteri, sentez denetimi | Uygulandı; canlı proje doğrulaması yapılmadı |
| Zayıf modelin çok fazla araç ve bağlamla dağılması | Küçük model modu: tek araç, dar şema, kısa bütçe | Uygulandı; model matrisi yok |
| Kabuk komutlarının onaysız/yıkıcı çalışması | Onay sınırı, risk açıklaması, env scrub, süreç ağacı; isteğe bağlı bwrap/sandbox-exec adaptörü | Kısmen; Windows'ta OS sandbox yok, `required` modu fail-closed |
| Web/MCP içeriğinden prompt injection | Güvenilmeyen kanıt etiketi, taint tekrar onayı, araç onayı, kullanıcı kısıtı önceliği | Kısmen; kesin garanti yok |
| Sırların log/oturum/alt sürece sızması | Merkezi redaksiyon, DPAPI+ACL, ortam allowlist, checkpoint yol filtresi | Kısmen; sezgisel redaksiyon |
| Tarayıcıda kör koordinat/tıklama | Erişilebilirlik ref'i, eylem sonrası doğrulama, metin önceliği | Kaynak mevcut; gerçek tarayıcı testi yok |
| Masaüstü otomasyonunda yanlış pencere/koordinat | UIA ref, odak/DPI, screenshot doğrulaması | Kaynak mevcut; gerçek OS testi yok |
| Uzun geçmişte ağır DOM ve RAM | 40 kayıt sınırı, lazy araç gövdesi, sanal sayfalama, lazy TS derleyicisi | Uygulandı; toplam RAM sabit değil |
| Emoji/gürültülü, göz yoran arayüz | Grafit/Tabit yeşili, monospace, tek vurgu, reduced-motion, signal spine | Uygulandı |
| Klavye öncelikli akış eksikliği | `Ctrl+K`, `Esc`, `Enter`, komut paleti, odak halkaları | Uygulandı |
| CLI/masaüstü komut ve yardım sapması | `src/commands.ts` tek katalog; iki yüzey aynı listeyi okur | Uygulandı |
| “Dokunma/çalıştırma” talimatının yalnızca promptta kalması | `src/constraints.ts`; sınırlar oturum boyunca saklanır ve araç öncesi uygulanır | Uygulandı; dil kapsamı sezgisel |
| Sağlayıcıya kilitlenme | Çoklu adaptör, model listesi, yerel fallback | Uygulandı; otomatik ücretli failover yok |
| İnteraktif terminal/TTY eksikliği | `shell` + süreç yönetimi; PTY henüz yok | Açık |
| Dil sunucusu tanılaması eksikliği | TS/JS için yerel `diagnostics`; genel LSP istemcisi yok | Kısmen |
| İşlem geri alma/checkpoint | Dosya checkpoint/undo, onaylı geri yükleme | Uygulandı; tüm dosya sistemi değil |

## 4.1'de bilinçli olarak kapsam dışı

- Tam OS sandbox veya container izolasyonu (Windows'ta adaptör yok).
- Canlı rakip benchmark'ı ve “dünya #1” sertifikası.
- E2E, gerçek tarayıcı, gerçek Telegram ve gerçek sağlayıcı görevleri.
- GitHub push/release.
- PTY, genel LSP istemcisi ve eklenti API'si; bunlar sonraki mühendislik dilimi.
