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

## Güncel inceleme — 2.0.2 (2026-10-28)

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
