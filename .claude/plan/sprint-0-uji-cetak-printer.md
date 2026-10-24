# Sprint 0 — Uji Cetak Printer Epson LX-310 (didahulukan)

> Permintaan owner 2026-10-24: uji cetak dikerjakan **lebih dulu**, selagi ada
> akses ke printer LX-310 di tempat klien. Requirement: PRD §8.1–8.2
> (printer), FR-SYS-05 (cetak uji & atur posisi kertas). Alat:
> [`tools/uji-cetak/`](../../tools/uji-cetak/README.md).

**Tujuan:** membuktikan — sebelum aplikasi dibangun — bahwa kita bisa mencetak
**langsung tanpa dialog** ke Epson LX-310 lewat USB dengan byte ESC/P mentah,
dan mendapatkan angka nyata untuk setting printer (nama antrean, baris per
halaman, font, waktu cetak). Hasilnya menjadi dasar transport `windows-raw`
dan encoder `escp` di Sprint 6, sehingga tidak ada kejutan printer di akhir.

**Ringkasan status:** 7 selesai · 0 sebagian · 4 belum mulai (B2–B4: baris/halaman & font LX-310; B5: uji printer struk thermal).

## A. Alat uji (tanpa install)

- [x] **A1** Skrip `tools/uji-cetak/uji-cetak-lx310.ps1`: kirim job `RAW` ke antrean printer Windows lewat Win32 (`OpenPrinter`/`StartDocPrinter`/`WritePrinter`), pilih printer interaktif (LX-310 ditandai otomatis), mode `-SimpanKe` tanpa printer
  - 📌 **Status:** Selesai (2026-10-24). PowerShell 5.1 bawaan Windows + `Add-Type` C#, tanpa dependensi. Diuji di laptop dev tanpa printer: kompilasi Win32 OK, `-DaftarPrinter` OK, 3 halaman dihasilkan via `-SimpanKe` (pola 33 baris × 96 kolom, font, faktur 22 baris × 96 kolom). **Belum** diuji ke LX-310 fisik → B1
- [x] **A2** Tiga halaman uji: **pola posisi** (penggaris 96 kolom + nomor baris 1–33), **uji font** (draft / NLQ Roman / NLQ Sans, 10/12 cpi, condensed, tebal, lebar ganda), **contoh faktur** meniru format iPOS (data fiktif, 12 cpi, ½ halaman)
  - 📌 **Status:** Selesai. Faktur dikunci 12 cpi = 96 kolom (PRD §8.1); `-Cpi`/`-BarisPerHalaman`/`-Nlq` untuk eksperimen
- [x] **A3** `UJI-CETAK.cmd` (klik dua kali) + `README.md` berisi persiapan, cara jalan, **daftar cek hasil** (9 poin) dan tabel "bila gagal" (termasuk jalan keluar driver *Generic / Text Only* bila RAW ditolak)
  - 📌 **Status:** Selesai

- [x] **A4** Uji cetak **di dalam aplikasi** (menu "Uji Cetak Printer" di beranda): encoder ESC/P TypeScript (`src/main/hardware/escp.ts`), halaman uji yang sama (`test-pages.ts`), transport `windows-raw` (`windows-raw.ts`, helper PowerShell+winspool, tanpa modul native), daftar printer dari Electron (LX-310 dipilih otomatis), IPC `pos:printer:list|test` dengan validasi Zod & printer harus ada di daftar Windows
  - 📌 **Status:** Selesai (2026-10-24). Tes: halaman pola tepat N baris × 96 kolom, faktur ≤ 96 kolom & ≤ 33 baris, transliterasi; helper RAW diuji ke printer yang tidak ada (pesan "Printer tidak ditemukan") dan nama printer berisi perintah diperlakukan sebagai data. Ini menjadi dasar transport & encoder Sprint 6

## B. Uji di printer asli (oleh owner/dev di lokasi klien)

- [x] **B1** Buka aplikasi → **Uji Cetak Printer** (atau `UJI-CETAK.cmd` di komputer tanpa aplikasi) di komputer yang tersambung LX-310 (USB) dengan kertas ½ halaman → isi daftar cek (foto hasil cetak + jawaban)
  - 📌 **Status:** Selesai (2026-10-24) — **cetak RAW ESC/P ke LX-310 lewat USB berhasil tanpa dialog** (dikonfirmasi owner). Temuan: Windows punya **dua antrean** LX-310 — `EPSON LX-310 ESC/P` di **LPT1 (Error)** dan `EPSON LX-310 ESC/P (Copy 1)` di **USB003 (Normal)**; percobaan pertama masuk ke LPT1 dan tertahan. Perbaikan: daftar printer dari `Get-Printer` (port + status), LX-310 USB+Normal dipilih otomatis, pilihan tersimpan diabaikan bila antreannya tidak siap, dan job dipantau ±8 dtk setelah kirim — tertahan Error/Offline → dibatalkan + pesan jelas. Pelajaran untuk PC toko & installer: cek antrean ganda/port mati saat setup printer (FR-SYS-05)
