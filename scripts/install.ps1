# ==============================================================================
# T Bot 2.0 - Windows Uzaktan Tek Komutla Kurulum Betiği
# Kullanım: irm https://raw.githubusercontent.com/egemenkrdsek-boop/t-bot/main/scripts/install.ps1 | iex
# ==============================================================================

[CmdletBinding()]
param()

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

function Show-Header {
    Write-Host ""
    Write-Host "    ████████╗    ██████╗  ██████╗ ████████╗" -ForegroundColor White
    Write-Host "    ╚══██╔══╝    ██╔══██╗██╔═══██╗╚══██╔══╝" -ForegroundColor Cyan
    Write-Host "       ██║       ██████╔╝██║   ██║   ██║   " -ForegroundColor Cyan
    Write-Host "       ██║       ██╔══██╗██║   ██║   ██║   " -ForegroundColor White
    Write-Host "       ██║       ██████╔╝╚██████╔╝   ██║   " -ForegroundColor Cyan
    Write-Host "       ╚═╝       ╚═════╝  ╚═════╝    ╚═╝   " -ForegroundColor White
    Write-Host ""
    Write-Host "  T Bot 2.0 — Tri-Core Local AI Agent & Autonomous Gateway (Crystal-Ice Edition)" -ForegroundColor White
    Write-Host "  https://github.com/egemenkrdsek-boop/t-bot" -ForegroundColor Cyan
    Write-Host "  ──────────────────────────────────────────────────────────────────────────────" -ForegroundColor Cyan
    Write-Host ""
}

function Show-ErrorAndExit {
    param(
        [string]$Message,
        [string]$Resolution
    )
    Write-Host ""
    Write-Host "[HATA] $Message" -ForegroundColor Red
    if ($Resolution) {
        Write-Host "Çözüm: $Resolution" -ForegroundColor Yellow
    }
    Write-Host ""
    exit 1
}

Show-Header

# ------------------------------------------------------------------------------
# Adım 1: Sistem Gereksinimleri Kontrolü (Node.js >= 20.3, npm, git)
# ------------------------------------------------------------------------------
Write-Host "[1/3] Sistem gereksinimleri kontrol ediliyor..." -ForegroundColor Cyan

# Node.js Kontrolü
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Show-ErrorAndExit `
        -Message "Node.js sisteminizde kurulu değil veya PATH çevre değişkenine eklenmemiş." `
        -Resolution "T Bot 2.0 için Node.js 20.3 veya üzeri gereklidir.`n        Hızlı kurulum: winget install OpenJS.NodeJS.LTS`n        veya https://nodejs.org adresinden LTS sürümünü indirebilirsiniz."
}

try {
    $nodeVerRaw = (node -v).Trim()
    if ($nodeVerRaw -match '^v?(\d+)\.(\d+)') {
        $nodeMajor = [int]$Matches[1]
        $nodeMinor = [int]$Matches[2]
        if ($nodeMajor -lt 20 -or ($nodeMajor -eq 20 -and $nodeMinor -lt 3)) {
            Show-ErrorAndExit `
                -Message "Mevcut Node.js sürümünüz ($nodeVerRaw) gereksinimleri karşılamıyor." `
                -Resolution "T Bot 2.0 için en az Node.js 20.3 veya üzeri gereklidir.`n        Güncellemek için: winget install OpenJS.NodeJS.LTS"
        }
    }
    Write-Host "  [OK] Node.js: $nodeVerRaw" -ForegroundColor Green
} catch {
    Write-Host "  [BİLGİ] Node.js sürümü doğrulanamadı, kuruluma devam ediliyor." -ForegroundColor Yellow
}

# npm Kontrolü
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCmd) {
    Show-ErrorAndExit `
        -Message "npm paket yöneticisi sisteminizde bulunamadı." `
        -Resolution "Node.js kurulumunuzun eksiksiz olduğundan emin olun (npm Node.js ile birlikte gelir)."
}
$npmVer = (npm -v).Trim()
Write-Host "  [OK] npm: v$npmVer" -ForegroundColor Green

# Git Kontrolü
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCmd) {
    Show-ErrorAndExit `
        -Message "Git sisteminizde bulunamadı veya PATH ortam değişkeninde yer almıyor." `
        -Resolution "T Bot 2.0'ı GitHub üzerinden kurabilmek için Git gereklidir.`n        Yüklemek için terminalde: winget install Git.Git`n        veya https://git-scm.com adresini ziyaret edin."
}
$gitVer = (git --version).Trim()
Write-Host "  [OK] Git: $gitVer" -ForegroundColor Green

Write-Host ""

# ------------------------------------------------------------------------------
# Adım 2: T Bot 2.0 Global Kurulumu
# ------------------------------------------------------------------------------
Write-Host "[2/3] T Bot 2.0 paketi kuruluyor..." -ForegroundColor Cyan

$repoUrl = "git+https://github.com/egemenkrdsek-boop/t-bot.git"
$isLocalRepo = $false

