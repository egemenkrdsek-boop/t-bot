# Desktop incelemesi — 28 Ekim 2026

Kapsam: `src/desktop/**`, `tests/desktop.test.cjs`. Electron main, isolated preload, vanilla JS renderer, CSS, IPC, tur/onay/MCP/kapanış yaşam döngüsü ve bellek temizleyicisi incelendi. Kullanıcının mevcut dosyaları ve diğer işçilerin değişiklikleri korundu. E2E çalıştırılmadı.

## Kararlar ve düzeltmeler

- Mevcut frameworksüz arayüz korundu. Konuşma metni platformun sans yazı tipine ve 14px/1.7 satır aralığına taşındı; kod ve teknik hedefler monospace kaldı. Araç kartları kompakt; başarılı sonuçlar başlangıçta kapalı, gerçek hatalar açık. Önceden akordeon yalnızca sınıf/ok değiştiriyordu; şimdi gövde görünürlüğü ve `aria-expanded` birlikte değişiyor.
- Araç çıktısındaki herhangi bir `error`, `hata`, `fail` sözcüğü hata sayılmıyor. Çekirdeğin `Tool error:`/`Araç Hatası:` zarfları ve `shell` sonucunun son `Exit code:` durumu kullanılıyor. Başarılı kaynak okumasında `new Error(...)` bulunması yanlış alarm üretmiyor; sıfır dışı shell çıkışı hata gösteriyor. Yarım kalan araçların “Çalışıyor” rozeti tur bitince “Durduruldu” oluyor.
- Birden fazla paralel araç onayı renderer'daki tek `currentApproval` değerini eziyor, aynı ID'ye sahip kartlar oluşturuyor ve önceki onayı erişilemez bırakabiliyordu. İstekler sıraya alındı. Her karar kendi request ID'sine gider; tur için sürekli izin seçimi sıradaki istekleri de açıkça onaylar. 120 saniyelik süre dolumu main→preload→renderer bildirimiyle kartı sonlandırır ve sıradakini gösterir.
- IPC onayı ve YOLO yetkilendirmesi yalnızca gerçek boolean `true` ile kabul ediliyor. `approved: "false"` gibi truthy değerler izin sayılmıyor. Onay resolver'ı gönderimden önce kaydedilir; renderer yoksa veya gönderim başarısızsa istek hemen reddedilir.
- Oturum geçmişi yüklenirken gönderim ve yeni gezinme kilitlenir; yeni oturumun asenkron oluşturulması da aynı rezervasyonu kullanır. Eski oturum listesi, iş akışı veya model kataloğu yanıtları daha yeni bir seçimi/çalışma alanını ezemez. Aktif oturum IPC üzerinden silinemez. Silinen açık oturumun kimliği temizlenir. Başarısız/iptal edilen turun dönen session ID'si korunur; kullanıcı iptali gereksiz hata kartı üretmez.
- Renderer süreci çökerse tur iptal edilir ve bekleyen onaylar reddedilir. MCP `close()` işleminin süresiz takılması tur kilidini tutamaz: her bağlantının kapanışı 5 saniye ile sınırlandı. Gerçek uygulama kapanışının mevcut tek-seferlik/deadline cleanup akışı korundu.
- RAM temizliği için eşzamanlı tray/IPC talepleri tek in-flight promise'i paylaşır. Kullanıcı tarafından yazılabilir dizindeki kalıcı .NET DLL'ini `Assembly.LoadFrom` ile yükleme kaldırıldı; Windows yardımcı tipi süreç içinde sabit kaynak koddan oluşturulur. PowerShell işlemi gizli ve 5 saniyelik sınırlıdır. Fiziksel çalışma kümesi boşaltmak kalıcı heap azalması değildir; gösterge ölçülen çalışma kümesini raporlar.
- Otomatik basınç temizliği 15 saniyelik hafif ölçümde pencere gizliyken de çalışır. Yalnızca sistem boş RAM ≤0.25GB ve uygulama çalışma kümesi ≥128MB olduğunda veya toplam Electron çalışma kümesi ≥768MB olduğunda GC/working-set trim tetiklenir. Manuel temizleme dahil son denemenin giriş zamanından itibaren 120 saniye cooldown uygulanır; başarısız deneme de cooldown tüketir ve eşzamanlı trim başlatılamaz. Aktif session/history değiştirilmez; session sıkıştırması çekirdeğin tur-sonu yoluna bırakılır. Kapanış sırasında yeni kontrol başlatılmaz; mevcut will-quit interval temizliği korunur.
- Logo idle animation döngüsü eklenmedi; mevcut statik canvas, 50ms kümelenmiş stream render, görünür pencereye 15sn telemetri yayını ve CSS reduced-motion politikası korundu. Düşünme süresi araç geçişlerinde sıfırlanmaz; tek timer bütün tur boyunca devam eder. Ekran görüntüsü önizlemesi klavye ile açılabilir.

