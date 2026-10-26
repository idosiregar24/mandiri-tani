# Sprint 3 — Master Data & Impor Master dari iPOS

> Milestone **M1 Master & Inventori**. Requirement: PRD §5.1 (FR-MD-01…04, 08…11, 14),
> §5.9 (FR-MIG-01…03, 07…09 lingkup **Master**), §6.3 (multi-satuan & harga).
> Pemetaan data: `File Skema/Mandiri Tani v1.0/Analisis-Sumber-Data-iPOS.md` §4.
> Go-live: [`sprint-14-go-live-migrasi.md`](sprint-14-go-live-migrasi.md).

**Dikerjakan sebelum Sprint 2** (keputusan owner 2026-10-24: "sprint 3 dulu").
Akibatnya belum ada login — lihat keputusan **S3-1**.

**Ringkasan status (2026-10-26):** 31/31 item selesai · DoD 3/4 (sisa: dicoba owner di aplikasi). Semua bagian A–E dibangun & teruji (**112 tes** hijau, 18 file); impor backup asli cocok 1:1 (E10). Sisa untuk owner: coba alur di aplikasi (pilih file backup lewat dialog → impor → reset → impor ulang) — dialog file asli belum diklik dari sesi pengembangan.

## Keputusan sprint ini

| # | Keputusan | Alasan |
|---|---|---|
| S3-1 | **Kunci akses lokal sementara** sampai Sprint 2: main process membuat token acak 32 byte setiap kali aplikasi dibuka, hanya diberikan lewat IPC ke jendela aplikasi sendiri; api-client mengirimnya sebagai `Authorization: Bearer`. Server memperlakukannya sebagai **OWNER** di perangkat K01. Request tanpa token / token lain → **401** (HP & PC lain di Wi-Fi tidak bisa membaca/mengubah master). Bukan bypass IP (security-standards §1). Dihapus & diganti sesi login di Sprint 2 | Sprint 3 dikerjakan sebelum Sprint 2; API tidak boleh terbuka ke LAN |
| S3-2 | `import_batches.created_by` boleh NULL (= dijalankan lewat akses lokal sebelum ada akun) | Belum ada tabel user terisi; Sprint 2 mewajibkan user lewat service |
| S3-3 | Restore iPOS: `pg_restore` **hanya objek TABLE + TABLE DATA** (daftar TOC disaring) ke DB sementara `ipos_import` milik `pos_app`; fungsi/trigger lama iPOS tidak ikut. Metadata file (nama, SHA-256, waktu backup) disimpan di tabel `_mtpos_source` di DB sementara itu | Uji 2026-10-24: PG 18 membaca backup iPOS (PG 9.5, arsip 1.12) dalam ±2 dtk; satu-satunya error = 6 trigger yang fungsinya tidak ada |
| S3-4 | Main process (PgManager) yang menjalankan `pg_restore`/`pg_dump`; transformasi data di server (REST). Backup sebelum reset diberikan ke server sebagai **hook** `createServer({ hooks: { backup } })` | Golden rule 8 & 9: server tidak import electron, hanya PgManager memanggil binaries PG |
| S3-5 | Harga iPOS: item `sistemhargajual = S` → harga per satuan dari `tbl_itemhj` (level 0/1, jmlsampai 0, harga > 0); item lain → `tbl_item.hargajual1` pada satuan dasar. Harga 0 tidak diimpor (DQ-2) | Data: 14 item tipe S (pupuk KG/ZAK), `hargajual1` item S berbeda dari harga per KG di `tbl_itemhj` |
| S3-6 | Kode pelanggan/supplier non-standar (berupa nama, DQ-5) → kode baru berurutan melanjutkan nomor tertinggi (`PLxxxx`/`SPxxxx`); kode lama di `legacy_refs`. Pelanggan iPOS `UMUM` → pelanggan **UMUM** bawaan (walk-in) | DQ-5; FR-MD-08 |
| S3-7 | Satuan jual/beli default saat impor = satuan yang **paling sering** dipakai item itu di `tbl_ikdt` / `tbl_imdt` (cadangan: satuan dasar / satuan terbesar) | Pupuk dijual per ZAK tapi stok per KG; kasir tidak perlu ganti satuan setiap kali |
| S3-8 | Merek iPOS (3 merek, tak satu pun dipakai item) tidak diimpor; saran merek dari nama (DQ-7) ditunda | Tidak ada data merek nyata |
| S3-9 | "Lingkup master sudah terisi" (FR-MIG-03) = ada batch `COMMITTED` lingkup master **atau** sudah ada barang / pelanggan (selain UMUM) / supplier yang diketik manual → impor ditolak, jalankan Reset dulu. Konfirmasi reset = ketik `RESET` (S14 menyebut "ketik nama toko" — nama toko baru ada di S2; ganti saat itu) | Tidak ada penggabungan data setengah jadi; aturan sederhana untuk owner |
| S3-10 | Importer membaca `ipos_import` lewat koneksi terpisah lalu menulis ke `mandiri_tani` dalam **satu transaksi** (`INSERT … SELECT unnest($n::…[])`, tetap berparameter). Transformasi = fungsi murni `planMasterImport()` (dipakai pratinjau & impor) | PG tidak bisa `INSERT … SELECT` lintas database tanpa ekstensi; fungsi murni mudah diuji |
| S3-11 | Sisi "iPOS" rekonsiliasi untuk harga dihitung **langsung dengan SQL** di DB sumber, tidak memakai parsing JS importer | Bug parsing yang ditemukan di E10 tidak terlihat bila kedua sisi memakai kode yang sama |