if (Test-Path "package.json") {
    try {
        $pkg = Get-Content "package.json" -Raw | ConvertFrom-Json
        if ($pkg.name -eq "t-bot-cli") {
            $isLocalRepo = $true
        }
    } catch {
        $isLocalRepo = $false
    }
}

if ($isLocalRepo) {
    Write-Host "  Yerel kaynak dizini algılandı. Yerel paket derlenip global yükleniyor..." -ForegroundColor White
    npm install -g --force .
} else {
    Write-Host "  GitHub deposu klonlanıp global olarak yükleniyor ($repoUrl)..." -ForegroundColor White
    npm install -g --force $repoUrl
}

if ($LASTEXITCODE -ne 0) {
    Show-ErrorAndExit `
        -Message "npm install komutu başarısız oldu (Hata kodu: $LASTEXITCODE)." `
        -Resolution "Depoya erişim yetkinizi, internet bağlantınızı veya PowerShell'i Yönetici olarak çalıştırmayı deneyin."
}

Write-Host "  [OK] Paket başarıyla yüklendi." -ForegroundColor Green
Write-Host ""

# ------------------------------------------------------------------------------
# Adım 3: Doğrulama (tbot --help) ve Kalıcı PATH Senkronizasyonu
# ------------------------------------------------------------------------------
Write-Host "[3/3] Kurulum doğrulanıyor ve PATH yapılandırılıyor..." -ForegroundColor Cyan

try {
    $npmPrefix = (npm prefix -g).Trim()
    $npmBinPath = $npmPrefix
    if (Test-Path (Join-Path $npmPrefix "bin")) {
        $npmBinPath = Join-Path $npmPrefix "bin"
    }
    if ($env:Path -notlike "*$npmBinPath*" -and $env:Path -notlike "*$npmPrefix*") {
        $env:Path = "$npmBinPath;$env:Path"
    }
    if ($env:APPDATA) {
        $appDataNpm = Join-Path $env:APPDATA "npm"
        if ((Test-Path $appDataNpm) -and ($env:Path -notlike "*$appDataNpm*")) {
            $env:Path = "$appDataNpm;$env:Path"
        }
    }

    # Kalıcı User PATH ortam değişkeni kaydı
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ([string]::IsNullOrWhiteSpace($userPath)) {
        [Environment]::SetEnvironmentVariable('Path', $npmBinPath, 'User')
        Write-Host "  [OK] '$npmBinPath' kullanıcı PATH değişkenine kalıcı olarak eklendi." -ForegroundColor Green
    } elseif ($userPath -notlike "*$npmBinPath*") {
        [Environment]::SetEnvironmentVariable('Path', "$userPath;$npmBinPath", 'User')
        Write-Host "  [OK] '$npmBinPath' kullanıcı PATH değişkenine kalıcı olarak eklendi." -ForegroundColor Green
    }
} catch {
    # PATH zenginleştirme hatası yutulabilir
}

$tbotCmd = Get-Command tbot -ErrorAction SilentlyContinue
$helpCheckOk = $false

if ($tbotCmd) {
    Write-Host "  [OK] 'tbot' komutu bulundu: $($tbotCmd.Source)" -ForegroundColor Green
    try {
        $helpOutput = tbot --help 2>&1
        if ($LASTEXITCODE -eq 0) {
            $helpCheckOk = $true
            Write-Host "  [OK] 'tbot --help' doğrulaması başarılı." -ForegroundColor Green
        }
    } catch {
        # Doğrulama hatası
    }
} else {
    Write-Host "  [BİLGİ] 'tbot' komutu mevcut oturumda anında bulunamadı." -ForegroundColor Yellow
    Write-Host "  npm global ikili dizini PATH değişkeninize yeni eklenmiş olabilir." -ForegroundColor White
    Write-Host "  Lütfen terminalinizi kapatıp yeniden açın veya PATH'inizi tazeleyin." -ForegroundColor White
}

Write-Host ""
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "[OK] T Bot 2.0 başarıyla kuruldu! Başlatmak için terminale 'tbot' yazın." -ForegroundColor White
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Hızlı Başlangıç İpuçları:" -ForegroundColor White
Write-Host "    tbot                  Etkileşimli Crystal-Ice Cyber-Zen TUI oturumu başlatır" -ForegroundColor Cyan
Write-Host "    tbot config           Sağlayıcı (Gemini, OpenAI, Anthropic, OpenRouter) ayarla" -ForegroundColor Cyan
Write-Host "    tbot doctor           Ortam ve sistem sağlığını denetle" -ForegroundColor Cyan
Write-Host "    tbot --bot            Sıfır-Backend Telegram Bot ağ geçidini başlat" -ForegroundColor Cyan
Write-Host "    tbot --ultracode      4-Aşamalı Öz-Onarımlı otonom kodlama modunu aç" -ForegroundColor Cyan
Write-Host "    tbot --help           Tüm komutları ve bayrakları listele" -ForegroundColor Cyan
Write-Host ""
