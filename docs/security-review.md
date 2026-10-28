# Güvenlik incelemesi — 28 Ekim 2026

Bu belge üretim olgunlaştırma çalışmasındaki kaynak kod incelemesini ve odaklı birim testlerini kaydeder. Tamamlanmış bir Codex Security taraması, sızma testi veya güvenlik garantisi değildir. Yerel uygulama, gerçek sağlayıcı hesapları, Telegram, MCP sunucuları ve işletim sistemi otomasyonu uçtan uca çalıştırılmadı.

## Kapatılan sınırlar

| Bulgu | Önceki yol | Değişiklik | Doğrulama |
| --- | --- | --- | --- |
| Kesilen sağlayıcı akışından araç çalıştırma | Genel adapter tamamlanmış görünen araç nesnesi varsa EOF'u kabul ediyor ve yarım JSON'u onarıyordu. Responses chat fallback'i tamamlanmayı denetlemiyor, hatalı argümanları `{}` yapıyordu. | Chat/Anthropic/Gemini için terminal protokol olayı ve güvenli bitiş nedeni aranır; JSON argümanları kesin ayrıştırılır. Responses fallback'i bozuk çerçeve/sağlayıcı hatasını reddeder. | Üç protokolde EOF araç çağrısı üretmez. Yarım JSON, dizi/null, uzunluk kesilmesi, fallback bozuk çerçevesi ve hata olayı reddedilir; normal tamamlanmış çağrılar korunur. |
| Genel web aracından özel ağa erişim | `url_fetch` yalnızca URL metnini kontrol ediyordu; DNS yanıtını doğrulamıyordu. `redirect: follow` hedefe bağlandıktan sonra son URL kontrol ediliyordu. | `public-network.ts` gerçek soket DNS çözümlemesinde tüm yanıtları doğrular, seçilmiş genel adresi bağlantıya verir ve bağlantı havuzunu kapatır. Her yönlendirme bağlantı kurulmadan önce yeniden denetlenir. IPv4 alternatif yazımları, eşlenmiş IPv6, yerel/özel IPv6 ve geçiş adresleri engellenir. Arama sağlayıcıları da bu ortak taşıma katmanını kullanır. | Özel ve karışık DNS yanıtları reddedilir; metadata yönlendirmesinde ikinci istek yapılmaz. Genel adres ve göreli yönlendirme kontrolleri geçer. |
| Sınırsız web yanıtı okuma | Karakter sınırı `response.text()` ile bütün gövde belleğe alındıktan sonra uygulanıyordu. | Ağ katmanı gövdeyi okurken 2 MB sınırı uygular; tüm yönlendirme zincirine 12 saniyelik zaman aşımı bağlanır. | Küçük test sınırını aşan akış reddedilir; HTML çıkarımı korunur. |
| Terminal stdin üzerinden onay atlama | Onaylanan bir arka plan kabuğuna `process_write` ile sonraki komutlar onaysız yazılabiliyordu. | `process_write`, ortak araç dağıtıcısının zorunlu onay listesine eklendi. | Reddedilen çağrı süreç aramasına/yazmaya ulaşmaz ve onay geri çağırımı tam bir kez çalışır. |
| GUI yoluyla eylem onayı atlama | Tarayıcı ve masaüstü araçları yalnızca özel ortam ayarı açık olduğunda onay istiyordu. | GUI araçları varsayılan olarak ortak onay sınırını kullanır. Güvenilir kullanım için `TBOT_REQUIRE_GUI_APPROVAL=false` açık opt-out'tur; YOLO/izin verilmiş workspace onay geri çağırımı üzerinden devam eder. | Browser open/evaluate ve computer type reddedildiğinde GUI başlatılmaz. |
| Eski Telegram düğmesinin yeni işlemi onaylaması | Bütün talepler aynı `approve_yes`/`approve_no` değerlerini kullanıyordu. | Her talebe 128 bit rastgele nonce verilir. Bekleyen talep ve chat eşleşmesine ek olarak nonce da doğrulanır. | Eski nonce ve eski biçimdeki düğmeler reddedilir; mevcut talebin onay/red düğmeleri ayrıştırılır. |
| Alt süreçlere istemsiz sır aktarımı | Kabuk bütün üst süreç ortamını kopyalıyordu. | API anahtarı/token/sır/parola/kimlik bilgisi adları başlatılan kabuğun ortamından çıkarılır. Ortam her başlatmada üretilir; PATH/SystemRoot korunur. | Örnek sağlayıcı, Telegram ve AWS sırları aktarılmaz; çalışma zamanı yolları korunur. |

Web araçlarının model girdisine dönüşen çıktısı `[Untrusted web content]` etiketi taşır. Ana ajanın talimatı dosya/web/araç çıktılarının izin veremeyeceğini ve kullanıcı talimatını değiştiremeyeceğini ayrıca belirtir. Bu etiketler prompt injection için kesin engel değildir; asıl eylem sınırları araç yetkilendirmesi ve işletim sistemi izinleridir.

