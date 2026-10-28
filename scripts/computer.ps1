param(
  [string]$Action = ""
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$binDir = Join-Path $env:APPDATA "TBot\bin"
if (-not (Test-Path -LiteralPath $binDir)) {
  New-Item -ItemType Directory -Path $binDir -Force | Out-Null
}
$dllPath = Join-Path $binDir "tbot-desktop-native-v3.dll"
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
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }

  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
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
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

  public static bool ForceForeground(IntPtr hWnd) {
    if (hWnd == IntPtr.Zero || !IsWindow(hWnd)) return false;
    ShowWindowAsync(hWnd, 9); // SW_RESTORE = 9
    if (SetForegroundWindow(hWnd) && GetForegroundWindow() == hWnd) return true;

    // Alt key trick to bypass foreground lock timeout
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    if (SetForegroundWindow(hWnd) && GetForegroundWindow() == hWnd) return true;

    // Thread attach trick
    uint processId = 0;
    uint targetThread = GetWindowThreadProcessId(hWnd, out processId);
    uint currentThread = GetCurrentThreadId();
    if (targetThread != currentThread && targetThread != 0) {
      AttachThreadInput(currentThread, targetThread, true);
      SetForegroundWindow(hWnd);
      AttachThreadInput(currentThread, targetThread, false);
    }
    return GetForegroundWindow() == hWnd;
  }
}
"@
  Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.Windows.Forms','System.Drawing' -OutputAssembly $dllPath
  [System.Reflection.Assembly]::LoadFrom($dllPath) | Out-Null
}

try {
  if (-not [DesktopNative]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))) {
    [void][DesktopNative]::SetProcessDPIAware()
  }
} catch {
  [void][DesktopNative]::SetProcessDPIAware()
}

