[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
# Build in an owned staging checkout before touching the global installation.
$previousSkip = $env:ELECTRON_SKIP_BINARY_DOWNLOAD
$staging = $null
$locationPushed = $false
try {
    $requestedRevision = [string]$env:TBOT_INSTALL_REVISION
    if ($requestedRevision -and $requestedRevision -notmatch '\A[a-fA-F0-9]{40}\z') { throw 'TBOT_INSTALL_REVISION must be a full 40-character commit SHA.' }
    $requestedRevision = $requestedRevision.ToLowerInvariant()
    foreach ($command in @('node', 'npm.cmd', 'git')) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Required command missing: $command. Install Node.js >=22.12 and Git, then reopen the terminal." }
    }
    & node -e "const [a,b]=process.versions.node.split('.').map(Number); if(a<22||(a===22&&b<12))process.exit(1)"
    if ($LASTEXITCODE -ne 0) { throw 'Node.js >=22.12.0 is required.' }
    $env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $staging = [IO.Path]::GetFullPath((Join-Path $tempRoot ('tbot-install-' + [Guid]::NewGuid().ToString('N'))))
    Write-Host 'Building T Bot CLI from GitHub main in a temporary checkout...'
    & git clone --depth 1 --branch main -- 'https://github.com/egemenkrdsek-boop/t-bot.git' $staging
    if ($LASTEXITCODE -ne 0) { throw 'Unable to clone T Bot source.' }
    if ($requestedRevision) {
        & git -C $staging fetch --depth 1 origin $requestedRevision
        if ($LASTEXITCODE -ne 0) { throw 'Unable to fetch the pinned T Bot revision.' }
        & git -C $staging checkout --detach $requestedRevision --
        if ($LASTEXITCODE -ne 0) { throw 'Unable to check out the pinned T Bot revision.' }
    }
    $revision = (& git -C $staging rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $revision -notmatch '^[a-f0-9]{40}$') { throw 'Unable to identify the source revision.' }
    if ($requestedRevision) {
        if ($revision -ne $requestedRevision) { throw 'Checkout does not match TBOT_INSTALL_REVISION.' }
    } else {
        $mainRevision = (& git -C $staging rev-parse refs/remotes/origin/main).Trim()
        if ($LASTEXITCODE -ne 0 -or $revision -ne $mainRevision) { throw 'Checkout does not match the remote main branch.' }
    }
    Write-Host "Source revision: $revision"
    Push-Location -LiteralPath $staging
    $locationPushed = $true
    & npm.cmd ci --global=false --include=dev --ignore-scripts=false
    if ($LASTEXITCODE -ne 0) { throw 'Source dependency install or build failed; global CLI was not changed.' }
    $version = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
    $builtVersion = (& node dist/index.js --version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $builtVersion -ne "T Bot $version") { throw 'Built CLI version check failed; global CLI was not changed.' }
    & node dist/index.js --help | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Built CLI help check failed; global CLI was not changed.' }
    & npm.cmd pack --global=false --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw 'CLI packaging failed; global CLI was not changed.' }
    $tarball = Join-Path $staging "t-bot-cli-$version.tgz"
    if (-not (Test-Path -LiteralPath $tarball -PathType Leaf)) { throw "CLI package missing: $tarball" }
    Pop-Location
    $locationPushed = $false
    & npm.cmd install --global --ignore-scripts $tarball
    if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE). Check the build output, network access and npm global prefix permissions." }
    $npmPrefix = (& npm.cmd prefix --global).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($npmPrefix)) { throw 'Unable to resolve npm global prefix.' }
    $cliPath = Join-Path $npmPrefix 'tbot.cmd'
    if (-not (Test-Path -LiteralPath $cliPath -PathType Leaf)) { throw "CLI shim not found: $cliPath" }
    & $cliPath --help
    if ($LASTEXITCODE -ne 0) { throw 'Installed CLI failed the --help check.' }
    $installedVersion = (& $cliPath --version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $installedVersion -ne "T Bot $version") { throw 'Installed CLI failed the expected version check.' }
    Write-Host $installedVersion
    if (($env:Path -split ';') -notcontains $npmPrefix) { $env:Path = "$npmPrefix;$env:Path" }
    $userPath = [string][Environment]::GetEnvironmentVariable('Path', 'User')
    if (($userPath -split ';') -notcontains $npmPrefix) {
        [Environment]::SetEnvironmentVariable('Path', (($userPath.TrimEnd(';') + ';' + $npmPrefix).TrimStart(';')), 'User')
    }
    Write-Host 'T Bot CLI installed and verified. Run tbot config, then tbot. Reopen other terminals to refresh PATH.'
} finally {
    if ($locationPushed) { Pop-Location }
    $env:ELECTRON_SKIP_BINARY_DOWNLOAD = $previousSkip
    if ($staging -and (Test-Path -LiteralPath $staging)) {
        $resolvedStaging = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $staging).Path)
        $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
        if (-not $resolvedStaging.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -or
            (Split-Path $resolvedStaging -Leaf) -notmatch '^tbot-install-[a-f0-9]{32}$') {
            throw "Refusing cleanup outside the owned staging directory: $resolvedStaging"
        }
        Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
    }
}