## Son genişletilmiş araç incelemesi

İkinci geçişte `src/tools/image.ts` ve `src/tools/computer.ts` bütünüyle okundu; `files.ts` işlem dağıtıcısı, okuma/yazma/patch/glob/search yolları incelendi. `browser.ts` yaşam döngüsü, URL/element çözümlemesi, gezinme, JavaScript çalıştırma, onay diyaloğu ve ekran görüntüsü yolları incelendi. `scripts/computer.ps1` JSON istek işleme, hata sonuçları, ekran görüntüsü, uygulama başlatma ve klavye yolları incelendi; gömülü C# UI Automation/çizim kodu örneklem düzeyinde kaldı. Bu kaynak kapsamı gerçek işletim sistemi davranışının doğrulandığı anlamına gelmez.

Somut ek düzeltmeler:

- Masaüstü daemon yanıtı kaybolduğunda click/type/key/open/drag/scroll tekrar oynatılmaz. Yalnızca gözlem talepleri standalone'a düşebilir; iptal/kill-switch bu yolu da kapatır. Başarısız sonuçlar `ok:false` taşır ve uydurma başarı/ekran görüntüsü mesajı eklenmez.
- PowerShell ekran yakalama hatası boş bir bitmap ile örtülmez; hata döner. Uygulama açmada komut metni oluşturan `cmd /c start` fallback'i kaldırıldı.
- Tarayıcı JavaScript değerlendirmesi hata verdikten sonra yeniden çalıştırılmaz; ilk denemede oluşmuş yan etkiler tekrar edilmez. Sayfanın confirm/prompt diyalogları otomatik kabul edilmez; kapatılır.
- OpenAI görüntü yanıtındaki uzak URL, sınırsız ve denetimsiz ikinci istekle indirilmez. İstenen inline veri gelmezse açık hata döner. Kaynak görüntü bulunamadığında veya geçersiz olduğunda işlem sessizce yeni üretime dönüşmez. Bu araçtaki OpenAI kaynaktan düzenleme desteklenmediği için ücretli istekten önce reddedilir; Gemini/OpenRouter kaynak görüntü akışı korunur.
- `file_outline` ve mevcut dosyayı üzerine yazmadan önceki okuma 10 MB ile sınırlanır. `file_write`, ENOENT dışındaki okuma hatalarını dosya yokmuş gibi kabul etmez.

Ek test: `node --import tsx --test tests/runtime-tools.test.ts` 7/7 başarılı. Enjekte edilmiş masaüstü taşıması ile kayıp yanıt/iptal/kill-switch ve gözlem fallback'i sınanır; gerçek OS eylemi yapılmaz. Görüntü testleri sahte sağlayıcı ve geçici dosya kullanır. PowerShell AST parser `scripts/computer.ps1` için sözdizimi hatası bulmadı; betik çalıştırılmadı. `npx tsc --noEmit` başarılı.

## İncelenen kapsam

Tam okunan uygulamalar: `src/tools/web.ts`, yeni `src/tools/public-network.ts`, `src/tools/shell.ts`, `src/tools/git.ts`, `src/mcp.ts`, `src/sessions.ts`, `src/openai-responses.ts`. Bunlar bütün ürünün veya bütün çağrı zincirlerinin eksiksiz denetlendiği anlamına gelmez.

Odaklı/sampled inceleme: `src/tools/index.ts` araç politikası, alias normalizasyonu ve onay/dağıtım; `src/tools/files.ts` kök çözümleme, symlink reddi ve atomik yazma; `src/tools/browser.ts` URL kontrolü, tarayıcı profil başlatma ve gezinme çağrıları; `src/tools/computer.ts` süreç başlatma ve Unix komut geçişleri; `src/secrets.ts` sır dosyası/DPAPI/önbellek yolu; `src/providers.ts` uç nokta seçimi, kimlik doğrulama ve yönlendirme politikası; `src/config.ts` uç nokta ve yapılandırma yazma; `src/bot.ts` eşleştirme, allowlist, bekleyen onay ve callback işleme. Browser HUD/overlay ayrıntılarının tamamı, PowerShell gömülü C# UI Automation ayrıntılarının tamamı ve `mcp-local-vercel.ts` bu iş paketinde tam incelenmedi. `image.ts` ve `computer.ts` ikinci geçişte bütünüyle okundu. Masaüstü ana süreç/renderer incelemesi ayrı iş paketindedir.

## Korunan özellikler ve açık sınırlar

