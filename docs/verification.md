# Doğrulama kayıtları

## Önceki çalışma kaydı — 2.0.1

Aşağıdaki sonuçlar bu incelemeden önce depoda bulunan 2.0.1 kaydıdır. Mevcut çalışma ağacındaki değişikliklerin, yeni setup dosyasının veya yeni kurulumun doğrulaması sayılmaz. Güncel inceleme kayıtları dosyanın sonunda tutulur.

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

Önceki 2.0.1 kaydının oluşturulduğu 2026-10-28 anında tamamlanmış bir yerel Codex Security taraması yoktu. Bu tarihli gözlem sonraki 2.0.2 taramasının durumunu anlatmaz. Resmi güvenlik sertifikası iddiası yoktur. `npm audit` belirli bir anda bilinen bağımlılık açıklarını kontrol eder; kaynak güvenliği denetimi veya gelecekte açık bulunmayacağı garantisi değildir.

Sözdizimi ve dosya kontrolleri tüm dilleri, bağımlılık sözleşmelerini veya model iddialarını doğrulamaz. Token tasarrufu hesapları sağlayıcı faturasıyla eşdeğer değildir. Bağımsız benchmark veya “dünya #1” kanıtı bulunmaz. Depo geçmişi ve lisanslar incelenmiştir; eksiksiz kaynak benzerliği/köken denetimi yapılmamıştır. Önceki tamamlanmamış güvenlik taraması başarı kanıtı sayılmaz.

## Çalışma kaydı — 2.0.2 (2026-10-28)

Bu bölüm yeni çalışma ağacına aittir. Sürüm, hata ve güvenlik düzeltmeleri için 2.0.2'ye yükseltildi; bağımlılıkların kilitli sürüm ve integrity kayıtları değiştirilmedi. Kurulumun aynı sürüm numaralı eski içeriği başarı saymasını engellemek için `dist:win` yükleyici ve `app.asar` SHA256 manifesti üretir; yerel kurulum betiği her ikisini doğrular. Manifest imza yerine geçmez.

| Kontrol | Güncel sonuç |
| --- | --- |
| Dağıtım yardımcıları | `release-manifest.mjs` ve `prepare.mjs` Node sözdizimi kontrolü başarılı |
| PowerShell kurulum yardımcıları | `install.ps1` ve `deploy-local.ps1` parse başarılı |
| Yapılandırma | CI, release workflow ve electron-builder YAML parse başarılı |
| İzole dağıtım kontrolleri | Sahte dosyalardan yükleyici ve ASAR hashleri doğru üretildi; `prepare` eksik paketi reddetti ve tamamlanmış dosya listesini kabul etti |
| Yerel yükleyici reddetme kontrolü | Windows PowerShell `-NoProfile` altında yanlış SHA256 içeren sahte yükleyici süreç kapatma ve kurulumdan önce reddedildi; hash hesabı modül bağımlılığı olmadan .NET akışıyla yapılır |
| Kilit dosyası | Önceki commit ile tüm bağımlılık kayıtları aynı; yalnızca kök sürüm/lisans metadata değişti |
| `npm audit --json` | Ana ajan tarafından çalıştırıldı: 383 bağımlılık, sıfır bilinen açık |
| Son toplu `npm test` | Ana ajan kaydı: 86/86 başarılı, 0 hata ve 0 atlanan test; yaklaşık 3,066 saniye |
| Test dağılımı | Çekirdek/sağlayıcı 35, masaüstü 22, CLI 6, güvenlik/çalışma zamanı 23; masaüstü grubu RAM baskısı kontrolünü de içerir |
| Son `npm run typecheck` | Başarılı |
| Renderer ve preload `node --check` | Başarılı |
| `npm run dist:win` | Ana ajan kaydı: TypeScript, masaüstü assetleri, Windows x64 NSIS setup ve SHA256 manifesti başarıyla üretildi; ilk setup 128.466.964 byte |
| İlk gerçek 2.0.2 masaüstü kurulumu | `deploy-local.ps1` başarılı; ProductVersion `2.0.2.0`, yükleyici hashinin ve kurulu `app.asar` hashinin manifestle eşleştiği doğrulandı |
| ASAR/paket içeriği | Read-only `asar list`: CLI, Electron main, preload, renderer HTML/JS/CSS, yeni `dist/workspace-state.js`, dağıtım manifest yardımcısı, proje lisansı, üçüncü taraf bildirimleri ve güncel belge yolları mevcut |
| Paket dışı bileşenler | `app.asar.unpacked/scripts/computer.ps1` fiziksel dosyası mevcut (55.196 byte); Electron ve Chromium lisans bildirimleri uygulama dizininde mevcut |
| `npm pack --ignore-scripts` | Ana ajan kaydı: yerel derlenmiş CLI tarball başarılı; ilk paket 176 dosya ve yaklaşık 524.516 byte; belge değişiklikleri son paketin boyutunu değiştirebilir |
| Yerel global CLI kurulumu | Tarball'dan `npm install -g --ignore-scripts` başarılı: 97 paket eklendi, 1 paket güncellendi; global `tbot.cmd --version` → `T Bot 2.0.2`, `--help` başarılı |
| Kurulu 2.0.2 görsel açılış gözlemi | Masaüstü ajanı native UI açılışını ve yerleşimi gözledi; UI RAM göstergesi tek anda 426,4 MB. Kişisel başlıklar nedeniyle ekran görüntüsü kaydedilmedi; ayrıntılar [masaüstü incelemesinde](desktop-review.md) |
| Codex Security baseline | `e72740f` tabanında kısmi kapsamlı canonical tarama raporu tamamlandı: 1 yüksek, 2 orta bulgu; düzeltmeler ve kalan sınırlar [güvenlik incelemesinde](security-review.md) tutulur |

