# Kurulum ve güncelleme

## Gereksinimler

- Node.js >=22.12.0, npm ve Git. Kilitli Electron geliştirme bağımlılığı bu Node sürümünü gerektirir; geçici kaynak checkout'unda `npm ci` geliştirme bağımlılıklarını da kurar.
- GitHub/npm erişimi ve npm global prefix dizinine yazma izni.
- Windows masaüstü paketi oluşturmak için Windows x64, Electron ve electron-builder/NSIS indirmeleri için ağ erişimi.
- Tarayıcı işlemleri için Chrome veya Playwright uyumlu Chromium; `playwright-core` tarayıcıyı otomatik indirmez.

## CLI

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/egemenkrdsek-boop/t-bot/main/scripts/install.ps1 -ErrorAction Stop | iex
```

Linux/macOS:

```sh
sh -c 'script=$(curl -fsSL https://raw.githubusercontent.com/egemenkrdsek-boop/t-bot/main/scripts/install.sh) && printf "%s\n" "$script" | sh'
```

Bu betikler çalışma dizininizdeki yerel kopyayı seçmez; uzak `main` dalını benzersiz geçici dizine klonlar ve seçilen commit SHA'sını gösterir. `npm ci --global=false --include=dev --ignore-scripts=false` kilitli bağımlılıkları yerelde kurar ve `prepare` ile derler. Kaynak CLI yardım/sürüm kontrollerinden sonra tarball üretilir; ancak bundan sonra `npm install --global --ignore-scripts <tarball>` çalışır. Böylece kaynak derleme/paketleme hatası mevcut global CLI'yi değiştirmez. Global yazma işleminin disk/izin hatasında otomatik rollback garantisi yoktur. Geçici checkout işlem sonunda temizlenir.

Host ortamındaki isteğe bağlı `TBOT_INSTALL_REVISION` tam 40 hex karakterli commit SHA'sı kabul eder. CI veya tekrarlanabilir kurulum için sabit aynı upstream'den bu commit shallow fetch edilip detached checkout yapılır; HEAD eşitliği doğrulanmadan derleme/global kurulum başlamaz. Branch/tag adı veya komut bayrağı kabul edilmez. Değişken boşsa varsayılan `main` ve `HEAD == origin/main` kontrolü korunur. Bu, modelin araç argümanı değildir; kullanıcı/CI host ortamı ayarıdır.

Doğrudan `npm install -g git+...` npm 11 global Git hazırlığında yerel derleyici bağımlılıklarını bulamadığı için desteklenmez. Tekrarlanabilir kaynak kurulumu için doğruladığınız commit'i ayrı bir checkout'ta seçip `npm ci --global=false --include=dev --ignore-scripts=false`, `npm pack --ignore-scripts` ve üretilen tarball için `npm install -g --ignore-scripts <dosya>` kullanın. Kaynakta `prepare` derleme hatalarını korur; derleyici PATH shim'i yerine kurulu TypeScript modülünden çözülür. Hazır tarball'da kaynak yoksa gerekli dağıtım dosyaları denetlenir. `--ignore-scripts` kaynak derlemesinde kullanılmamalıdır. Betikler CLI kurulumu için Electron ikilisini indirmez.

Windows betiği npm global prefix'ini kullanıcı PATH'ine ekler. Linux/macOS betiği yalnızca gerekli profil değişikliğini gösterir; alt shell üst shell'in PATH'ini değiştiremez. Unix'te gerekirse shell profilinize `export PATH="$(npm prefix -g)/bin:$PATH"` ekleyin. Yazma izni hatasında kullanıcıya ait npm prefix'i kullanın; kurulum hatasını `--force` ile örtmeyin.

İlk kullanım: `tbot config`, ardından `tbot`. Güncellemek için aynı kurulum komutunu tekrar çalıştırın. Kaldırmak için `npm uninstall -g t-bot-cli` kullanın. Kullanıcı yapılandırması kaldırılmaz.

Telegram için `TELEGRAM_BOT_TOKEN` ve tercihen `TELEGRAM_ALLOWED_CHATS` yapılandırıp `tbot --bot` çalıştırın. Allowlist boşsa yerel terminalin gösterdiği `/pair <32-karakter hex kod>` komutunu yetkilendireceğiniz chat'e gönderin. Kod 10 dakika ve tüm chatler toplamında 10 denemeyle sınırlıdır, tek kullanımlıktır; yeni kod için ağ geçidini yerelden yeniden başlatın. Yapılandırılmış allowlist varken eşleştirme yoktur. Grup chat'i yetkilendirmek gruptaki üyelerin tamamına chat yetkisi verir.

## Kaynaktan masaüstü ve yerel kurulum

```powershell
npm ci
npm run typecheck
npm run dist:win
powershell -ExecutionPolicy Bypass -File scripts/deploy-local.ps1
```

`npm ci` kaynak paketini de derler. `npm run dist:win`, TypeScript çıktılarını ve renderer HTML/CSS/JS/preload dosyalarını oluşturur, ardından tek yapılandırma kaynağı `electron-builder.yml` ile NSIS paketi üretir. Çıktı `release/T-Bot-Setup-<version>.exe` ve yükleyici/uygulama SHA256 değerlerini içeren `release/build-manifest.json` olur. Yükleyici Windows x64 içindir; imzalama sertifikası yapılandırılmadıysa imzasızdır ve Windows uyarı gösterebilir.

Yerel kurulum betiği varsayılan olarak `%LOCALAPPDATA%\Programs\T Bot` konumuna kurar. Gerekirse `-SetupPath <exe>`, `-ManifestPath <json>` ve `-InstallDirectory <dizin>` verin. Manifest varsayılan olarak yükleyicinin yanında aranır; eski, manifestsiz yükleyiciyi bu betikle kurmadan önce yeniden derleyin. Betik süreçleri kapatmadan önce yükleyicinin SHA256 değerini doğrular, yalnızca hedef kurulumdaki çalışan T Bot süreçlerini kapatır; yükleyici hatasında, sürüm veya kurulan `resources/app.asar` SHA256 uyuşmazlığında durur. Uygulamayı otomatik açmaz. Manifest bütünlük denetimidir; imza veya bağımsız güven kaynağı değildir. Windows Ayarlar > Uygulamalar üzerinden kaldırabilirsiniz.

Geliştirme: `npm run desktop`. Electron indirmesini önceki CLI kurulumunda atladıysanız, `ELECTRON_SKIP_BINARY_DOWNLOAD` ortam değişkenini kaldırıp `node node_modules/electron/install.js` çalıştırın.

## Sorun giderme

- `tbot` bulunamıyorsa npm global prefix ve PATH'i kontrol edip yeni terminal açın.
- Derleme hatasında üstteki ilk TypeScript/asset hatasını düzeltin; betik artık hatayı yutmaz.
- API `401` hatasında `tbot config` ile anahtarı yenileyin. Sağlayıcının model erişimini ayrıca kontrol edin.
- `tbot doctor` ortam bilgisi sağlar; gerçek model, tarayıcı veya masaüstü akışının başarı testi değildir.
- Yapılandırma Windows'ta `%APPDATA%\TBot`, diğer sistemlerde `~/.config/TBot` altındadır. Anahtar saklama davranışını kullanılan sistem ve sürüm için ayrıca değerlendirin.
