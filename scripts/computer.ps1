param(
  [string]$Action = ""
)

$ErrorActionPreference = 'Stop'
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom
try {
  [Console]::SetIn([System.IO.StreamReader]::new([System.Console]::OpenStandardInput(), $utf8NoBom))
  $outWriter = [System.IO.StreamWriter]::new([System.Console]::OpenStandardOutput(), $utf8NoBom)
  $outWriter.AutoFlush = $true
  [Console]::SetOut($outWriter)
} catch {}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$binDir = Join-Path $env:APPDATA "TBot\bin"
if (-not (Test-Path -LiteralPath $binDir)) {
  New-Item -ItemType Directory -Path $binDir -Force | Out-Null
}
$dllPath = Join-Path $binDir "tbot-desktop-native-v16.dll"
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
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hWndParent, EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)]
  public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
  [DllImport("oleacc.dll")]
  public static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint dwId, ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object ppvObject);

  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
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

  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public UIntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public UIntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct HARDWAREINPUT {
    public uint uMsg;
    public ushort wParamL;
    public ushort wParamH;
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct InputUnion {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
    [FieldOffset(0)] public HARDWAREINPUT hi;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public InputUnion u;
  }

  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

  public static void SendUnicodeChar(char ch) {
    if (ch == '\r') return;
    if (ch == '\n') {
      INPUT down = new INPUT();
      down.type = 1; // INPUT_KEYBOARD
      down.u.ki.wVk = 0x0D; // VK_RETURN
      down.u.ki.wScan = 0;
      down.u.ki.dwFlags = 0;
      down.u.ki.time = 0;
      down.u.ki.dwExtraInfo = UIntPtr.Zero;

      INPUT up = new INPUT();
      up.type = 1;
      up.u.ki.wVk = 0x0D;
      up.u.ki.wScan = 0;
      up.u.ki.dwFlags = 0x0002; // KEYEVENTF_KEYUP
      up.u.ki.time = 0;
      up.u.ki.dwExtraInfo = UIntPtr.Zero;

      INPUT[] retInputs = new INPUT[] { down, up };
      SendInput(2, retInputs, Marshal.SizeOf(typeof(INPUT)));
      return;
    }

    INPUT charDown = new INPUT();
    charDown.type = 1;
    charDown.u.ki.wVk = 0;
    charDown.u.ki.wScan = (ushort)ch;
    charDown.u.ki.dwFlags = 0x0004; // KEYEVENTF_UNICODE
    charDown.u.ki.time = 0;
    charDown.u.ki.dwExtraInfo = UIntPtr.Zero;

    INPUT charUp = new INPUT();
    charUp.type = 1;
    charUp.u.ki.wVk = 0;
    charUp.u.ki.wScan = (ushort)ch;
    charUp.u.ki.dwFlags = 0x0004 | 0x0002; // KEYEVENTF_UNICODE | KEYEVENTF_KEYUP
    charUp.u.ki.time = 0;
    charUp.u.ki.dwExtraInfo = UIntPtr.Zero;

    INPUT[] charInputs = new INPUT[] { charDown, charUp };
    SendInput(2, charInputs, Marshal.SizeOf(typeof(INPUT)));
  }

  public static void SendUnicodeString(string text) {
    if (string.IsNullOrEmpty(text)) return;
    for (int i = 0; i < text.Length; i++) {
      SendUnicodeChar(text[i]);
      System.Threading.Thread.Sleep(3);
    }
  }

  public static bool SwitchToInteractiveDesktop() {
    try {
      IntPtr hSta = OpenWindowStation("WinSta0", false, 0x037F);
      if (hSta != IntPtr.Zero) SetProcessWindowStation(hSta);
      IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
      if (hDesk != IntPtr.Zero) return SetThreadDesktop(hDesk);
    } catch {}
    return false;
  }

  public static string GetWindowsJson() {
    string json = "[]";
    IntPtr hSta = OpenWindowStation("WinSta0", false, 0x037F);
    if (hSta != IntPtr.Zero) SetProcessWindowStation(hSta);
    IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);

    System.Threading.Thread t = new System.Threading.Thread(() => {
      try {
        if (hDesk != IntPtr.Zero) SetThreadDesktop(hDesk);
        List<string> wins = new List<string>();
        EnumWindows((h, p) => {
          if (IsWindowVisible(h)) {
            StringBuilder sb = new StringBuilder(512);
            GetWindowText(h, sb, sb.Capacity);
            string tStr = sb.ToString();
            RECT r;
            if (tStr.Length > 0 && GetWindowRect(h, out r)) {
              int w = r.Right - r.Left;
              int ht = r.Bottom - r.Top;
              if (w > 20 && ht > 20 && !tStr.Contains("OsdForm") && !tStr.Contains("Giris Deneyimi")) {
                uint pid;
                GetWindowThreadProcessId(h, out pid);
                string pName = "";
                try {
                  Process proc = Process.GetProcessById((int)pid);
                  if (proc != null) pName = proc.ProcessName;
                } catch {}
                string safeT = tStr.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", " ");
                string safeP = pName.Replace("\\", "\\\\").Replace("\"", "\\\"");
                wins.Add("{\"handle\":\"" + h.ToInt64() + "\",\"title\":\"" + safeT + "\",\"processName\":\"" + safeP + "\",\"bounds\":{\"x\":" + r.Left + ",\"y\":" + r.Top + ",\"width\":" + w + ",\"height\":" + ht + "}}");
              }
            }
          }
          return true;
        }, IntPtr.Zero);
        json = "[" + string.Join(",", wins.ToArray()) + "]";
      } catch {}
    });
    t.SetApartmentState(System.Threading.ApartmentState.STA);
    t.Start();
    t.Join(800);
    return json;
  }

  private class BFSItem {
    public AutomationElement Element;
    public int Depth;
  }

  public static List<IntPtr> WakeUpAccessibilityAndGetRenderRoots(IntPtr target) {
    List<IntPtr> renderRoots = new List<IntPtr>();
    if (target == IntPtr.Zero || !IsWindow(target)) return renderRoots;

    Guid iidIAccessible = new Guid("{618736E0-3C3D-11CF-810C-00AA00389B71}");
    StringBuilder clsSb = new StringBuilder(256);

    // Hedef pencerenin kendi sınıfını kontrol et
    GetClassName(target, clsSb, clsSb.Capacity);
    string targetCls = clsSb.ToString();
    if (targetCls.Contains("Chrome_RenderWidgetHostHWND") ||
        targetCls.Contains("Windows.UI.Core.CoreWindow") ||
        targetCls.Contains("ApplicationFrameInputSinkWindow") ||
        targetCls.Contains("Internet Explorer_Server")) {
      UIntPtr res;
      SendMessageTimeout(target, 0x003D, IntPtr.Zero, new IntPtr(-4), 2, 150, out res);
      try {
        object accObj;
        AccessibleObjectFromWindow(target, 0xFFFFFFFCu, ref iidIAccessible, out accObj);
      } catch {}
      renderRoots.Add(target);
    }

    // Hedef pencerenin tüm alt pencerelerini (child windows) tara
    EnumChildWindows(target, (childHwnd, p) => {
      if (IsWindowVisible(childHwnd)) {
        StringBuilder sb = new StringBuilder(256);
        GetClassName(childHwnd, sb, sb.Capacity);
        string clsName = sb.ToString();
        if (clsName.Contains("Chrome_RenderWidgetHostHWND") ||
            clsName.Contains("Windows.UI.Core.CoreWindow") ||
            clsName.Contains("ApplicationFrameInputSinkWindow") ||
            clsName.Contains("Internet Explorer_Server")) {
          UIntPtr res;
          SendMessageTimeout(childHwnd, 0x003D, IntPtr.Zero, new IntPtr(-4), 2, 150, out res);
          try {
            object accObj;
            AccessibleObjectFromWindow(childHwnd, 0xFFFFFFFCu, ref iidIAccessible, out accObj);
          } catch {}
          renderRoots.Add(childHwnd);
        }
      }
      return true;
    }, IntPtr.Zero);

    // Eğer render root bulunduysa Chromium/Electron DOM motorunun ağacı üretmesi için 60ms bekle
    if (renderRoots.Count > 0) {
      System.Threading.Thread.Sleep(60);
    }

    return renderRoots;
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
              if (tStr.Length > 0 && !tStr.Contains("OsdForm") && !tStr.Contains("Giris Deneyimi")) {
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

        RECT winRect;
        GetWindowRect(target, out winRect);
        int winLeft = winRect.Left;
        int winTop = winRect.Top;
        int winRight = winRect.Right;
        int winBottom = winRect.Bottom;
        int winWidth = winRight - winLeft;
        int winHeight = winBottom - winTop;

        int inputX = winLeft + (int)(winWidth * 0.62);
        int inputY = winBottom - 42;
        int sendX = winRight - 45;
        int sendY = winBottom - 42;
        int searchX = winLeft + 140;
        int searchY = winTop + 115;
        int firstItemX = winLeft + 160;
        int firstItemY = winTop + 195;

        string windowBoundsJson = string.Format(
          "{{\"left\":{0},\"top\":{1},\"right\":{2},\"bottom\":{3},\"width\":{4},\"height\":{5}}}",
          winLeft, winTop, winRight, winBottom, winWidth, winHeight
        );

        string landmarksJson = string.Format(
          "{{\"bottom_input_bar\":{{\"x\":{0},\"y\":{1},\"description\":\"Sohbet/Mesaj Giris Kutusu Tahmini Bolgesi (Alt Cubuk)\"}},\"bottom_send_button\":{{\"x\":{2},\"y\":{3},\"description\":\"Gonder Butonu Tahmini Bolgesi (Sag Alt)\"}},\"left_search_box\":{{\"x\":{4},\"y\":{5},\"description\":\"Sol Panel Arama Kutusu Tahmini Bolgesi\"}},\"left_first_item\":{{\"x\":{6},\"y\":{7},\"description\":\"Sol Liste Ilk Oge / Sohbet Bolgesi\"}}}}",
          inputX, inputY, sendX, sendY, searchX, searchY, firstItemX, firstItemY
        );

        List<string> list = new List<string>();
        Stopwatch sw = Stopwatch.StartNew();

        try {
          List<IntPtr> renderRoots = WakeUpAccessibilityAndGetRenderRoots(target);
          Queue<BFSItem> queue = new Queue<BFSItem>();
          HashSet<IntPtr> queuedHandles = new HashSet<IntPtr>();

          // Render root pencerelerini en başa derinlik 0 olarak ekle
          foreach (IntPtr rHwnd in renderRoots) {
            try {
              AutomationElement rEl = AutomationElement.FromHandle(rHwnd);
              if (rEl != null) {
                queue.Enqueue(new BFSItem { Element = rEl, Depth = 0 });
                queuedHandles.Add(rHwnd);
              }
            } catch {}
          }

          // Ana hedef pencereyi de ekle
          if (!queuedHandles.Contains(target)) {
            try {
              AutomationElement rootEl = AutomationElement.FromHandle(target);
              if (rootEl != null) {
                queue.Enqueue(new BFSItem { Element = rootEl, Depth = 0 });
              }
            } catch {}
          }

          int visited = 0;
          int idx = 1;
          TreeWalker walker = TreeWalker.ControlViewWalker;

          while (queue.Count > 0 && visited < 650 && idx <= 85) {
            if (sw.ElapsedMilliseconds > 1100) break;
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

                    bool isInteractive = cleanType == "Edit" || cleanType == "Document" || cleanType == "Button" ||
                                         cleanType == "Hyperlink" || cleanType == "ListItem" || cleanType == "TabItem" ||
                                         cleanType == "ComboBox" || cleanType == "CheckBox" || cleanType == "MenuItem" ||
                                         cleanType == "RadioButton" || cleanType == "TreeItem" || cleanType == "SplitButton" ||
                                         (cleanType == "Text" && (!string.IsNullOrEmpty(name) || el.Current.IsKeyboardFocusable));

                    if (isInteractive) {
                      int cx = (int)(r.X + (r.Width / 2.0));
                      int cy = (int)(r.Y + (r.Height / 2.0));

                      list.Add("{\"id\":\"u" + idx + "\",\"type\":\"" + cleanType + "\",\"name\":\"" + name + "\",\"x\":" + cx + ",\"y\":" + cy + ",\"rect\":{\"left\":" + (int)r.X + ",\"top\":" + (int)r.Y + ",\"width\":" + (int)r.Width + ",\"height\":" + (int)r.Height + "}}");
                      idx++;
                    }
                  }
                }
              } catch {}
            }

            if (depth < 14) {
              try {
                AutomationElement child = walker.GetFirstChild(el);
                if (child == null) {
                  try {
                    child = TreeWalker.RawViewWalker.GetFirstChild(el);
                  } catch {}
                }
                while (child != null) {
                  if (sw.ElapsedMilliseconds > 1100 || visited + queue.Count >= 650) break;
                  queue.Enqueue(new BFSItem { Element = child, Depth = depth + 1 });
                  try {
                    child = walker.GetNextSibling(child);
                  } catch {
                    child = null;
                  }
                }
              } catch {}
            }
          }
        } catch {}

        string safeTitle = winTitle.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", " ");
        jsonResult = "{\"action\":\"inspect\",\"handle\":\"" + target.ToInt64() + "\",\"windowTitle\":\"" + safeTitle + "\",\"windowBounds\":" + windowBoundsJson + ",\"landmarks\":" + landmarksJson + ",\"elements\":[" + string.Join(",", list.ToArray()) + "]}";
      } catch {}
    });

    t.SetApartmentState(System.Threading.ApartmentState.STA);
    t.Start();
    t.Join(1300);
    return jsonResult;
  }

  public static bool ForceForeground(IntPtr hWnd) {
    if (hWnd == IntPtr.Zero || !IsWindow(hWnd)) return false;
    bool wasIconic = IsIconic(hWnd);
    ShowWindowAsync(hWnd, 9); // SW_RESTORE = 9
    if (wasIconic) {
      System.Threading.Thread.Sleep(140);
    }
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
  try {
    $raw = [DesktopNative]::GetWindowsJson()
    $parsed = $raw | ConvertFrom-Json
    return @($parsed)
  } catch {
    return @()
  }
}

