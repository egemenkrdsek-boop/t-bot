[CmdletBinding()]
param(
    [string]$SetupPath,
    [string]$ManifestPath,
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Programs\T Bot')
)
$ErrorActionPreference = 'Stop'
function Get-Sha256([string]$Path) {
    # Works in Windows PowerShell even when the Utility module is unavailable.
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}
$repoRoot = Split-Path $PSScriptRoot -Parent
$version = (Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
if (-not $SetupPath) { $SetupPath = Join-Path $repoRoot "release\T-Bot-Setup-$version.exe" }
$SetupPath = (Resolve-Path -LiteralPath $SetupPath).Path
if (-not $ManifestPath) { $ManifestPath = Join-Path (Split-Path $SetupPath -Parent) 'build-manifest.json' }
$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
if ($manifest.version -ne $version -or $manifest.installer -ne (Split-Path $SetupPath -Leaf)) {
    throw 'Build manifest does not match the requested version and installer. Run npm run dist:win again.'
}
if ($manifest.installerSha256 -notmatch '^[a-f0-9]{64}$' -or $manifest.appAsarSha256 -notmatch '^[a-f0-9]{64}$') {
    throw 'Build manifest contains an invalid SHA256.'
}
if ((Get-Sha256 $SetupPath) -ne $manifest.installerSha256) {
    throw 'Installer SHA256 does not match the build manifest.'
}
$InstallDirectory = [IO.Path]::GetFullPath($InstallDirectory)
$executable = Join-Path $InstallDirectory 'T Bot.exe'
# Stop only this installation, after validating the installer exists.
Get-Process -Name 'T Bot' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $executable } | Stop-Process -Force
Write-Host "Installing $SetupPath into $InstallDirectory..."
# NSIS requires /D to be the final argument, without quotes.
$installer = Start-Process -FilePath $SetupPath -ArgumentList "/S /D=$InstallDirectory" -WindowStyle Hidden -PassThru -Wait
if ($installer.ExitCode -ne 0) { throw "Installer failed with exit code $($installer.ExitCode)." }
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw "Installer returned success but executable is missing: $executable" }
$installedAsar = Join-Path $InstallDirectory 'resources\app.asar'
if ((Get-Sha256 $installedAsar) -ne $manifest.appAsarSha256) {
    throw 'Installed application payload does not match the built app.asar SHA256.'
}
$installedVersion = (Get-Item -LiteralPath $executable).VersionInfo.ProductVersion
$requestedVersion = [version]$version
$actualVersion = [version]$installedVersion
# Windows executable metadata can add a zero revision to a three-part semver.
$revisionMatches = ($actualVersion.Revision -in @(-1, 0)) -and ($requestedVersion.Revision -in @(-1, 0))
if ($actualVersion.Major -ne $requestedVersion.Major -or
    $actualVersion.Minor -ne $requestedVersion.Minor -or
    $actualVersion.Build -ne $requestedVersion.Build -or -not $revisionMatches) {
    throw "Installed version '$installedVersion' does not match requested '$version'."
}
Write-Host "Installed T Bot $installedVersion at $executable. Launch it from the Start menu."