## A. Fondasi API (pengganti sementara Sprint 2)

- [x] **A1** `src/shared/permissions.ts`: peta role → permission lengkap PRD §4.2 (OWNER, KASIR) + `hasPermission()`
  - 📌 `permissions.ts` (role OWNER/KASIR + `OWNER_AUTHORIZABLE`); dipakai server (`requirePermission`) & renderer (`lib/navigation.ts` menyembunyikan menu)
- [x] **A2** Middleware `auth` (kunci akses lokal S3-1, `timingSafeEqual`) + `requirePermission()` + `req.ctx` (role, userId, deviceId, requestId); test 401/403
  - 📌 `middleware/auth.ts`: digest SHA-256 + `timingSafeEqual`, tanpa pengecualian IP. Test 401 (tanpa/salah kunci, juga untuk route tak dikenal) di `server.test.ts`; 403 KASIR di setiap file test modul (harness `test/api.ts`: KASIR lewat authenticator tiruan karena belum ada kredensial KASIR sebelum S2)
- [x] **A3** Kunci akses: dibuat `lifecycle` saat boot → `createServer` config; IPC `pos:app:access-token` (pengirim tepercaya saja) → `window.pos.accessToken()`; `api-client` menyisipkan header; semua method (GET/POST/PUT/DELETE)
  - 📌 `Lifecycle.localAccessKey` (32 byte acak per start) → `createServer` → IPC `pos:app:access-token` (pengirim divalidasi) → `window.pos.accessToken()` → `api-client` menyisipkan `Authorization` di GET/POST/PUT/DELETE. Di browser biasa (tanpa `window.pos`) semua API = 401 — terbukti di smoke test
- [x] **A4** `auditService.record(tx, …)` (perubahan harga, impor, reset) — dalam transaksi aksi itu
  - 📌 `lib/audit.ts` `recordAudit(tx, …)`: harga dibuat/diubah, nonaktif/hapus master, limit kredit, impor (`import.ipos.commit`), reset (`system.reset_preparation`)
- [x] **A5** `@shared/money` & `@shared/qty` (decimal.js, string desimal, `formatRupiah` di renderer)
  - 📌 `@shared/money` (dec/toMoney/toQty/trimDecimal); `lib/format.ts` renderer: `formatRupiah`, `formatQty`, `parseMoneyInput` (`1.500.000` → `1500000`), tanggal Asia/Jakarta — tanpa float, 5 tes

## B. Migrasi `0002_master.sql`

- [x] **B1** Tabel master skema §2: units, categories, brands, warehouses, customer_groups, customers, suppliers, cash_accounts, payment_methods, cash_categories, products, product_units, product_barcodes, product_prices, product_components (+ index, trigger `updated_at`)
  - 📌 Diterapkan di DB dev 2026-10-24 21.46 → file **beku**; perubahan skema berikutnya lewat `0003`
- [x] **B2** Data awal: satuan kode iPOS, grup UMUM, **pelanggan UMUM (walk-in)**, akun kas LACI/KAS_TOKO, kategori kas, metode bayar CASH & CREDIT, **gudang UTM "Gudang Utama" (default)** — lewat fungsi `seed_master_defaults()` (idempoten, dipakai ulang oleh reset)
  - 📌 `seed_master_defaults()` idempoten — dipanggil migrasi & reset