- Kabuk **OS sandbox içinde çalışmaz**. Çalışma dizini workspace olsa da komutlar kullanıcının bütün izinleriyle dosyalara, ağa ve süreçlere erişebilir. Onay veya YOLO ayarı bu erişimi belirler. Ortam filtreleme, sır dosyalarının aynı OS kullanıcısı tarafından okunmasını engellemez; sır kullanması gereken CLI'lar artık anahtarın açıkça sağlanmasını gerektirir.
- GUI/browser araçları yerel geliştirme siteleri ve gerçek masaüstü eylemleri için tasarlanmıştır. Bunlara genel web aracının ağ kısıtı uygulanmaz; ortak dağıtıcı GUI için varsayılan olarak onay ister. `TBOT_REQUIRE_GUI_APPROVAL=false` ayarı bu kontrolü açıkça kapatır. URL metni kontrolü, yönlendirme ve alt kaynaklar için ağ güvenlik duvarı sayılmaz.
- Dosya araçları workspace dışına çıkmayı ve görülen symlink'leri reddeder. Kontroller ile kullanım atomik değildir; aynı kullanıcıyla eşzamanlı yol değiştiren bir süreç veya Windows reparse-point varyantları için OS düzeyinde izolasyon sağlanmaz. Windows kopyalama fallback'i de atomik rename garantisi vermez.
- Telegram allowlist'i **chat** bazındadır. Yetkili grup chat'inde bütün üyeler bu yetkiye dahildir. Grup üyelerinin ayrı kimlik doğrulaması yoktur. İlk eşleştirme kodu yerel günlükte gösterilir; deneme sayısı için kalıcı hız sınırı yoktur. Metin `/onay` mevcut bekleyen isteği onaylar; nonce bağlama inline düğmelere uygulanır.
- Sabit sağlayıcıların anahtarları kullanıcı tarafından verilen başka uç noktalara gönderilmez; özel/yerel sağlayıcı yapılandırması güvenilir kullanıcı ayarıdır. Sağlayıcı HTTP çağrıları yönlendirmeleri reddeder. Canlı API doğrulaması yapılmadı.
- Windows sır saklama DPAPI ve kullanıcıya kısıtlı ACL kullanır; şifreleme başarısızlığında açık metne geri düşmez. Windows dışı saklama 0600 dosyadır ve şifreli değildir. Oturum sır maskelemesi sezgiseldir; bilinmeyen sır biçimlerini yakalama garantisi yoktur.
- MCP stdio yapılandırması yerel program başlatma yetkisidir. HTTP MCP sağlayıcılarında sabit origin ve redirect reddi görülmüştür. MCP araçları ortak dağıtıcıda onay gerektirir ve çıktıları güvenilmeyen içerik olarak işaretlenir; üçüncü taraf araçların davranışı burada doğrulanmadı.
- Shell/background süreç yönetimi tek uygulama sürecinde paylaşılır; farklı çalışma alanları için OS düzeyinde süreç ayrımı sunulmaz. Arka planda başlatılan ve kendisini süreç ağacından ayıran uygulamaların durdurulması garanti edilmez.

## Kanıt

`node --import tsx --test tests/providers.test.ts tests/security.test.ts`: 16 test başarılı. Testler sahte HTTP/DNS/SSE taşıması ve yerel fonksiyon çağrıları kullanır; dış ağa, gerçek terminal komutuna veya Telegram'a bağlanmaz. Anthropic kullanım testi, toplam girdi hesabına cache read/creation eklenmesini ve delta olayında tekrar sayılmamasını denetler. `npx tsc --noEmit`: başarılı. Son toplu doğrulama ve paket/kurulum durumu için `docs/verification.md` esas alınmalıdır.

Bu inceleme bağımlılıkların tamamını, ağ altyapısını, bütün prompt injection yollarını, işletim sistemi erişim kontrollerini veya gerçek hesap izinlerini doğrulamaz. Güvenlik açısından önemli kalan kararlar: chat yerine bireysel Telegram yetkilendirmesi, gerçek OS sandbox ve eşzamanlı dosya yolu saldırılarına dayanıklı dosya tanıtıcısı tabanlı erişim.

Ek kalan sınırlar: `file_search` için JavaScript regex motoru kullanılır; kötü niyetli karmaşık regex uzun süre CPU tüketebilir ve ayrı worker zaman aşımı yoktur. Tarayıcı semantik fallback eşleşmeleri aynı görünen farklı hedeflere gidebilir; model gözlemi kullanıcı niyetini doğrulamaz. Ekran görüntüleri yerel hassas içerik taşıyabilir. Başlatılması devam eden tarayıcının uygulama kapanışıyla yarışması ve gerçek UI Automation davranışı yalnızca kaynak incelemesiyle doğrulanamaz. Görüntü imza/header kontrolleri tam bir resim codec doğrulaması değildir.

Paket yolu düzeltmesi: PowerShell betiği Electron sanal `app.asar` üyesi yerine fiziksel `app.asar.unpacked` yolundan seçilir. Sahte dosya sistemi testi sanal üye mevcutken de dış yolun seçildiğini ve dış dosya yoksa kapalı hata verildiğini doğrular; kaynak checkout yolu korunur. DLL yardımcıları APPDATA/TBot/bin altında derlenir ve ASAR içinden yüklenmez. Standalone PowerShell boş/geçersiz sonuç döndürürse başarı varsayılmaz.
