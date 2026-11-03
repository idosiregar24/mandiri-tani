Add-Type -AssemblyName System.Drawing

$size = 512
$bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

# Clear background to transparent
$g.Clear([System.Drawing.Color]::Transparent)

# Rounded rectangle for icon background
$rect = New-Object System.Drawing.Rectangle 16, 16, 480, 480
$radius = 110

$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc($rect.X, $rect.Y, $radius * 2, $radius * 2, 180, 90)
$path.AddArc($rect.Right - $radius * 2, $rect.Y, $radius * 2, $radius * 2, 270, 90)
$path.AddArc($rect.Right - $radius * 2, $rect.Bottom - $radius * 2, $radius * 2, $radius * 2, 0, 90)
$path.AddArc($rect.X, $rect.Bottom - $radius * 2, $radius * 2, $radius * 2, 90, 90)
$path.CloseFigure()

# Background gradient: Rich Mandiri Tani Green
$cTop = [System.Drawing.Color]::FromArgb(255, 46, 125, 50)   # #2e7d32
$cBot = [System.Drawing.Color]::FromArgb(255, 27, 94, 32)    # #1b5e20
$brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect, $cTop, $cBot, [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
$g.FillPath($brush, $path)

# Border line
$borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(40, 255, 255, 255)), 4
$g.DrawPath($borderPen, $path)

# Leaf Path (Smooth stylized agricultural leaf)
$leafPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$p1 = New-Object System.Drawing.PointF 160, 365
$c1 = New-Object System.Drawing.PointF 140, 240
$c2 = New-Object System.Drawing.PointF 220, 140
$p2 = New-Object System.Drawing.PointF 370, 115

$c3 = New-Object System.Drawing.PointF 355, 270
$c4 = New-Object System.Drawing.PointF 265, 365

$leafPath.AddBezier($p1, $c1, $c2, $p2)
$leafPath.AddBezier($p2, $c3, $c4, $p1)
$leafPath.CloseFigure()

$leafBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
$g.FillPath($leafBrush, $leafPath)

# Leaf center vein
$veinPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(230, 27, 94, 32)), 10
$veinPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$veinPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawBezier($veinPen, (New-Object System.Drawing.PointF 165, 360), (New-Object System.Drawing.PointF 225, 290), (New-Object System.Drawing.PointF 280, 210), (New-Object System.Drawing.PointF 360, 125))

# Side veins
$sidePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(180, 27, 94, 32)), 6
$sidePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$sidePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($sidePen, 235, 280, 195, 245)
$g.DrawLine($sidePen, 275, 230, 320, 220)
$g.DrawLine($sidePen, 295, 200, 265, 175)

# Small second leaf / sprout on bottom left
$sproutPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$sproutPath.AddBezier((New-Object System.Drawing.PointF 155, 365), (New-Object System.Drawing.PointF 110, 340), (New-Object System.Drawing.PointF 115, 285), (New-Object System.Drawing.PointF 175, 280))
$sproutPath.AddBezier((New-Object System.Drawing.PointF 175, 280), (New-Object System.Drawing.PointF 185, 330), (New-Object System.Drawing.PointF 165, 355), (New-Object System.Drawing.PointF 155, 365))
$sproutPath.CloseFigure()
$sproutBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(230, 232, 245, 233))
$g.FillPath($sproutBrush, $sproutPath)

# Save 512x512 PNG to build/icon.png
if (-not (Test-Path "build")) { New-Item -ItemType Directory -Path "build" }
$bmp.Save("build/icon.png", [System.Drawing.Imaging.ImageFormat]::Png)

# Create 256x256 for Windows ICO
$bmp256 = New-Object System.Drawing.Bitmap 256, 256, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g256 = [System.Drawing.Graphics]::FromImage($bmp256)
$g256.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g256.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g256.DrawImage($bmp, 0, 0, 256, 256)

$ms = New-Object System.IO.MemoryStream
$bmp256.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $ms.ToArray()

# Build ICO binary with embedded PNG
$icoMs = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $icoMs

# ICO Header
$bw.Write([uint16]0) # Reserved
$bw.Write([uint16]1) # Type (1 = Icon)
$bw.Write([uint16]1) # Count (1 image)

# Directory Entry (16 bytes)
$bw.Write([byte]0)   # Width: 0 = 256
$bw.Write([byte]0)   # Height: 0 = 256
$bw.Write([byte]0)   # Palette
$bw.Write([byte]0)   # Reserved
$bw.Write([uint16]1) # Color planes
$bw.Write([uint16]32) # Bits per pixel
$bw.Write([uint32]$pngBytes.Length) # Image data size
$bw.Write([uint32]22) # Offset of data (6 + 16 = 22)

# Image Data
$bw.Write($pngBytes)
$bw.Flush()

[System.IO.File]::WriteAllBytes("build/icon.ico", $icoMs.ToArray())

# Also create Android launcher icons for various densities
$androidRes = "mobile/android/app/src/main/res"
if (Test-Path $androidRes) {
  $densities = @{
    "mipmap-mdpi" = 48
    "mipmap-hdpi" = 72
    "mipmap-xhdpi" = 96
    "mipmap-xxhdpi" = 144
    "mipmap-xxxhdpi" = 192
  }

  foreach ($d in $densities.Keys) {
    $dim = $densities[$d]
    $folder = Join-Path $androidRes $d
    if (Test-Path $folder) {
      $scaled = New-Object System.Drawing.Bitmap $dim, $dim
      $sg = [System.Drawing.Graphics]::FromImage($scaled)
      $sg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
      $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $sg.DrawImage($bmp, 0, 0, $dim, $dim)
      $scaled.Save((Join-Path $folder "ic_launcher.png"), [System.Drawing.Imaging.ImageFormat]::Png)
      $scaled.Save((Join-Path $folder "ic_launcher_round.png"), [System.Drawing.Imaging.ImageFormat]::Png)
      $sg.Dispose()
      $scaled.Dispose()
    }
  }
}

$g.Dispose()
$bmp.Dispose()
$g256.Dispose()
$bmp256.Dispose()
$ms.Dispose()
$icoMs.Dispose()

Write-Host "Icons successfully generated in build/ and mobile/android/!"