- [x] **B3** S3-2: `import_batches.created_by` DROP NOT NULL; file skema diperbarui di commit yang sama
  - 📌 File skema diperbarui (`created_by` nullable + `products_sku_trgm`)
- [x] **B4** Test skema: semua FK ber-index, CHECK & unique bekerja (SKU unik case-insensitive, satu satuan dasar, harga unik per satuan/grup/min_qty)
  - 📌 Diuji lewat API (unik case-insensitive SKU/kode, satu satuan dasar, harga unik per satuan/grup/min_qty, satu gudang default, satu walk-in) + `test/schema.test.ts` (semua FK ber-index)

## C. API master (`/api/v1`)

- [x] **C1** `units`, `categories`, `brands`, `warehouses` (satu default), `customer-groups` — list/create/update/nonaktifkan (soft delete, FR-MD-14)
  - 📌 `modules/masters` — hapus = soft delete, ditolak bila masih dipakai; UMUM & gudang utama dilindungi
- [x] **C2** `customers` (cari nama/kode/HP, paginasi, kode otomatis `PLxxxx`, UMUM tidak bisa dihapus/diubah grupnya), `suppliers` (kode otomatis `SPxxxx`)
  - 📌 Cari nama/kode/HP/desa, paginasi `?page=`, `PLxxxx`/`SPxxxx` melanjutkan nomor tertinggi; UMUM selalu aktif, tunai saja, tak bisa dihapus
- [x] **C3** `cash-accounts` (rekening BANK) + `payment-methods` (TRANSFER per rekening, QRIS; CASH/CREDIT bawaan tidak bisa dihapus) — D-6
  - 📌 Transfer/QRIS wajib ke rekening BANK; Tunai & Piutang hanya bisa diganti nama/urutan
- [x] **C4** `products`: list + cari (nama/SKU/barcode, `ILIKE` + trigram), detail, **simpan satu paket** produk + satuan + barcode + harga dalam satu transaksi; validasi satu satuan dasar (konversi 1), konversi > 0, barcode unik global; konversi satuan yang sudah dipakai transaksi dikunci (kolom dipersiapkan, dicek mulai Sprint 5)
  - 📌 Satu paket dalam satu transaksi; id baris harga stabil saat diubah (penting untuk sync); barcode unik global dengan pesan nama barang pemakainya; kunci konversi dicek mulai S5 (komentar di service)
- [x] **C5** Perubahan harga & nonaktif produk tercatat di `audit_logs`
  - 📌 Audit hanya berisi harga yang **berubah** (`ZAK|umum|1: 630000 → null`), plus aktif/nonaktif
- [x] **C6** Test integrasi per route (PostgreSQL asli): sukses, validasi 400, duplikat 409, tanpa token 401
  - 📌 5 file test route (masters, customers, suppliers, payment-methods, products) — 33 tes: sukses, 400 + `fieldErrors`, 404, 409, 401, 403 KASIR

## D. Layar (sederhana — design-standards §0)

- [x] **D1** `AppShell` sederhana: sidebar (Beranda, **Barang**, **Pelanggan**, **Supplier**, **Data Lain**, **Impor iPOS**, Uji Cetak) — menu modul lain tampil nonaktif "Segera"
  - 📌 `app/AppShell.tsx` + `lib/navigation.ts` (7 grup, menu disaring permission, "Segera" untuk Kasir/Pembelian/Piutang/Laporan/Profil Toko)
- [x] **D2** **Barang**: daftar + cari cepat + filter kategori; form satu halaman: nama, kode, kategori, satuan dasar, tabel **Satuan & Harga** (mis. KG = 1 → Rp 15.000; ZAK = 50 KG → Rp 640.000), barcode opsional, "Detail lain" terlipat (stok min, qty desimal, nonaktif)
  - 📌 Daftar: cari (debounce) + filter kategori + nonaktif, harga per satuan ("ZAK = 50 KG · Rp 640.000"). Form: baris pertama = satuan dasar, isi per satuan, harga umum, barcode, radio "Utama dijual"; "Detail lain": merek, stok min, pecahan, jasa, aktif, **harga khusus grup/grosir** (tidak hilang saat disimpan). Validasi = skema bersama `ProductInput`, issue dipetakan ke kolom (`features/products/form.ts`, 4 tes). Hapus di menu "Lainnya" + `ConfirmDialog`
- [x] **D3** **Pelanggan**: daftar + cari, form (nama, HP, alamat/desa, grup, limit kredit kosong = tanpa batas, termin 10 hari)
  - 📌 Dialog form; limit kredit kosong = tanpa batas, 0 = tunai saja; UMUM dikunci
