# İlk isteğe göre kapsam ve tamamlanma denetimi

Denetim tarihi: 28 Ekim 2026, yaklaşık 12:23 Europe/Istanbul. Esas istek: `C:\Users\Egemen\Desktop\T Bot Prompt.md`. Esas ürün snapshot'ı: `f264e6a0a3aca3a15fc3de386983c9e49b4bc841`, sürüm **2.1.0**. Bu belge bir tamamlanma sertifikası değildir: yayımlanmış ve yerelde kurulu bir sürüm vardır; ilk isteğin bütün ürün/kalite hedefleri tamamlanmış değildir.

Durumlar: **completed** bu satırın dar, somut gereksinimi için mevcut kanıt yeterli; **incomplete** bilinen eksik iş var; **unverified** istenen sonucu değerlendirecek yeterli ölçüm veya kapsama sahip kanıt yok; **contradicted** gereksinimin mutlak yorumu mevcut davranışla uyuşmuyor. Fixture başarısı, başka bir satırın kalite/rekabet/tam güvenilirlik kanıtına dönüştürülmez. Koşullu bir talimatın uygulanması, ürünün bütünüyle tamamlandığını göstermez.

“Backend yok, her şey yerelde çalışır” için tasarım yorumu: aynı istekte browser use, araçlar ve farklı modeller de talep edildiği için en makul okuma T Bot'un backend/orchestration/runtime katmanının yerel olması, kullanıcının seçtiği bulut sağlayıcıları ve internet siteleriyle API iletişiminin mümkün kalmasıdır. Kullanıcı açıkça tamamen offline/airgap çalışma istemedi. Aşağıda ayrı uygulama backend'i gerektirmeme somut yerel runtime kanıtıyla değerlendirilir; hiçbir uzak işlemin olmaması yalnız mutlak/literal yorum olarak nitelendirilir. Bu yorum belirsizliği ürünün tüm gereksinimlerini tamamlanmış saydırmaz; bulut/browser özelliklerini kaldırmak için gerekçe de değildir. Metrics, sandbox ve dış akış doğrulama eksikleri aynen sürer.

## Bağımsız snapshot kanıtları