## Kanıt

`node --test tests/desktop.test.cjs`: **22/22 geçti**. Testler gerçek modül kaynaklarını VM içinde çalıştırır; provider, IPC ve DOM sınırları küçük stub'larla izole edilir. Kanıtlanan davranışlar: markdown/URL güvenliği, toplam RAM ve ölçülen sıfır, IPC sender/subframe kontrolü, asenkron tur rezervasyonu ve iptali, ek doğrulaması, config revision kimliği, MCP araç aktarımı/kapanışı, CSP, kapanış deadline'ı, araç hata sınıflandırması, akordeon görünürlüğü/ARIA, yavaş oturum yükleme rezervasyonu, eski çalışma alanı yanıtının atılması, timer sürekliliği, strict boolean onayı ve truthy YOLO bypass regresyonu, gönderim öncesi onay kaydı, aktif oturum silme koruması, trim taleplerinin birleşmesi, paralel onay sırası ve takılan MCP kapanışı, gizli pencere basınç eşiği, iki dakikalık/manual-shared cooldown ve tek in-flight basınç temizliği.

`node --check src/desktop/renderer/app.js`: geçti. Repository genelindeki son typecheck/build ve paketleme root koordinasyonunda yapılır.

## Sınırlar

Bu testler Electron/Win32 kurulumunun, gerçek grafik donanımının, dış model sağlayıcısının veya gerçek MCP sunucusunun çalıştığını kanıtlamaz. Kullanıcı E2E'yi yasakladı; prompt, araç veya harici sağlayıcı içeren UI akışı çalıştırılmadı. RAM/token tasarrufunda rakiplere göre yüzde iddiası ölçülmedi ve bu incelemeden çıkarılamaz. MCP kapanışı deadline'ı UI kilidini serbest bırakır; bozuk üçüncü taraf taşıyıcının gerçekten sonlandığını garanti etmez. Tool-result sözleşmesi string olduğundan hata durumu çekirdeğin belgelenen önekleri ve shell kapanış satırıyla sınırlıdır; gelecekte yapısal durum alanı eklenirse renderer onu tercih etmelidir. İlk incelemede büyük geçmişin tamamı DOM olarak yükleniyordu; aşağıdaki 2.1 sonrası performans aşaması bu görünür DOM sınırını giderir.


## Kurulu 2.0.2 açılış gözlemi

Yerel kurulu `T Bot.exe` Windows Computer Use (`@oai/sky`) ile açıldı ve yalnızca açılış/yerleşim içsel olarak incelendi. 1222×821 pencere görüntüsünde sol oturum listesi, orta karşılama ve mesaj alanı, sağ görev paneli ve üst pencere kontrolleri yerleşti; engelleyici modal, hata ekranı veya boş renderer gözlenmedi. Mesaj gönderilmedi; sağlayıcı, ajan aracı veya uygulama içi browser/computer akışı başlatılmadı. Bu bir E2E testi değildir.

Tek açılış anlık ölçümünde arayüzün toplam Electron çalışma kümesi göstergesi **426.4 MB** idi. Bu tek değer soğuk açılış ölçümüdür; kararlı durum veya rakiple bellek kıyası değildir. Kişisel oturum başlıkları bulunduğundan ekran görüntüsü dosyası kaydedilmedi. Uzun model adıyla alt HUD sağ ucu ve dar mesaj alanındaki uzun placeholder metni sıkışabiliyor; ana kontroller erişilebilir kaldı. Bu kozmetik sınır nedeniyle kurulum sonrası kaynak değişikliği yapılmadı.