function Get-WindowTitle([IntPtr]$handle) {
  if ($handle -eq [IntPtr]::Zero) { return "" }
  try {
    $sb = [Text.StringBuilder]::new(512)
    [void][DesktopNative]::GetWindowText($handle, $sb, $sb.Capacity)
    return $sb.ToString()
  } catch { return "" }
}

function Get-WindowProcessName([IntPtr]$handle) {
  if ($handle -eq [IntPtr]::Zero) { return "" }
  try {
    $procId = 0
    [void][DesktopNative]::GetWindowThreadProcessId($handle, [ref]$procId)
    if ($procId -gt 0) {
      $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
      if ($proc) { return [string]$proc.ProcessName }
    }
  } catch {}
  return ""
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

  # Foreground bulunamadıysa en üstteki görünür açık pencereyi seç
  $allWins = Get-DesktopWindows
  if ($allWins -and $allWins.Count -gt 0) {
    return [IntPtr]::new([long]$allWins[0].handle)
  }

  return [IntPtr]::Zero
}

function Resolve-TargetElement {
  param(
    [string]$target,
    [IntPtr]$handle = [IntPtr]::Zero
  )
  if ([string]::IsNullOrWhiteSpace($target)) { return $null }
  $cleanTarget = $target.Trim().TrimStart('[').TrimEnd(']')
  $lower = $cleanTarget.ToLowerInvariant()

  $targetHwnd = if ($handle -ne [IntPtr]::Zero) { $handle } else { [DesktopNative]::GetForegroundWindow() }
  $winRect = [DesktopNative+RECT]::new()
  $hasRect = ($targetHwnd -ne [IntPtr]::Zero -and [DesktopNative]::GetWindowRect($targetHwnd, [ref]$winRect) -and ($winRect.Right -gt $winRect.Left))
  $wLeft = if ($hasRect) { $winRect.Left } else { 0 }
  $wTop = if ($hasRect) { $winRect.Top } else { 0 }
  $wRight = if ($hasRect) { $winRect.Right } else { 1920 }
  $wBottom = if ($hasRect) { $winRect.Bottom } else { 1080 }
  $wWidth = $wRight - $wLeft
  $wHeight = $wBottom - $wTop

  # 1. Eğer hedef açıkça bir landmark ismi ise
  if ($lower -eq 'bottom_input_bar' -or $lower -eq 'landmark_bottom_input_bar') {
    if ($script:LastUiElements) {
      foreach ($el in $script:LastUiElements) {
        if ($el.type -eq 'Edit' -or $el.type -eq 'Document') { return $el }
      }
    }
    return @{
      id = "landmark_bottom_input_bar";
      type = "Landmark";
      name = "Sohbet/Mesaj Giris Kutusu Tahmini Bolgesi (Alt Cubuk)";
      x = [int]($wLeft + ($wWidth * 0.62));
      y = [int]($wBottom - 42);
      rect = @{ left = [int]($wLeft + ($wWidth * 0.3)); top = [int]($wBottom - 60); width = [int]($wWidth * 0.6); height = 40 }
    }
  }

  if ($lower -eq 'bottom_send_button' -or $lower -eq 'landmark_bottom_send_button') {
    if ($script:LastUiElements) {
      foreach ($el in $script:LastUiElements) {
        if ($el.name -match 'gönder|gonder|send' -or ($el.type -eq 'Button' -and $el.x -gt ($wRight - 100) -and $el.y -gt ($wBottom - 80))) { return $el }
      }
    }
    return @{
      id = "landmark_bottom_send_button";
      type = "Landmark";
      name = "Gonder Butonu Tahmini Bolgesi (Sag Alt)";
      x = [int]($wRight - 45);
      y = [int]($wBottom - 42);
      rect = @{ left = [int]($wRight - 65); top = [int]($wBottom - 60); width = 40; height = 40 }
    }
  }

  if ($lower -eq 'left_search_box' -or $lower -eq 'landmark_left_search_box') {
    return @{
      id = "landmark_left_search_box";
      type = "Landmark";
      name = "Sol Panel Arama Kutusu Tahmini Bolgesi";
      x = [int]($wLeft + 140);
      y = [int]($wTop + 115);
      rect = @{ left = [int]($wLeft + 20); top = [int]($wTop + 95); width = 240; height = 40 }
    }
  }

  if ($lower -eq 'left_first_item' -or $lower -eq 'landmark_left_first_item') {
    return @{
      id = "landmark_left_first_item";
      type = "Landmark";
      name = "Sol Liste Ilk Oge / Sohbet Bolgesi";
      x = [int]($wLeft + 160);
      y = [int]($wTop + 195);
      rect = @{ left = [int]($wLeft + 20); top = [int]($wTop + 165); width = 280; height = 60 }
    }
  }

  # 2. Son bulunan UI öğeleri listesinde ara ($script:LastUiElements)
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

  # 3. Bulunamadıysa hızlı GetUiElementsJson çağırıp güncelle
  $hStr = if ($targetHwnd -ne [IntPtr]::Zero) { $targetHwnd.ToInt64().ToString() } else { "" }
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

  # 4. Model "mesaj" / "input" dedi ama UIA'da bulunamadıysa landmark fallback
  if ($lower -match 'mesaj|message|chat_input|input_bar|yaz') {
    if ($script:LastUiElements) {
      foreach ($el in $script:LastUiElements) {
        if ($el.type -eq 'Edit' -or $el.type -eq 'Document') { return $el }
      }
    }
    return @{
      id = "landmark_bottom_input_bar";
      type = "Landmark";
      name = "Sohbet/Mesaj Giris Kutusu Tahmini Bolgesi (Alt Cubuk)";
      x = [int]($wLeft + ($wWidth * 0.62));
      y = [int]($wBottom - 42);
      rect = @{ left = [int]($wLeft + ($wWidth * 0.3)); top = [int]($wBottom - 60); width = [int]($wWidth * 0.6); height = 40 }
    }
  }

  if ($lower -match 'gönder|gonder|send') {
    if ($script:LastUiElements) {
      foreach ($el in $script:LastUiElements) {
        if ($el.name -match 'gönder|gonder|send' -or ($el.type -eq 'Button' -and $el.x -gt ($wRight - 100) -and $el.y -gt ($wBottom - 80))) { return $el }
      }
    }
    return @{
      id = "landmark_bottom_send_button";
      type = "Landmark";
      name = "Gonder Butonu Tahmini Bolgesi (Sag Alt)";
      x = [int]($wRight - 45);
      y = [int]($wBottom - 42);
      rect = @{ left = [int]($wRight - 65); top = [int]($wBottom - 60); width = 40; height = 40 }
    }
  }

  if ($lower -match 'arama|ara|search') {
    return @{
      id = "landmark_left_search_box";
      type = "Landmark";
      name = "Sol Panel Arama Kutusu Tahmini Bolgesi";
      x = [int]($wLeft + 140);
      y = [int]($wTop + 115);
      rect = @{ left = [int]($wLeft + 20); top = [int]($wTop + 95); width = 240; height = 40 }
    }
  }

  if ($lower -match 'sohbet|first_chat|first_item') {
    return @{
      id = "landmark_left_first_item";
      type = "Landmark";
      name = "Sol Liste Ilk Oge / Sohbet Bolgesi";
      x = [int]($wLeft + 160);
      y = [int]($wTop + 195);
      rect = @{ left = [int]($wLeft + 20); top = [int]($wTop + 165); width = 280; height = 60 }
    }
  }

  return $null
}