function Execute-DesktopRequest($request) {
  $action = [string]$request.action
  $screen = [System.Windows.Forms.SystemInformation]::VirtualScreen

  if ($action -eq 'windows') {
    $windows = [System.Collections.Generic.List[object]]::new()
    $callback = [DesktopNative+EnumProc]{ param($h, $p)
      if ([DesktopNative]::IsWindowVisible($h)) {
        $title = [Text.StringBuilder]::new(1024)
        [void][DesktopNative]::GetWindowText($h, $title, $title.Capacity)
        $rect = [DesktopNative+RECT]::new()
        if ($title.Length -gt 0 -and [DesktopNative]::GetWindowRect($h, [ref]$rect)) {
          $windows.Add(@{
            handle = $h.ToInt64().ToString();
            title = $title.ToString();
            bounds = @{
              x = $rect.Left;
              y = $rect.Top;
              width = $rect.Right - $rect.Left;
              height = $rect.Bottom - $rect.Top
            }
          })
        }
      }
      return $true
    }
    [void][DesktopNative]::EnumWindows($callback, [IntPtr]::Zero)
    return @{
      windows = @($windows.ToArray());
      foreground = [DesktopNative]::GetForegroundWindow().ToInt64().ToString();
      screen = @{ x=$screen.X; y=$screen.Y; width=$screen.Width; height=$screen.Height }
    }
  }

  if ($action -eq 'screenshot') {
    $file = [string]$request.screenshotPath
    if (-not [IO.Path]::IsPathRooted($file) -or [IO.Path]::GetExtension($file) -ne '.png') {
      throw 'Invalid screenshot path.'
    }
    $bitmap = [Drawing.Bitmap]::new($screen.Width, $screen.Height)
    try {
      $graphics = [Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.CopyFromScreen($screen.Location, [Drawing.Point]::Empty, $screen.Size)
        $bitmap.Save($file, [Drawing.Imaging.ImageFormat]::Png)
      } finally {
        $graphics.Dispose()
      }
    } finally {
      $bitmap.Dispose()
    }
    return @{
      path = $file;
      bounds = @{ x=$screen.X; y=$screen.Y; width=$screen.Width; height=$screen.Height }
    }
  }

  $value = 0L
  if (-not [long]::TryParse([string]$request.handle, [ref]$value) -or $value -le 0) {
    throw 'A valid window handle is required.'
  }
  $handle = [IntPtr]::new($value)
  if (-not [DesktopNative]::IsWindow($handle) -or -not [DesktopNative]::IsWindowVisible($handle)) {
    throw 'Window is no longer visible.'
  }

  if ($action -eq 'focus') {
    if (-not [DesktopNative]::ForceForeground($handle)) {
      throw 'Windows refused to focus the window.'
    }
    return @{ attempted = $true; action = $action; focused = $true }
  }

  $currentFg = [DesktopNative]::GetForegroundWindow()
  if ($currentFg -ne $handle) {
    # Otomatik focus denemesi ile dayanıklılığı artır
    [void][DesktopNative]::ForceForeground($handle)
    $currentFg = [DesktopNative]::GetForegroundWindow()
  }

  if ($action -eq 'click' -or $action -eq 'scroll') {
    $x = [int]$request.x
    $y = [int]$request.y
    $rect = [DesktopNative+RECT]::new()
    if (-not [DesktopNative]::GetWindowRect($handle, [ref]$rect) -or -not $screen.Contains($x, $y)) {
      throw 'Coordinates must be inside the target window and virtual screen.'
    }
    if ($x -lt $rect.Left -or $x -ge $rect.Right -or $y -lt $rect.Top -or $y -ge $rect.Bottom) {
      throw 'Coordinates must be inside target window bounds.'
    }
    if (-not [DesktopNative]::SetCursorPos($x, $y)) {
      throw 'Could not move pointer.'
    }

    $point = [DesktopNative+POINT]::new()
    $point.X = $x
    $point.Y = $y
    $hit = [DesktopNative]::WindowFromPoint($point)
    $ancestor = [DesktopNative]::GetAncestor($hit, 2)
    $fg = [DesktopNative]::GetForegroundWindow()

    # Chrome, Electron ve WPF uygulamalarında alt pencere handle'ları farklı olabildiği için:
    # Hedef pencere öne getirilmişse veya nokta pencere sınırları içindeyse tıklamayı kabul et.
    $isValidTarget = ($ancestor -eq $handle -or $hit -eq $handle -or $fg -eq $handle)
    if (-not $isValidTarget) {
      throw 'Target is no longer foreground or the point is covered by another window.'
    }

    if ($action -eq 'click') {
      $btn = if ($request.button) { [string]$request.button } else { 'left' }
      if ($btn -eq 'right') {
        [DesktopNative]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero) # MOUSEEVENTF_RIGHTDOWN
        [DesktopNative]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero) # MOUSEEVENTF_RIGHTUP
      } elseif ($btn -eq 'middle') {
        [DesktopNative]::mouse_event(0x0020, 0, 0, 0, [UIntPtr]::Zero) # MOUSEEVENTF_MIDDLEDOWN
        [DesktopNative]::mouse_event(0x0040, 0, 0, 0, [UIntPtr]::Zero) # MOUSEEVENTF_MIDDLEUP
      } elseif ($btn -eq 'double') {
        [DesktopNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
        [DesktopNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
        [System.Threading.Thread]::Sleep(50)
        [DesktopNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
        [DesktopNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
      } else {
        [DesktopNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero) # MOUSEEVENTF_LEFTDOWN
        [DesktopNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero) # MOUSEEVENTF_LEFTUP
      }
    } else {
      # Scroll
      $delta = [int]$request.delta
      [DesktopNative]::mouse_event(0x0800, 0, 0, $delta, [UIntPtr]::Zero) # MOUSEEVENTF_WHEEL
    }
  } elseif ($action -eq 'type') {
    $inputText = [string]$request.text
    $escaped = [regex]::Replace($inputText, '[+^%~(){}\[\]]', { param($m) '{' + $m.Value + '}' })
    if ([DesktopNative]::GetForegroundWindow() -ne $handle) {
      [void][DesktopNative]::ForceForeground($handle)
    }
    [System.Windows.Forms.SendKeys]::SendWait($escaped)
  } elseif ($action -eq 'key') {
    $keys = @{
      ENTER='{ENTER}'; TAB='{TAB}'; ESC='{ESC}'; BACKSPACE='{BACKSPACE}'; DELETE='{DELETE}';
      UP='{UP}'; DOWN='{DOWN}'; LEFT='{LEFT}'; RIGHT='{RIGHT}'; HOME='{HOME}'; END='{END}';
      PAGEUP='{PGUP}'; PAGEDOWN='{PGDN}'
    }
    if (-not $keys.ContainsKey([string]$request.key)) { throw 'Unsupported key.' }
    if ([DesktopNative]::GetForegroundWindow() -ne $handle) {
      [void][DesktopNative]::ForceForeground($handle)
    }
    [System.Windows.Forms.SendKeys]::SendWait($keys[[string]$request.key])
  } else {
    throw 'Unsupported action.'
  }

  return @{
    attempted = $true;
    action = $action;
    note = 'Input dispatch was attempted; application handling cannot be verified.'
  }
}

if ($Action -eq 'daemon') {
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $line = $line.Trim()
    if ($line.Length -eq 0) { continue }
    $req = $null
    try {
      $req = $line | ConvertFrom-Json
      $id = $req.id
      $data = Execute-DesktopRequest $req
      $res = @{ id = $id; ok = $true; data = $data }
      [Console]::Out.WriteLine(($res | ConvertTo-Json -Depth 6 -Compress))
    } catch {
      $id = $null
      if ($req -and $req.id) { $id = $req.id }
      $res = @{ id = $id; ok = $false; error = $_.Exception.Message }
      [Console]::Out.WriteLine(($res | ConvertTo-Json -Depth 6 -Compress))
    }
  }
} else {
  try {
    $raw = [Console]::In.ReadToEnd()
    if (-not [string]::IsNullOrWhiteSpace($raw)) {
      $req = $raw | ConvertFrom-Json
      $data = Execute-DesktopRequest $req
      [Console]::Out.WriteLine(($data | ConvertTo-Json -Depth 6 -Compress))
    }
  } catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
  }
}
