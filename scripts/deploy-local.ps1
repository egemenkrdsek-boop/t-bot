# scripts/deploy-local.ps1
# Deploy updated setup, refresh desktop shortcuts & cache

Write-Output "Step 1: Stopping running T Bot instances..."
Stop-Process -Name "T Bot" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

Write-Output "Step 2: Installing T-Bot-Setup-2.0.0.exe silently (/S)..."
$setupPath = (Resolve-Path "release/T-Bot-Setup-2.0.0.exe").Path
$process = Start-Process -FilePath $setupPath -ArgumentList "/S" -PassThru -Wait
Write-Output "Installer process exited with code: $($process.ExitCode)"

$installDir = "C:\Users\Egemen\AppData\Local\Programs\T Bot"
if (-not (Test-Path $installDir)) {
    Write-Warning "Install dir not found: $installDir"
} else {
    Write-Output "Installed directory confirmed: $installDir"
}

Write-Output "Step 3: Copying white icon explicitly to tbot-white-icon-v2.ico..."
$whiteIconDest = Join-Path $installDir "tbot-white-icon-v2.ico"
Copy-Item -Path "build/icon.ico" -Destination $whiteIconDest -Force
Write-Output "Copied white icon to: $whiteIconDest"

Write-Output "Step 4: Updating Desktop shortcut icon..."
$desktopShortcut = "C:\Users\Egemen\Desktop\T Bot.lnk"
$wsh = New-Object -ComObject WScript.Shell
if (Test-Path $desktopShortcut) {
    $shortcut = $wsh.CreateShortcut($desktopShortcut)
    $shortcut.TargetPath = Join-Path $installDir "T Bot.exe"
    $shortcut.WorkingDirectory = "C:\Users\Egemen\Desktop\T Bot"
    $shortcut.IconLocation = "$whiteIconDest,0"
    $shortcut.Save()
    Write-Output "Desktop shortcut icon updated to: $whiteIconDest,0"
} else {
    $shortcut = $wsh.CreateShortcut($desktopShortcut)
    $shortcut.TargetPath = Join-Path $installDir "T Bot.exe"
    $shortcut.WorkingDirectory = "C:\Users\Egemen\Desktop\T Bot"
    $shortcut.IconLocation = "$whiteIconDest,0"
    $shortcut.Description = "T Bot 2.0 Desktop Agent"
    $shortcut.Save()
    Write-Output "Desktop shortcut created with icon: $whiteIconDest,0"
}

# Also update Start Menu shortcut if exists
$startMenuShortcut = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\T Bot.lnk"
if (Test-Path $startMenuShortcut) {
    $smShortcut = $wsh.CreateShortcut($startMenuShortcut)
    $smShortcut.IconLocation = "$whiteIconDest,0"
    $smShortcut.Save()
    Write-Output "Start menu shortcut icon updated to: $whiteIconDest,0"
}

Write-Output "Step 5: Copying Setup to Desktop..."
$desktopSetup = "C:\Users\Egemen\Desktop\T-Bot-Setup-2.0.0.exe"
Copy-Item -Path $setupPath -Destination $desktopSetup -Force
Write-Output "Copied setup to: $desktopSetup (Size: $((Get-Item $desktopSetup).Length) bytes)"

Write-Output "Step 6: Refreshing Windows icon cache with ie4uinit..."
Start-Process -FilePath "ie4uinit.exe" -ArgumentList "-show" -Wait -ErrorAction SilentlyContinue

Write-Output "LOCAL_DEPLOYMENT_COMPLETED_SUCCESSFULLY"