function Draw-ScreenshotOverlays($bitmap, $screen, $uiElements, $activeHandle) {
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

    $neonGreen = [System.Drawing.Color]::FromArgb(148, 216, 45)
    $darkBg = [System.Drawing.Color]::FromArgb(220, 11, 19, 14)
    $gridColor = [System.Drawing.Color]::FromArgb(45, 148, 216, 45)
    $stampBg = [System.Drawing.Color]::FromArgb(210, 15, 23, 42)
    $stampColor = [System.Drawing.Color]::FromArgb(102, 217, 232) # Parlak camgöbeği (#66D9E8)

    $gridPen = [System.Drawing.Pen]::new($gridColor, 1)
    $textBrush = [System.Drawing.SolidBrush]::new($neonGreen)
    $bgBrush = [System.Drawing.SolidBrush]::new($darkBg)
    $stampBrush = [System.Drawing.SolidBrush]::new($stampColor)
    $stampBgBrush = [System.Drawing.SolidBrush]::new($stampBg)
    $badgeBorderPen = [System.Drawing.Pen]::new($neonGreen, 1)
    $stampBorderPen = [System.Drawing.Pen]::new($stampColor, 1)
    $badgeOutlinePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(80, 148, 216, 45), 1)

    $rulerFont = [System.Drawing.Font]::new("Consolas", 8, [System.Drawing.FontStyle]::Bold)
    $stampFont = [System.Drawing.Font]::new("Consolas", 7, [System.Drawing.FontStyle]::Bold)
    $badgeFont = [System.Drawing.Font]::new("Segoe UI", 8, [System.Drawing.FontStyle]::Bold)

    try {
      # 1. 4-Kenar Cetveli ve 100px Kılavuz Çizgileri
      for ($x = 100; $x -lt $screen.Width; $x += 100) {
        $graphics.DrawLine($gridPen, $x, 0, $x, $screen.Height)
        $numStr = "$x"
        $sz = $graphics.MeasureString($numStr, $rulerFont)
        $bx = [int]($x - ($sz.Width / 2.0))
        $bw = [int]$sz.Width + 4
        $bh = 15

        # Üst kenar cetveli
        $graphics.FillRectangle($bgBrush, $bx, 2, $bw, $bh)
        $graphics.DrawRectangle($badgeBorderPen, $bx, 2, $bw, $bh)
        $graphics.DrawString($numStr, $rulerFont, $textBrush, $bx + 2, 2)

        # Alt kenar cetveli (Height - 20)
        $bottomY = [Math]::Max(0, $screen.Height - 18)
        $graphics.FillRectangle($bgBrush, $bx, $bottomY, $bw, $bh)
        $graphics.DrawRectangle($badgeBorderPen, $bx, $bottomY, $bw, $bh)
        $graphics.DrawString($numStr, $rulerFont, $textBrush, $bx + 2, $bottomY)
      }

      for ($y = 100; $y -lt $screen.Height; $y += 100) {
        $graphics.DrawLine($gridPen, 0, $y, $screen.Width, $y)
        $numStr = "$y"
        $sz = $graphics.MeasureString($numStr, $rulerFont)
        $by = [int]($y - ($sz.Height / 2.0))
        $bw = [int]$sz.Width + 4
        $bh = 15

        # Sol kenar cetveli
        $graphics.FillRectangle($bgBrush, 2, $by, $bw, $bh)
        $graphics.DrawRectangle($badgeBorderPen, 2, $by, $bw, $bh)
        $graphics.DrawString($numStr, $rulerFont, $textBrush, 4, $by)

        # Sağ kenar cetveli (Width - 42)
        $rightX = [Math]::Max(0, $screen.Width - 42)
        $graphics.FillRectangle($bgBrush, $rightX, $by, $bw, $bh)
        $graphics.DrawRectangle($badgeBorderPen, $rightX, $by, $bw, $bh)
        $graphics.DrawString($numStr, $rulerFont, $textBrush, $rightX + 2, $by)
      }

      # 2. Ekran İçi (X,Y) Kesişim Damgaları (Her 200px'de bir)
      for ($gx = 200; $gx -lt ($screen.Width - 60); $gx += 200) {
        for ($gy = 200; $gy -lt ($screen.Height - 50); $gy += 200) {
          $stampText = "($gx,$gy)"
          $stSz = $graphics.MeasureString($stampText, $stampFont)
          $stW = [int]$stSz.Width + 4
          $stH = 13
          $stX = $gx + 3
          $stY = $gy + 3

          $graphics.FillRectangle($stampBgBrush, $stX, $stY, $stW, $stH)
          $graphics.DrawRectangle($stampBorderPen, $stX, $stY, $stW, $stH)
          $graphics.DrawString($stampText, $stampFont, $stampBrush, $stX + 2, $stY)
        }
      }

      # 3. Aktif Hedef Pencere Çerçevesi (2px #66D9E8 / Parlak Camgöbeği)
      if ($activeHandle -and $activeHandle -ne [IntPtr]::Zero -and [DesktopNative]::IsWindow($activeHandle)) {
        $winRect = [DesktopNative+RECT]::new()
        if ([DesktopNative]::GetWindowRect($activeHandle, [ref]$winRect)) {
          $wx = [Math]::Max(0, $winRect.Left - $screen.X)
          $wy = [Math]::Max(0, $winRect.Top - $screen.Y)
          $ww = $winRect.Right - $winRect.Left
          $wh = $winRect.Bottom - $winRect.Top

          if ($ww -gt 30 -and $wh -gt 30) {
            $cyanPen = [System.Drawing.Pen]::new($stampColor, 2)
            try {
              $graphics.DrawRectangle($cyanPen, $wx, $wy, $ww, $wh)

              $altLabel = "[Aktif Pencere Alt Siniri: Y=$($winRect.Bottom)]"
              $lblSz = $graphics.MeasureString($altLabel, $badgeFont)
              $lblW = [int]$lblSz.Width + 6
              $lblH = 17
              $lblX = $wx + 6
              $lblY = [Math]::Max(0, ($wy + $wh) - 22)

              $graphics.FillRectangle($stampBgBrush, $lblX, $lblY, $lblW, $lblH)
              $graphics.DrawRectangle($cyanPen, $lblX, $lblY, $lblW, $lblH)
              $graphics.DrawString($altLabel, $badgeFont, $stampBrush, $lblX + 3, $lblY + 1)
            } finally {
              $cyanPen.Dispose()
            }
          }
        }
      }

      # 4. Etkileşimli UI Öğeleri Rozetleri
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
      $stampBrush.Dispose()
      $stampBgBrush.Dispose()
      $badgeBorderPen.Dispose()
      $stampBorderPen.Dispose()
      $badgeOutlinePen.Dispose()
      $rulerFont.Dispose()
      $stampFont.Dispose()
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

    foreach ($m in $modifiers) {
      [DesktopNative]::keybd_event($m, 0, 0, [UIntPtr]::Zero)
      [System.Threading.Thread]::Sleep(10)
    }
    [DesktopNative]::SendUnicodeString($mainKey)
    for ($i = $modifiers.Count - 1; $i -ge 0; $i--) {
      [DesktopNative]::keybd_event($modifiers[$i], 0, 2, [UIntPtr]::Zero)
      [System.Threading.Thread]::Sleep(10)
    }
    return
  }

  if ($script:VkMap.ContainsKey($k)) {
    $vk = $script:VkMap[$k]
    [DesktopNative]::keybd_event($vk, 0, 0, [UIntPtr]::Zero)
    [System.Threading.Thread]::Sleep(20)
    [DesktopNative]::keybd_event($vk, 0, 2, [UIntPtr]::Zero)
    return
  }

  [DesktopNative]::SendUnicodeString($keyName)
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

    $inspectProcess = ""
    try { $inspectProcess = Get-WindowProcessName ([IntPtr]::new([long]$resObj.handle)) } catch {}
    return @{
      action = 'inspect';
      handle = [string]$resObj.handle;
      windowTitle = [string]$resObj.windowTitle;
      processName = $inspectProcess;
      windowBounds = $resObj.windowBounds;
      landmarks = $resObj.landmarks;
      elements = $elements;
    }
  }

  if ($action -eq 'screenshot') {
    $file = [string]$request.screenshotPath
    if ([string]::IsNullOrWhiteSpace($file) -or [IO.Path]::GetExtension($file) -ne '.png' -or -not [IO.Path]::IsPathRooted($file)) {
      $file = [IO.Path]::Combine([IO.Path]::GetTempPath(), "tbot-screen-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()).png")
    }
    $bitmap = [Drawing.Bitmap]::new($screen.Width, $screen.Height)
    $uiElements = @()
    $activeHwnd = Resolve-WindowHandle $request
    $windowBounds = $null
    $landmarks = $null
    $activeTitle = ""
    try {
      $graphics = [Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.CopyFromScreen($screen.Location, [Drawing.Point]::Empty, $screen.Size)
      } finally {
        $graphics.Dispose()
      }

      $handleInput = if ($activeHwnd -ne [IntPtr]::Zero) { $activeHwnd.ToInt64().ToString() } elseif ($request.handle) { [string]$request.handle } else { "" }
      try {
        $rawJson = [DesktopNative]::GetUiElementsJson($handleInput)
        $uiObj = $rawJson | ConvertFrom-Json
        $uiElements = @($uiObj.elements)
        $windowBounds = $uiObj.windowBounds
        $landmarks = $uiObj.landmarks
        $activeTitle = [string]$uiObj.windowTitle
        $script:LastUiElements = [System.Collections.Generic.List[object]]::new()
        foreach ($item in $uiElements) { $script:LastUiElements.Add($item) }
      } catch {}

      try {
        Draw-ScreenshotOverlays $bitmap $screen $uiElements $activeHwnd
      } catch {}

      $bitmap.Save($file, [Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $bitmap.Dispose()
    }
    $activeHandleStr = ""
    if ($activeHwnd -ne [IntPtr]::Zero) { $activeHandleStr = $activeHwnd.ToInt64().ToString() }
    return @{
      path = $file;
      screenshotPath = $file;
      bounds = @{ x=$screen.X; y=$screen.Y; width=$screen.Width; height=$screen.Height };
      windowBounds = $windowBounds;
      windowTitle = $activeTitle;
      handle = $activeHandleStr;
      processName = (Get-WindowProcessName $activeHwnd);
      landmarks = $landmarks;
      elements = @($uiElements);
    }
  }

  if ($action -eq 'open' -or $action -eq 'launch' -or $action -eq 'start') {
    $targetApp = if ($request.target) { [string]$request.target } elseif ($request.text) { [string]$request.text } elseif ($request.command) { [string]$request.command } else { [string]$request.app }
    if ([string]::IsNullOrWhiteSpace($targetApp)) {
      $fg = [DesktopNative]::GetForegroundWindow()
      return @{
        attempted = $false;
        action = 'open';
        warning = 'A target application or URL was not specified for open action.';
        foreground = $fg.ToInt64().ToString();
      }
    }
    Start-Process -FilePath $targetApp -ErrorAction Stop
    [System.Threading.Thread]::Sleep(500)
    $newFg = [DesktopNative]::GetForegroundWindow()
    return @{
      attempted = $true;
      action = 'open';
      target = $targetApp;
      foreground = $newFg.ToInt64().ToString();
      handle = $newFg.ToInt64().ToString();
      windowTitle = (Get-WindowTitle $newFg);
      processName = (Get-WindowProcessName $newFg);
    }
  }

  # Handle çözümlemesi
  $handle = Resolve-WindowHandle $request

  if ($action -eq 'click_text') {
    $label = [string]$request.text
    if ([string]::IsNullOrWhiteSpace($label)) {
      return @{ attempted = $false; action = 'click_text'; warning = 'click_text requires "text" (the visible label of the UI element).'; available = @() }
    }
    if ($handle -ne [IntPtr]::Zero) { [void][DesktopNative]::ForceForeground($handle) }
    $hStr = ""
    if ($handle -ne [IntPtr]::Zero) { $hStr = $handle.ToInt64().ToString() }
    $elements = @()
    $winTitle = Get-WindowTitle $handle
    try {
      $rawJson = [DesktopNative]::GetUiElementsJson($hStr)
      $uiObj = $rawJson | ConvertFrom-Json
      $elements = @($uiObj.elements)
      $winTitle = [string]$uiObj.windowTitle
      $script:LastUiElements = [System.Collections.Generic.List[object]]::new()
      foreach ($item in $elements) { $script:LastUiElements.Add($item) }
    } catch {}

    $match = $null
    foreach ($el in $elements) {
      if ($el.name -and ([string]$el.name).Trim() -ieq $label.Trim()) { $match = $el; break }
    }
    if ($null -eq $match) {
      foreach ($el in $elements) {
        if ($el.name -and ([string]$el.name).IndexOf($label, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $match = $el; break }
      }
    }
    if ($null -eq $match) {
      $available = @($elements | Where-Object { $_.name } | Select-Object -First 12 | ForEach-Object { "$($_.id):$($_.name)" })
      return @{
        attempted = $false;
        action = 'click_text';
        text = $label;
        warning = "No visible UI element in window `"$winTitle`" matches `"$label`".";
        available = $available;
        handle = $hStr;
        windowTitle = $winTitle;
        processName = (Get-WindowProcessName $handle);
      }
    }

    [void][DesktopNative]::SetCursorPos([int]$match.x, [int]$match.y)
    [System.Threading.Thread]::Sleep(40)
    [DesktopNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero) # MOUSEEVENTF_LEFTDOWN
    [DesktopNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero) # MOUSEEVENTF_LEFTUP
    return @{
      attempted = $true;
      action = 'click_text';
      text = $label;
      element = @{ id = [string]$match.id; name = [string]$match.name; type = [string]$match.type; x = [int]$match.x; y = [int]$match.y };
      handle = $hStr;
      windowTitle = $winTitle;
      processName = (Get-WindowProcessName $handle);
    }
  }

  if ($action -eq 'focus') {
    $focused = $false
    if ($handle -ne [IntPtr]::Zero) {
      $focused = [bool][DesktopNative]::ForceForeground($handle)
    }
    return @{
      attempted = $true;
      action = 'focus';
      focused = $focused;
      handle = $handle.ToInt64().ToString();
      windowTitle = (Get-WindowTitle $handle);
      processName = (Get-WindowProcessName $handle);
    }
  }

  if ($action -eq 'move') {
    $moveX = if ($null -ne $request.x) { [int]$request.x } else { $null }
    $moveY = if ($null -ne $request.y) { [int]$request.y } else { $null }
    if (($null -eq $moveX -or $null -eq $moveY) -and $request.target) {
      $matched = Resolve-TargetElement -target ([string]$request.target) -handle $handle
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

    # Smart Window Clamping
    $clampedNotice = ""
    if ($handle -ne [IntPtr]::Zero) {
      $winRect = [DesktopNative+RECT]::new()
      if ([DesktopNative]::GetWindowRect($handle, [ref]$winRect)) {
        $winH = $winRect.Bottom - $winRect.Top
        if ($winH -gt 60) {
          $isTaskbarTarget = ($request.target -and ([string]$request.target -match 'taskbar|görev çubuğu|tray|başlat|start'))
          $screenBounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
          if (-not $isTaskbarTarget -and ($y -gt $winRect.Bottom) -and ($y -le ($winRect.Bottom + 75)) -and ($winRect.Bottom -lt ($screenBounds.Height - 25))) {
            $origY = $y
            $y = $winRect.Bottom - 42
            $clampedNotice = "[AKILLI HIZALAMA: Y koordinati pencere alt sinirina ($y) hizalandi (orijinal: $origY)]"
          }
        }
      }
    }

    [void][DesktopNative]::SetCursorPos($x, $y)
    return @{ attempted = $true; action = 'move'; x = $x; y = $y; notice = $clampedNotice }
  }

  if ($action -eq 'drag') {
    $startX = if ($null -ne $request.x) { [int]$request.x } else { $null }
    $startY = if ($null -ne $request.y) { [int]$request.y } else { $null }
    if ($null -eq $startX -or $null -eq $startY) {
      $pt = [DesktopNative+POINT]::new()
      [void][DesktopNative]::GetCursorPos([ref]$pt)
      $startX = $pt.X
      $startY = $pt.Y
    }
    $endX = if ($null -ne $request.to_x) { [int]$request.to_x } else { $startX + 100 }
    $endY = if ($null -ne $request.to_y) { [int]$request.to_y } else { $startY }

    [void][DesktopNative]::SetCursorPos($startX, $startY)
    [System.Threading.Thread]::Sleep(30)
    [DesktopNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero) # MOUSEEVENTF_LEFTDOWN
    [System.Threading.Thread]::Sleep(40)

    for ($step = 1; $step -le 5; $step++) {
      $curX = [int]($startX + ($endX - $startX) * ($step / 5.0))
      $curY = [int]($startY + ($endY - $startY) * ($step / 5.0))
      [void][DesktopNative]::SetCursorPos($curX, $curY)
      [System.Threading.Thread]::Sleep(20)
    }

    [DesktopNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero) # MOUSEEVENTF_LEFTUP
    return @{ attempted = $true; action = 'drag'; from = @{ x = $startX; y = $startY }; to = @{ x = $endX; y = $endY } }
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
      $matched = Resolve-TargetElement -target ([string]$request.target) -handle $handle
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

    # Smart Window Clamping
    $clampedNotice = ""
    if ($handle -ne [IntPtr]::Zero) {
      $winRect = [DesktopNative+RECT]::new()
      if ([DesktopNative]::GetWindowRect($handle, [ref]$winRect)) {
        $winH = $winRect.Bottom - $winRect.Top
        if ($winH -gt 60) {
          $isTaskbarTarget = ($request.target -and ([string]$request.target -match 'taskbar|görev çubuğu|tray|başlat|start'))
          $screenBounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
          if (-not $isTaskbarTarget -and ($y -gt $winRect.Bottom) -and ($y -le ($winRect.Bottom + 75)) -and ($winRect.Bottom -lt ($screenBounds.Height - 25))) {
            $origY = $y
            $y = $winRect.Bottom - 42
            $clampedNotice = "[AKILLI HIZALAMA: Y koordinati pencere alt sinirina ($y) hizalandi (orijinal: $origY)]"
          }
        }
      }
    }

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
      return @{ attempted = $true; action = 'click'; x = $x; y = $y; button = $btn; notice = $clampedNotice }
    } else {
      # Scroll
      $delta = if ($null -ne $request.delta) { [int]$request.delta } else { -120 }
      [DesktopNative]::mouse_event(0x0800, 0, 0, $delta, [UIntPtr]::Zero) # MOUSEEVENTF_WHEEL
      return @{ attempted = $true; action = 'scroll'; x = $x; y = $y; delta = $delta; notice = $clampedNotice }
    }
  } elseif ($action -eq 'type') {
    $typeX = if ($null -ne $request.x) { [int]$request.x } else { $null }
    $typeY = if ($null -ne $request.y) { [int]$request.y } else { $null }

    # Koordinat veya target varsa önce tıkla
    if ($request.target) {
      $matched = Resolve-TargetElement -target ([string]$request.target) -handle $handle
      if ($matched) {
        $typeX = [int]$matched.x
        $typeY = [int]$matched.y
      }
    }
    if ($null -ne $typeX -and $null -ne $typeY) {
      $tx = [int]$typeX
      $ty = [int]$typeY

      # Smart Window Clamping
      if ($handle -ne [IntPtr]::Zero) {
        $winRect = [DesktopNative+RECT]::new()
        if ([DesktopNative]::GetWindowRect($handle, [ref]$winRect)) {
          $winH = $winRect.Bottom - $winRect.Top
          if ($winH -gt 60) {
            $isTaskbarTarget = ($request.target -and ([string]$request.target -match 'taskbar|görev çubuğu|tray|başlat|start'))
            $screenBounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
            if (-not $isTaskbarTarget -and ($ty -gt $winRect.Bottom) -and ($ty -le ($winRect.Bottom + 75)) -and ($winRect.Bottom -lt ($screenBounds.Height - 25))) {
              $ty = $winRect.Bottom - 42
            }
          }
        }
      }

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
      [DesktopNative]::SendUnicodeString($inputText)
    }

    if ($request.press_enter -or $request.enter -or $request.submit -or $inputText.EndsWith("`n")) {
      [System.Threading.Thread]::Sleep(50)
      [DesktopNative]::keybd_event(0x0D, 0, 0, [UIntPtr]::Zero) # ENTER Down
      [System.Threading.Thread]::Sleep(20)
      [DesktopNative]::keybd_event(0x0D, 0, 2, [UIntPtr]::Zero) # ENTER Up
    }

    return @{ attempted = $true; action = 'type'; text = $inputText }
  } elseif ($action -eq 'key') {
    $keyInput = [string]$request.key
    Send-KeyboardKey $keyInput
    return @{ attempted = $true; action = 'key'; key = $keyInput }
  } else {
    $fg = [DesktopNative]::GetForegroundWindow()
    return @{
      attempted = $false;
      action = $action;
      warning = "Unsupported action '$action'. Available actions: windows, inspect, screenshot, focus, click, click_text, type, key, scroll, move, drag, open, wait, wait_for_window.";
      foreground = $fg.ToInt64().ToString();
    }
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
      $errText = $_.Exception.Message
      $fallbackFg = [DesktopNative]::GetForegroundWindow()
      $fallbackTitle = [Text.StringBuilder]::new(512)
      try { [void][DesktopNative]::GetWindowText($fallbackFg, $fallbackTitle, $fallbackTitle.Capacity) } catch {}
      $res = @{
        id = $id;
        ok = $false;
        warning = $errText;
        fallback = $true;
        handle = $fallbackFg.ToInt64().ToString();
        windowTitle = $fallbackTitle.ToString();
      }
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
    $errText = $_.Exception.Message
    $fallbackFg = [DesktopNative]::GetForegroundWindow()
    $fallbackTitle = [Text.StringBuilder]::new(512)
    try { [void][DesktopNative]::GetWindowText($fallbackFg, $fallbackTitle, $fallbackTitle.Capacity) } catch {}
    $res = @{
      ok = $false;
      warning = $errText;
      fallback = $true;
      handle = $fallbackFg.ToInt64().ToString();
      windowTitle = $fallbackTitle.ToString();
    }
    [Console]::Out.WriteLine(($res | ConvertTo-Json -Depth 6 -Compress))
    exit 0
  }
}
