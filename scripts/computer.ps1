$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$binDir = Join-Path $env:APPDATA "TBot\bin"
if (-not (Test-Path -LiteralPath $binDir)) {
  New-Item -ItemType Directory -Path $binDir -Force | Out-Null
}
$dllPath = Join-Path $binDir "tbot-desktop-native-v2.dll"
if (Test-Path -LiteralPath $dllPath) {
  [System.Reflection.Assembly]::LoadFrom($dllPath) | Out-Null
} else {
  $source = @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class DesktopNative {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, int data, UIntPtr extra);
}
"@
  Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.Windows.Forms','System.Drawing' -OutputAssembly $dllPath
  [System.Reflection.Assembly]::LoadFrom($dllPath) | Out-Null
}

try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $action = [string]$request.action
  try { if (-not [DesktopNative]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))) { [void][DesktopNative]::SetProcessDPIAware() } } catch { [void][DesktopNative]::SetProcessDPIAware() }
  $screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
  if ($action -eq 'windows') {
    $windows = [System.Collections.Generic.List[object]]::new()
    $callback = [DesktopNative+EnumProc]{ param($h, $p)
      if ([DesktopNative]::IsWindowVisible($h)) {
        $title = [Text.StringBuilder]::new(1024)
        [void][DesktopNative]::GetWindowText($h, $title, $title.Capacity)
        $rect = [DesktopNative+RECT]::new()
        if ($title.Length -gt 0 -and [DesktopNative]::GetWindowRect($h, [ref]$rect)) {
          $windows.Add(@{ handle = $h.ToInt64().ToString(); title = $title.ToString(); bounds = @{ x = $rect.Left; y = $rect.Top; width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top } })
        }
      }
      return $true
    }
    [void][DesktopNative]::EnumWindows($callback, [IntPtr]::Zero)
    @{ windows = @($windows.ToArray()); foreground = [DesktopNative]::GetForegroundWindow().ToInt64().ToString(); screen = @{ x=$screen.X; y=$screen.Y; width=$screen.Width; height=$screen.Height } } | ConvertTo-Json -Depth 6 -Compress
  } elseif ($action -eq 'screenshot') {
    $file = [string]$request.screenshotPath
    if (-not [IO.Path]::IsPathRooted($file) -or [IO.Path]::GetExtension($file) -ne '.png') { throw 'Invalid screenshot path.' }
    $bitmap = [Drawing.Bitmap]::new($screen.Width, $screen.Height)
    try { $graphics = [Drawing.Graphics]::FromImage($bitmap); try { $graphics.CopyFromScreen($screen.Location, [Drawing.Point]::Empty, $screen.Size); $bitmap.Save($file, [Drawing.Imaging.ImageFormat]::Png) } finally { $graphics.Dispose() } } finally { $bitmap.Dispose() }
    @{ path=$file; bounds=@{ x=$screen.X; y=$screen.Y; width=$screen.Width; height=$screen.Height } } | ConvertTo-Json -Depth 4 -Compress
  } else {
    $value = 0L
    if (-not [long]::TryParse([string]$request.handle, [ref]$value) -or $value -le 0) { throw 'A valid window handle is required.' }
    $handle = [IntPtr]::new($value)
    if (-not [DesktopNative]::IsWindow($handle) -or -not [DesktopNative]::IsWindowVisible($handle)) { throw 'Window is no longer visible.' }
    if ($action -eq 'focus') {
      if (-not [DesktopNative]::SetForegroundWindow($handle) -or [DesktopNative]::GetForegroundWindow() -ne $handle) { throw 'Windows refused to focus the window.' }
    } else {
      if ([DesktopNative]::GetForegroundWindow() -ne $handle) { throw 'Target window is not in the foreground; focus it first.' }
      if ($action -eq 'click' -or $action -eq 'scroll') {
        $x = [int]$request.x; $y = [int]$request.y
        $rect = [DesktopNative+RECT]::new()
        if (-not [DesktopNative]::GetWindowRect($handle, [ref]$rect) -or $x -lt $rect.Left -or $x -ge $rect.Right -or $y -lt $rect.Top -or $y -ge $rect.Bottom -or -not $screen.Contains($x,$y)) { throw 'Coordinates must be inside the target window and virtual screen.' }
        if (-not [DesktopNative]::SetCursorPos($x, $y)) { throw 'Could not move pointer.' }
        $point = [DesktopNative+POINT]::new(); $point.X = $x; $point.Y = $y
        $hit = [DesktopNative]::WindowFromPoint($point)
        if ([DesktopNative]::GetForegroundWindow() -ne $handle -or [DesktopNative]::GetAncestor($hit, 2) -ne $handle) { throw 'Target is no longer foreground or the point is covered by another window.' }
        if ($action -eq 'click') {
          if ($request.button -eq 'right') { [DesktopNative]::mouse_event(0x0008,0,0,0,[UIntPtr]::Zero) }
          else { [DesktopNative]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero); [DesktopNative]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero) }
        } else { [DesktopNative]::mouse_event(0x0800,0,0,[int]$request.delta,[UIntPtr]::Zero) }
      } elseif ($action -eq 'type') {
        $inputText = [string]$request.text
        $escaped = [regex]::Replace($inputText, '[+^%~(){}\[\]]', { param($m) '{' + $m.Value + '}' })
        if ([DesktopNative]::GetForegroundWindow() -ne $handle) { throw 'Target window lost focus.' }
        [System.Windows.Forms.SendKeys]::SendWait($escaped)
      } elseif ($action -eq 'key') {
        $keys = @{ ENTER='{ENTER}'; TAB='{TAB}'; ESC='{ESC}'; BACKSPACE='{BACKSPACE}'; DELETE='{DELETE}'; UP='{UP}'; DOWN='{DOWN}'; LEFT='{LEFT}'; RIGHT='{RIGHT}'; HOME='{HOME}'; END='{END}'; PAGEUP='{PGUP}'; PAGEDOWN='{PGDN}' }
        if (-not $keys.ContainsKey([string]$request.key)) { throw 'Unsupported key.' }
        if ([DesktopNative]::GetForegroundWindow() -ne $handle) { throw 'Target window lost focus.' }
        [System.Windows.Forms.SendKeys]::SendWait($keys[[string]$request.key])
      } else { throw 'Unsupported action.' }
    }
    @{ attempted=$true; action=$action; note='Input dispatch was attempted; application handling cannot be verified.' } | ConvertTo-Json -Compress
  }
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
