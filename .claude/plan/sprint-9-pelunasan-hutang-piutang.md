# Sprint 9 — Pelunasan Piutang & Hutang, Jatuh Tempo, Aging, Saldo Awal

> Milestone **M3 Pembelian & AR/AP**. Requirement: PRD §5.5 (FR-ARAP-01…06), FR-MIG-03…05.
> Skema: tabel bagian 6 `mandiri_tani_schema.sql` **apa adanya** (owner 2026-10-29: "tetap
> ikuti struktur database yang ada"). Lanjutan dari Sprint 8 (retur memotong hutang/piutang).

**Ringkasan status (2026-10-29):** 11/12 item · **232 tes** hijau. Sisa: uji langkah impor piutang di aplikasi dengan backup asli (B4).

## Cara toko menagih di iPOS (backup 2026-10-24, angka agregat)

| Temuan | Angka | Akibat |
|---|---|---|
| Piutang terbuka | 308 nota JL (semua gudang UTM), **Rp 2,62 M**, 165 pelanggan, tertua Sep-2024; semua punya jatuh tempo | Impor otomatis seluruhnya sebagai `receivables` OPENING |
| Pelunasan | 2.548 pembayaran, semua tunai; **294 melunasi > 1 nota sekaligus** | Satu pembayaran → banyak nota (alokasi), default nota jatuh tempo terlama dulu |
| Hutang | 49 faktur BL kredit, Rp 3,13 M, 20 supplier, **tidak satu pun pelunasan tercatat** | Tidak diimpor otomatis: Owner mencentang yang benar-benar belum lunas (FR-MIG-05) |

## Keputusan sprint ini

| # | Keputusan | Alasan |
|---|---|---|
| S9-1 | **Pelunasan piutang `BP`** (`0001/BP/UTM/1026`): satu pembayaran = satu pelanggan, dialokasikan ke ≥ 1 nota (`receivable_payment_allocations`). Default otomatis **jatuh tempo terlama dulu**; bisa diatur per nota. Tidak boleh melebihi sisa. Idempotency-Key → `client_op_id` | FR-ARAP-02, data iPOS |
| S9-2 | Tunai piutang masuk **LACI** (kategori `AR_PAYMENT`), transfer/QRIS ke rekening metode itu. `shift_id` kosong (tanpa shift, S6-1). Kasir boleh (`ar.payment`) tanpa PIN | FR-ARAP-03 |
| S9-3 | **Pembayaran hutang `BH`** (Owner, `ap.payment`), alokasi sama; tunai dari **KAS_TOKO** (`AP_PAYMENT`), transfer dari rekening. `payable_payments` tidak punya `client_op_id` di skema → **tanpa Idempotency-Key** (layar Owner menonaktifkan tombol selama menyimpan) | Skema tidak diubah |
| S9-4 | Retur S8 memotong lewat **baris alokasi** (`sale_return_id` / `purchase_return_id`), bukan `UPDATE paid_amount` langsung — `paid_amount` = Σ alokasi selalu | Skema bagian 6 |
| S9-5 | **Saldo awal manual** (FR-ARAP-06): piutang (`customers.write`) / hutang (`purchases.write`) OPENING per dokumen (no. nota lama, tanggal, jatuh tempo, sisa) — juga untuk hutang di luar iPOS | FR-ARAP-06, FR-MIG-05 |
| S9-6 | **Impor iPOS lingkup `receivables`**: semua piutang terbuka (`jmlkredit − krd_jml_byr − krd_jml_pot > 0`) → OPENING dengan nomor/tanggal/jatuh tempo asli, nilai = sisa; hutang hanya faktur yang dicentang Owner (boleh isi sisa). Butuh lingkup master; ditolak bila sudah pernah; `legacy_refs` (`receivable`/`payable`) + rekonsiliasi | FR-MIG-03…05 |
| S9-7 | Aging dihitung SQL dari `due_date` (tanggal WIB hari ini): belum jatuh tempo, 1–30, 31–60, 61–90, > 90 hari | FR-ARAP-05 |
| S9-8 | Kartu piutang (FR-ARAP-07, S) & hapus piutang (FR-ARAP-08, C) **tidak** di sprint ini | Prioritas |

## A. Server

- [x] **A1** Migrasi `0006_ar_ap_payments.sql`: `receivable_payments`, `receivable_payment_allocations`, `payable_payments`, `payable_payment_allocations` persis file skema; reset persiapan ikut
  - 📌 Dibentuk dari file skema (4 tabel) dengan generator yang sama dengan 0005 — skema **tidak** diubah
- [x] **A2** Retur jual (potong piutang) & retur beli (potong hutang) memakai baris alokasi
  - 📌 `paid_amount` = Σ alokasi dicek di tes untuk piutang & hutang. `reducePayable` dihapus
- [x] **A3** `GET /receivables/summary` (per pelanggan + aging + hitungan jatuh tempo), `GET /receivables?customerId=&due=`
  - 📌 Bucket & hitungan badge (lewat jatuh tempo, hari ini, 7 hari, total lewat jatuh tempo) dari SQL; KASIR boleh baca (`ar.payment`)
- [x] **A4** `POST /receivable-payments` (BP), `GET /receivable-payments/:id`, `GET /receivable-payments?customerId=`
  - 📌 Nomor `0001/BP/UTM/1026` (4 digit, `numbering.ts`); "sisa" per nota & sisa pelanggan di bukti dihitung **saat pembayaran itu** (urutan UUIDv7) — cetak ulang menampilkan angka yang sama
- [x] **A5** `GET /payables/summary`, `GET /payables`, `POST /payable-payments` (BH), `GET /payable-payments/:id`
  - 📌 Tanpa Idempotency-Key (S9-3). KASIR 403 di semua endpoint hutang
- [x] **A6** `POST /receivables/opening`, `POST /payables/opening`
  - 📌 No. nota ganda per pelanggan/supplier → 409 `DUPLICATE_DOC_NUMBER`; pelanggan umum ditolak
- [x] **A7** Impor iPOS `receivables`: `POST /imports/ipos/receivables/inspect|commit`
  - 📌 Diuji dengan fixture sintetis (`ipos-mini.sql` ditambah kolom kredit). Data asli (agregat): 308 nota Rp 2.618.779.001 / 165 pelanggan; 49 faktur BL Rp 3.133.385.000 / 20 supplier. Pelanggan tak dikenal / tanpa jatuh tempo → catatan; rekonsiliasi menunjukkan selisihnya
- [x] **A8** Tes: FIFO jatuh tempo, alokasi manual, lebih dari sisa ditolak, kas LACI/KAS_TOKO/rekening, nomor BP/BH, idempoten, KASIR 403 hutang, retur → alokasi, aging, saldo awal, impor + rekonsiliasi
  - 📌 `ar-ap/routes.test.ts` 6, `imports/arap-import.test.ts` 5, bukti BP 1, retur → alokasi (2 assert). Total **232 tes**

## B. Layar

- [x] **B1** `/piutang` (Owner): daftar per pelanggan (sisa, aging, jatuh tempo terdekat), chip "Semua · Lewat jatuh tempo · 7 hari", cari; detail nota terbuka + **Terima pembayaran** + **Saldo awal**
  - 📌 Kartu angka (total, lewat jatuh tempo, 7 hari) + tabel aging; klik baris → nota terbuka + 5 pembayaran terakhir → **Terima pembayaran** (centang nota = lunasi nota itu; tanpa centang = jatuh tempo terlama dulu) → cetak **bukti bayar BP** di LX-310
- [x] **B2** `/hutang` (Owner): sama untuk supplier + **Bayar hutang** + **Hutang manual**
  - 📌 Uji layar: bayar 2 faktur sekaligus → `0001/BH/UTM/1026`, kas keluar dari Kas Toko
- [x] **B3** Kasir: **Terima pembayaran piutang** (Ctrl+B) → pilih pelanggan, nota terbuka, jumlah, cetak bukti bayar (struk)
  - 📌 Tombol "Terima piutang Ctrl+B" di kepala layar kasir → pilih pelanggan (tanpa baris Umum) → dialog yang sama; Alt+1…9 cara bayar; fokus kembali ke kolom scan
- [ ] **B4** Impor iPOS: langkah "Piutang & hutang" (centang faktur hutang) + uji layar
  - 📌 Langkah 5 di halaman Impor iPOS: angka iPOS, catatan data, tabel faktur kredit dengan centang + isian sisa, rekonsiliasi di langkah 6. **Belum diuji di aplikasi** (butuh dialog pilih file Electron + backup asli)

**Definition of Done:** typecheck/lint/test hijau; `paid_amount` = Σ alokasi untuk setiap
piutang/hutang; total piutang terbuka hasil impor = iPOS.
