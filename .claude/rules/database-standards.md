# Database Standards — PostgreSQL Portable + node-postgres

Berlaku untuk `db/migrations/`, `src/server/db/`, dan semua `repo.ts`.
Skema otoritatif: `.claude/File Skema/Mandiri Tani v1.0/mandiri_tani_schema.sql`
(desain & alasan: PRD §6). Dokumen ini adalah aturan **cara menulisnya**.

## 1. Mesin & koneksi

- PostgreSQL portable, major **dipin** di `resources/postgres/VERSION`
  (minimal 15 — skema memakai `UNIQUE NULLS NOT DISTINCT`). Port default
  **5433**, `listen_addresses = '127.0.0.1'`. Aplikasi login sebagai
  **`pos_app`** (owner DB `mandiri_tani`, bukan superuser). Superuser
  `postgres` hanya dipakai `PgManager` untuk initdb/maintenance.
- Satu `pg.Pool` per proses (`src/server/db/pool.ts`): `max 10`,
  `idleTimeoutMillis 30000`, `connectionTimeoutMillis 5000`,
  `statement_timeout 15s` (laporan: `SET LOCAL statement_timeout = '60s'`).
- **Hanya** lewat helper:
  ```ts
  await withTransaction(async (tx) => { … });   // BEGIN … COMMIT, retry 40001/40P01 maks 3×
  await withClient(async (db) => { … });        // baca tanpa transaksi
  ```
  Jangan pernah `pool.connect()` manual di service/repo — klien yang lupa
  di-`release()` menghabiskan pool.
- Tipe `NUMERIC` dikembalikan `pg` sebagai **string** — biarkan string,
  konversi lewat `money.ts`/`qty.ts`. Jangan pasang `types.setTypeParser`
  yang mengubah NUMERIC ke `Number`.
- `timestamptz` di-parse ke `Date`; `date` (tanggal jatuh tempo) dibiarkan
  string `YYYY-MM-DD` (set parser OID 1082) agar tidak bergeser zona waktu.

## 2. Migrasi

- File `db/migrations/NNNN_deskripsi.sql` (4 digit, berurutan), **forward-only**,
  satu file = satu transaksi. Runner mencatat nama + checksum di
  `schema_migrations`; mengubah file yang sudah diterapkan = FATAL.
- Mulai dari `mandiri_tani_schema.sql`: Sprint 1 memindahkan bagian
  sistem ke `0001`, modul lain masuk migrasi di sprint modulnya. Bila
  migrasi menyimpang dari file skema, **perbarui file skema** di commit yang
  sama.
- Perubahan kolom pada tabel besar (`sales`, `sale_items`,
  `stock_movements`): tambah kolom nullable/berdefault konstan (instan di
  PG ≥ 11), backfill bertahap, baru `SET NOT NULL` — jangan rewrite tabel di
  satu migrasi.
- Runner membuat backup `pre-migrate-<versi>.dump` sebelum menerapkan
  migrasi baru pada database yang sudah berisi data (PRD §3.5).

## 3. Konvensi skema

| Hal | Aturan |
|---|---|
| Nama | Tabel `snake_case` jamak; FK `<singular>_id`; index `<tabel>_<kolom>_idx`, unique `_uq` |
| PK | `id uuid` — **UUIDv7 dibuat aplikasi** (`uuidv7()` dari paket `uuid`); `DEFAULT gen_random_uuid()` hanya pengaman. Ledger urut pakai `seq bigint GENERATED ALWAYS AS IDENTITY` |
| Status | `text` + `CHECK (status IN (…))` — **bukan** `CREATE TYPE … AS ENUM`. Nilai identik dengan union TS di `src/shared/constants.ts` |
| Uang / HPP / qty | `numeric(18,2)` / `numeric(18,4)` / `numeric(18,4)` — **tidak pernah** `real`/`double precision`/`money` |
| Waktu | `timestamptz`; waktu bisnis (`trx_at`, `moved_at`) terpisah dari `created_at`/`updated_at` |
| `updated_at` | Diisi trigger `set_updated_at()` (`clock_timestamp()`), jangan di-set dari aplikasi — ini dasar `?since=` |
| Master yang disinkron | `deleted_at timestamptz` (tombstone) + `index (updated_at)`; unique index memakai `WHERE deleted_at IS NULL` |
| Hapus | Master: soft delete saja. Dokumen POSTED/COMPLETED: tidak pernah dihapus/diubah — koreksi lewat dokumen pembalik. Ledger (`stock_movements`, `cash_transactions`, `audit_logs`): trigger `forbid_mutation()` |
| FK | Selalu ber-index (PG tidak membuatnya otomatis). Master→dokumen `RESTRICT` (default); header→baris `CASCADE` hanya bila dokumen bisa dihapus saat DRAFT/HELD |
| JSONB | Untuk konfigurasi & atribut bebas saja (`settings.value`, `products.attributes`, `payment_methods.config`). Apa pun yang di-join/di-constraint/diagregasi di laporan = kolom biasa |
| Snapshot | Baris dokumen menyimpan snapshot yang memengaruhi angka historis: `product_name`, `unit_code`, `conversion_qty`, `unit_price`, `cost_per_base` |

## 4. Uang & kuantitas di kode

- `src/shared/money.ts` dan `qty.ts` membungkus `decimal.js`
  (`Decimal.set({ precision: 30, rounding: ROUND_HALF_UP })`).
