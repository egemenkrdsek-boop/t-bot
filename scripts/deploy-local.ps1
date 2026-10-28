[CmdletBinding()]
param(
    [string]$SetupPath,
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Programs\T Bot')
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$version = (Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
if (-not $SetupPath) { $SetupPath = Join-Path $repoRoot "release\T-Bot-Setup-$version.exe" }
$SetupPath = (Resolve-Path -LiteralPath $SetupPath).Path
$InstallDirectory = [IO.Path]::GetFullPath($InstallDirectory)
$executable = Join-Path $InstallDirectory 'T Bot.exe'
# Stop only this installation, after validating the installer exists.
Get-Process -Name 'T Bot' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $executable } | Stop-Process -Force
Write-Host "Installing $SetupPath into $InstallDirectory..."
# NSIS requires /D to be the final argument, without quotes.
$installer = Start-Process -FilePath $SetupPath -ArgumentList "/S /D=$InstallDirectory" -WindowStyle Hidden -PassThru -Wait
if ($installer.ExitCode -ne 0) { throw "Installer failed with exit code $($installer.ExitCode)." }
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw "Installer returned success but executable is missing: $executable" }
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