- [x] **A5** **Printer kedua: struk kasir thermal (ESC/POS)** — ditemukan dari foto struk KSR iPOS (2026-10-24). Encoder `escpos.ts`, halaman `struk-pola` (tanda lebar 32/42/48) & `struk-contoh` (meniru struk KSR iPOS, data fiktif, `wrap()` untuk kertas sempit), menu Uji Cetak kini dua tab (Faktur LX-310 / Struk Kasir), `pickPrinter` per peran (LX-310 tak pernah dipilih untuk struk)
  - 📌 **Status:** Selesai di aplikasi; 9 tes baru (struk muat 32/42/48 kolom, potong kertas opsional, pemilihan printer). **Belum diuji di printer thermal asli** (tidak tersambung ke laptop dev) → B5
- [x] **A6** **Simpan pengaturan printer per PC** (FR-SYS-05) — langkah "5. Simpan pengaturan" di tiap tab; disimpan ke `%APPDATA%\pos-desktop\config.json` (`printers.faktur` = antrean, baris/halaman, NLQ; `printers.struk` = antrean, lebar huruf, potong) lewat IPC lokal (bukan API LAN — login baru ada Sprint 2). Tulis atomik (tmp → rename) dan `updateConfig` agar simpan port DB tidak menimpa printer & sebaliknya. Indikator "Belum disimpan / Tersimpan"; antrean tersimpan yang sedang tidak siap tetap diganti pilihan otomatis. Pengaturan ini yang akan dipakai cetak faktur & struk sungguhan (Sprint 6)
  - 📌 **Status:** Selesai (2026-10-24); 5 tes `config.test.ts` (default/rusak, round-trip tanpa sisa .tmp, printer tidak valid → default tanpa kehilangan port, update sebagian, default tak ikut berubah)
- [ ] **B5** Uji di printer struk thermal: tab **Printer Struk Kasir** → `Pola lebar struk` (tanda terakhir yang utuh = lebar) → `Contoh struk kasir` → catat merek/model, lebar, pemotong (Q-17)
- [ ] **B2** Bila baris 33 tidak pas di perforasi: ubah "Baris per halaman" & cetak pola lagi sampai pas → **Simpan pengaturan** → catat nilainya di tabel
- [ ] **B3** Pilih font (draft / NLQ Roman / NLQ Sans) & catat waktu cetak 1 faktur (draft vs NLQ) → default `printer.quality`
- [ ] **B4** Catat hasil di bagian **Hasil uji** di bawah, perbarui PRD §8.1 bila ada angka yang berbeda (baris/halaman, kolom maksimum, font), dan tandai Q-15 selesai

## Hasil uji (diisi setelah B1–B3)

| Item | Nilai |
|---|---|
| Tanggal & lokasi uji | 2026-10-24, laptop dev + LX-310 milik klien |
| Nama printer di Windows | `EPSON LX-310 ESC/P (Copy 1)` (antrean lama `EPSON LX-310 ESC/P` di LPT1 = Error) |
| Driver & port | `EPSON LX-310 ESC/P`, **USB003** |
| Cetak tanpa dialog (RAW) | ✔ Berhasil (dari aplikasi, menu Uji Cetak Printer) |
| Kolom maksimum terbaca utuh @ 12 cpi | |
| Baris per ½ halaman (pas perforasi) | |
| Posisi kertas stabil setelah 3 halaman | |
| Font terpilih | |
| Waktu cetak faktur (draft / NLQ) | |
| Catatan | |

## Definition of Done Sprint 0

- [ ] Satu faktur contoh tercetak rapi di LX-310 asli tanpa dialog, muat ½ halaman, dan owner setuju tampilannya mendekati faktur iPOS
- [ ] Angka setting printer (nama antrean, baris/halaman, font) tercatat di tabel hasil & PRD
- [ ] Bila RAW gagal: jalan keluar dicatat (driver Generic/Text Only atau alternatif) **sebelum** Sprint 6 dirancang

## Setelah Sprint 0

Kode Win32 RAW di skrip ini menjadi referensi transport `windows-raw` di
`src/main/hardware/transports/` (Sprint 6) — di aplikasi dipanggil dari main
process Electron (modul native kecil atau helper PowerShell yang sama),
dengan byte dari encoder `escp` + `DocumentBuilder` (rules
`desktop-runtime-standards.md` §5). Tata letak contoh faktur di skrip ini
adalah titik awal snapshot test encoder.
