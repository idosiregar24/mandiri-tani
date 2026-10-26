# Rencana Eksekusi — Mandiri Tani POS v1.0

Sumber: PRD §9 (`File Skema/Mandiri Tani v1.0/PRD-Mandiri-Tani-POS.md`).
Sprint = 2 minggu. Setiap sprint punya file checklist yang dicentang
langsung seiring progres, dengan catatan status singkat (📌) per item.
File sprint dibuat saat sprint itu akan dimulai — bukan semuanya sekarang —
supaya isinya mengikuti keadaan nyata kode.

**Penamaan file:** `sprint-<nomor>-<deskripsi-fitur>.md` — nomor tanpa nol
di depan, deskripsi huruf kecil dipisah tanda hubung (contoh:
`sprint-2-auth-user-pengaturan.md`). Rencana fitur yang menyentuh beberapa
sprint memakai nomor sprint tempat fitur itu **utamanya** dibangun, dan
menyebut sprint lain di dalamnya.

**Status saat ini (2026-10-26):** S1 selesai kecuali uji di Windows bersih (G2); S3 (master + impor iPOS) selesai, dikerjakan sebelum S2. Catatan lama (2026-10-24): Sudah ada:
dokumen `.claude` (PRD, skema, rules, skills, plan) dan **alat uji cetak
LX-310** (`tools/uji-cetak/`, Sprint 0) yang menunggu diuji di printer asli.
Sprint 1 siap dimulai paralel.

Rencana lintas sprint:
[`sprint-7-pengambilan-barang.md`](sprint-7-pengambilan-barang.md) (terjual
belum diambil — juga S4, S9, S10, S14) ·
[`sprint-14-go-live-migrasi.md`](sprint-14-go-live-migrasi.md) (data
pengembangan sekarang vs impor saat go-live — mulai S3).

## Roadmap

| Sprint | Milestone | Fokus | Status |
|---|---|---|---|
| [S0](sprint-0-uji-cetak-printer.md) | M0 Fondasi | **Uji cetak Epson LX-310 didahulukan** (permintaan owner): alat PowerShell RAW ESC/P, halaman pola/font/faktur, daftar cek hasil di printer asli | 🔶 Cetak RAW LX-310 berhasil; uji cetak di aplikasi (2 printer) + simpan pengaturan selesai; menunggu baris/halaman, font & uji thermal |
| [S1](sprint-1-fondasi-shell-postgresql.md) | M0 Fondasi | Scaffold Electron + Vite + React, PostgreSQL portable + `PgManager`, migration runner, Express skeleton, boot screen, shutdown, kerangka installer | 🔶 Installer dibuild & build terpaket teruji (boot 1,3 dtk, crash/kill, tutup normal); **menunggu owner:** install di Windows bersih + HP (G2), logoff & sleep (F2) |
| S2 | M0 Fondasi | Auth (password/PIN, sesi), user & role, permission, audit log, settings, first-run wizard, app shell, penomoran dokumen | — |
| [S3](sprint-3-master-data-impor-ipos.md) | M1 Master & Inventori | Produk multi-satuan (KG/ZAK), harga, kategori/merek, pelanggan & grup, supplier, gudang, metode bayar per rekening; **importer iPOS lingkup Master** — dikerjakan **sebelum S2** (keputusan owner) | ✅ 31/31 item, 112 tes hijau; impor backup asli cocok 1:1 (416 barang, 1.238 pelanggan, 37 supplier). **Menunggu owner:** coba alur impor → reset → impor ulang di aplikasi |
| S4 | M1 Master & Inventori | `stockService.apply` (ledger + lock + HPP), **impor stok awal iPOS**, kartu stok (buku & fisik), penyesuaian, opname (desktop), stok menipis, cek konsistensi | — |
| S5 | M2 POS Kasir | Layar kasir: cari/scan, keranjang, resolusi harga + ubah harga baris, ganti satuan, potongan nota nominal, shortcut, `useScanner` | — |
| S6 | M2 POS Kasir | Shift, pembayaran tunai/transfer/QRIS, simpan transaksi, **cetak ESC/P ke Epson LX-310 (USB)**, cetak ulang, kas masuk/keluar → **transaksi KSR pertama end-to-end** | — |
| S7 | M2 POS Kasir | **Faktur Penjualan (JL)**: kredit/sebagian kredit, ongkos angkut, harga terakhir pelanggan; **terjual-belum-diambil + Pengambilan Barang** ([rencana fitur](sprint-7-pengambilan-barang.md)); hold/resume, void, otorisasi PIN Owner | — |
| S8 | M3 Pembelian & AR/AP | Faktur pembelian langsung (BL), riwayat harga beli, retur jual & beli, PO + penerimaan (Should) | — |
| S9 | M3 Pembelian & AR/AP | Pelunasan piutang multi-nota, jatuh tempo, aging, **impor piutang terbuka iPOS** + rekonsiliasi, saldo awal hutang manual | — |
| S10 | M4 Laporan | Laba kotor, arus kas, Penjualan Rekap & Pembelian Detail ala iPOS, rekap harian pupuk, barang belum diambil & riwayat pengambilan, dashboard, ekspor; **impor histori iPOS 2 tahun** | — |
| S11 | M5 Sinkronisasi | Pairing perangkat, `sync/pull`, `sync/push`, halaman Koneksi | — |
| S12 | M5 Sinkronisasi | App mobile Capacitor: cek harga/stok offline, opname offline, status sync | — |
| S13 | M6 Hardening | Backup/restore, uji cabut listrik, sleep/resume, konkurensi, performa 20k produk | — |
| S14 | M6 Rilis | Installer produksi, panduan instalasi, gladi migrasi dari backup iPOS terbaru + paralel 1 minggu, UAT di toko → **v1.0** | — |

