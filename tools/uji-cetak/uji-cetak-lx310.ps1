<#
.SYNOPSIS
  Uji cetak Epson LX-310 (ESC/P) untuk Mandiri Tani POS - tanpa install apa pun.

.DESCRIPTION
  Mengirim byte ESC/P mentah (RAW) ke antrean printer Windows, persis cara
  yang nanti dipakai aplikasi (transport "windows-raw", PRD 8.1). Tiga halaman uji:
    pola   - penggaris kolom & nomor baris: cek lebar 96 kolom dan panjang
             halaman 33 baris (1/2 halaman 9,5" x 5,5"), posisi perforasi.
    font   - draft vs NLQ, 10/12 cpi, condensed, tebal, lebar ganda.
    faktur - contoh Faktur Penjualan meniru format iPOS (data fiktif).

.EXAMPLE
  .\uji-cetak-lx310.ps1                      # pilih printer, cetak semua halaman
.EXAMPLE
  .\uji-cetak-lx310.ps1 -Halaman faktur -Nlq # hanya faktur, mode NLQ (lebih rapi)
.EXAMPLE
  .\uji-cetak-lx310.ps1 -SimpanKe uji.prn    # tidak mencetak, simpan byte ke file
#>
[CmdletBinding()]
param(
  [string]$Printer,
  [ValidateSet('semua', 'pola', 'font', 'faktur')]
  [string]$Halaman = 'semua',
  [ValidateSet(10, 12)]
  [int]$Cpi = 12,
  [ValidateRange(10, 99)]
  [int]$BarisPerHalaman = 33,
  [switch]$Nlq,
  [string]$SimpanKe,
  [switch]$DaftarPrinter
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- Win32 RAW
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class RawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFO {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool ClosePrinter(IntPtr handle);
    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern int StartDocPrinter(IntPtr handle, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO info);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool EndDocPrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool StartPagePrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool EndPagePrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool WritePrinter(IntPtr handle, IntPtr bytes, int count, out int written);

    public static void Send(string printerName, byte[] data, string docName) {
        IntPtr handle;
        if (!OpenPrinter(printerName, out handle, IntPtr.Zero))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenPrinter gagal untuk '" + printerName + "'");
        try {
            DOCINFO info = new DOCINFO();
            info.pDocName = docName;
            info.pDataType = "RAW";
            if (StartDocPrinter(handle, 1, info) == 0)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "StartDocPrinter (RAW) gagal");
            try {
                if (!StartPagePrinter(handle))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "StartPagePrinter gagal");
                IntPtr buffer = Marshal.AllocCoTaskMem(data.Length);
                try {
                    Marshal.Copy(data, 0, buffer, data.Length);
                    int written;
                    if (!WritePrinter(handle, buffer, data.Length, out written) || written != data.Length)
                        throw new Win32Exception(Marshal.GetLastWin32Error(), "WritePrinter gagal (" + written + "/" + data.Length + " byte)");
                } finally {
                    Marshal.FreeCoTaskMem(buffer);
                }
                EndPagePrinter(handle);
            } finally {
                EndDocPrinter(handle);
            }
        } finally {
            ClosePrinter(handle);
        }
    }
}
'@

# ---------------------------------------------------------------- ESC/P
$ESC = 0x1B
$script:buf = New-Object 'System.Collections.Generic.List[byte]'