İlk setup/masaüstü kurulumu, paket içeriği ve yerel CLI kurulumu doğrulandı. Belgeler tamamlandıktan sonra setup yeniden üretilecek ve kurulacak; yukarıdaki ilk boyutlar son teslim boyutları değildir. Hashler paket içindeki belgelere gömülmez; son derlemenin `build-manifest.json` dosyası esas alınır. Son yeniden paketleme/kurulum ve GitHub yayın sonucu teslim kaydında ayrıca bildirilir. E2E testleri kullanıcı talebiyle çalıştırılmaz; görsel açılış gözlemi görev tamamlama veya canlı model doğrulaması değildir. Tek RAM gözlemi performans kıyaslaması değildir. Ağır derleme ve kurulumlar düşük RAM nedeniyle ana ajan tarafından sırayla yürütülür.

Canonical güvenlik raporu yerel Codex state içinde `scans/T-Bot/e72740f5f0f73bc40f65f13d3821c155719c2fa8_20261028T082910Z_vayxyqqi/report.md` kimliğiyle saklanır. Baseline raporu son yamalanmış çalışma ağacının tekrar taraması veya ürünün tamamı için güvenlik garantisi değildir. Son doğrulama bitmeden açıkların tamamının yeniden doğrulandığı iddia edilmez.

Yayın ön kontrolünde ana ajan GitHub bağlayıcısıyla iki deponun Releases listesini okudu; `t-bot` ve `t-bot-desktop` için liste boştu. İki remote için `git push --dry-run` yetki hatası olmadan geçti. Bunlar gerçek push, CI veya yayımlanmış yükleyici kanıtı değildir.

Yayın komutları (testler ve typecheck tamamlandıktan sonra):

```powershell
npm run dist:win
powershell -ExecutionPolicy Bypass -File scripts/deploy-local.ps1
npm pack --ignore-scripts
# CLI tarball'ını kurarken gerçek üretilen dosya adını kullanın:
npm install -g --ignore-scripts .\t-bot-cli-2.0.2.tgz
tbot --version
tbot --help
```

`--ignore-scripts` yalnızca önceden derlenmiş yerel tarball örneğinde kullanılır; Git kaynak kurulumunda kullanılmamalıdır. Windows release workflow `v2.0.2` etiketinin package sürümüyle eşleşmesini zorunlu tutar; kurulum, SHA256SUMS ve build manifestini birlikte yayımlar. Aynı etiketin yayımlanmış dosyalarını otomatik değiştirmez. Etiket ve push işlemleri ana ajan tarafından ayrıca yürütülür.

## Uzak kaynak CLI kurulum düzeltmesi

Ana ajan `5d0b0e6` commitini iki deponun `main` dalına gönderdi; her iki depoda Windows ve Ubuntu CI başarılı oldu. Ardından gerçek Windows README kurulum betiği denenince doğrudan global npm Git bağımlılığının hazırlığı başarısız oldu. Bu, CI ve yerel tarball başarısının uzak Git kurulumunu tek başına doğrulamadığını gösterdi.

Somut kanıt: `bin-links=true`, `ignore-scripts=false`, `omit` boştu. npm 11.12.1'in iç hazırlık günlüğü yerel kaynak bağımlılıklarını kurmak yerine global `t-bot-cli` bağlantısını hazırlamış; `prepare` içindeki `tsc` bulunamamıştı. Geçici Git checkout npm tarafından temizlendiği için o klasördeki bağımlılık dosyaları sonradan doğrulanamadı. Başarısız global işlem CLI giriş dosyasını kaldırdı; ana ajan derlenmiş tarball'ı yeniden kurarak global `T Bot 2.0.2` komutunu onardı. Bu başarısız deneme kurulum başarısı olarak sayılmaz.

