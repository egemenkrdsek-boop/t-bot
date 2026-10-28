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
$dllPath = Join-Path $binDir "tbot-desktop-native-v12.dll"
if (Test-Path -LiteralPath $dllPath) {
  [System.Reflection.Assembly]::LoadFrom($dllPath) | Out-Null
} else {
  $source = @"
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Diagnostics;
using System.Windows.Automation;

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
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, int data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

  [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr OpenWindowStation(string lpszWinSta, bool fInherit, uint dwDesiredAccess);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetProcessWindowStation(IntPtr hWinSta);
  [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetThreadDesktop(IntPtr hDesktop);

  public static bool SwitchToInteractiveDesktop() {
    try {
      IntPtr hSta = OpenWindowStation("WinSta0", false, 0x037F);
      if (hSta != IntPtr.Zero) SetProcessWindowStation(hSta);
      IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
      if (hDesk != IntPtr.Zero) return SetThreadDesktop(hDesk);
    } catch {}
    return false;
  }

  private class BFSItem {
    public AutomationElement Element;
    public int Depth;
  }

  public static string GetUiElementsJson(string handleStr) {
    string jsonResult = "{\"action\":\"inspect\",\"handle\":\"0\",\"windowTitle\":\"\",\"elements\":[]}";
    IntPtr hSta = OpenWindowStation("WinSta0", false, 0x037F);
    if (hSta != IntPtr.Zero) SetProcessWindowStation(hSta);
    IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);

    System.Threading.Thread t = new System.Threading.Thread(() => {
      try {
        if (hDesk != IntPtr.Zero) SetThreadDesktop(hDesk);

        IntPtr target = IntPtr.Zero;
        long val;
        if (!string.IsNullOrEmpty(handleStr) && long.TryParse(handleStr, out val) && val > 0) {
          target = new IntPtr(val);
        }
        if (target == IntPtr.Zero || !IsWindow(target)) {
          target = GetForegroundWindow();
        }
        if (target == IntPtr.Zero || !IsWindow(target)) {
          EnumWindows((h, p) => {
            if (IsWindowVisible(h)) {
              StringBuilder sb = new StringBuilder(256);
              GetWindowText(h, sb, sb.Capacity);
              string tStr = sb.ToString();
              if (tStr.Length > 0 && !tStr.Contains("OsdForm") && !tStr.Contains("Giriş Deneyimi")) {
                target = h;
                return false;
              }
            }
            return true;
          }, IntPtr.Zero);
        }

        if (target == IntPtr.Zero) return;

        StringBuilder titleSb = new StringBuilder(512);
        GetWindowText(target, titleSb, titleSb.Capacity);
        string winTitle = titleSb.ToString();

        List<string> list = new List<string>();
        Stopwatch sw = Stopwatch.StartNew();

        try {
          AutomationElement rootEl = AutomationElement.FromHandle(target);
          if (rootEl != null) {
            Queue<BFSItem> queue = new Queue<BFSItem>();
            queue.Enqueue(new BFSItem { Element = rootEl, Depth = 0 });
            int visited = 0;
            int idx = 1;
            TreeWalker walker = TreeWalker.ControlViewWalker;

            while (queue.Count > 0 && visited < 220 && idx <= 60) {
              if (sw.ElapsedMilliseconds > 800) break;
              BFSItem curr = queue.Dequeue();
              visited++;
              AutomationElement el = curr.Element;
              int depth = curr.Depth;

              if (depth > 0) {
                try {
                  if (!el.Current.IsOffscreen) {
                    System.Windows.Rect r = el.Current.BoundingRectangle;
                    if (r.Width > 4 && r.Height > 4) {
                      string rawType = el.Current.ControlType.ProgrammaticName;
                      string cleanType = rawType.StartsWith("ControlType.") ? rawType.Substring(12) : rawType;
                      string name = el.Current.Name ?? el.Current.AutomationId ?? "";
                      name = name.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", " ");
                      if (name.Length > 80) name = name.Substring(0, 77) + "...";

                      int cx = (int)(r.X + (r.Width / 2.0));
                      int cy = (int)(r.Y + (r.Height / 2.0));

                      list.Add("{\"id\":\"u" + idx + "\",\"type\":\"" + cleanType + "\",\"name\":\"" + name + "\",\"x\":" + cx + ",\"y\":" + cy + ",\"rect\":{\"left\":" + (int)r.X + ",\"top\":" + (int)r.Y + ",\"width\":" + (int)r.Width + ",\"height\":" + (int)r.Height + "}}");
                      idx++;
                    }
                  }
                } catch {}
              }

              if (depth < 5) {
                try {
                  AutomationElement child = walker.GetFirstChild(el);
                  while (child != null) {
                    if (sw.ElapsedMilliseconds > 800 || visited + queue.Count >= 220) break;
                    queue.Enqueue(new BFSItem { Element = child, Depth = depth + 1 });
                    child = walker.GetNextSibling(child);
                  }
                } catch {}
              }
            }
          }
        } catch {}

        string safeTitle = winTitle.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", " ");
        jsonResult = "{\"action\":\"inspect\",\"handle\":\"" + target.ToInt64() + "\",\"windowTitle\":\"" + safeTitle + "\",\"elements\":[" + string.Join(",", list.ToArray()) + "]}";
      } catch {}
    });

    t.SetApartmentState(System.Threading.ApartmentState.STA);
    t.Start();
    t.Join(900);
    return jsonResult;
  }

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
  Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.Windows.Forms','System.Drawing','UIAutomationClient','UIAutomationTypes','WindowsBase' -OutputAssembly $dllPath
  [System.Reflection.Assembly]::LoadFrom($dllPath) | Out-Null
}

try {
  if (-not [DesktopNative]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))) {
    [void][DesktopNative]::SetProcessDPIAware()
  }
} catch {
  [void][DesktopNative]::SetProcessDPIAware()
}

