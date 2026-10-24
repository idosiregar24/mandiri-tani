# Uji Cetak Epson LX-310 — Mandiri Tani POS

Alat kecil untuk membuktikan bahwa aplikasi bisa mencetak **langsung** ke
printer dot matrix Epson LX-310 milik toko (tanpa dialog Windows), memakai
cara yang sama dengan aplikasi nanti: byte **ESC/P** mentah ke antrean
printer Windows. Tidak perlu install apa pun — hanya PowerShell bawaan
Windows 10/11. Rencana: [`.claude/plan/sprint-0-uji-cetak-printer.md`](../../.claude/plan/sprint-0-uji-cetak-printer.md).

## Persiapan (sekali)

1. Sambungkan LX-310 ke laptop/PC lewat **USB**, nyalakan.
2. Pasang driver **`LX-310_Drv_Ver1_1497909`** (driver resmi Epson) bila
   printer belum muncul di *Settings → Printers & scanners*.
3. Pasang kertas continuous form **½ halaman (9,5" × 5,5")**, sejajarkan
   **perforasi tepat di atas kepala cetak** (posisi awal halaman), tuas
   kertas ke posisi *tractor*.
4. Salin folder `tools/uji-cetak/` ke komputer itu (flashdisk boleh).

## Menjalankan

**Cara termudah:** klik dua kali **`UJI-CETAK.cmd`** → pilih nomor printer
(LX-310 sudah ditandai) → Enter. Tiga halaman akan tercetak.

Lewat PowerShell (untuk variasi):

```powershell
.\uji-cetak-lx310.ps1 -DaftarPrinter            # lihat nama printer
.\uji-cetak-lx310.ps1 -Halaman pola             # hanya pola posisi
.\uji-cetak-lx310.ps1 -Halaman faktur -Nlq      # faktur, mode NLQ (lebih rapi, lebih lambat)
.\uji-cetak-lx310.ps1 -Halaman pola -BarisPerHalaman 36   # coba panjang halaman lain
.\uji-cetak-lx310.ps1 -Printer "EPSON LX-310" -Halaman faktur
.\uji-cetak-lx310.ps1 -SimpanKe uji.prn         # tanpa printer: simpan byte ke file
```

Bila muncul *"running scripts is disabled"*, pakai `UJI-CETAK.cmd` (sudah
memakai `-ExecutionPolicy Bypass` hanya untuk proses ini).

## Halaman yang dicetak

| Halaman | Gunanya |
|---|---|
| **1. Pola posisi** | Penggaris 1–96 kolom + nomor baris 1–33. Membuktikan lebar 96 kolom @ 12 cpi dan panjang ½ halaman = 33 baris |
| **2. Uji font** | Draft vs NLQ Roman vs NLQ Sans, 10/12 cpi, condensed, tebal, lebar ganda — pilih yang paling mudah dibaca |
| **3. Contoh faktur** | Faktur Penjualan meniru format iPOS dengan **data fiktif** (bukan transaksi) |

## Daftar cek hasil (isi lalu kirim balik / foto)

| # | Cek | Hasil |
|---|---|---|
| 1 | Tercetak **tanpa** dialog Windows, tidak ada karakter aneh di awal | ☐ Ya ☐ Tidak |
| 2 | Pola: kolom **96** (angka terakhir "6") masih tercetak utuh di kanan, tidak terpotong | ☐ Ya ☐ Terpotong di kolom ___ |
| 3 | Pola: baris **33** berada tepat di atas perforasi; halaman berikutnya mulai tepat setelah perforasi | ☐ Pas ☐ Kurang ___ baris ☐ Lebih ___ baris |
| 4 | Setelah 3 halaman, posisi kertas **tidak bergeser** (tidak makin turun/naik) | ☐ Ya ☐ Bergeser |
| 5 | Font paling mudah dibaca | ☐ Draft ☐ NLQ Roman ☐ NLQ Sans |
| 6 | Faktur: semua kolom sejajar, angka rata kanan, "TOTAL AKHIR" tebal | ☐ Ya ☐ Tidak |
| 7 | Faktur muat dalam ½ halaman dan mirip faktur iPOS | ☐ Ya ☐ Tidak |
| 8 | Waktu cetak 1 faktur (detik), mode draft / NLQ | ___ dtk / ___ dtk |
| 9 | Nama printer persis di Windows | ________________ |

Bila **#3 tidak pas**, ulangi `-Halaman pola -BarisPerHalaman <angka lain>`
(mis. 32, 34, 36) sampai pas, lalu catat angkanya — angka itu menjadi
setting `printer.lines_per_page` di aplikasi.

## Bila gagal

| Gejala | Coba |
|---|---|
| `OpenPrinter gagal` | Nama printer salah — jalankan `-DaftarPrinter`, pakai nama persis |
| `StartDocPrinter (RAW) gagal` | Driver tipe v4 menolak RAW: tambah printer baru di Windows dengan driver **"Generic / Text Only"** pada port USB yang sama (USB001), lalu uji ke printer itu |
| Job masuk antrean tapi tidak tercetak | Cek printer ON-LINE (lampu Pause mati), tuas kertas, kabel USB; hapus job macet di antrean Windows |
| Huruf acak / simbol aneh | Printer di mode lain (mis. emulasi IBM) — reset printer (matikan-nyalakan) lalu ulangi |
| Cetak terlalu ke kiri/kanan | Geser pemandu kertas (tractor) — aplikasi tidak bisa memindahkan posisi horizontal fisik |