Düzeltme: her iki kurulum betiği artık benzersiz geçici checkout'ta `HEAD == origin/main` kontrolü, commit kaydı, açıkça yerel `npm ci` ve tek `prepare` derlemesi, kaynak CLI yardım/sürüm kontrolü ve tarball paketlemesi yapar. Bunlar başarılı olmadan global kurulum çağrılmaz. `build.mjs` derleyiciyi TypeScript modülünden çözer; nested npm veya `tsc` PATH shim'i gerekmez. Doğrudan global Git npm alternatifi desteklenen belgelerden kaldırıldı. Global yazma aşamasındaki disk/izin hatalarında rollback garanti edilmez.

Yeni yardımcı için 4/4 izole test Windows'ta başarılı: PATH/npm olmadan modülden derleyici çözme, derleyici hata kodunu koruma, PowerShell ve Git POSIX shell altında kaynak derleme başarısızken global kurulumun hiç çağrılmaması. Sahte derleyici/komutlar ve geçici dosyalar kullanıldı; ürün veya gerçek uzak kurulum çalıştırılmadı. `build.mjs` Node syntax, `install.ps1` PowerShell parse ve `install.sh` POSIX `sh -n` kontrolleri başarılı. Bu son yamanın tam suite, setup ve gerçek uzak kaynak kurulum sonuçları ana ajan tarafından yeniden doğrulanıp teslim kaydında bildirilecektir. `v2.0.2` etiketi/release henüz yayımlanmış sayılmaz.

### Düzeltilmiş Windows kaynak kurulumunun gerçek doğrulaması

Ana ajan daha sonra `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1` komutunu gerçek uzak kaynakla çalıştırdı; çıkış kodu 0 oldu. Klonlanan `main` commit'i `e509f5338980958a451ae7563f80cd5a76e30fd9` idi. Geçici checkout'ta `npm ci` 357 paket kurdu; 358 paketlik audit sıfır bilinen açık bildirdi. `prepare`/derleme ve global değişiklikten önce kaynak CLI yardım/sürüm kontrolleri başarılı oldu; 177 dosyalı tarball üretildi. Global kurulum 98 paket değiştirdi; kurulu komutun yardım kontrolü ve beklenen `T Bot 2.0.2` sürüm eşitliği doğrulandı. Geçici dizin temizliği de tamamlandı. Bu sonuç önceki başarısız global Git denemesinden ve tarball ile onarımdan ayrı, düzeltilmiş staging akışının gerçek Windows kanıtıdır.

Bu doğrulama Linux/macOS üzerinde gerçek uzak kurulum başarısı iddiası değildir. Daha sonra eklenen PowerShell yürütücü yolu sertleştirmesinden sonraki toplu doğrulama aşağıda ayrı kaydedilmiştir; önceki 86 test sonucu bu yeni yamanın final suite sonucu olarak okunmamalıdır.

### Son kaynak doğrulaması

Ana ajan son güvenlik yaması dahil çalışma ağacında `npm test` çalıştırdı: **92/92 başarılı, 0 hata, 0 atlanan test; 3097,4 ms**. Önceki 86 teste kurulum yardımcıları için 4, Windows güvenlik yardımcısı için 1 ve masaüstü bellek trimi için 1 regresyon kontrolü eklendi. `npm run typecheck`, yeni Node derleme yardımcısıyla gerçek TypeScript derleyicisini çalıştıran `npm run build` ve derlenmiş renderer/preload `node --check` kontrolleri başarılı oldu. Testler E2E senaryosu değildir.

Bu son güvenlik yamasını içeren setup'ın yeniden üretilmesi ve yerel masaüstü kurulumu bu kayıt anında henüz tamamlanmamıştır; yukarıdaki önceki setup/kurulum başarıları bu son paketin kanıtı sayılmaz. Son setup, hash, kurulum, main push, etiket ve release/CI durumu ana ajanın final teslim kaydında bildirilir. `e509f53` veya sonraki commit için uzak CI sonucu burada varsayılmaz.

## Yeni kaynak sürümü — 2.1.0

2.1.0, OpenCode ve Hermes Agent'tan belirli MIT bileşenlerinin sabit upstream commitlerden uyarlanması için açıldı. Package ve lock kök sürümü 2.1.0'dır; bağımlılık sürümleri bu metadata değişikliğinde yükseltilmedi. OpenCode edit-match ve Hermes context-window portları kaynak ağacına eklendi ve aşağıdaki son kaynak doğrulaması tamamlandı. Yukarıdaki 2.0.2 sonuçları 2.1.0'ın doğrulaması sayılmaz. Port kaynakları ve zorunlu lisans metinleri [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) dosyasında kaydedilir.

Dar metadata/bildirim kontrolü package/lock sürüm uyumunu, önceki commit ile tüm resolved dependency kayıtlarının aynı kalmasını ve iki upstream copyright satırıyla tam MIT metinlerinin notices içinde bulunmasını doğruladı. Bunlar uygulama davranışını veya yeni portların regresyon güvenliğini tek başına doğrulamaz.