## 2.1 sürüm metadatası

Header, karşılama başlığı, pencere başlığı ve tray artık sabit `2.0` göstermez. Mevcut `config:get` açılış yanıtı `{ config, appVersion }` zarfıdır; sürüm main sürecinin `app.getVersion()` kaynağından gelir ve disk config nesnesinden ayrıdır. Yeni IPC kanalı veya dosya okuma yolu eklenmedi. Renderer sınırlı sürüm metnini doğrular ve `textContent`/`document.title` kullanır; sürüm alınamazsa `—` ve “Sürüm bilgisi alınamadı” açıklaması gösterilir. Model adındaki gerçek `gemini-2.0-flash` sürümü ürün sürümü olarak değiştirilmedi.

Odaklı doğrulama: `node --test tests/desktop.test.cjs` **25/25 geçti**; `node --check src/desktop/renderer/app.js` geçti. Yeni testler metadata zarfını, renderer payload'ının güvenilir sürümü değiştirememesini, saveConfig yolunun metadata'yı disk config'e eklememesini ve eksik/bozuk sürüm fallback'ini doğrular. E2E, GUI, sağlayıcı çağrısı, ağır build, commit veya push yapılmadı; önceki immutable 2.0.2 release tag'i değiştirilmedi.


## 2.1 sonrası: uzun görevlerde görünür geçmiş ve parse maliyeti

Somut başlangıç durumu: `switchSession` bütün kullanıcı/asistan mesajlarını DOM'a ekliyordu; kapalı araç kartlarında bile argüman ve tam sonuç/diff HTML'si üretiliyordu. Stream güncellemesi her 50ms'de o ana kadarki bütün mesajı yeniden Markdown olarak işliyordu. Bunların maliyeti oturum/yanıt büyüklüğüyle sınırsız artıyordu.

Renderer artık ham transcript kaydı ile gösterilen DOM'u ayırır. Normal görünüm en fazla **40 kayıt** içerir; kullanıcı `İlk kayıtlar`, `Önceki 40`, `Sonraki 40`, `En yeni` kontrolleri ve açık aralık/toplam sayısı ile bütün geçmişe ulaşabilir. Sayfa dışında kalan **yalnız aktif stream, çalışan araç ve güncel onay** ayrıca sabitlenir; sayı göstergesi bu ek canlı işlemleri açıkça bildirir. Tamamlanan/iptal edilen işlemler sabitlenmiş kümeden çıkar. Yazılmakta olan composer ve ekleri bu DOM değişimlerinin dışında kalır. Kullanıcı eski sayfayı okurken yeni araç sonuçları sayfayı en yeniye atmaz. Session yüklemesi tek geçişte ham kayıtları kurar; önceki görünümde gösterilmeyen kayıtlı tool-result mesajları da artık bağlı araç kartı olarak erişilebilir.

Kapalı tool kartında yalnız başlık/durum vardır; argüman/sonuç DOM'u ancak kart açılınca üretilir ve kart kapanınca silinir. Argümanlar, sonuçlar, kullanıcı/asistan mesajları ve uzun onay açıklamaları **16.000 karakterlik açık bölümler** halinde gösterilir; ham metin kısaltılmaz. Ekran görüntüsü yalnız açık araçta önizlemeye dönüşür; görüntülerde native lazy/async decode ipuçları vardır. Eski DOM kaldırıldığında element referansı bırakılır. Clear/session değişiminde ham kayıtlar ve pin kümeleri boşaltılır, lightbox `src` ve indirme callback'inin base64 closure'ı temizlenir. Ek dosyalar için mevcut object URL `finally` revocation yolu korunur.

Stream verisi küçük parçaları birleştiren ham chunk dizisinde tutulur; normal canlı görünüm yalnız son 16.000 karakteri formatlar. Kullanıcı eski metin bölümünü okurken her yeni token için tam metin birleştirilmez veya eski bölüm yeniden parse edilmez. Tam metin yalnız finalde veya kullanıcının eski bölüm/tam kopya isteğinde birleştirilir. Önceki tek kopya eylemi DOM codeblock'undan çalışıyordu; etiketi artık **Görünür kodu kopyala**. Uzun mesaj/argüman/sonuç/onay için ayrıca ham kayıttan **tamamını kopyala** eylemi vardır. Tam konuşma export özelliği zaten yoktu; görünür sayfayı tam konuşma gibi sunan yeni bir yol eklenmedi.

