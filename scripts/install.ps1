[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
# Git dependencies run prepare with development dependencies; skip the Electron
# download for a CLI install. npm run desktop needs its binary separately.
$previousSkip = $env:ELECTRON_SKIP_BINARY_DOWNLOAD
try {
    foreach ($command in @('node', 'npm.cmd', 'git')) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Required command missing: $command. Install Node.js >=22.12 and Git, then reopen the terminal." }
    }
    & node -e "const [a,b]=process.versions.node.split('.').map(Number); if(a<22||(a===22&&b<12))process.exit(1)"
    if ($LASTEXITCODE -ne 0) { throw 'Node.js >=22.12.0 is required.' }
    $env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
    Write-Host 'Installing T Bot CLI from GitHub main...'
    & npm.cmd install --global 'git+https://github.com/egemenkrdsek-boop/t-bot.git#main'
    if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE). Check the build output, network access and npm global prefix permissions." }
    $npmPrefix = (& npm.cmd prefix --global).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($npmPrefix)) { throw 'Unable to resolve npm global prefix.' }
    $cliPath = Join-Path $npmPrefix 'tbot.cmd'
    if (-not (Test-Path -LiteralPath $cliPath -PathType Leaf)) { throw "CLI shim not found: $cliPath" }
    & $cliPath --help
    if ($LASTEXITCODE -ne 0) { throw 'Installed CLI failed the --help check.' }
    & $cliPath --version
    if ($LASTEXITCODE -ne 0) { throw 'Installed CLI failed the --version check.' }
    if (($env:Path -split ';') -notcontains $npmPrefix) { $env:Path = "$npmPrefix;$env:Path" }
    $userPath = [string][Environment]::GetEnvironmentVariable('Path', 'User')
    if (($userPath -split ';') -notcontains $npmPrefix) {
        [Environment]::SetEnvironmentVariable('Path', (($userPath.TrimEnd(';') + ';' + $npmPrefix).TrimStart(';')), 'User')
    }
    Write-Host 'T Bot CLI installed and verified. Run tbot config, then tbot. Reopen other terminals to refresh PATH.'
} finally {
    $env:ELECTRON_SKIP_BINARY_DOWNLOAD = $previousSkip
}