### 2.1.0 son kaynak doğrulaması

Ana ajanın konsolide entegrasyon kontrolü: **`npm test` 117/117 başarılı, 0 hata, 0 atlanan test; 2917,2725 ms**. Önceki 92 kontrole 13 edit, 10 context-window ve 2 masaüstü sürüm metadata testi eklendi. `npm run typecheck`, gerçek TypeScript derleyicisiyle `npm run build` ve derlenmiş renderer/preload `node --check` kontrolleri başarılı oldu. E2E testi veya canlı sağlayıcı görevi çalıştırılmadı.

Ana ajanın bu 2.1.0 snapshot'ındaki `npm audit --json` sonucu 383 toplam bağımlılık için sıfır bilinen açık bildirdi. Kilitli bağımlılıklar değiştirilmedi. Bu sonuç kaynak güvenliği veya gelecekte açık bulunmayacağı garantisi değildir.

OpenCode uyarlaması `fa1260d6ca484fe0fd868aa992ad81ab85343cf3` kaynağına sabittir; benzersiz Unicode/satır eşleştirmesi, kaynak context baytları ve mixed line-ending korunması ile iş/matris/batch sınırları odaklı fixture'larda denetlendi. T Bot'a özgü stale-write kontrolleri tam okumada içerik hash'i ve revision, partial okumada metadata revision kullanır; süreç içindeki kooperatif mutasyonları kilitler. Yeni dosya yayınlama no-clobber, mevcut dosya rename tekrarları yeniden içerik kontrolü kullanır; başarısız rename'i overwrite-copy ile örtmez. Bunlar son karşılaştırma ile rename arasında dış sürece karşı atomik OS CAS veya filesystem sandbox garantisi değildir. Geçerli UTF-8 text desteklenir; binary/UTF-16 düzenleme desteği yoktur. Ayrıntılar [çekirdek incelemesinde](core-review.md).

Hermes uyarlaması `ee7e0f517232fb619c72e49d7e648436bddc598e` kaynağına sabittir; bütçe penceresi, tool call/result atomikliği ve taşma davranışı fixture'larda denetlendi. 2001 mesajlı yerel fixture yaklaşık 15,6 ms'de 1500 tahmini token bütçesine karşı 1476 tahmini token üretti. Bu tek kontrollü gözlem kalite, gerçek sağlayıcı tokenizasyonu veya rakip benchmark'ı değildir. Korunması gereken tur/opaque native içerik bütçeyi aştığında sert kayıpsız üst sınır vaat edilmez; Python/LLM özetleme ve prepared background mekanizmaları taşınmadı. Ayrıntılar [context-window incelemesinde](context-window-review.md). Genel %50–75 tasarruf veya dünya sıralaması kanıtı yoktur.

Bu kayıt anında **2.1.0 setup, yerel kurulum, uzak main push, CI ve yayın henüz doğrulanmadı**. Kaynak belgeleri sabitlendikten sonra üretilecek son paket, manifest hashleri, kurulum ve release/CI sonuçları ana ajanın final teslim kaydında bildirilecektir. Önceki 2.0.2 paket/yayın başarıları bu yeni paketin kanıtı sayılmaz.

### Doğrulanmış 2.0.2 yayın geçmişi

Ana ajan `82aad18` için iki deponun main CI Windows/Ubuntu kontrollerini ve `v2.0.2` tag yayınını doğruladı. Windows release workflow çalışmaları `t-bot: 40660687286` ve `t-bot-desktop: 40660692444` başarılı; her iki GitHub release `draft=false` ve setup, `SHA256SUMS.txt`, `build-manifest.json` dosyalarını içeriyor. Manifest/checksum dosyaları doğrudan HTTP ile okunup GitHub executable asset digest'iyle karşılaştırıldı. İki deponun setup hashleri farklı, paketlenmiş `app.asar` hashleri aynıydı; bunlar ayrı CI derlemeleridir. Yayınlar: [t-bot v2.0.2](https://github.com/egemenkrdsek-boop/t-bot/releases/tag/v2.0.2), [t-bot-desktop v2.0.2](https://github.com/egemenkrdsek-boop/t-bot-desktop/releases/tag/v2.0.2).

Yerel son 2.0.2 derlemesi kendi manifestiyle kurulup hashleri ve native açılışı doğrulandı; bu yerel paket CI paketinden farklıdır. Yayımlanmış executable'ın indirilip yerelde kurulduğu iddia edilmez. `v2.0.2` etiketi değiştirilmeyecek; 2.1.0 kendi test/paket/yayın sürecini kullanacak. Bu yayın kanıtları 2.1.0'ın doğrulaması değildir.
