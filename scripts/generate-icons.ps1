# scripts/generate-icons.ps1
# T Bot 2.0 Cyber-Zen 256x256 Icon & Windows ICO Generator

Add-Type -AssemblyName System.Drawing

$outputDirs = @("build", "assets")
foreach ($dir in $outputDirs) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}

$width = 256
$height = 256

$bmp = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$gfx.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gfx.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$gfx.Clear([System.Drawing.Color]::Transparent)

function Create-RoundedRectanglePath($x, $y, $w, $h, $radius) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc([float]$x, [float]$y, [float]$d, [float]$d, 180, 90)
    $path.AddArc([float]($x + $w - $d), [float]$y, [float]$d, [float]$d, 270, 90)
    $path.AddArc([float]($x + $w - $d), [float]($y + $h - $d), [float]$d, [float]$d, 0, 90)
    $path.AddArc([float]$x, [float]($y + $h - $d), [float]$d, [float]$d, 90, 90)
    $path.CloseFigure()
    return $path
}

# 1. Dark squircle background (#0D1117)
$bgMargin = 10
$bgSize = 256 - ($bgMargin * 2)
$bgRadius = 44
$bgPath = Create-RoundedRectanglePath $bgMargin $bgMargin $bgSize $bgSize $bgRadius

$ptStart = New-Object System.Drawing.PointF([float]$bgMargin, [float]$bgMargin)
$ptEnd = New-Object System.Drawing.PointF([float]($bgMargin + $bgSize), [float]($bgMargin + $bgSize))
$c1 = [System.Drawing.ColorTranslator]::FromHtml("#0D1117")
$c2 = [System.Drawing.ColorTranslator]::FromHtml("#161B22")
$brushBg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($ptStart, $ptEnd, $c1, $c2)
$gfx.FillPath($brushBg, $bgPath)
$brushBg.Dispose()

# 2. Outer cyber border
$penBorder = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml("#30363D"), 2.0)
$gfx.DrawPath($penBorder, $bgPath)
$penBorder.Dispose()

# 3. Inner neon cyan-mint subtle glow
$glowMargin = $bgMargin + 2
$glowSize = $bgSize - 4
$glowPath = Create-RoundedRectanglePath $glowMargin $glowMargin $glowSize $glowSize ($bgRadius - 2)
$penGlow = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(64, 102, 217, 232), 1.5)
$gfx.DrawPath($penGlow, $glowPath)
$penGlow.Dispose()
$glowPath.Dispose()

# 4. 14x14 Cyber-Zen Badge Matrix
$mark = @(
  'GGGGGGGGGGGGG.',
  'GGGGGGGGGGGGGG',
  'GGGGGWWGGGGGGG',
  'GGGGGWWWGGGGGG',
  'GGGGWWWWWWGGGG',
  'GGGGGWWWGGGGGG',
  'GGGGGWWWGGGGGG',
  'GGGGGWWWGGGGGG',
  'GGGGGWWWGGGGGG',
  'GGGGGWWWGGGGGG',
  'GGGGGWWWWGGGGG',
  'GGGGGGWWWGGGGG',
  'GGGGGGGGGGGGGG',
  '.GGGGGGGGGGGGG'
)

$cellSize = 11.0
$cellGap = 1.5
$totalGrid = 14 * ($cellSize + $cellGap) - $cellGap # 173.5 px
$startX = ($width - $totalGrid) / 2
$startY = ($height - $totalGrid) / 2

for ($row = 0; $row -lt 14; $row++) {
    $line = $mark[$row]
    for ($col = 0; $col -lt 14; $col++) {
        $char = $line[$col]
        if ($char -eq '.') { continue }
        
        $px = $startX + ($col * ($cellSize + $cellGap))
        $py = $startY + ($row * ($cellSize + $cellGap))
        
        # Cyber-Zen gradient: Tabit green (#94D82D) to crystal cyan (#66D9E8)
        $t = ($row + $col) / 26.0
        $rG = [int](148 + (102 - 148) * $t)
        $gG = [int](216 + (217 - 216) * $t)
        $bG = [int](45 + (232 - 45) * $t)
        
        $brush = if ($char -eq 'W') {
            New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
        } else {
            New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, $rG, $gG, $bG))
        }
        
        $cPath = Create-RoundedRectanglePath $px $py $cellSize $cellSize 2.5
        $gfx.FillPath($brush, $cPath)
        $cPath.Dispose()
        $brush.Dispose()
    }
}

$bgPath.Dispose()
$gfx.Flush()
$gfx.Dispose()

# Save PNG
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $ms.ToArray()
$ms.Dispose()
$bmp.Dispose()

[System.IO.File]::WriteAllBytes("build/icon.png", $pngBytes)
[System.IO.File]::WriteAllBytes("assets/icon.png", $pngBytes)

# Generate Windows ICO format (256x256 PNG-embedded)
$pngSize = $pngBytes.Length
$icoBytes = New-Object byte[] (22 + $pngSize)

# ICONHEADER (6 bytes)
$icoBytes[0] = 0; $icoBytes[1] = 0 # Reserved (0)
$icoBytes[2] = 1; $icoBytes[3] = 0 # Type: 1 (ICO)
$icoBytes[4] = 1; $icoBytes[5] = 0 # Image count: 1

# ICONDIRENTRY (16 bytes)
$icoBytes[6] = 0 # Width: 0 = 256px
$icoBytes[7] = 0 # Height: 0 = 256px
$icoBytes[8] = 0 # Colors: 0 = No palette
$icoBytes[9] = 0 # Reserved
$icoBytes[10] = 1; $icoBytes[11] = 0 # Planes: 1
$icoBytes[12] = 32; $icoBytes[13] = 0 # BPP: 32

# PNG size (4 bytes little-endian)
$icoBytes[14] = [byte]($pngSize -band 0xFF)
$icoBytes[15] = [byte](($pngSize -shr 8) -band 0xFF)
$icoBytes[16] = [byte](($pngSize -shr 16) -band 0xFF)
$icoBytes[17] = [byte](($pngSize -shr 24) -band 0xFF)

# Offset (22 bytes header)
$icoBytes[18] = 22
$icoBytes[19] = 0
$icoBytes[20] = 0
$icoBytes[21] = 0

# Copy PNG data
[System.Array]::Copy($pngBytes, 0, $icoBytes, 22, $pngSize)

[System.IO.File]::WriteAllBytes("build/icon.ico", $icoBytes)
[System.IO.File]::WriteAllBytes("build/installerIcon.ico", $icoBytes)
[System.IO.File]::WriteAllBytes("assets/icon.ico", $icoBytes)

Write-Output "ICONS_GENERATED_SUCCESSFULLY: $($pngBytes.Length) bytes PNG, $($icoBytes.Length) bytes ICO"
