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

**Status saat ini (2026-10-24):** belum ada kode. Hanya folder `.claude`
(PRD, skema, rules, skills, plan). Sprint 1 siap dimulai.

Rencana lintas sprint:
[`sprint-7-pengambilan-barang.md`](sprint-7-pengambilan-barang.md) (terjual
belum diambil — juga S4, S9, S10, S14) ·
[`sprint-14-go-live-migrasi.md`](sprint-14-go-live-migrasi.md) (data
pengembangan sekarang vs impor saat go-live — mulai S3).

## Roadmap

| Sprint | Milestone | Fokus | Status |
|---|---|---|---|
| [S1](sprint-1-fondasi-shell-postgresql.md) | M0 Fondasi | Scaffold Electron + Vite + React, PostgreSQL portable + `PgManager`, migration runner, Express skeleton, boot screen, shutdown, kerangka installer | ⏳ Belum mulai |
| S2 | M0 Fondasi | Auth (password/PIN, sesi), user & role, permission, audit log, settings, first-run wizard, app shell, penomoran dokumen | — |
| S3 | M1 Master & Inventori | Produk multi-satuan (KG/ZAK), harga, kategori/merek, pelanggan & grup, supplier, gudang, metode bayar per rekening; **importer iPOS lingkup Master** | — |
| S4 | M1 Master & Inventori | `stockService.apply` (ledger + lock + HPP), **impor stok awal iPOS**, kartu stok (buku & fisik), penyesuaian, opname (desktop), stok menipis, cek konsistensi | — |
| S5 | M2 POS Kasir | Layar kasir: cari/scan, keranjang, resolusi harga + ubah harga baris, ganti satuan, potongan nota nominal, shortcut, `useScanner` | — |
| S6 | M2 POS Kasir | Shift, pembayaran tunai/transfer/QRIS, simpan transaksi, ESC/POS + laci, cetak ulang, kas masuk/keluar → **transaksi KSR pertama end-to-end** | — |
| S7 | M2 POS Kasir | **Faktur Penjualan (JL)**: kredit/sebagian kredit, ongkos angkut, harga terakhir pelanggan; **terjual-belum-diambil + Pengambilan Barang** ([rencana fitur](sprint-7-pengambilan-barang.md)); hold/resume, void, otorisasi supervisor | — |
| S8 | M3 Pembelian & AR/AP | Faktur pembelian langsung (BL), riwayat harga beli, retur jual & beli, PO + penerimaan (Should) | — |
| S9 | M3 Pembelian & AR/AP | Pelunasan piutang multi-nota, jatuh tempo, aging, **impor piutang terbuka iPOS** + rekonsiliasi, saldo awal hutang manual | — |
| S10 | M4 Laporan | Laba kotor, arus kas, Penjualan Rekap & Pembelian Detail ala iPOS, rekap harian pupuk, barang belum diambil & riwayat pengambilan, dashboard, ekspor; histori iPOS (Should) | — |
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
3. **Hardware di akhir M2, bukan di awal.** Encoder ESC/POS diuji dengan
   snapshot byte; printer fisik baru dibutuhkan di S6.
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
| Electron | _isi saat S1_ | stable terbaru saat scaffold |
| electron-vite / electron-builder | _isi_ | |
| React / Vite / Tailwind / shadcn | _isi_ | Tailwind v4 (CSS-first) |
| Express | _isi_ | 5.x |
| PostgreSQL portable | _isi_ (`resources/postgres/VERSION`) | ≥ 15 wajib; pilih major terbaru yang tersedia sebagai zip binaries Windows |

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

## Pertanyaan terbuka

Lihat PRD §10 (Q-1 … Q-14; Q-6 & Q-8 sudah terjawab dari data). Paling
mendesak sebelum S3–S4: **Q-10** (HPP FIFO vs rata-rata), **Q-13**
(impor histori?), **Q-14** (daftar pengguna). Jawaban dicatat di PRD, lalu
dampaknya di sprint terkait.
