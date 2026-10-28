# Rakiplik boşluk matrisi (iç mühendislik notu)

Bu dosya bağımsız bir rakip denetimi veya sıralama kanıtı değildir. Amaç, kodlama ajanlarında tekrar eden sorunları T Bot'un somut davranışlarıyla eşlemek ve 3.0 kapsamını görünür tutmaktır. Kaynaklar ürünlerin genel kullanım deneyimi ve açık dokümantasyonudur; her iddia sürüm bazında ayrıca doğrulanmalıdır.

| Yaygın sorun | T Bot 3.1 karşılığı | Durum |
| --- | --- | --- |
| Uzun oturumda bağlam şişmesi | Model profiline göre yerel bütçe, pencereleme, kanıt özeti | Uygulandı; gerçek model kalitesi ölçülmedi |
| Büyük araç çıktısının her turda tekrar gönderilmesi | `.tbot/artifacts` + `artifact_read` | Uygulandı |
| Modelin var olmayan dosya/export uydurması | Repo map, `file_outline`, okuma-sonrası-yazma, grounding | Kısmen; model hatası tümüyle engellenemez |
| Aynı hatalı araç çağrısının döngüye girmesi | Tekrar sayacı, döngü uyarısı, kurtarma ipucu, bütçe sentezi | Uygulandı |
| Test/typecheck çalıştırmadan “tamamlandı” demek | `project_verify`, kanıt defteri, sentez denetimi | Uygulandı; canlı proje doğrulaması yapılmadı |
| Zayıf modelin çok fazla araç ve bağlamla dağılması | Küçük model modu: tek araç, dar şema, kısa bütçe | Uygulandı; model matrisi yok |
| Kabuk komutlarının onaysız/yıkıcı çalışması | Onay sınırı, risk açıklaması, env scrub, süreç ağacı | Kısmen; OS sandbox yok |
| Web/MCP içeriğinden prompt injection | Güvenilmeyen kanıt etiketi, araç onayı, kullanıcı kısıtı önceliği | Kısmen; kesin garanti yok |
| Sırların log/oturum/alt sürece sızması | Merkezi redaksiyon, DPAPI+ACL, ortam allowlist | Kısmen; sezgisel redaksiyon |
| Tarayıcıda kör koordinat/tıklama | Erişilebilirlik ref'i, eylem sonrası doğrulama, metin önceliği | Kaynak mevcut; gerçek tarayıcı testi yok |
| Masaüstü otomasyonunda yanlış pencere/koordinat | UIA ref, odak/DPI, screenshot doğrulaması | Kaynak mevcut; gerçek OS testi yok |
| Uzun geçmişte ağır DOM ve RAM | 40 kayıt sınırı, lazy araç gövdesi, sanal sayfalama | Uygulandı; toplam RAM sabit değil |
| Emoji/gürültülü, göz yoran arayüz | Grafit/Tabit yeşili, monospace, tek vurgu, reduced-motion | Uygulandı |
| Klavye öncelikli akış eksikliği | `Ctrl+K`, `Esc`, `Enter`, komut paleti, odak halkaları | Uygulandı |
| CLI/masaüstü komut ve yardım sapması | `src/commands.ts` tek katalog; iki yüzey aynı listeyi okur | Uygulandı |
| “Dokunma/çalıştırma” talimatının yalnızca promptta kalması | `src/constraints.ts`; açık sınırlar oturum boyunca saklanır ve araç öncesi uygulanır | Uygulandı; dil kapsamı sezgisel |
| Sağlayıcıya kilitlenme | Çoklu adaptör, model listesi, yerel fallback | Uygulandı; otomatik ücretli failover yok |
| İnteraktif terminal/TTY eksikliği | `shell` + süreç yönetimi; PTY henüz yok | Açık |
| Dil sunucusu tanılaması eksikliği | AST/outline var; LSP istemcisi yok | Açık |
| İşlem geri alma/checkpoint | Oturum checkpoint'i var; dosya undo yok | Açık |

## 3.0'da bilinçli olarak kapsam dışı

- Tam OS sandbox veya container izolasyonu.
- Canlı rakip benchmark'ı ve “dünya #1” sertifikası.
- E2E, gerçek tarayıcı, gerçek Telegram ve gerçek sağlayıcı görevleri.
- GitHub push/release.
- PTY, LSP, dosya checkpoint/undo ve eklenti sistemi; bunlar bir sonraki mühendislik dilimi.