- [x] **D4** **Supplier**: daftar + form
  - 📌 Dialog form; termin 0 = tunai
- [x] **D5** **Data Lain**: tab Kategori · Satuan · Grup Pelanggan · Gudang · Rekening & Metode Bayar · Merek
  - 📌 Satu komponen `features/masters/MasterSection.tsx` berbasis konfigurasi untuk 7 daftar (rekening & metode bayar satu tab)
- [x] **D6** Komponen bersama: `PageHeader`, `DataTable` (TanStack Table), `MoneyInput`, `Notice`, `ConfirmDialog`, `EmptyState` + shadcn (input, label, select, dialog, tabs, table, badge, checkbox, textarea)
  - 📌 `components/shared/`: PageHeader, DataTable (TanStack Table **v8** — npm memasang v9, dipin balik ke v8 sesuai frontend-standards §5), MoneyInput, QtyInput, Notice, ConfirmDialog, EmptyState, SearchBox; shadcn + `form`, `dropdown-menu`. `<FormLabel required>` ditambahkan ke `form.tsx` (tampilan saja). Smoke test headless: semua halaman tampil, 0 error JS, tanpa scroll horizontal di 1366×768

## E. Impor master dari iPOS (FR-MIG-01…03, 07…09)

- [x] **E1** PgManager: `restoreIposBackup(file)` → SHA-256, waktu backup (header arsip), `DROP/CREATE DATABASE ipos_import OWNER pos_app`, `pg_restore -L <daftar TABLE+DATA>` sebagai `pos_app`, tulis `_mtpos_source`; `dropIposImport()`; `backupDatabase(label)` (`pg_dump -Fc` ke folder backup)
  - 📌 `PgManager.restoreIposBackup()` (SHA-256 streaming, `pg_restore -l` → saring TABLE + TABLE DATA → `pg_restore -L` sebagai `pos_app`, `PGPASSWORD` lewat env, gagal → DB dihapus), `dropIposImport()`, `backupDatabase()`; tes dengan dump sintetis: hanya tabel+data yang ikut (fungsi & trigger tidak), file daftar dibersihkan, file bukan backup ditolak
- [x] **E2** IPC: `pos:import:choose-ipos` (dialog pilih file `.i5bu` → restore → ringkasan), `pos:import:cleanup`
  - 📌 `pos:import:choose-ipos` (dialog native — renderer tidak pernah mengirim path) mengembalikan hasil terstruktur `RESTORED/CANCELED/FAILED`; `pos:import:cleanup` dipanggil setelah impor
- [x] **E3** **Sidik struktur** (FR-MIG-09): daftar tabel & kolom wajib lingkup master; beda → berhenti dengan daftar perbedaan jelas
  - 📌 `MASTER_FINGERPRINT` (14 tabel) di `modules/imports/ipos-source.ts`; beda → daftar tabel/kolom hilang, impor 422 (tes)
- [x] **E4** `POST /imports/ipos/inspect`: pratinjau jumlah per entitas + masalah kualitas data (DQ-1/2/4/5/7/9 + item tipe tak dikenal + satuan turunan konversi 1) — tanpa menulis apa pun
  - 📌 `POST /imports/ipos/inspect`: jumlah per entitas + temuan DQ-2/4/5/9, kode supplier non-SP, tipe item tak dikenal, satuan turunan isi 1, barcode kembar — tanpa menulis apa pun (tes)
- [x] **E5** `POST /imports/ipos/commit` (lingkup master): satu transaksi — gudang UTM, satuan, kategori (RACUN→Pestisida, ALT→Alat Pertanian), grup (General→UMUM + diskon), pelanggan, supplier, rekening & metode Transfer (BCA, Mandiri), produk + satuan + barcode + harga; `import_batches` + `legacy_refs` per baris; impor ulang lingkup yang sudah ada **ditolak** (FR-MIG-03)
  - 📌 `POST /imports/ipos/commit {purpose}`: satu transaksi + advisory lock; gagal → rollback penuh + batch `FAILED` sebagai jejak; ulang ditolak 409 (S3-9)
- [x] **E6** Rekonsiliasi (FR-MIG-04 lingkup master): jumlah item / satuan turunan / harga / pelanggan per grup / supplier di iPOS vs hasil impor — tampil di layar
  - 📌 Barang, multi-satuan, satuan turunan, harga per satuan (SQL independen, S3-11), kategori, satuan, grup, pelanggan **per grup**, supplier, rekening — disimpan di `import_batches.summary` dan ditampilkan