$script:LastUiElements = [System.Collections.Generic.List[object]]::new()

function Get-DesktopWindows() {
  $windows = [System.Collections.Generic.List[object]]::new()
  $callback = [DesktopNative+EnumProc]{ param($h, $p)
    if ([DesktopNative]::IsWindowVisible($h)) {
      $title = [Text.StringBuilder]::new(1024)
      [void][DesktopNative]::GetWindowText($h, $title, $title.Capacity)
      $rect = [DesktopNative+RECT]::new()
      if ($title.Length -gt 0 -and [DesktopNative]::GetWindowRect($h, [ref]$rect)) {
        $pId = 0
        [void][DesktopNative]::GetWindowThreadProcessId($h, [ref]$pId)
        $procName = ""
        try {
          $proc = [System.Diagnostics.Process]::GetProcessById($pId)
          if ($proc) { $procName = $proc.ProcessName }
        } catch {}

        $windows.Add(@{
          handle = $h.ToInt64().ToString();
          title = $title.ToString();
          processName = $procName;
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
  return @($windows.ToArray())
}

function Find-WindowByText([string]$text) {
  if ([string]::IsNullOrWhiteSpace($text)) { return [IntPtr]::Zero }
  $clean = $text.Trim()
  $openWins = Get-DesktopWindows
  foreach ($w in $openWins) {
    if ($w.title -and $w.title.IndexOf($clean, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
      return [IntPtr]::new([long]$w.handle)
    }
    if ($w.processName -and $w.processName.IndexOf($clean, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
      return [IntPtr]::new([long]$w.handle)
    }
  }
  return [IntPtr]::Zero
}

function Resolve-WindowHandle($request) {
  $handleVal = 0L
  if ($request.handle -and [long]::TryParse([string]$request.handle, [ref]$handleVal) -and $handleVal -gt 0) {
    $h = [IntPtr]::new($handleVal)
    if ([DesktopNative]::IsWindow($h)) { return $h }
  }

  if ($request.handle -and [string]$request.handle -notmatch '^\d+$') {
    $found = Find-WindowByText([string]$request.handle)
    if ($found -ne [IntPtr]::Zero) { return $found }
  }

  if ($request.target) {
    $found = Find-WindowByText([string]$request.target)
    if ($found -ne [IntPtr]::Zero) { return $found }
  }

  if ($null -ne $request.x -and $null -ne $request.y) {
    $pt = [DesktopNative+POINT]::new()
    $pt.X = [int]$request.x
    $pt.Y = [int]$request.y
    $hit = [DesktopNative]::WindowFromPoint($pt)
    if ($hit -ne [IntPtr]::Zero) {
      $ancestor = [DesktopNative]::GetAncestor($hit, 2) # GA_ROOT = 2
      if ($ancestor -ne [IntPtr]::Zero -and [DesktopNative]::IsWindow($ancestor)) {
        return $ancestor
      }
      if ([DesktopNative]::IsWindow($hit)) { return $hit }
    }
  }

  $fg = [DesktopNative]::GetForegroundWindow()
  if ($fg -ne [IntPtr]::Zero -and [DesktopNative]::IsWindow($fg)) {
    return $fg
  }

  return [IntPtr]::Zero
}

function Resolve-TargetElement([string]$target, [IntPtr]$handle) {
  if ([string]::IsNullOrWhiteSpace($target)) { return $null }
  $cleanTarget = $target.Trim().TrimStart('[').TrimEnd(']')

  # 1. Son bulunan UI öğeleri listesinde ara ($script:LastUiElements)
  if ($script:LastUiElements -and $script:LastUiElements.Count -gt 0) {
    foreach ($el in $script:LastUiElements) {
      if ($el.id -eq $cleanTarget -or $el.id -eq $target) { return $el }
    }
    foreach ($el in $script:LastUiElements) {
      if ($el.name -and ($el.name.IndexOf($cleanTarget, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or $el.name.IndexOf($target, [StringComparison]::OrdinalIgnoreCase) -ge 0)) {
        return $el
      }
    }
  }

  # 2. Bulunamadıysa hızlı GetUiElementsJson çağırıp güncelle
  $hStr = if ($handle -ne [IntPtr]::Zero) { $handle.ToInt64().ToString() } else { "" }
  try {
    $rawJson = [DesktopNative]::GetUiElementsJson($hStr)
    $resObj = $rawJson | ConvertFrom-Json
    if ($resObj.elements) {
      $script:LastUiElements = [System.Collections.Generic.List[object]]::new()
      foreach ($item in $resObj.elements) { $script:LastUiElements.Add($item) }

      foreach ($el in $script:LastUiElements) {
        if ($el.id -eq $cleanTarget -or $el.id -eq $target) { return $el }
      }
      foreach ($el in $script:LastUiElements) {
        if ($el.name -and ($el.name.IndexOf($cleanTarget, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or $el.name.IndexOf($target, [StringComparison]::OrdinalIgnoreCase) -ge 0)) {
          return $el
        }
      }
    }
  } catch {}

  return $null
}

function Draw-ScreenshotOverlays($bitmap, $screen, $uiElements) {
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

    $neonGreen = [System.Drawing.Color]::FromArgb(148, 216, 45)
    $darkBg = [System.Drawing.Color]::FromArgb(220, 11, 19, 14)
    $gridColor = [System.Drawing.Color]::FromArgb(55, 148, 216, 45)

    $gridPen = [System.Drawing.Pen]::new($gridColor, 1)
    $textBrush = [System.Drawing.SolidBrush]::new($neonGreen)
    $bgBrush = [System.Drawing.SolidBrush]::new($darkBg)
    $badgeBorderPen = [System.Drawing.Pen]::new($neonGreen, 1)
    $badgeOutlinePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(80, 148, 216, 45), 1)
    $rulerFont = [System.Drawing.Font]::new("Consolas", 8, [System.Drawing.FontStyle]::Bold)
    $badgeFont = [System.Drawing.Font]::new("Segoe UI", 8, [System.Drawing.FontStyle]::Bold)

    try {
      for ($x = 100; $x -lt $screen.Width; $x += 100) {
        $graphics.DrawLine($gridPen, $x, 0, $x, $screen.Height)
        $numStr = "$x"
        $sz = $graphics.MeasureString($numStr, $rulerFont)
        $bx = [int]($x - ($sz.Width / 2.0))
        $graphics.FillRectangle($bgBrush, $bx, 2, [int]$sz.Width + 4, 15)
        $graphics.DrawRectangle($badgeBorderPen, $bx, 2, [int]$sz.Width + 4, 15)
        $graphics.DrawString($numStr, $rulerFont, $textBrush, $bx + 2, 2)
      }

      for ($y = 100; $y -lt $screen.Height; $y += 100) {
        $graphics.DrawLine($gridPen, 0, $y, $screen.Width, $y)
        $numStr = "$y"
        $sz = $graphics.MeasureString($numStr, $rulerFont)
        $by = [int]($y - ($sz.Height / 2.0))
        $graphics.FillRectangle($bgBrush, 2, $by, [int]$sz.Width + 4, 15)
        $graphics.DrawRectangle($badgeBorderPen, 2, $by, [int]$sz.Width + 4, 15)
        $graphics.DrawString($numStr, $rulerFont, $textBrush, 4, $by)
      }

      if ($uiElements) {
        foreach ($el in $uiElements) {
          try {
            $rx = [int]$el.rect.left - $screen.X
            $ry = [int]$el.rect.top - $screen.Y
            $rw = [int]$el.rect.width
            $rh = [int]$el.rect.height

            $graphics.DrawRectangle($badgeOutlinePen, $rx, $ry, $rw, $rh)
            $badgeText = "[$($el.id)]"
            $bsz = $graphics.MeasureString($badgeText, $badgeFont)
            $badgeW = [int]$bsz.Width + 4
            $badgeH = 15
            $bx = [Math]::Max(0, $rx)
            $by = if ($ry -ge 16) { $ry - 15 } else { $ry + 2 }

            $graphics.FillRectangle($bgBrush, $bx, $by, $badgeW, $badgeH)
            $graphics.DrawRectangle($badgeBorderPen, $bx, $by, $badgeW, $badgeH)
            $graphics.DrawString($badgeText, $badgeFont, $textBrush, $bx + 2, $by)
          } catch {}
        }
      }
    } finally {
      $gridPen.Dispose()
      $textBrush.Dispose()
      $bgBrush.Dispose()
      $badgeBorderPen.Dispose()
      $badgeOutlinePen.Dispose()
      $rulerFont.Dispose()
      $badgeFont.Dispose()
    }
  } finally {
    $graphics.Dispose()
  }
}

$script:VkMap = @{
  'ENTER' = 0x0D; 'RETURN' = 0x0D;
  'TAB' = 0x09;
  'ESC' = 0x1B; 'ESCAPE' = 0x1B;
  'SPACE' = 0x20; 'SPACEBAR' = 0x20;
  'BACKSPACE' = 0x08; 'BS' = 0x08;
  'DELETE' = 0x2E; 'DEL' = 0x2E;
  'UP' = 0x26; 'ARROWUP' = 0x26;
  'DOWN' = 0x28; 'ARROWDOWN' = 0x28;
  'LEFT' = 0x25; 'ARROWLEFT' = 0x25;
  'RIGHT' = 0x27; 'ARROWRIGHT' = 0x27;
  'HOME' = 0x24;
  'END' = 0x23;
  'PAGEUP' = 0x21; 'PGUP' = 0x21;
  'PAGEDOWN' = 0x22; 'PGDN' = 0x22;
  'INSERT' = 0x2D; 'INS' = 0x2D;
  'PRINTSCREEN' = 0x2C; 'PRTSC' = 0x2C;
  'F1' = 0x70; 'F2' = 0x71; 'F3' = 0x72; 'F4' = 0x73;
  'F5' = 0x74; 'F6' = 0x75; 'F7' = 0x76; 'F8' = 0x77;
  'F9' = 0x78; 'F10' = 0x79; 'F11' = 0x7A; 'F12' = 0x7B;
  'A' = 0x41; 'B' = 0x42; 'C' = 0x43; 'D' = 0x44; 'E' = 0x45;
  'F' = 0x46; 'G' = 0x47; 'H' = 0x48; 'I' = 0x49; 'J' = 0x4A;
  'K' = 0x4B; 'L' = 0x4C; 'M' = 0x4D; 'N' = 0x4E; 'O' = 0x4F;
  'P' = 0x50; 'Q' = 0x51; 'R' = 0x52; 'S' = 0x53; 'T' = 0x54;
  'U' = 0x55; 'V' = 0x56; 'W' = 0x57; 'X' = 0x58; 'Y' = 0x59; 'Z' = 0x5A;
  '0' = 0x30; '1' = 0x31; '2' = 0x32; '3' = 0x33; '4' = 0x34;
  '5' = 0x35; '6' = 0x36; '7' = 0x37; '8' = 0x38; '9' = 0x39;
}

function Send-KeyboardKey([string]$keyName) {
  $k = $keyName.Trim().ToUpperInvariant()

  # WIN tuşu tekil
  if ($k -eq 'WIN' -or $k -eq 'WINDOWS' -or $k -eq 'LWIN') {
    [DesktopNative]::keybd_event(0x5B, 0, 0, [UIntPtr]::Zero)
    [System.Threading.Thread]::Sleep(30)
    [DesktopNative]::keybd_event(0x5B, 0, 2, [UIntPtr]::Zero)
    return
  }

  # Kombinasyon çözümleme: CTRL+, ALT+, SHIFT+, WIN+
  if ($k.Contains('+')) {
    $parts = $k.Split('+')
    $modifiers = [System.Collections.Generic.List[byte]]::new()
    $mainKey = ""

    foreach ($p in $parts) {
      $trimmed = $p.Trim()
      if ($trimmed -eq 'CTRL' -or $trimmed -eq 'CONTROL') {
        $modifiers.Add(0x11)
      } elseif ($trimmed -eq 'ALT') {
        $modifiers.Add(0x12)
      } elseif ($trimmed -eq 'SHIFT') {
        $modifiers.Add(0x10)
      } elseif ($trimmed -eq 'WIN' -or $trimmed -eq 'WINDOWS') {
        $modifiers.Add(0x5B)
      } else {
        $mainKey = $trimmed
      }
    }

    $mainVk = 0
    if ($script:VkMap.ContainsKey($mainKey)) {
      $mainVk = $script:VkMap[$mainKey]
    } elseif ($mainKey.Length -eq 1) {
      $mainVk = [byte][char]$mainKey[0]
    }

    if ($mainVk -ne 0) {
      foreach ($m in $modifiers) {
        [DesktopNative]::keybd_event($m, 0, 0, [UIntPtr]::Zero)
        [System.Threading.Thread]::Sleep(10)
      }
      [DesktopNative]::keybd_event($mainVk, 0, 0, [UIntPtr]::Zero)
      [System.Threading.Thread]::Sleep(20)
      [DesktopNative]::keybd_event($mainVk, 0, 2, [UIntPtr]::Zero)
      for ($i = $modifiers.Count - 1; $i -ge 0; $i--) {
        [DesktopNative]::keybd_event($modifiers[$i], 0, 2, [UIntPtr]::Zero)
        [System.Threading.Thread]::Sleep(10)
      }
      return
    }

    try {
      $prefix = ""
      if ($modifiers.Contains(0x11)) { $prefix += "^" }
      if ($modifiers.Contains(0x12)) { $prefix += "%" }
      if ($modifiers.Contains(0x10)) { $prefix += "+" }
      [System.Windows.Forms.SendKeys]::SendWait("$prefix$mainKey")
      return
    } catch {}
  }

  if ($script:VkMap.ContainsKey($k)) {
    $vk = $script:VkMap[$k]
    [DesktopNative]::keybd_event($vk, 0, 0, [UIntPtr]::Zero)
    [System.Threading.Thread]::Sleep(20)
    [DesktopNative]::keybd_event($vk, 0, 2, [UIntPtr]::Zero)
    return
  }

  try {
    [System.Windows.Forms.SendKeys]::SendWait($k.ToLowerInvariant())
  } catch {
    foreach ($ch in $k.ToCharArray()) {
      $b = [byte]$ch
      [DesktopNative]::keybd_event($b, 0, 0, [UIntPtr]::Zero)
      [System.Threading.Thread]::Sleep(10)
      [DesktopNative]::keybd_event($b, 0, 2, [UIntPtr]::Zero)
    }
  }
}

function Execute-DesktopRequest($request) {
  $action = [string]$request.action
  $screen = [System.Windows.Forms.SystemInformation]::VirtualScreen

  if ($action -eq 'windows') {
    $windows = Get-DesktopWindows
    return @{
      windows = @($windows);
      foreground = [DesktopNative]::GetForegroundWindow().ToInt64().ToString();
      screen = @{ x=$screen.X; y=$screen.Y; width=$screen.Width; height=$screen.Height }
    }
  }

  if ($action -eq 'inspect') {
    $handleInput = if ($request.handle) { [string]$request.handle } else { "" }
    $rawJson = [DesktopNative]::GetUiElementsJson($handleInput)
    $resObj = $rawJson | ConvertFrom-Json
    $elements = @($resObj.elements)
    $script:LastUiElements = [System.Collections.Generic.List[object]]::new()
    foreach ($item in $elements) { $script:LastUiElements.Add($item) }

    return @{
      action = 'inspect';
      handle = [string]$resObj.handle;
      windowTitle = [string]$resObj.windowTitle;
      elements = $elements;
    }
  }

  if ($action -eq 'screenshot') {
    $file = [string]$request.screenshotPath
    if (-not [IO.Path]::IsPathRooted($file) -or [IO.Path]::GetExtension($file) -ne '.png') {
      throw 'Invalid screenshot path.'
    }
    $bitmap = [Drawing.Bitmap]::new($screen.Width, $screen.Height)
    $uiElements = @()
    try {
      $graphics = [Drawing.Graphics]::FromImage($bitmap)
      try {
        try {
          $graphics.CopyFromScreen($screen.Location, [Drawing.Point]::Empty, $screen.Size)
        } catch {
          $bg = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(15, 20, 25))
          $graphics.FillRectangle($bg, 0, 0, $screen.Width, $screen.Height)
          $bg.Dispose()
        }
      } finally {
        $graphics.Dispose()
      }

      $handleInput = if ($request.handle) { [string]$request.handle } else { "" }
      try {
        $rawJson = [DesktopNative]::GetUiElementsJson($handleInput)
        $uiObj = $rawJson | ConvertFrom-Json
        $uiElements = @($uiObj.elements)
        $script:LastUiElements = [System.Collections.Generic.List[object]]::new()
        foreach ($item in $uiElements) { $script:LastUiElements.Add($item) }
      } catch {}

      try {
        Draw-ScreenshotOverlays $bitmap $screen $uiElements
      } catch {}

      $bitmap.Save($file, [Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $bitmap.Dispose()
    }
    return @{
      path = $file;
      screenshotPath = $file;
      bounds = @{ x=$screen.X; y=$screen.Y; width=$screen.Width; height=$screen.Height };
      elements = @($uiElements);
    }
  }

  if ($action -eq 'open' -or $action -eq 'launch' -or $action -eq 'start') {
    $targetApp = if ($request.target) { [string]$request.target } elseif ($request.text) { [string]$request.text } elseif ($request.command) { [string]$request.command } else { [string]$request.app }
    if ([string]::IsNullOrWhiteSpace($targetApp)) {
      throw 'A target application or URL is required for open.'
    }
    try {
      Start-Process $targetApp
    } catch {
      # Fallback to powershell Start-Process via cmd
      Start-Process "cmd.exe" -ArgumentList "/c start `"`" `"$targetApp`"" -WindowStyle Hidden
    }
    [System.Threading.Thread]::Sleep(500)
    $newFg = [DesktopNative]::GetForegroundWindow()
    return @{
      attempted = $true;
      action = 'open';
      target = $targetApp;
      foreground = $newFg.ToInt64().ToString();
    }
  }

  # Handle çözümlemesi
  $handle = Resolve-WindowHandle $request

  if ($action -eq 'focus') {
    if ($handle -ne [IntPtr]::Zero) {
      [void][DesktopNative]::ForceForeground($handle)
    }
    return @{ attempted = $true; action = 'focus'; focused = $true; handle = $handle.ToInt64().ToString() }
  }

  if ($action -eq 'move') {
    $moveX = if ($null -ne $request.x) { [int]$request.x } else { $null }
    $moveY = if ($null -ne $request.y) { [int]$request.y } else { $null }
    if (($null -eq $moveX -or $null -eq $moveY) -and $request.target) {
      $matched = Resolve-TargetElement ([string]$request.target) $handle
      if ($matched) {
        $moveX = [int]$matched.x
        $moveY = [int]$matched.y
      }
    }
    if ($null -eq $moveX -or $null -eq $moveY) {
      $pt = [DesktopNative+POINT]::new()
      [void][DesktopNative]::GetCursorPos([ref]$pt)
      $moveX = $pt.X
      $moveY = $pt.Y
    }
    $x = [int]$moveX
    $y = [int]$moveY
    [void][DesktopNative]::SetCursorPos($x, $y)
    return @{ attempted = $true; action = 'move'; x = $x; y = $y }
  }

  # Gerekirse pencereyi öne getir
  if ($handle -ne [IntPtr]::Zero -and [DesktopNative]::GetForegroundWindow() -ne $handle) {
    [void][DesktopNative]::ForceForeground($handle)
  }

  if ($action -eq 'click' -or $action -eq 'scroll') {
    $targetX = if ($null -ne $request.x) { [int]$request.x } else { $null }
    $targetY = if ($null -ne $request.y) { [int]$request.y } else { $null }

    # Target çözümlemesi
    if ($request.target) {
      $matched = Resolve-TargetElement ([string]$request.target) $handle
      if ($matched) {
        $targetX = [int]$matched.x
        $targetY = [int]$matched.y
      } else {
        # target bir açık pencere başlığı mı?
        $winTarget = Find-WindowByText ([string]$request.target)
        if ($winTarget -ne [IntPtr]::Zero) {
          [void][DesktopNative]::ForceForeground($winTarget)
          $handle = $winTarget
        }
      }
    }

    # Koordinat yoksa o anki fare imlecini kullan
    if ($null -eq $targetX -or $null -eq $targetY) {
      $pt = [DesktopNative+POINT]::new()
      [void][DesktopNative]::GetCursorPos([ref]$pt)
      $targetX = $pt.X
      $targetY = $pt.Y
    }

    $x = [int]$targetX
    $y = [int]$targetY

    [void][DesktopNative]::SetCursorPos($x, $y)

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
      return @{ attempted = $true; action = 'click'; x = $x; y = $y; button = $btn }
    } else {
      # Scroll
      $delta = if ($null -ne $request.delta) { [int]$request.delta } else { -120 }
      [DesktopNative]::mouse_event(0x0800, 0, 0, $delta, [UIntPtr]::Zero) # MOUSEEVENTF_WHEEL
      return @{ attempted = $true; action = 'scroll'; x = $x; y = $y; delta = $delta }
    }
  } elseif ($action -eq 'type') {
    $typeX = if ($null -ne $request.x) { [int]$request.x } else { $null }
    $typeY = if ($null -ne $request.y) { [int]$request.y } else { $null }

    # Koordinat veya target varsa önce tıkla
    if ($request.target) {
      $matched = Resolve-TargetElement ([string]$request.target) $handle
      if ($matched) {
        $typeX = [int]$matched.x
        $typeY = [int]$matched.y
      }
    }
    if ($null -ne $typeX -and $null -ne $typeY) {
      $tx = [int]$typeX
      $ty = [int]$typeY
      [void][DesktopNative]::SetCursorPos($tx, $ty)
      [DesktopNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
      [DesktopNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
      [System.Threading.Thread]::Sleep(80)
    }

    $inputText = [string]$request.text
    $pasted = $false
    try {
      [System.Windows.Forms.Clipboard]::SetText($inputText)
      $pasted = $true
    } catch {
      try {
        Set-Clipboard -Value $inputText
        $pasted = $true
      } catch {}
    }

    if ($pasted) {
      [System.Threading.Thread]::Sleep(30)
      [DesktopNative]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero) # CTRL Down
      [DesktopNative]::keybd_event(0x56, 0, 0, [UIntPtr]::Zero) # V Down
      [System.Threading.Thread]::Sleep(20)
      [DesktopNative]::keybd_event(0x56, 0, 2, [UIntPtr]::Zero) # V Up
      [DesktopNative]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero) # CTRL Up
    } else {
      try {
        $escaped = [regex]::Replace($inputText, '[+^%~(){}\[\]]', { param($m) '{' + $m.Value + '}' })
        [System.Windows.Forms.SendKeys]::SendWait($escaped)
      } catch {
        foreach ($ch in $inputText.ToCharArray()) {
          $b = [byte]$ch
          [DesktopNative]::keybd_event($b, 0, 0, [UIntPtr]::Zero)
          [System.Threading.Thread]::Sleep(5)
          [DesktopNative]::keybd_event($b, 0, 2, [UIntPtr]::Zero)
        }
      }
    }

    if ($request.press_enter -or $inputText.EndsWith("`n")) {
      [System.Threading.Thread]::Sleep(30)
      [DesktopNative]::keybd_event(0x0D, 0, 0, [UIntPtr]::Zero) # ENTER Down
      [System.Threading.Thread]::Sleep(15)
      [DesktopNative]::keybd_event(0x0D, 0, 2, [UIntPtr]::Zero) # ENTER Up
    }

    return @{ attempted = $true; action = 'type'; text = $inputText }
  } elseif ($action -eq 'key') {
    $keyInput = [string]$request.key
    Send-KeyboardKey $keyInput
    return @{ attempted = $true; action = 'key'; key = $keyInput }
  } else {
    throw "Unsupported action: $action"
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
      $res = @{ ok = $true; data = $data }
      [Console]::Out.WriteLine(($res | ConvertTo-Json -Depth 6 -Compress))
    }
  } catch {
    $res = @{ ok = $false; error = $_.Exception.Message }
    [Console]::Out.WriteLine(($res | ConvertTo-Json -Depth 6 -Compress))
    exit 1
  }
}