function Add-Bytes([byte[]]$bytes) { $script:buf.AddRange($bytes) }
function Add-Text([string]$text) { Add-Bytes ([System.Text.Encoding]::ASCII.GetBytes($text)) }
function Add-Line([string]$text = '') { Add-Text $text; Add-Bytes @(0x0D, 0x0A) }
function Set-Bold([bool]$on) { if ($on) { Add-Bytes @($ESC, 0x45) } else { Add-Bytes @($ESC, 0x46) } }
function Set-DoubleWidth([bool]$on) { Add-Bytes @($ESC, 0x57, [byte][int]$on) }
function Set-Pitch([int]$cpi) { if ($cpi -eq 12) { Add-Bytes @($ESC, 0x4D) } else { Add-Bytes @($ESC, 0x50) } }
function Set-Condensed([bool]$on) { if ($on) { Add-Bytes @(0x0F) } else { Add-Bytes @(0x12) } }
function Set-Quality([bool]$nlq) { Add-Bytes @($ESC, 0x78, [byte][int]$nlq) }
function Add-FormFeed { Add-Bytes @(0x0C) }

function Start-Page {
  Add-Bytes @($ESC, 0x40)                          # ESC @  inisialisasi
  Add-Bytes @($ESC, 0x74, 0x01)                    # ESC t 1  tabel karakter PC437
  Add-Bytes @($ESC, 0x32)                          # ESC 2  spasi baris 1/6"
  Add-Bytes @($ESC, 0x43, [byte]$BarisPerHalaman)  # ESC C n  panjang halaman (baris)
  Set-Quality $Nlq.IsPresent
  Set-Pitch $Cpi
}

function Kiri([string]$s, [int]$w) { if ($s.Length -ge $w) { $s.Substring(0, $w) } else { $s.PadRight($w) } }
function Kanan([string]$s, [int]$w) { if ($s.Length -ge $w) { $s.Substring($s.Length - $w) } else { $s.PadLeft($w) } }

$Kolom = if ($Cpi -eq 12) { 96 } else { 80 }

# ---------------------------------------------------------------- halaman: pola
function Add-PolaPage {
  Start-Page
  $tens = -join (1..$Kolom | ForEach-Object { if ($_ % 10 -eq 0) { [string](($_ / 10) % 10) } else { ' ' } })
  $units = -join (1..$Kolom | ForEach-Object { [string]($_ % 10) })
  Add-Line $tens
  Add-Line $units
  for ($i = 3; $i -le $BarisPerHalaman; $i++) {
    $left = 'baris {0,2}' -f $i
    if ($i -eq 3) { $left = "baris  3  POLA POSISI - $Kolom kolom @ $Cpi cpi, $BarisPerHalaman baris/halaman" }
    if ($i -eq $BarisPerHalaman) { $left = "baris $i  TERAKHIR - perforasi harus tepat di bawah baris ini" }
    $line = (Kiri $left ($Kolom - 1)) + '|'
    if ($i -eq $BarisPerHalaman) { Add-Text $line } else { Add-Line $line }
  }
  Add-FormFeed
}

# ---------------------------------------------------------------- halaman: font
function Add-FontPage {
  Start-Page
  Set-Bold $true; Add-Line 'UJI FONT EPSON LX-310 - MANDIRI TANI POS'; Set-Bold $false
  Add-Line ''
  Set-Quality $false; Set-Pitch 10; Add-Line 'DRAFT 10 cpi : NPK MUTIARA 16/16/16  50 KG   Rp 730.000,00'
  Set-Pitch 12;                     Add-Line 'DRAFT 12 cpi : NPK MUTIARA 16/16/16  50 KG   Rp 730.000,00'
  Set-Condensed $true;              Add-Line 'DRAFT condensed (17 cpi) : NPK MUTIARA 16/16/16  50 KG   Rp 730.000,00'
  Set-Condensed $false
  Set-Quality $true; Add-Bytes @($ESC, 0x6B, 0x00)   # ESC k 0  Roman
  Set-Pitch 12; Add-Line 'NLQ Roman 12 : NPK MUTIARA 16/16/16  50 KG   Rp 730.000,00'
  Add-Bytes @($ESC, 0x6B, 0x01)                      # ESC k 1  Sans Serif
  Add-Line 'NLQ Sans  12 : NPK MUTIARA 16/16/16  50 KG   Rp 730.000,00'
  Set-Quality $Nlq.IsPresent; Set-Pitch $Cpi
  Add-Line ''
  Set-Bold $true; Add-Line 'TEBAL : TOTAL AKHIR   Rp 375.000,00'; Set-Bold $false
  Set-DoubleWidth $true; Add-Line 'LEBAR GANDA : 0001789/JL'; Set-DoubleWidth $false
  Add-Line ''
  Add-Line 'Angka & tanda: 0123456789 ., : / - ( ) % Rp'
  Add-Line 'Garis        : ------------------------------------------------'
  Add-Line ''
  Add-Line 'Catat mana yang paling mudah dibaca: DRAFT / NLQ Roman / NLQ Sans.'
  Add-FormFeed
}