- [x] **E7** **Reset data persiapan** (FR-MIG-08, lingkup data yang ada sampai sprint ini): ketik `RESET` → backup otomatis (`pre-reset-<waktu>.dump`) → hapus data master + `legacy_refs`, batch → `DISCARDED`, isi ulang data awal; user/perangkat/pengaturan/audit tetap
  - 📌 `POST /imports/reset {confirm:"RESET"}`: tolak bila go-live; hook backup `pre-reset-<waktu>.dump` **dulu** (gagal backup = tidak reset); `TRUNCATE` master + `legacy_refs`, batch → `DISCARDED`, seed ulang, audit. Tanpa hook backup (mis. dari HP) → 503
- [x] **E8** Layar **Impor iPOS**: 1) Pilih file → 2) Pratinjau & masalah data → 3) Impor → 4) Rekonsiliasi; tombol Reset di bagian bawah (Mode Persiapan)
  - 📌 `pages/imports/IposImportPage.tsx`: 4 langkah bernomor, temuan DQ bisa dibuka, tujuan impor (Uji coba/Gladi/Go-live), tabel rekonsiliasi (baris beda merah), riwayat impor, kartu Reset (ketik RESET + dialog konfirmasi)
- [x] **E9** Test: fixture **fiktif** `test/fixtures/ipos-mini.sql` (KG/ZAK×50, item harga tipe S, kode pelanggan berupa nama, UMUM, grup RAM 1, supplier tanpa SP) — tidak pernah memakai backup asli
  - 📌 `test/fixtures/ipos-mini.sql` fiktif (nama kolom = iPOS asli) + `modules/imports/routes.test.ts` (11 tes: pratinjau, impor, pemetaan KG/ZAK & harga tipe S, pelanggan/grup/supplier/bank, tolak ulang, reset → impor ulang, go-live, sidik struktur, 403/401, sebelum file dipilih)
- [x] **E10** Uji dengan backup asli di laptop dev: angka cocok dengan Analisis §2 (416 item, 14 item multi-satuan, 1.238 pelanggan, 37 supplier) — catat hasilnya di sini
  - 📌 **2026-10-26, backup `.claude/file/` di cluster sementara (bukan DB dev), hanya angka yang dicatat:** sidik struktur cocok; **416 barang, 14 multi-satuan, 14 satuan turunan, 354 harga per satuan, 4 kategori, 11 satuan, 6 grup, 1.238 pelanggan (UMUM 1.056 · RAM 1 69 · RAM 2 50 · Gold 31 · Silver 29 · Bronze 2), 37 supplier, 2 rekening — semua baris rekonsiliasi cocok 1:1.** 13 pupuk KG + ZAK = 50 KG. Kode baru PL s/d PL1268 (9 kode-nama), SP s/d SP0038 (17). Temuan: DQ-2 74 barang tanpa harga, DQ-4 13 nama kembar, DQ-9 **2** pupuk ber-PCS (Analisis menyebut 1), 1 tipe item tak dikenal, 1 satuan turunan isi 1. Waktu: pratinjau 0,3 dtk, impor 0,5 dtk.
  - 📌 **Bug ditemukan & diperbaiki berkat data asli:** `tbl_itemhj.hargajual` di iPOS bertipe `numeric` tak terbatas (`60000.00000000000000000000`) → harga 14 barang tipe S terbaca 0 (DQ-2 sempat 88). Parser menerima desimal panjang; fixture kini memakai `numeric` tak terbatas; rekonsiliasi harga dihitung SQL (S3-11)

## Definition of Done

- [ ] Owner bisa mengimpor master dari backup iPOS lewat layar, melihat rekonsiliasi yang cocok, me-reset, dan mengimpor ulang
  - 📌 Alur server + main teruji otomatis dan dengan backup asli; **tinggal dicoba owner di aplikasi** (dialog pilih file native tidak bisa diklik dari sesi pengembangan)
- [x] Barang, pelanggan, supplier bisa dicari, ditambah, diubah, dinonaktifkan dari layar
  - 📌 API teruji; layar dirender & divalidasi di smoke test (data tiruan)
- [x] `npm run typecheck && npm run lint && npm test` hijau — 18 file, **112 tes**, ±45 dtk; `npm run build` bersih
- [x] API master menolak request tanpa kunci akses (401) — tes + smoke test browser (semua request 401)
