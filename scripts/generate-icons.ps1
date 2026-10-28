# scripts/generate-icons.ps1
# T Bot 2.0 Pure White (#FFFFFF) Background Multi-Size Icon & ICO Generator

Add-Type -AssemblyName System.Drawing

$outputDirs = @("build", "assets", "src/desktop/renderer", "dist/desktop/renderer")
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

# 1. Fill entire 256x256 canvas with 100% PURE OPAQUE WHITE (#FFFFFF)
$pureWhite = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)
$gfx.Clear($pureWhite)

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

# 2. Draw subtle elegant #DCE6D9 rounded card border
$bgMargin = 8
$bgSize = 256 - ($bgMargin * 2)
$bgRadius = 40
$cardPath = Create-RoundedRectanglePath $bgMargin $bgMargin $bgSize $bgSize $bgRadius

# Draw crisp elegant border #DCE6D9 (2px)
$borderCol = [System.Drawing.ColorTranslator]::FromHtml("#DCE6D9")
$penBorder = New-Object System.Drawing.Pen($borderCol, 2.0)
$gfx.DrawPath($penBorder, $cardPath)
$penBorder.Dispose()
$cardPath.Dispose()

# 3. 14x14 Cyber-Zen Badge Matrix
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
        
        # Cyber-Zen gradient: Tabit vibrant green (#65B817 / #4D9A0F) to crystal cyan (#0891B2)
        $t = ($row + $col) / 26.0
        # Start: 101, 184, 23 (#65B817) -> End: 8, 145, 178 (#0891B2)
        $rG = [int](101 + (8 - 101) * $t)
        $gG = [int](184 + (145 - 184) * $t)
        $bG = [int](23 + (178 - 23) * $t)
        
        $brush = if ($char -eq 'W') {
            New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
        } else {
            New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, $rG, $gG, $bG))
        }
        
        $cPath = Create-RoundedRectanglePath $px $py $cellSize $cellSize 2.5
        $gfx.FillPath($brush, $cPath)
        
        # For 'W' cells, add a subtle 0.5px soft border for sharp distinction
        if ($char -eq 'W') {
            $wPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(60, 8, 145, 178), 0.75)
            $gfx.DrawPath($wPen, $cPath)
            $wPen.Dispose()
        }
        
        $cPath.Dispose()
        $brush.Dispose()
    }
}

$gfx.Flush()
$gfx.Dispose()

# Save 256x256 Master PNG
$ms256 = New-Object System.IO.MemoryStream
$bmp.Save($ms256, [System.Drawing.Imaging.ImageFormat]::Png)
$png256Bytes = $ms256.ToArray()
$ms256.Dispose()

[System.IO.File]::WriteAllBytes("build/icon.png", $png256Bytes)
[System.IO.File]::WriteAllBytes("assets/icon.png", $png256Bytes)

# Generate multi-size PNG images for ICO: 256, 128, 64, 48, 32, 16
$sizes = @(256, 128, 64, 48, 32, 16)
$pngImages = @()

foreach ($sz in $sizes) {
    if ($sz -eq 256) {
        $pngImages += ,@($sz, $png256Bytes)
    } else {
        $resizedBmp = New-Object System.Drawing.Bitmap($sz, $sz, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $rGfx = [System.Drawing.Graphics]::FromImage($resizedBmp)
        $rGfx.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $rGfx.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $rGfx.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $rGfx.Clear($pureWhite)
        
        $destRect = New-Object System.Drawing.Rectangle(0, 0, $sz, $sz)
        $srcRect = New-Object System.Drawing.Rectangle(0, 0, 256, 256)
        $rGfx.DrawImage($bmp, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
        $rGfx.Flush()
        $rGfx.Dispose()
        
        $rMs = New-Object System.IO.MemoryStream
        $resizedBmp.Save($rMs, [System.Drawing.Imaging.ImageFormat]::Png)
        $rBytes = $rMs.ToArray()
        $rMs.Dispose()
        $resizedBmp.Dispose()
        
        $pngImages += ,@($sz, $rBytes)
    }
}
$bmp.Dispose()

# Construct Multi-layer Windows ICO format
# ICONHEADER: 6 bytes
# ICONDIRENTRY: 16 bytes per image
$imageCount = $pngImages.Count
$headerSize = 6 + (16 * $imageCount)
$totalIcoSize = $headerSize
foreach ($img in $pngImages) {
    $totalIcoSize += $img[1].Length
}

$icoBytes = New-Object byte[] $totalIcoSize

# ICONHEADER
$icoBytes[0] = 0; $icoBytes[1] = 0 # Reserved
$icoBytes[2] = 1; $icoBytes[3] = 0 # Type 1 (ICO)
$icoBytes[4] = [byte]($imageCount -band 0xFF)
$icoBytes[5] = [byte](($imageCount -shr 8) -band 0xFF)

$currentOffset = $headerSize
for ($i = 0; $i -lt $imageCount; $i++) {
    $sz = $pngImages[$i][0]
    $data = $pngImages[$i][1]
    $len = $data.Length
    
    $entryOffset = 6 + ($i * 16)
    $icoBytes[$entryOffset + 0] = if ($sz -eq 256) { [byte]0 } else { [byte]$sz } # Width
    $icoBytes[$entryOffset + 1] = if ($sz -eq 256) { [byte]0 } else { [byte]$sz } # Height
    $icoBytes[$entryOffset + 2] = 0 # Colors
    $icoBytes[$entryOffset + 3] = 0 # Reserved
    $icoBytes[$entryOffset + 4] = 1; $icoBytes[$entryOffset + 5] = 0 # Planes: 1
    $icoBytes[$entryOffset + 6] = 32; $icoBytes[$entryOffset + 7] = 0 # BPP: 32
    
    # Bytes in res (4 bytes little-endian)
    $icoBytes[$entryOffset + 8] = [byte]($len -band 0xFF)
    $icoBytes[$entryOffset + 9] = [byte](($len -shr 8) -band 0xFF)
    $icoBytes[$entryOffset + 10] = [byte](($len -shr 16) -band 0xFF)
    $icoBytes[$entryOffset + 11] = [byte](($len -shr 24) -band 0xFF)
    
    # Image offset (4 bytes little-endian)
    $icoBytes[$entryOffset + 12] = [byte]($currentOffset -band 0xFF)
    $icoBytes[$entryOffset + 13] = [byte](($currentOffset -shr 8) -band 0xFF)
    $icoBytes[$entryOffset + 14] = [byte](($currentOffset -shr 16) -band 0xFF)
    $icoBytes[$entryOffset + 15] = [byte](($currentOffset -shr 24) -band 0xFF)
    
    # Copy PNG bytes to offset
    [System.Array]::Copy($data, 0, $icoBytes, $currentOffset, $len)
    $currentOffset += $len
}

# Write multi-layer ICO to all target directories
$targetIcoPaths = @(
    "build/icon.ico",
    "build/installerIcon.ico",
    "assets/icon.ico",
    "src/desktop/renderer/icon.ico"
)

if (Test-Path "dist/desktop/renderer") {
    $targetIcoPaths += "dist/desktop/renderer/icon.ico"
}

foreach ($p in $targetIcoPaths) {
    [System.IO.File]::WriteAllBytes($p, $icoBytes)
    Write-Output "SAVED_ICO: $p ($($icoBytes.Length) bytes, $($imageCount) layers)"
}

Write-Output "ICONS_GENERATION_COMPLETED_SUCCESSFULLY"