# ---------------------------------------------------------------- halaman: faktur
function Add-FakturPage {
  Start-Page
  Set-Pitch 12   # faktur selalu 12 cpi = 96 kolom (PRD 8.1), apa pun -Cpi
  $w = 96
  $sep = '-' * $w
  $leftW = 35
  $tgl = Get-Date -Format 'dd/MM/yyyy HH.mm'
  $hdr = @(
    @('FAKTUR PENJUALAN',      'No Transaksi : 0000000/JL/UTM/UJI', 'Dept : UTM'),
    @('MANDIRI TANI',          "Tanggal      : $tgl",               'User : KASIR'),
    @('JL. POROS RAPP km. 72', 'Pelanggan    : PELANGGAN CONTOH (UJI CETAK)', ''),
    @('0813-6144-1706',        'Alamat       : JL. CONTOH',         '')
  )
  Add-Line ''
  $first = $true
  foreach ($h in $hdr) {
    if ($first) { Set-Bold $true }
    Add-Text (Kiri $h[0] $leftW)
    if ($first) { Set-Bold $false; $first = $false }
    $mid = Kiri $h[1] ($w - $leftW - 12)
    Add-Line ($mid + (Kiri $h[2] 12)).TrimEnd()
  }
  Add-Line $sep
  # lebar kolom: No 2, Kode 14, Nama 30, Jml 6, Sat 6, Harga 12, Pot 5, Total 13 (+ spasi)
  Add-Line ((Kiri 'No' 2) + ' ' + (Kiri 'Kode Item' 14) + ' ' + (Kiri 'Nama Item' 30) + ' ' + (Kanan 'Jml' 6) + ' ' + (Kiri 'Satuan' 6) + ' ' + (Kanan 'Harga' 12) + ' ' + (Kanan 'Pot%' 5) + ' ' + (Kanan 'Total' 13))
  Add-Line $sep
  $items = @(
    @('1', 'NARA UP 5',      'NARA UP 5 LTR',              '1,00', 'PAIL', '330.000,00', '0,00', '330.000,00'),
    @('2', 'METSULINDO 100', 'METSULINDO 100 GR',          '1,00', 'BTL',  '45.000,00',  '0,00', '45.000,00'),
    @('3', 'NPK MUTIARA',    'NPK MUTIARA 16/16/16 1 KG',  '2,00', 'ZAK',  '730.000,00', '0,00', '1.460.000,00')
  )
  foreach ($it in $items) {
    Add-Line ((Kanan $it[0] 2) + ' ' + (Kiri $it[1] 14) + ' ' + (Kiri $it[2] 30) + ' ' + (Kanan $it[3] 6) + ' ' + (Kiri $it[4] 6) + ' ' + (Kanan $it[5] 12) + ' ' + (Kanan $it[6] 5) + ' ' + (Kanan $it[7] 13))
  }
  Add-Line $sep
  $sumLeftW = 33
  $midW = 25
  $rightW = $w - $sumLeftW - $midW
  $rows = @(
    @('Keterangan :',       'Jml Item   :   4,00',   'Sub Total   :', '1.835.000,00'),
    @('',                   'Potongan   :   0,00',   'Biaya Lain  :', '0,00'),
    @('      Penerima',     'Tanggal Jt : 03/11/2026', 'TOTAL AKHIR :', '1.835.000,00'),
    @('',                   '',                      'Tunai       :', '835.000,00'),
    @('',                   '',                      'Kredit      :', '1.000.000,00'),
    @('  (..............)', '',                      'Kembali     :', '0,00')
  )
  foreach ($r in $rows) {
    $isTotal = $r[2] -like 'TOTAL*'
    Add-Text ((Kiri $r[0] $sumLeftW) + (Kiri $r[1] $midW))
    if ($isTotal) { Set-Bold $true }
    Add-Text ((Kiri $r[2] 14) + (Kanan $r[3] ($rightW - 14)))
    if ($isTotal) { Set-Bold $false }
    Add-Line ''
  }
  Add-Line ''
  Add-Line 'Terbilang : satu juta delapan ratus tiga puluh lima ribu rupiah'
  Add-Line ''
  Add-Line '*** UJI CETAK - BUKAN TRANSAKSI ***'
  Add-FormFeed
}