Etkileşim hareketi yalnız yeni sayfa/metin kontrollerindeki **120ms opacity hover** geçişidir. Mevcut `prefers-reduced-motion` kuralının `transition: none !important` bildirimi bunu bastırır. 40 geçmiş kartı ayrı ayrı animate edilmez; yeni idle loop, blur/glow, kalıcı `will-change`, RAF veya gezinme timer'ı eklenmedi. Okuyucu, seçim, caret ve scroll stabilitesi nedeniyle panel/stream giriş animasyonu eklenmedi. GPU veya pil tasarrufu yüzdesi ölçülmedi.

### Ölçülebilir doğrulama

`node --test tests/desktop.test.cjs`: **34/34 geçti**. `node --check src/desktop/renderer/app.js` ve hedefli `git diff --check` geçti. Yeni component fixture'ları gerçek renderer kaynak fonksiyonlarını çalıştırır; DOM ve clipboard küçük stub'lardır:

- 3.000 message / **60.020.780 ham içerik karakteri** fixture'ında ilk görünüm **40 mounted kayıt**, **12.008 üretilmiş HTML karakteri** idi. Bin tool-result ham kaydı korundu, kapalı gövdeleri boş kaldı; ilk/son sayfa arasında veriye yeniden erişildi. Fixture aynı uzun çıktı string'ini paylaşır; sayılan değerler render işi ve kayıt sayısıdır, gerçek Electron heap'i veya fiziksel RAM ölçümü değildir.
- **480.000 karakterlik** stream'in 80 güncellemesinde Markdown'a toplam **1.266.000 karakter** verildi; her güncellemede bütün prefix'i yeniden işlemek bu fixture için **19.440.000 karakter** olurdu. En büyük tek parse girdisi **16.000** idi. Bu bir CPU süresi/heap benchmark'ı değildir.
- Eski sayfa açıkken 200 tamamlanan canlı araç boyunca görünüm 40 kayıt + yalnız çalışan araca ait bir pin ile sınırlı kaldı; scroll/ilk kayıt/composer değişmedi. İptal/onay sırası, uzun onayda request kimliği, tool screenshot önizlemesi ve kapanınca boşaltma, tam ham metin kopyası, session clear ve timer temizliği ayrıca doğrulandı.

Sınırlar: oturumun ham metni hâlâ renderer belleğinde tutulur ve mevcut IPC tam session'ı aktarır; toplam uygulama RAM'i için sabit üst sınır iddiası yoktur. Aktif işlemler bilinçli olarak 40 kayda eklenir; eşzamanlı aktif iş sayısı kadar ek DOM oluşabilir. Kullanıcı büyük bir sonucun tamamını kopyalarsa o metnin clipboard aktarımı tam uzunluktadır. 16k bölüm sınırı Markdown bloğunu bölebilir; ham içerik ve tam kopya korunur, sayfa içi kod kopyasının kapsamı açıkça etiketlidir. GUI, E2E, harici provider/tool akışı, ağır build, kurulum, sürüm değişimi, commit veya push bu aşamada yapılmadı.


### Seçili session yüklemesinde fail-closed consumer düzeltmesi

Desktop başlangıcındaki `store.get(...).catch(() => null)` kaldırıldı. Seçili ID yüklenirken bütçe/aşırı boyut, bozuk segment veya başka okuma hatası oluşursa kullanıcıya açık yükleme hatası döner; ID gerçekten bulunamazsa da açık “seçili oturum bulunamadı” cevabı verilir. Her iki durumda provider başlatılmaz, yeni session üretilmez veya kaydedilmez; tur rezervasyonu `finally` ile açılır. ID verilmeden bilinçli yeni sohbet başlatmak desteklenmeye devam eder. Resume edilen host Session nesnesi klonlanmadığı için Symbol revision kimliği korunur. Ek iki regression sonrası Desktop suite **36/36 geçti**; bütçe/bozulma/null-not-found, retry unlock, provider çağrılmaması, yazma olmaması, açık yeni session ve revision nesne kimliği doğrulandı.