Setelah v1.0: v1.x (Mode Terminal, auto-update, batch/kedaluwarsa) →
**v2.0 Tailscale** (`File Skema/Mandiri Tani v2.0/`).

## Prinsip urutan

1. **Sync-ready sejak hari pertama.** Walau API sinkron baru di S11,
   setiap tabel sejak S1 sudah mengikuti `rules/sync-standards.md` (UUIDv7
   dari aplikasi, `updated_at` via trigger, `deleted_at`, `client_op_id`).
   Menambahkannya belakangan = migrasi data yang mahal.
2. **Stok satu pintu sebelum POS.** `stockService.apply` (S4) selesai &
   teruji sebelum layar kasir menyimpan transaksi (S6).
3. **Hardware di akhir M2, bukan di awal.** Encoder ESC/P (Epson LX-310)
   diuji dengan snapshot byte; printer fisik baru dibutuhkan di S6.
4. **Data nyata sejak S3.** Importer iPOS dibangun bertahap bersama modulnya
   (master S3, stok S4, piutang S9) sehingga setiap layar diuji dengan 416
   item, 1.238 pelanggan dan 308 nota piutang asli — bukan data dummy.
   Sumber: `.claude/file/DB Mandiri Tani.i5bu` (lihat aturan privasi di
   `CLAUDE.md`). Analisis: `File Skema/Mandiri Tani v1.0/Analisis-Sumber-Data-iPOS.md`.

## Versi terpasang (diisi saat Sprint 1 — "as actually installed")

| Komponen | Versi | Catatan |
|---|---|---|
| Node.js (dev) | 24.12.0 | Terpasang di mesin dev (cek 2026-10-24) |
| npm | 11.8.0 | |
| Electron | **44.9.3** (dipin persis) | 45.0.0 baru rilis 3 hari saat scaffold → pilih garis 44 yang matang |
| electron-vite / electron-builder | 6.0.0 / 26.18.0 | electron-vite 6: `build.externalizeDeps` (plugin lama deprecated) |
| Vite / React / React Router | 8.3.5 / 19.3.1 / 8.5.0 | |
| Tailwind / shadcn/ui | 4.3.3 / CLI terbaru (style new-york) | Tailwind v4 CSS-first; **CLI shadcn salah membaca alias `@/lib/utils` → menginstal paket npm `cn`** — sudah dicopot, import diperbaiki manual; cek setiap `shadcn add` |
| TypeScript | **6.0.3** | TS 7 sudah rilis, tapi typescript-eslint 8.72 hanya mendukung < 6.1 |
| Express / pg / Zod / pino | 5.3.0 / 8.23.1 / 4.6.7 / 10.4.0 | |
| React Hook Form / @hookform/resolvers / TanStack Table | 7.91.0 / 5.9.1 / **8.21.3** | Dipasang S3. npm memberi TanStack Table **v9** (API berbeda) → dipin ke v8 sesuai frontend-standards §5 |
| Vitest / ESLint | 5.0.5 / 10.13.0 | |
| PostgreSQL portable | **18.4-1** (`resources/postgres/VERSION`) | Zip binaries EDB; 18.5 belum tersedia (403). PG 18: `uuidv7()` bawaan, locale `builtin C.UTF-8`. CDN EDB membatasi ±30 KB/s per koneksi → `scripts/lib/parallel-download.mjs` (16 koneksi, ±300 KB/s) |

## Penyimpangan dari PRD

Catat di sini setiap keputusan implementasi yang berbeda dari PRD (tanggal,
apa, alasan) — lalu perbarui PRD/skema bila keputusannya permanen.