- Pembulatan: uang ke 2 desimal, HPP ke 4 desimal, **hanya** di titik simpan
  (bukan di tiap langkah perhitungan). Alokasi proporsional (diskon nota,
  ongkos angkut) memakai metode *largest remainder* agar Σ alokasi = total
  persis.
- `base_qty = qty × conversion_qty` dihitung di service, disimpan, dan
  divalidasi `> 0`; produk tanpa `allow_decimal_qty` menolak qty pecahan
  dalam satuan baris.

## 5. Mutasi stok — satu pintu

**Semua** perubahan `stock_balances` lewat `stockService.apply(tx, movements[])`
(lihat skill `stock-movement`). Tidak ada `UPDATE stock_balances` di repo
lain. `apply()`:

1. Urutkan (product_id, warehouse_id); `INSERT … ON CONFLICT DO NOTHING`
   baris balance yang belum ada.
2. Lock **semua** produk terdampak `ORDER BY id FOR UPDATE` (menyerialkan
   akses lapisan FIFO-nya), lalu balance terurut `FOR UPDATE`.
3. Validasi kebijakan stok negatif (FR-INV-10) — kecuali `source` dari sync.
4. **HPP FIFO** (PRD §6.6, ADR-04): barang masuk berbiaya → lapisan baru di
   `stock_cost_layers`; barang keluar → habiskan lapisan tertua
   (`ORDER BY received_at, id FOR UPDATE`) dan catat
   `stock_layer_consumptions`; `unit_cost` mutasi = rata-rata tertimbang
   lapisan terpakai. Kekurangan lapisan (stok minus) = harga beli terakhir,
   ditandai `is_estimated`.
5. `INSERT stock_movements`, `UPDATE stock_balances`, update
   `stock_cost_layers.qty_remaining` & `products.last_purchase_cost`.

Invarian harian: `Σ stock_cost_layers.qty_remaining = stock_balances.qty`
per produk × gudang (bila ≥ 0). Nilai persediaan = Σ `qty_remaining ×
unit_cost` — bukan qty × harga master.

Urutan lock yang konsisten = tidak ada deadlock antar kasir/HP. Jangan
pernah lock balance di luar `apply()` dengan urutan lain.

**Reservasi (terjual-belum-diambil).** `stock_balances.qty` = stok **fisik**;
`reserved_qty` = terjual belum diambil; tersedia = `qty − reserved_qty`.
`stockService.reserve(tx, lines)` / `release(tx, lines)` memakai urutan lock
yang sama dengan `apply()`; mutasi `SALE_PICKUP` mengurangi `qty` **dan**
`reserved_qty` sekaligus, `SALE_PICKUP_CANCEL` kebalikannya. Validasi jual
memakai **tersedia**, validasi pengambilan memakai **fisik**. Invarian harian:
`reserved_qty` = Σ sisa belum diambil nota COMPLETED (× konversi).

## 6. Penomoran dokumen

Nomor dari `numbering.next(tx, docType, deptCode, date)` →
`UPDATE doc_sequences SET last_no = last_no + 1 … RETURNING` (upsert per
tahun) **di dalam transaksi dokumen** — rollback mengembalikan nomor.
Format **sama dengan iPOS**: `0001789/JL/UTM/1026` (urut/tipe/gudang/BLNTHN,
7 digit untuk KSR/JL/BL, 4 digit lainnya, reset tahunan — PRD §6.7). Saat
go-live `last_no` diisi dari nomor terakhir iPOS. Format nomor hanya dibuat
di `numbering.ts` (satu fungsi, diuji unit) — jangan merakit string nomor di
tempat lain.

## 7. Query

- Selalu berparameter (`$1, $2`) — **tidak pernah** interpolasi string ke
  SQL. Nama kolom/arah sort dinamis hanya dari whitelist.
- Laporan dihitung SQL (`GROUP BY`, window function), bukan loop JS di
  main process (event loop dipakai bersama UI — PRD §2.4).
- Cari teks: `ILIKE` + index `gin_trgm_ops`; barcode: equality pada unique
  index.
- Setiap query baru di jalur kasir (scan, cari, simpan) dicek `EXPLAIN
  ANALYZE` dengan data uji 20.000 produk; target PRD NFR-PERF.

## 8. Seed

- Data sistem (grup `UMUM`, akun kas, kategori kas termasuk OPEX ekspedisi/
  bongkar/kendaraan/upah, metode bayar dasar, satuan kode iPOS: PCS, BTL,
  LTR, GLN, PAIL, KG, ZAK, GRAM, BOX, DUS, PAK) ada di migrasi — dibutuhkan
  setiap instalasi.
- Data toko (profil, owner, gudang, rekening) dari wizard first-run; data
  master, stok, dan piutang nyata dari **importer iPOS** (PRD §5.9) — setiap
  baris impor tercatat di `legacy_refs`, setiap proses di `import_batches`.
- Data demo untuk dev/test dari `scripts/seed-demo.ts`: **sintetis** tapi
  meniru bentuk data nyata (pupuk dasar KG + ZAK = 50 KG, pestisida per
  BTL/LTR/GLN/PAIL, pelanggan grup General/Gold/RAM 1, nota JL kredit
  dengan ongkos angkut). **Jangan** menyalin nama/HP pelanggan dari
  `.claude/file/`. Tidak pernah dijalankan otomatis di build produksi.
