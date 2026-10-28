# Rakiplik boşluk matrisi (iç mühendislik notu)

Bu dosya bağımsız bir rakip denetimi veya sıralama kanıtı değildir. Amaç, kodlama ajanlarında tekrar eden sorunları T Bot 5.0'ın somut davranışlarıyla eşlemek ve kapsamı görünür tutmaktır. "Uygulandı" etiketi kaynakta karşılığı olduğunu söyler; canlı donanım/model doğrulaması anlamına gelmez. Canlı kanıt `docs/verification.md` 5.0 bölümünde tutulur.

| Yaygın sorun | T Bot 5.0 karşılığı | Durum |
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
| Test/typecheck çalıştırmadan "tamamlandı" demek | `project_verify`, kanıt defteri, sentez denetimi | Uygulandı; canlı proje doğrulaması raporlanır |
| Zayıf modelin çok fazla araç ve bağlamla dağılması | `small` profilde tek araç/tur, dar şema, kısa bütçe; `flash` yanlış sınıflandırılmaz | Uygulandı; model matrisi ölçülmedi |
| Kabuk komutlarının onaysız/yıkıcı çalışması | Onay sınırı, risk açıklaması, env scrub, süreç ağacı; isteğe bağlı bwrap/sandbox-exec | Kısmen; Windows'ta OS sandbox yok |
| Web/MCP içeriğinden prompt injection | Güvenilmeyen kanıt etiketi, taint tekrar onayı, araç onayı, kullanıcı kısıtı önceliği | Kısmen; kesin garanti yok |
| Sırların log/oturum/alt sürece sızması | Ortak deny-list, merkezi redaksiyon, DPAPI+ACL, ortam allowlist | Kısmen; redaksiyon sezgisel |
| Sırların dosya araması/Telegram ile sızması | `file_search` hassas yolu atlar, çıktı redakte; Telegram onay ve final metni maskelenir | Uygulandı (kaynak); canlı sızıntı testi raporlanır |
| Telegram grubunda her üyenin onay vermesi | Kullanıcı kimliği allowlist'i; grup onayları varsayılan kapalı | Uygulandı |
| MCP stdio'nun onaysız komut başlatması | Açık onay, workspace cwd, allowlist | Uygulandı (kaynak) |
| Tarayıcıda kör koordinat/tıklama | `selector`/`ref`/görünen metin hedefi, bayat ref'te tek yeniden inceleme, bilinmeyen sekmede aktif sekme | Kısmen; canlı tarayıcı testi raporlanır |
| Masaüstü otomasyonunda yanlış pencere/koordinat | `w1` oturum kimliği, başlık/süreç eşleşmesi, aktif pencere varsayılanı, UIA ref, screenshot doğrulaması | Kısmen; gerçek OS testi raporlanır |
| Browser URL politikasının `url_fetch`'ten zayıf olması | `assertPublicHttpUrl` paylaşımı, her yönlendirmede yeniden doğrulama | Uygulandı (kaynak) |
| Uzun geçmişte ağır DOM ve RAM | 40 kayıt sınırı, lazy araç gövdesi, sayfalama, lazy TS derleyicisi | Uygulandı; toplam RAM sabit değil |
| Emoji/gürültülü, göz yoran arayüz | Grafit/Tabit yeşili, monospace, tek vurgu, reduced-motion, run spine | Uygulandı |
| Klavye öncelikli akış eksikliği | `Ctrl+K`, `Esc`, `Enter`, komut paleti, odak halkaları | Uygulandı |
| CLI/masaüstü komut ve yardım sapması | `src/commands.ts` tek katalog; iki yüzey aynı listeyi okur | Uygulandı |
| Tur yarıda kesilince masaüstünde veri kaybı | Ana süreç kısmi mesajları ve araç sonuçlarını oturuma yazar; kapanışta flush | Uygulandı (kaynak); gerçek kill testi raporlanır |
| "Dokunma/çalıştırma" talimatının yalnızca promptta kalması | `core/request-brief` + `constraints`; sınırlar oturum boyunca araç öncesi uygulanır | Uygulandı; dil kapsamı sezgisel |
| Sağlayıcıya kilitlenme | Çoklu adaptör, model listesi, yerel fallback | Uygulandı; otomatik ücretli failover yok |
| İnteraktif terminal/TTY eksikliği | `shell` + süreç yönetimi; PTY yok | **Açık** — 5.1 dilimi |
| Dil sunucusu tanılaması eksikliği | TS/JS için yerel `diagnostics`; genel LSP istemcisi ve `code_symbols/definition/references` yok | **Kısmen** — 5.1 dilimi |
| İşlem geri alma/checkpoint | Dosya checkpoint/undo, onaylı geri yükleme | Uygulandı; tüm dosya sistemi değil |
| Kurulumun `main`e bağlı olması ve rollback yokluğu | Varsayılan `release`, ref eşitliği, global yazma öncesi CLI yedeği ve hata/sürüm uyuşmazlığında geri yükleme | Uygulandı (kaynak); temiz prefix kurulumu şef/Selin doğrulamasında |
| Pakette kaynak haritası şişmesi | `dist/**/*.map` npm paketinden ve masaüstü çıktısından çıkarıldı | Uygulandı; `npm pack --dry-run` 0 map |
| CI action'larının hareketli major etikete bağlı olması | checkout/setup-node/upload-artifact tam SHA'ya sabit; `npm audit --audit-level=high` adımı | Uygulandı (yapılandırma); CI henüz çalışmadı |

## 5.0'da bilinçli olarak kapsam dışı

- Genel LSP istemcisi: sembol/definition/reference, çoklu dil sunucusu ve büyük depoda IDE düzeyi gezinme. Yalnız TS/JS tanılaması ve `git grep` var.
- PTY / kalıcı interaktif terminal oturumu. `shell` tek seferlik komut çalıştırır.
- Tam OS sandbox veya container izolasyonu (Windows'ta adaptör yok).
- Canlı rakip benchmark'ı ve "dünya #1" sertifikası.
- E2E otomasyonu; canlı senaryolar ürünü gerçekten kullanan manuel/araçlı turlarla yapılır.
- GitHub `main` push'u; yayın `release` dalı ve isteğe bağlı `v5.0.0` etiketiyle yürür.
- Eklenti API'si ve renderer framework/bundler geçişi; bunlar sonraki mühendislik dilimleri.
