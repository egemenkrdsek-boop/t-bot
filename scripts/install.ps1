[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
# Build in an owned staging checkout before touching the global installation.
$previousSkip = $env:ELECTRON_SKIP_BINARY_DOWNLOAD
$staging = $null
$backup = $null
$locationPushed = $false
$npmPrefix = $null
$globalPackageDir = $null
$cliBackedUp = $false
$restoreArmed = $false
$shimNames = @('tbot', 'tbot.cmd', 'tbot.ps1', 't-bot', 't-bot.cmd', 't-bot.ps1', 't-bot-cli', 't-bot-cli.cmd', 't-bot-cli.ps1')
try {
    $requestedRevision = [string]$env:TBOT_INSTALL_REVISION
    if ($requestedRevision -and $requestedRevision -notmatch '\A[a-fA-F0-9]{40}\z') { throw 'TBOT_INSTALL_REVISION must be a full 40-character commit SHA.' }
    $requestedRevision = $requestedRevision.ToLowerInvariant()
    $requestedRef = [string]$env:TBOT_INSTALL_REF
    if (-not $requestedRef) { $requestedRef = 'release' }
    if ($requestedRef -notmatch '\A[A-Za-z0-9._/-]{1,80}\z' -or $requestedRef.Contains('..')) { throw 'TBOT_INSTALL_REF must be a branch or tag name.' }
    foreach ($command in @('node', 'npm.cmd', 'git')) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Required command missing: $command. Install Node.js >=22.12 and Git, then reopen the terminal." }
    }
    & node -e "const [a,b]=process.versions.node.split('.').map(Number); if(a<22||(a===22&&b<12))process.exit(1)"
    if ($LASTEXITCODE -ne 0) { throw 'Node.js >=22.12.0 is required.' }
    $env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $staging = [IO.Path]::GetFullPath((Join-Path $tempRoot ('tbot-install-' + [Guid]::NewGuid().ToString('N'))))
    Write-Host "Building T Bot CLI from GitHub $requestedRef in a temporary checkout..."
    & git clone --depth 1 --branch $requestedRef -- 'https://github.com/egemenkrdsek-boop/t-bot.git' $staging
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
        # Compare HEAD with the requested remote branch (or tag) instead of
        # special-casing one branch name. If neither ref resolves, fail closed.
        # Redirected native stderr becomes an ErrorRecord under the script-wide
        # Stop preference in Windows PowerShell 5.1, so probe under a local
        # SilentlyContinue preference and check the exit code explicitly.
        $probePreference = $ErrorActionPreference
        $ErrorActionPreference = 'SilentlyContinue'
        $expectedRevision = (& git -C $staging rev-parse --verify "refs/remotes/origin/$requestedRef" 2>$null | Out-String).Trim()
        $probeExit = $LASTEXITCODE
        if ($probeExit -ne 0 -or $expectedRevision -notmatch '^[a-f0-9]{40}$') {
            $expectedRevision = (& git -C $staging rev-parse --verify "refs/tags/$requestedRef" 2>$null | Out-String).Trim()
            $probeExit = $LASTEXITCODE
        }
        $ErrorActionPreference = $probePreference
        if ($probeExit -ne 0 -or $expectedRevision -notmatch '^[a-f0-9]{40}$') { throw "Unable to verify the requested ref: $requestedRef." }
        if ($revision -ne $expectedRevision) { throw "Checkout does not match the requested ref: $requestedRef." }
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
    $npmPrefix = (& npm.cmd prefix --global | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($npmPrefix)) { throw 'Unable to resolve npm global prefix.' }
    # Best-effort rollback: copy the previous t-bot-cli package directory and
    # its bin shims before npm mutates the prefix. Shared dependencies at the
    # prefix root are not copied; this protects the CLI entry point, not a full
    # dependency snapshot.
    $globalPackageDir = Join-Path (Join-Path $npmPrefix 'node_modules') 't-bot-cli'
    if (Test-Path -LiteralPath $globalPackageDir -PathType Container) {
        $backup = Join-Path $tempRoot ('tbot-cli-backup-' + [Guid]::NewGuid().ToString('N'))
        & New-Item -ItemType Directory -Path $backup -Force | Out-Null
        Copy-Item -LiteralPath $globalPackageDir -Destination (Join-Path $backup 'package') -Recurse -Force
        foreach ($name in $shimNames) {
            $shim = Join-Path $npmPrefix $name
            if (Test-Path -LiteralPath $shim -PathType Leaf) { Copy-Item -LiteralPath $shim -Destination (Join-Path $backup $name) -Force }
        }
        $cliBackedUp = $true
    }
    $restoreArmed = $cliBackedUp
    & npm.cmd install --global --ignore-scripts $tarball
    if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE). Check the build output, network access and npm global prefix permissions." }
    $cliPath = Join-Path $npmPrefix 'tbot.cmd'
    if (-not (Test-Path -LiteralPath $cliPath -PathType Leaf)) { throw "CLI shim not found: $cliPath" }
    & $cliPath --help
    if ($LASTEXITCODE -ne 0) { throw 'Installed CLI failed the --help check.' }
    $installedVersion = (& $cliPath --version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $installedVersion -ne "T Bot $version") { throw 'Installed CLI failed the expected version check.' }
    $restoreArmed = $false
    Write-Host $installedVersion
    if (($env:Path -split ';') -notcontains $npmPrefix) { $env:Path = "$npmPrefix;$env:Path" }
    $userPath = [string][Environment]::GetEnvironmentVariable('Path', 'User')
    if (($userPath -split ';') -notcontains $npmPrefix) {
        [Environment]::SetEnvironmentVariable('Path', (($userPath.TrimEnd(';') + ';' + $npmPrefix).TrimStart(';')), 'User')
    }
    Write-Host 'T Bot CLI installed and verified. Run tbot config, then tbot. Reopen other terminals to refresh PATH.'
} catch {
    if ($restoreArmed -and $cliBackedUp -and $backup -and $globalPackageDir -and $npmPrefix) {
        try {
            if (Test-Path -LiteralPath $globalPackageDir) { Remove-Item -LiteralPath $globalPackageDir -Recurse -Force }
            $packageParent = Split-Path -Parent $globalPackageDir
            if (-not (Test-Path -LiteralPath $packageParent -PathType Container)) { & New-Item -ItemType Directory -Path $packageParent -Force | Out-Null }
            Copy-Item -LiteralPath (Join-Path $backup 'package') -Destination $globalPackageDir -Recurse -Force
            foreach ($entry in Get-ChildItem -LiteralPath $backup -File) {
                Copy-Item -LiteralPath $entry.FullName -Destination (Join-Path $npmPrefix $entry.Name) -Force
            }
            Write-Host 'Previous T Bot CLI restored after the failed update.'
        } catch {
            Write-Warning "The previous CLI could not be restored automatically: $($_.Exception.Message) Reinstall it with: npm install -g t-bot-cli@<previous-version>"
        }
    }
    throw
} finally {
    if ($locationPushed) { Pop-Location }
    $env:ELECTRON_SKIP_BINARY_DOWNLOAD = $previousSkip
    foreach ($owned in @($staging, $backup)) {
        if (-not $owned -or -not (Test-Path -LiteralPath $owned)) { continue }
        $resolved = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $owned).Path)
        $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
        $leafPattern = if ($owned -eq $staging) { '^tbot-install-[a-f0-9]{32}$' } else { '^tbot-cli-backup-[a-f0-9]{32}$' }
        if (-not $resolved.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -or
            (Split-Path $resolved -Leaf) -notmatch $leafPattern) {
            throw "Refusing cleanup outside the owned temporary directory: $resolved"
        }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