# ---------------------------------------------------------------- printer
function Get-Printers {
  try { Get-Printer | Select-Object Name, DriverName, PortName }
  catch { Get-CimInstance Win32_Printer | Select-Object Name, DriverName, PortName }
}

if ($DaftarPrinter) { Get-Printers | Format-Table -AutoSize; return }

switch ($Halaman) {
  'pola'   { Add-PolaPage }
  'font'   { Add-FontPage }
  'faktur' { Add-FakturPage }
  default  { Add-PolaPage; Add-FontPage; Add-FakturPage }
}
$bytes = $script:buf.ToArray()

if ($SimpanKe) {
  $target = if ([System.IO.Path]::IsPathRooted($SimpanKe)) { $SimpanKe } else { Join-Path (Get-Location) $SimpanKe }
  [System.IO.File]::WriteAllBytes($target, $bytes)
  Write-Host "Disimpan $($bytes.Length) byte ke $target (tidak dicetak)."
  return
}

if (-not $Printer) {
  $list = @(Get-Printers)
  if ($list.Count -eq 0) { throw 'Tidak ada printer terpasang di Windows. Pasang driver LX-310 dulu.' }
  Write-Host ''
  Write-Host 'Printer yang terpasang:'
  for ($i = 0; $i -lt $list.Count; $i++) {
    $mark = if ($list[$i].Name -match 'LX-?310') { '  <-- Epson LX-310' } else { '' }
    Write-Host ('  [{0}] {1}  (driver: {2}, port: {3}){4}' -f ($i + 1), $list[$i].Name, $list[$i].DriverName, $list[$i].PortName, $mark)
  }
  $default = [array]::FindIndex([object[]]$list, [Predicate[object]] { param($p) $p.Name -match 'LX-?310' })
  $prompt = if ($default -ge 0) { "Pilih nomor printer [Enter = $($default + 1)]" } else { 'Pilih nomor printer' }
  $answer = Read-Host $prompt
  if ([string]::IsNullOrWhiteSpace($answer) -and $default -ge 0) { $idx = $default } else { $idx = [int]$answer - 1 }
  if ($idx -lt 0 -or $idx -ge $list.Count) { throw 'Nomor printer tidak valid.' }
  $Printer = $list[$idx].Name
}

Write-Host ''
Write-Host "Mengirim $($bytes.Length) byte ESC/P ke '$Printer' (halaman: $Halaman, $Cpi cpi, $BarisPerHalaman baris, NLQ: $($Nlq.IsPresent))..."
Write-Host 'Pastikan: kertas continuous form 1/2 halaman terpasang, perforasi sejajar kepala cetak, printer ON-LINE.'
[RawPrinter]::Send($Printer, $bytes, "Uji cetak Mandiri Tani POS - $Halaman")
Write-Host 'Terkirim. Periksa hasil cetak dengan daftar cek di README.md.'
