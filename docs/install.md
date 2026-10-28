# Kurulum ve güncelleme

## Gereksinimler

- Node.js >=22.12.0, npm ve Git. Kilitli Electron geliştirme bağımlılığı bu Node sürümünü gerektirir; Git kaynak kurulumları `prepare` sırasında geliştirme bağımlılıklarını da kullanır.
- GitHub/npm erişimi ve npm global prefix dizinine yazma izni.
- Windows masaüstü paketi oluşturmak için Windows x64, Electron ve electron-builder/NSIS indirmeleri için ağ erişimi.
- Tarayıcı işlemleri için Chrome veya Playwright uyumlu Chromium; `playwright-core` tarayıcıyı otomatik indirmez.

## CLI

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/egemenkrdsek-boop/t-bot/main/scripts/install.ps1 | iex
```

Linux/macOS:

```sh
curl -fsSL https://raw.githubusercontent.com/egemenkrdsek-boop/t-bot/main/scripts/install.sh | sh
```

Bu betikler çalışma dizininizdeki yerel kopyayı seçmez; her zaman uzak `main` dalını kurar. `main` değişebilir; tekrarlanabilir bir sürüm için aşağıdaki npm komutundaki `main` yerine doğruladığınız tam commit SHA'sını kullanın:

```sh
npm install -g 'git+https://github.com/egemenkrdsek-boop/t-bot.git#main'
```

Kaynakta `prepare` derleme hatalarını görünür biçimde döndürür. Hazır npm tarball'ında kaynak yoksa gerekli CLI ve masaüstü dosyalarının varlığını denetler. `--ignore-scripts` kullanımı kaynak kurulumunun derlenmesini engeller. Betikler Electron ikilisini CLI kurulumu için indirmez.

Windows betiği npm global prefix'ini kullanıcı PATH'ine ekler. Linux/macOS betiği yalnızca gerekli profil değişikliğini gösterir; alt shell üst shell'in PATH'ini değiştiremez. Unix'te gerekirse shell profilinize `export PATH="$(npm prefix -g)/bin:$PATH"` ekleyin. Yazma izni hatasında kullanıcıya ait npm prefix'i kullanın; kurulum hatasını `--force` ile örtmeyin.

İlk kullanım: `tbot config`, ardından `tbot`. Güncellemek için aynı kurulum komutunu tekrar çalıştırın. Kaldırmak için `npm uninstall -g t-bot-cli` kullanın. Kullanıcı yapılandırması kaldırılmaz.

## Kaynaktan masaüstü ve yerel kurulum

```powershell
npm ci
npm run typecheck
npm run dist:win
powershell -ExecutionPolicy Bypass -File scripts/deploy-local.ps1
```

`npm ci` kaynak paketini de derler. `npm run dist:win`, TypeScript çıktılarını ve renderer HTML/CSS/JS/preload dosyalarını oluşturur, ardından tek yapılandırma kaynağı `electron-builder.yml` ile NSIS paketi üretir. Çıktı `release/T-Bot-Setup-<version>.exe` olur. Yükleyici Windows x64 içindir; imzalama sertifikası yapılandırılmadıysa imzasızdır ve Windows uyarı gösterebilir.

Yerel kurulum betiği varsayılan olarak `%LOCALAPPDATA%\Programs\T Bot` konumuna kurar. Gerekirse `-SetupPath <exe>` ve `-InstallDirectory <dizin>` verin. Betik yalnızca hedef kurulumdaki çalışan T Bot süreçlerini kapatır; yükleyici hatasında veya sürüm uyuşmazlığında durur. Uygulamayı otomatik açmaz. Windows Ayarlar > Uygulamalar üzerinden kaldırabilirsiniz.

Geliştirme: `npm run desktop`. Electron indirmesini önceki CLI kurulumunda atladıysanız, `ELECTRON_SKIP_BINARY_DOWNLOAD` ortam değişkenini kaldırıp `node node_modules/electron/install.js` çalıştırın.

## Sorun giderme

- `tbot` bulunamıyorsa npm global prefix ve PATH'i kontrol edip yeni terminal açın.
- Derleme hatasında üstteki ilk TypeScript/asset hatasını düzeltin; betik artık hatayı yutmaz.
- API `401` hatasında `tbot config` ile anahtarı yenileyin. Sağlayıcının model erişimini ayrıca kontrol edin.
- `tbot doctor` ortam bilgisi sağlar; gerçek model, tarayıcı veya masaüstü akışının başarı testi değildir.
- Yapılandırma Windows'ta `%APPDATA%\TBot`, diğer sistemlerde `~/.config/TBot` altındadır. Anahtar saklama davranışını kullanılan sistem ve sürüm için ayrıca değerlendirin.