| Tanggal | Penyimpangan | Alasan |
|---|---|---|
| 2026-10-24 | Remote access: Tailscale (v2.0) menggantikan Cloudflare Tunnel di spesifikasi awal | Keputusan proyek — API POS tidak dibuka ke internet publik (ADR-05) |
| 2026-10-24 | Mobile client = Capacitor, bukan PWA | Service worker butuh HTTPS; LAN v1 HTTP polos (ADR-08) |
| 2026-10-24 | Fitur resto (meja/waiter/kitchen printer) tidak di v1 | Toko tani ritel; lihat PRD §1.5 |
| 2026-10-24 | Skema & PRD disesuaikan dengan data iPOS: mode Kasir/Faktur, ubah harga baris = alur normal, ongkos angkut, pengambilan bertahap, kode dokumen KSR/JL/BL, satuan ZAK, limit kredit opsional, termin 10 hari, importer iPOS. Split bill, bundling, rakitan, PPN, mutasi gudang turun ke Could; PO & retur ke Should | Analisis-Sumber-Data-iPOS.md (D-1…D-11) |
| 2026-10-24 | Modul RAM sawit dibatalkan (file tonase di luar konteks) | Keputusan owner |
| 2026-10-24 | **Terjual-belum-diambil**: stok fisik baru berkurang saat barang diambil; barang terjual dikunci sebagai *Dipesan* (`reserved_qty`); bukti & riwayat Pengambilan (`AB`) | Permintaan owner — iPOS tidak bisa; [rencana fitur](sprint-7-pengambilan-barang.md) |
| 2026-10-24 | Importer iPOS bisa diulang selama **Mode Persiapan**; pengembangan memakai backup sekarang, go-live mengimpor backup terbaru | Permintaan owner; [rencana go-live](sprint-14-go-live-migrasi.md) |
| 2026-10-24 | **HPP FIFO** (bukan rata-rata bergerak): tabel `stock_cost_layers` + `stock_layer_consumptions`; saldo awal menyalin lapisan FIFO iPOS | Jawaban owner Q-10 — sama seperti iPOS (ADR-04) |
| 2026-10-24 | **Histori 2 tahun iPOS diimpor** (Must, S10) | Jawaban owner Q-13 |
| 2026-10-24 | **Dua role v1: KASIR & OWNER**; Supervisor ditunda; otorisasi = PIN Owner. Pembelian, opname, harga, laporan laba = Owner | Jawaban owner Q-14 |
| 2026-10-24 | Hutang supplier: Owner mencentang faktur kredit iPOS yang belum lunas saat impor | Penjelasan Q-11 (D-13) |
| 2026-10-24 | Printer = **Epson LX-310 dot matrix (USB)**, bukan thermal: encoder **ESC/P**, kertas continuous form 80 kolom, tanpa pemotong/port laci/QR → laci default manual, nomor nota dicetak besar menggantikan QR | Jawaban owner Q-4 (driver `LX-310_Drv_Ver1_1497909`) |
| 2026-10-24 | **Sprint 0 uji cetak** ditambahkan sebelum S1; alat `tools/uji-cetak/` | Permintaan owner — selagi ada akses ke printer klien |
| 2026-10-24 | **Nomor dokumen sama dengan iPOS**: `0001789/JL/UTM/1026` (urut/tipe/dept/BLNTHN), urutan per tipe reset tiap tahun, **melanjutkan nomor terakhir iPOS** saat go-live | Jawaban owner Q-16 |
| 2026-10-24 | Tidak ada laci uang (`drawer.mode = none`) | Jawaban owner Q-15 |
| 2026-10-24 | **Dua printer per peran**: `faktur` = LX-310 (ESC/P) untuk JL & AB; `struk` = thermal (ESC/POS) untuk KSR — koreksi asumsi "KSR di LX-310" | Foto struk KSR iPOS dari owner |
| 2026-10-24 | Desain UI **sederhana, mudah dipakai, mudah dibaca** (shadcn boleh) — design-standards §0 | Permintaan owner |
| 2026-10-24 | Faktur dicetak **meniru format faktur iPOS** (½ halaman 9,5"×5,5", 96 kolom, logo, Terbilang, kotak Penerima, ruang stempel); hanya metode bayar yang dipakai yang dicetak | Foto faktur dari owner (`.claude/file/contoh-faktur-ipos-LX310.jpg`, lokal) |

## Pertanyaan terbuka

Lihat PRD §10. Sudah terjawab: Q-4 (Epson LX-310 USB), Q-6, Q-8, Q-9,
Q-10 (FIFO), Q-11 (centang per faktur), Q-13 (histori ya), Q-14 (Kasir &
Owner), Q-15 (½ halaman, tanpa laci), Q-16 (nomor gaya iPOS). Masih
terbuka, tidak menghalangi S1–S5: Q-1 PKP, Q-2 pupuk subsidi, Q-3 jumlah PC
kasir, Q-5 batch/expired,
Q-7 HP Android, Q-12 diskon grup. Jawaban dicatat di PRD, lalu dampaknya di
sprint terkait.