- Denetim başında tracked çalışma ağacı temizdi. Kullanıcının önceden var olan untracked `artifacts/` belgeleri ve görselleri duruyordu; bunlara dokunulmadı. Denetim sırasında diğer işçiler yeni görevler yürütmeye başladığından bu temiz durum yalnız başlangıç snapshot'ına aittir.
- `git rev-parse HEAD`, iki remote için `git ls-remote ... refs/heads/main` ve yerel `git rev-parse 'v2.1.0^{}'` aynı `f264e6a...` commitini verdi. Annotated tag nesnesi `e996ee4...`; bu nesne SHA'sı ürün commit SHA'sıyla karıştırılmaz.
- GitHub bağlayıcısıyla doğrudan okunan main CI çalışmaları: [t-bot 40662878089](https://github.com/egemenkrdsek-boop/t-bot/actions/runs/40662878089), [t-bot-desktop 40662884529](https://github.com/egemenkrdsek-boop/t-bot-desktop/actions/runs/40662884529). İkisinin Ubuntu ve Windows işleri `success`.
- Tag release çalışmaları: [t-bot 40663091366](https://github.com/egemenkrdsek-boop/t-bot/actions/runs/40663091366), [t-bot-desktop 40663097844](https://github.com/egemenkrdsek-boop/t-bot-desktop/actions/runs/40663097844), ikisi `success`. [t-bot v2.1.0](https://github.com/egemenkrdsek-boop/t-bot/releases/tag/v2.1.0) ve [desktop v2.1.0](https://github.com/egemenkrdsek-boop/t-bot-desktop/releases/tag/v2.1.0) `draft=false`, `prerelease=false`; her biri setup, SHA256SUMS ve build-manifest içeriyor. GitHub API `immutable=false` bildiriyor; oturumdaki “etiketi değiştirmeme” kararı teknik release immutability ayarı değildir.
- İki release'in JSON manifesti ve checksum metni doğrudan HTTP üzerinden okundu. Setup hashleri hem checksum hem GitHub asset digest değerleriyle eşleşiyor. İki CI setup'ı farklı, ASAR içerik hashleri aynı. Bu denetimde executable indirilmedi veya yeniden kurulmadı.
- Yerel `%LOCALAPPDATA%\Programs\T Bot\T Bot.exe`: ProductVersion `2.1.0.0`, FileVersion `2.1.0`. Kurulu `resources/app.asar` SHA256 ve yerel setup SHA256, yerel `release/build-manifest.json` ile yeniden eşleştirildi. Yerel derleme ile CI derlemesi ayrı; yayımlanmış executable'ın yerelde kurulduğu iddia edilmez.
- Global npm paket metadatası `2.1.0`; global `tbot.cmd --version` gerçekten `T Bot 2.1.0` döndürdü. Yeni model görevi, browser/computer eylemi veya E2E testi çalıştırılmadı.
- [verification.md](verification.md) içindeki konsolide 117/117 test, typecheck/build ve sıfır açık audit sonucu önceki ana ajan kaydıdır. Bu audit bunları tekrar çalıştırmadı; başarılı iki-platform CI bu snapshot için ayrıca okundu. 117 test bütün özelliklerin gerçek ortamda güvenilir çalıştığı anlamına gelmez.
- Kaynak/belge incelemesi: [architecture](architecture.md), [core-review](core-review.md), [context-window-review](context-window-review.md), [desktop-review](desktop-review.md), [security-review](security-review.md), [install](install.md), [lisans/provenance](../THIRD_PARTY_NOTICES.md), shell yürütümü, bellek koruması ve renderer reduced-motion politikası. Eski verification içindeki “henüz yayımlanmadı” cümleleri paket hazırlanırken kaydedilmiş tarihsel durumlardır; yukarıdaki doğrudan güncel gözlem onların sonrasına aittir.

## Her açık gereksinimin durumu

| # | İstekteki gereksinim | Durum | Kanıt veya eksik |
| --- | --- | --- | --- |
| 1 | Yeni oturum olarak ele alma | unverified | Ürün ağacı ve bu iş paketinin mesajları görüldü; ana oturumun başlangıç bağlamının tamamı bağımsız doğrulanmadı. |
| 2 | Kullanıcıya soru sormadan ilerleme | unverified | Bu denetimde soru/izin isteği yok; bütün oturum davranışı bu kaynak denetimiyle ispatlanmaz. |
| 3 | Belirsizlikte karar verip gerekçeyi kısa kaydetme | completed | İnceleme belgelerinde kaynak, sınır, kurulum kararı ve başarısız denemeler açık kaydedilmiş. |
| 4 | Projeyi baştan sona geliştirip canlıya alma | incomplete | 2.1.0 canlı release ve kurulum mevcut; aşağıdaki ürün/kalite/güvenilirlik açıkları devam ediyor. |
| 5 | OpenCode + Hermes sentez forku | incomplete | İki pinned MIT kaynak bileşeni gerçekten uyarlanmış. Bütün upstream geçmişinin/runtime'ının veya geniş ürün yeteneklerinin sentezi tamamlanmış değil. |
| 6 | Her iki upstream'den çok daha ileri nesil olma | unverified | Karşılaştırılabilir görev/başarı/kalite ölçümü yok. |
| 7 | Rakiplerin bilinen tüm sorunlarına çözüm | incomplete | Rakip sorunu envanteri ve her sorun için kabul ölçütü/çözüm kanıtı yok; ürünün kendi belgelenmiş sınırları da var. |
| 8 | Ajanik kodlamada dünya #1 | unverified | Bağımsız, geniş, tekrarlanabilir sıralama yok. |
| 9 | Browser use'da dünya #1 | unverified | Gerçek browser görevleri veya rakip karşılaştırmasıyla kanıtlanmadı. |
| 10 | Computer use'da dünya #1 | unverified | Win32/UIA kaynak ve fixture incelemesi bir liderlik sıralaması değildir. |
| 11 | Araç çağırmada dünya #1 | unverified | Şema/argüman/stream regresyonları var; karşılaştırmalı başarı metrikleri yok. |
| 12 | Terminal kullanımında dünya #1 | unverified | Süreç/onay düzeltmeleri var; karşılaştırmalı görev ölçümü yok. |
| 13 | Zayıf modellerin büyük depoda odaklı çalışması | unverified | Şema budama, repo map ve pencere planlama var; zayıf model/büyük depo başarı matrisi yok. |
| 14 | Zayıf modellerin büyük depoda isabetli çalışması | unverified | Gerçek model doğruluğu ve değişiklik kalitesi fixture token sayısından çıkarılamaz. |
| 15 | Güçlü modellerin tam kapasitesini kullanma | unverified | Desteklenen sağlayıcı protokolleri var; yetenek/parite/ablasyon değerlendirmesi yok. |
| 16 | Prompt anlamanın belirgin iyileşmesi | unverified | Bazı intent/fast-path hataları düzeltildi; önce/sonra geniş anlamsal doğruluk ölçümü yok. |
| 17 | Talimat takibinin belirgin iyileşmesi | unverified | Grounding ve güvenilmeyen içerik kuralları var; geniş talimat uyumu değerlendirmesi yok. |
| 18 | Aynı işte rakiplerden %50–75 az token | unverified | Yerel tahmini şema/cache tasarrufu aynı görevde rakip faturası/usage karşılaştırması değildir. |
| 19 | Düşük RAM | unverified | Cache sınırları ve trim var; uzun koşu/soğuk açılış/aynı yük rakip profili yok. Tek RSS/working-set gözlemi yeterli değil. |
| 20 | Düşük CPU | unverified | Bazı algoritmik sınırlar ve render batching var; temsilî süreç/GPU/CPU zaman serisi yok. |
| 21 | Neredeyse sıfır kalite kaybı | unverified | Bağlam sıkıştırması kayıplı; bilgi koruma ve görev kalitesi karşılaştırması yok. |
| 22 | Özgün görsel tasarım | unverified | Yerel özel renderer/assets var; özgünlük ve kullanıcı algısı bağımsız değerlendirilmedi. |
| 23 | Çarpıcı görünüm | unverified | Görsel açılış gözlemi estetik kabul kanıtı değildir. |
| 24 | Akıcı animasyonlar | unverified | CSS geçişleri var; frame-time/drop ölçümü yok, bazı idle animasyonlar bilerek kapalı. |
| 25 | Göz yormama | unverified | Uzun kullanım/kontrast/hareket/erişilebilirlik değerlendirmesi yapılmadı. |
| 26 | Yazıların net okunması | incomplete | Önceki native açılışta ana kontroller okunabilir; uzun model/HUD ve dar placeholder sıkışması belgelenmiş. |
| 27 | Ajan işlerinin bir bakışta takip edilebilmesi | unverified | Araç kartları, durum/hata ve görev panelleri var; görev izleme kullanılabilirliği ölçülmedi. |
| 28 | Animasyonların GPU dostu ve hafif olması | unverified | Statik logo ve azaltılmış animasyon yüzeyi var; gerçek donanım profili yok. |
| 29 | Azaltılmış hareket tercihine saygı | completed | CSS `prefers-reduced-motion: reduce` animasyon/transition/smooth-scroll'u kapatıyor. Bu dar uygulama kanıtıdır. |
| 30 | Önce bütün projeyi ayrıntılı inceleme | incomplete | Çok katmanlı inceleme yapılmış; security kapsamı açıkça partial/sampled. Her dosyanın bütün çağrı zincirleri incelenmiş değil. |
| 31 | Mevcut davranışa değil amaçlanan ürüne göre eksikleri tamamlama | incomplete | Gerçek kapsam/kurulum/güvenlik/port düzeltmeleri var; bu tablodaki kabul kanıtları hâlâ eksik. |
| 32 | Gerektiğinde bir bölümü yeniden yazma | completed | Yeni edit-match/context-window/helper katmanları ve renderer/kurulum düzenlemeleri uygulanmış. Koşullu yöntem talimatıdır. |
| 33 | Ayrı backend gerektirmeme | completed | CLI/Electron aynı yerel çekirdeği çalıştırıyor; proje için ayrı barındırılmış backend kurulumu gerekmiyor. |
| 34 | “Her şey yerelde çalışır” mutlak yorumu | contradicted | Bulut model sağlayıcıları, web/MCP/Telegram uzak hizmetlere istek gönderebilir. Yerel runtime var; bütünüyle çevrimdışı/veri cihazdan çıkmaz garantisi yok. |
| 35 | Çok temiz ve minimal kod | unverified | Katmanlar ve küçük helperlar var; genel ölçüt/review kapsamı bütün kaynak kalitesini kanıtlamıyor. |
| 36 | Az kodla çözme, jenerik/şişirilmiş koddan kaçınma | unverified | Yeni portlar gereksiz upstream runtime taşımıyor; bütün depo için karşılaştırmalı sadeleştirme incelemesi yok. |
| 37 | Net mimari katmanlar | completed | CLI/renderer-preload-main/agent/providers/tools/state ayrımı mevcut ve belgeli; bütün bağımlılık sınırlarının otomatik zorlandığı iddia edilmez. |
| 38 | Hata/bug/teknik borcu uçtan uca arayıp düzeltme | incomplete | Çok sayıda somut regresyon kapandı; büyük geçmiş DOM'u, regex bütçesi ve diğer kalan borçlar belgeli. |
| 39 | Güvenlik açıklarını geniş kapsamda arayıp düzeltme | incomplete | Baseline scan ve odaklı düzeltmeler var; bütün ürünün tamamlanmış yeniden taraması ve tam OS sınırı yok. |
| 40 | Komut izolasyonu riskini özellikle inceleme | completed | Shell/stdio/onay/sır aktarımı/Windows executable lookup incelenip somut düzeltmeler yapıldı. |
| 41 | Komut çalıştırmanın güçlü izolasyonu | incomplete | 2.1.0 kabuk gerçek kullanıcı izinleriyle çalışıyor; `cwd` ve ortam filtreleme OS sandbox değildir. |
| 42 | Gizli anahtar yönetimini inceleme | completed | DPAPI/ACL, Unix 0600, ortam ve oturum redaksiyonu odaklı incelenmiş; sınırlar belgeli. |
| 43 | Sırların bütün ortamlarda güvenli tutulması | incomplete | Windows dışı dosya şifreli değil; aynı OS kullanıcısının okuması ve sezgisel redaksiyon tam engellenmiyor. |
| 44 | Prompt injection riskini inceleme | completed | Güvenilmeyen içerik işaretleri, onay sınırları ve stream argüman sertleştirmesi incelenmiş. |
| 45 | Prompt injection'a karşı tam güvenilirlik | unverified | Etiket/prompt talimatı kesin engel değil; yetki kapsamı ve kötü niyetli içerik regresyon matrisi tamamlanmış değil. |
| 46 | E2E testlerini çalıştırmama | completed | İnceleme kayıtları fixture/birim/kurulum/açılış gözlemlerini ayrı tutuyor; bu audit de E2E çalıştırmadı. |
| 47 | Her özellik doğru, tam ve güvenilir olmadan bitmiş saymama | incomplete | Canlı model/browser/computer/Telegram/MCP ve uzun koşu kalitesi tümüyle doğrulanmadı; genel hedef bitmiş ilan edilemez. |
| 48 | Şefin yalnız orkestrasyon yapıp işçilerin kod yazması | completed | Erişilen görev kayıtları kod işlerini Deniz/Ece/Aylin/Selim/Emre'ye bölüyor; root bu tur kaynak kod yazmadığını bildirdi. |
| 49 | Şef ve işçilerin GPT-6.1 Sol Medium olması | unverified | Model/effort ayarlarının bütün ajanlar için bağımsız runtime kayıtları bu denetimin elinde yok. |
| 50 | Türkçe ajan isimleri ve profesyonel sorumluluk dağılımı | completed | Görülen iş paketlerinde Türkçe isimler, dosya sahipliği, diğer değişiklikleri koruma ve ağır işi sıralama talimatları mevcut. |
| 51 | Düşük RAM'i izleme | completed | Root anlık RAM gözlemleri ve süreç sıralaması bildirmiş; ürün `memory-guard` ve desktop telemetry içeriyor. Sürekli ideal kullanım garantisi değil. |
| 52 | RAM dolunca otomatik temizleme | completed | Eşik/cooldown/in-flight denetimli trim/GC yolları mevcut ve odaklı testli. Working-set trim kalıcı heap azalması veya OOM önleme garantisi değil. |
| 53 | Ajan sayısını azaltmadan ağır işleri sıralama | completed | İncelenen iş kayıtlarında paralel sorumluluklar korunup test/build/install ana ajan tarafından sırayla yürütülmüş. |
| 54 | Projeyi optimize etme | completed | Somut cache/şema/context/batching/cap/trim iyileştirmeleri var; optimizasyon yapılmış olması talep edilen global yüzde/kalite hedefini tamamlamıyor. |
| 55 | GitHub main'e push etme | completed | İki remote main `f264e6a...` ve başarılı CI doğrudan doğrulandı. |
| 56 | Son sürümü bu bilgisayara kurma | completed | Yerel desktop 2.1.0 executable/hash ve global CLI 2.1.0 doğrulandı. Sonraki kaynak yamaları bu kurulumun parçası sayılmaz. |
| 57 | Başkalarının terminalden tek komutla kurabilmesi | incomplete | Windows staging yolu gerçek uzak kaynakla 2.0.2'de doğrulanmış;2.1globalCLI kurulu. Unix yolu syntax+izole failure kontrolüyle sınırlı; temiz Linux/macOS gerçek kaynak kurulumu henüz gösterilmedi. |
| 58 | README'de açık kurulum | completed | Node/npm/Git, Windows/Unix tek komut, kaynak/desktop build ve manifest doğrulaması açık yazılı. |
| 59 | Bugün bitirip olgunlaştırma | incomplete | 28 Ekim içinde yayın/kurulum yapılmış; bütün talimatların ürün/kalite kabulü henüz tamamlanmış değil. |
| 60 | Desktop App'e de aynı gereksinimler | incomplete | Desktop yayımlanıp kuruldu ve metadata/IPC/RAM iyileştirildi; genel kalite/performans/güvenilirlik boşlukları Desktop için de sürüyor. |
| 61 | Arayüzün Codex benzeri olması | completed | Oturum listesi, orta konuşma, görev/araç paneli ve onay yüzeyi olan desktop düzeni mevcut; görsel bire bir uyum veya marka bağı iddiası yok. |
| 62 | Setup dosyasını güncelleme | completed | Yerel 2.1.0 setup+manifest ve iki yayımlanmış 2.1.0 setup doğrudan doğrulandı; Windows x64 imzasız dağıtım. |

## Yapılabilir sonraki mühendislik işleri

Bu liste ilk hedefi daraltmaz; eksik kabul kanıtını üretmek ve bilinen davranış açıklarını kapatmak için sıralanır. E2E yasağı devam eder. Model/sağlayıcı hesabı veya kullanıcı sistemi üzerinde bütün görev zinciri koşturmak bu planın otomatik parçası değildir.

1. **Tekrarlanabilir offline değerlendirme altyapısı.** Gerçek production export'larını kullanan sürümlü fixture/replay koleksiyonu; intent/talimat takibi, açık/örtük kısıtlar, tool-call geçerliliği, çağrı-result eşleşmesi, görev kanıtı ve bilgiyi koruma skorları eklenebilir. Önce/sonra ve ablation sonuçları ayrı tutulmalı; model kalitesi/rekabet yüzdesi diye sunulmamalı. Ece'nin yeni component harness işi bu yönde sürüyor; bu dosyada henüz tamamlandı sayılmıyor.
2. **Kalan güvenlik sınırlarını güçlendirme.** Süreç/çalışma alanı/ajan sahipliğini açık tutan runtime izinleri, shell/MCP yetki kapsamları ve kullanılabilir OS izolasyon seçenekleri tasarlanabilir. Prompt injection fikstürleri, sır aktarımı ve çapraz çalışma alanı süreç erişimi olumsuz testlerle genişletilebilir. OS sandbox sağlanmadıkça “izole” etiketi verilmemeli.
3. **Bilinen kaynak ve arayüz borcunu kapatma.** Regex yürütme bütçesi/iptali, büyük oturum geçmişinin sınırlı DOM sunumu, dar pencere/HUD taşmaları ve anlaşılır yapılandırılmış araç durumları doğrudan iyileştirilebilir. Uzun sentetik geçmiş, küçük viewport ve arıza senaryolarında birim/bileşen sınırında doğrulama yapılabilir.
4. **Performans/kaliteyi birlikte ölçme.** Sabit seed/veri/Node/donanım kayıtlarıyla CPU, heap/RSS/working-set, frame üretim maliyeti ve tahmini token zaman serileri; sıkıştırma öncesi/sonrası korunması gereken bilgi ölçümü oluşturulabilir. Rakip değerlendirmesi ayrı sürüm/ayar/görev/kalite kabulü ister; tek cache veya schema ölçümü %50–75 şartını karşılamaz.
5. **Platform kurulum kapsamını tamamlama.** Linux/macOS temiz-prefix kaynak kurulumunu, `--help/--version` ve uninstall/upgrade davranışlarını uygulama görevi çalıştırmadan ayrı kurulum kontrolleriyle doğrulamak mümkün. Global yazma hatası için toparlama/rollback tasarımı değerlendirilebilir. Bunlar model/browser E2E testi değildir.
6. **Kabul matrisi ve kapsamı büyütme.** “Bilinen bütün rakip sorunları” için kaynaklı sorun envanteri, reproducible fixture veya sözleşme ve düzeltilen davranış eşlemesi oluşturulabilir. Zayıf/güçlü model ve büyük repo talepleri için temsilî, izin kapsamıyla uyumlu veri/ölçüm planı hazırlanabilir. Mevcut 117 fixture'ın tüm ürün görevlerini temsil ettiği varsayılmamalı.
7. **Yeni yamaları ayrı sürüm kanıtıyla teslim etme.** Rootun bu denetimle paralel başlattığı yeni DOM/runtime/evaluation işleri tamamlandığında kaynak testleri, yeniden paketleme, yerel kurulum, source/remote commit ve CI/release ayrı doğrulanmalı. 2.1.0 tag'i yeni içeriğe taşınmamalı. Bu denetim yeni yamaları test etmez veya yayımlamaz.

Denetim yalnız bu belgeyi oluşturur; ayrıca rootun açık ek yetkisiyle `package.json` içine `evaluate:components` çalıştırma komutu eklenmiştir. Sürüm yükseltilmedi, ürün derlenmedi/kurulmadı, commit veya push yapılmadı. Bu raporun eklenmesi mevcut yayımlanmış 2.1.0 paketin aynı belgeyi içerdiği anlamına gelmez.

## Sonraki kaynak aşaması: 2.2.0

İlk denetimin ardından ana ajan kaynak sürümü için 2.2.0 minor aşamasını açtı. İlk denetimdeki 62 durum satırı yukarıdaki 2.1.0 snapshot'ına aittir; sonraki kaynak değişiklikleri bu satırları kendiliğinden completed yapmaz. Planlanan kapsam uzun geçmiş UI sayfalaması/lazy araç çıktısı, sorguya göre sıralı repo map, süreç-oturum sahipliği, büyük oturumlar için kayıpsız chunk manifesti ve offline component evaluation'dır. Aşama açılırken 2.2.0 için final test/build/setup/kurulum/CI/yayın kanıtı yoktu; son kaynak sonucu aşağıdaki ek kayıtta tutulur. Package/lock/README metadata hazırlığı ürünün kabulünü veya geniş hedeflerin başarıldığını göstermez. 2.1.0 yayımlanmış tag'i yeni içeriğe taşınmaz.

### 2.2.0 somut kaynak deltasının sonraki kaydı

Ana ajan sonradan 2.2.0 final kaynak doğrulamasını bildirdi: **164/164 test, 0 hata/atlama; 3517,2902 ms**, typecheck, gerçek TypeScript build ve dist renderer/preload syntax başarılı. Bu sonuç eski 2.1.0 denetim tablosunun üstüne yeni, sınırları belirli kanıt ekler; 62 satır yeniden “tamamlandı” etiketlenmez.

- Uzun geçmiş UI sayfalaması/lazy tool output component fixture'larında sınırlı mounted DOM ve parse penceresi gösteriyor. Ham geçmişin tamamı bellekte/IPC'de kalıyor; düşük gerçek RAM/CPU, frame akıcılığı veya göz yormama hedefleri henüz kanıtlanmıyor.
- Sorguya göre repo map sıralaması derin yol/sembol retrieval fixture'larını genişletiyor; zayıf modelin büyük depoda gerçek doğruluğu ve rakip liderliği çıkarılamıyor.
- Process handle erişimi host kaynaklı session/workspace kimliğiyle sınırlanıyor; modelin owner/PID taklidi ve başka sohbet erişimi olumsuz fixture'larla reddediliyor. Bu uygulama içi yetki düzeltmesi OS komut sandbox'ı değil; isolation gereksinimi bütünüyle completed olmaz.
- Büyük session save artık >10 MiB için eski turları sessiz kesmiyor; segment manifesti ve revision çatışma kontrolü veri kaybının somut bir yolunu kapatıyor. Eski JSON okunup migrate olur; eski uygulama yeni biçimi okuyamaz. 256 MiB varsayılan load bütçesi ve 10 MiB manifest sınırı açık hata verir, tam transcript/message yüklemesi boyutla büyüyen bellek ister. Sır redaksiyonu/görsel ek politikası sürer; bütün veri biçimlerinde sınırsız/kayıpsız/constant-memory iddiası yok.
- Offline harness final **60/62**, sıfır critical ve iki informational eksik; gerekli araç görünürlüğü 24/24. Seçilmiş/tam T Bot şema tahmini token oranı %48,6416. Tam referans aynı ürünün yerel şema listesi; bu rakip, canlı görev kalitesi veya genel %50–75 tasarruf ölçümü değil. Kaynak hashleri final after snapshot'ıyla eşleştirilmiş. [evaluation.md](evaluation.md) bütün başarısızlıkları ve baseline farklarını koruyor.
- Sabit upstream'e exact SHA ile pinlenebilen kaynak installer'ı ve izole-prefix Ubuntu/macOS CI işi hazır. Gerçek uzak source-install sonuçları bu kayıt anında henüz yok; ilk tablonun platform kabul boşluğu yapılandırma eklemekle kapanmış sayılmaz.

2.2.0 setup/kurulum/main push/CI/release bu kayıt anında henüz tamamlanmamıştır; final teslim kanıtı ayrıca gelir. 164 fixture başarıları bütün dış akışların güvenilirliğini, model talimat takibini, kalite kaybının yokluğunu veya dünya #1 hedefini kanıtlamaz. İlk geniş hedefler aktif ve kapsam dahilindedir. Ayrıntılı kaynak/materyal sınırlar [verification.md](verification.md) içinde kayıtlıdır.

### Sonraki 2.2.0 gerçek platform kurulum ve yayın deltasının kaydı

Yukarıdaki paket öncesi pending kaydından sonra ana ajan `f126fbee9d622bc9affb10f50e2bd0f72d391d2b` main/tag CI çalışmalarının iki depoda da başarılı olduğunu bildirdi: Windows/Ubuntu build ile Ubuntu/macOS gerçek pinned kaynak kurulumu. Windows'ta aynı commitin yerel kaynak installer'ı çıkış kodu 0 ve sürüm/yardım kontrolünü geçti. **İlk tablonun #57 maddesinin dar platform kaynak-kurulum kabulü 2.2.0 için artık completed kanıtına sahiptir**; tablodaki eski incomplete kaydı 2.1.0 snapshot'ının tarihsel durumudur. Bu sonuç yeni sürüm, her Linux dağıtımı/cihazı veya canlı model/browser görevleri için evrensel garanti değildir.

İki non-draft v2.2.0 release'in üç dosyası, başarılı release workflow'ları, HTTP checksum/manifest ile asset digest eşleşmesi ve yerel 2.2.0 metadata/açılış/manifest hash kontrolü [verification.md](verification.md) arşivine eklendi. Yerel paket CI paketinden ayrı build'dir. Böylece #55/#56/#62'nin bu sürüme ait dağıtım kanıtları da büyüdü; bunlar genel kalite/sıralama/token/tam güvenilirlik hedeflerini tamamlamaz. v2.2.0 etiketi yeni kaynaklara taşınmaz.

### 2.2.1 kaynak aşaması

Yeni patch metadata sürümü 2.2.1; RAM guard ham geçmiş kaybı ve Telegram save/clear hata sunumu için kaynak düzeltmeleri yürütülüyor. Bu kayıt anında yeni final tam suite, build, kurulum veya yayın sonucu yoktur. Eski 62 madde ve geniş hedeflerin kapsamı korunur; dar bir bugfix bütün kalite ya da bilgi kaybının sıfırlanması şartını tamamlanmış saydırmaz. Sonraki tamamlanma kanıtı ayrıca eklenmelidir.

### 4.0.0 Precision güncellemesi

4.0.0, 3.1.0'ın çalışan çekirdeğini koruyarak sınır modüllerini yeniden yazdı: doğrulama-sonrası-yazma kapısı, checkpoint/undo, diagnostics'in geç yüklenmesi, MCP okuma/yazma yetenek ayrımı, taint, isteğe bağlı kabuk sandbox'ı ve CLI/masaüstü `/checkpoints` + `/undo` parity'si. 248/248 birim/bileşen testi, typecheck, katman denetimi, build ve Windows setup üretimi başarılıdır.

Bu güncelleme aşağıdaki geniş hedefleri **tamamlanmış saymaz**: dünya sıralaması, rakiplere göre %50–75 token tasarrufu, canlı model/browser/computer/Telegram doğruluğu, Windows OS sandbox eşdeğerliği, PTY/genel LSP/eklenti API'si ve tüm prompt-injection biçimlerine karşı kesin koruma. E2E ve gerçek kurulum çalıştırması yapılmadı; yalnızca statik/birim kanıtı ve paket artefaktı vardır.

### 4.1.0 J-Space ve GUI fast path

- Gizli J-Space skill'i ve kompakt varsayılan kernel eklendi; tam skill yalnızca açık tetikleyiciyle yükleniyor.
- CLI/TUI ve Telegram'da tüm built-in skill'lerin her turda enjekte edilmesi kaldırıldı; fast konuşma yolu yeniden çalışıyor.
- Browser/desktop eylemleri varsayılan olarak hafif durum gözlemi döndürüyor; screenshot/UIA açık istek gerektiriyor.
- Browser/desktop sıcak oturumları 10 dakikaya çıkarıldı; `browser_batch` ve `computer_batch` tek onayla en fazla 12 adım çalıştırıyor.
- Screenshot retention ve tool süresi ölçümü eklendi.
- 257/257 test, typecheck, katman denetimi ve build başarılı. Gerçek GUI gecikmesi ve model kalitesi bu kayıtta ölçülmedi; E2E yasağı sürüyor.
