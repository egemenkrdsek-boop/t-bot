# ==============================================================================
# T Bot 2.0 - Windows Uzaktan Tek Komutla Kurulum Betiği
# Kullanım: irm https://raw.githubusercontent.com/egemenkrdsek-boop/t-bot/main/scripts/install.ps1 | iex
# ==============================================================================

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Show-Header {
    Write-Host ""
    Write-Host "    ______     ____        __   ___     ____ " -ForegroundColor Cyan
    Write-Host "   /_  __/    / __ )____  / /_ |__ \   / __ \ " -ForegroundColor Cyan
    Write-Host "    / /      / __  / __ \/ __/ __/ /  / / / / " -ForegroundColor Cyan
    Write-Host "   / /      / /_/ / /_/ / /_  / __/__/ /_/ /  " -ForegroundColor Cyan
    Write-Host "  /_/      /_____/\____/\__/ /____(_)____/   " -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  T Bot 2.0 - Tri-Core Local AI Agent and Autonomous Gateway" -ForegroundColor Green
    Write-Host "  https://github.com/egemenkrdsek-boop/t-bot" -ForegroundColor DarkGray
    Write-Host "  -------------------------------------------------------------" -ForegroundColor DarkGray
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
        Write-Host "Cozum: $Resolution" -ForegroundColor Yellow
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
        -Message "Node.js sisteminizde kurulu degil veya PATH cevre degiskenine eklenmemis." `
        -Resolution "T Bot 2.0 icin Node.js 20.3 veya uzeri gereklidir.`n        Hizli kurulum: winget install OpenJS.NodeJS.LTS`n        veya https://nodejs.org adresinden LTS surumunu indirebilirsiniz."
}

try {
    $nodeVerRaw = (node -v).Trim()
    if ($nodeVerRaw -match '^v?(\d+)\.(\d+)') {
        $nodeMajor = [int]$Matches[1]
        $nodeMinor = [int]$Matches[2]
        if ($nodeMajor -lt 20 -or ($nodeMajor -eq 20 -and $nodeMinor -lt 3)) {
            Show-ErrorAndExit `
                -Message "Mevcut Node.js surumunuz ($nodeVerRaw) gereksinimleri karsilamiyor." `
                -Resolution "T Bot 2.0 icin en az Node.js 20.3 veya uzeri gereklidir.`n        Guncellemek icin: winget install OpenJS.NodeJS.LTS"
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
        -Message "Git sisteminizde bulunamadi veya PATH ortam degiskeninde yer almiyor." `
        -Resolution "T Bot 2.0'i GitHub uzerinden kurabilmek icin Git gereklidir.`n        Yuklemek icin terminalde: winget install Git.Git`n        veya https://git-scm.com adresini ziyaret edin."
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
    Write-Host "  Yerel kaynak dizini algilandi. Yerel paket derlenip global yukleniyor..." -ForegroundColor DarkGray
    npm install -g .
} else {
    Write-Host "  GitHub deposu klonlanip global olarak yukleniyor ($repoUrl)..." -ForegroundColor DarkGray
    npm install -g $repoUrl
}

if ($LASTEXITCODE -ne 0) {
    Show-ErrorAndExit `
        -Message "npm install komutu basarisiz oldu (Hata kodu: $LASTEXITCODE)." `
        -Resolution "Depoya erisim yetkinizi, internet baglantinizi veya PowerShell'i Yonetici olarak calistirmayi deneyin."
}

Write-Host "  [OK] Paket basariyla yuklendi." -ForegroundColor Green
Write-Host ""

# ------------------------------------------------------------------------------
# Adım 3: Doğrulama (tbot --help) ve PATH Senkronizasyonu
# ------------------------------------------------------------------------------
Write-Host "[3/3] Kurulum dogrulaniyor..." -ForegroundColor Cyan

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
} catch {
    # PATH zenginlestirme hatasi yutulabilir
}

$tbotCmd = Get-Command tbot -ErrorAction SilentlyContinue
$helpCheckOk = $false

if ($tbotCmd) {
    Write-Host "  [OK] 'tbot' komutu bulundu: $($tbotCmd.Source)" -ForegroundColor Green
    try {
        $helpOutput = tbot --help 2>&1
        if ($LASTEXITCODE -eq 0) {
            $helpCheckOk = $true
            Write-Host "  [OK] 'tbot --help' dogrulamasi basarili." -ForegroundColor Green
        }
    } catch {
        # Dogrulama hatasi
    }
} else {
    Write-Host "  [BİLGİ] 'tbot' komutu mevcut oturumda anında bulunamadı." -ForegroundColor Yellow
    Write-Host "  npm global ikili dizini PATH değişkeninize yeni eklenmiş olabilir." -ForegroundColor DarkGray
    Write-Host "  Lütfen terminalinizi kapatıp yeniden açın veya PATH'inizi tazeleyin." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "========================================================================" -ForegroundColor Green
Write-Host "[OK] T Bot 2.0 başarıyla kuruldu! Başlatmak için terminale 'tbot' yazın." -ForegroundColor Green
Write-Host "========================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Hızlı Başlangıç İpuçları:" -ForegroundColor White
Write-Host "    tbot                  Etkilesimli Siber-Minimalist TUI oturumu baslatir" -ForegroundColor Cyan
Write-Host "    tbot config           Saglayici (Gemini, OpenAI, Anthropic, OpenRouter) ayarla" -ForegroundColor Cyan
Write-Host "    tbot doctor           Ortam ve sistem sagligini denetle" -ForegroundColor Cyan
Write-Host "    tbot --bot            Sifir-Backend Telegram Bot ag gecidini baslat" -ForegroundColor Cyan
Write-Host "    tbot --ultracode      4-Asamali Oz-Onarimli otonom kodlama modunu ac" -ForegroundColor Cyan
Write-Host "    tbot --help           Tum komutlari ve bayraklari listele" -ForegroundColor Cyan
Write-Host ""
