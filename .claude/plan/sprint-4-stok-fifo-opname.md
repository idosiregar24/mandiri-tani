# Sprint 4 — Stok, HPP FIFO, Penyesuaian & Opname

> Milestone **M1 Master & Inventori**. Requirement: PRD §5.2 (FR-INV-01…07, 10, 12, 13),
> §6.4–6.7, §5.9 FR-MIG-02 lingkup **Stok awal**. Aturan kode: skill `stock-movement`,
> `rules/database-standards.md` §5. Rencana lintas sprint:
> [`sprint-7-pengambilan-barang.md`](sprint-7-pengambilan-barang.md) (reservasi),
> [`sprint-14-go-live-migrasi.md`](sprint-14-go-live-migrasi.md) (impor ulang & reset).

**Dikerjakan sebelum Sprint 2** (keputusan owner 2026-10-26: "langsung ke sprint 4"), sama seperti S3.

**Ringkasan status (2026-10-26):** 27/27 item selesai · DoD 3/4 (sisa: dicoba owner di aplikasi). **143 tes** hijau (22 file). Stok awal dari backup asli **cocok persis dengan iPOS: nilai persediaan Rp 1.793.173.974,00**, 288 barang, 357 lapisan FIFO.

## Keputusan sprint ini

| # | Keputusan | Alasan |
|---|---|---|
| S4-1 | `stock_opnames.created_by`, `stock_adjustments.created_by` boleh NULL (= lewat kunci akses lokal, sebelum ada akun) — sama dengan S3-2; Sprint 2 mewajibkannya lewat service | Belum ada user sebelum S2 |
| S4-2 | `numbering.ts` (PRD §6.7) ditarik maju dari S2: penyesuaian = **`PS`**, stok opname = **`OP`** (kode `trid` iPOS `tbl_formatnotr`, belum pernah dipakai toko) | Dokumen stok butuh nomor sekarang |
| S4-3 | Saldo awal iPOS: **satu mutasi `OPENING` per lapisan** `tbl_item_im` (kantor UTM, `sisa > 0`): qty = sisa, HPP = `hargadasar` (dibulatkan 4 desimal), `received_at` lapisan = tanggal iPOS, `moved_at` = waktu backup iPOS. Selisih `tbl_itemstok.stok − Σ sisa` (bila ada) → mutasi tambahan + temuan DQ | FIFO berlanjut persis seperti iPOS (D-11) |
| S4-4 | `last_purchase_cost` setelah impor = `hargadasar` lapisan **pembelian (BL) terbaru** di iPOS; tanpa pembelian → lapisan terbaru apa pun | Dipakai penyesuaian/opname plus & stok minus |
| S4-5 | Rekonsiliasi memakai angka **string desimal** (qty & rupiah), bukan number JS; nilai persediaan dibandingkan dalam rupiah dengan toleransi pembulatan HPP 4 desimal (≤ Rp 1 per lapisan) | Aturan uang tanpa float; iPOS menyimpan HPP 20 desimal |
| S4-6 | Penyesuaian & opname dibuat dan diposting dalam **satu langkah** (dokumen POSTED langsung); opname punya sesi `COUNTING` → `POSTED`/`CANCELLED`. Penyesuaian & opname hanya **Owner** (`stock.adjust`, `stock.opname`) | Q-14: dua role; dokumen POSTED tidak diubah |
| S4-7 | Data HPP/nilai/lapisan hanya untuk `cost.read` — disaring di serializer server, bukan disembunyikan di UI | security-standards §2 |

## A. Fondasi

- [x] **A1** Migrasi `0003_inventory.sql`: `stock_balances`, `stock_movements` (+ append-only), `stock_cost_layers`, `stock_layer_consumptions` (+ append-only), `stock_opnames`, `stock_opname_lines`, `stock_adjustments`, `stock_adjustment_lines`; S4-1; file skema diperbarui
  - 📌 8 tabel + trigger append-only; S4-1 & `client_op_id` penyesuaian (Idempotency-Key) dicatat juga di file skema
- [x] **A2** `src/server/lib/numbering.ts`: `next(tx, docType, deptCode, date)` → `0001/PS/UTM/1026`; 7 digit untuk KSR/JL/BL; reset tahunan; rollback mengembalikan nomor; tes unit format + tes DB berurutan & paralel
  - 📌 `lib/numbering.ts` + `lib/clock.ts` (tanggal Asia/Jakarta, bisa dimock); 6 tes: format, 31 Des 18:00 UTC = Januari WIB, rollback mengembalikan nomor, 8 dokumen paralel tanpa nomor kembar, lanjut dari nomor iPOS (`0001789/JL/UTM/1026`). Kode tipe `OP` diambil dari `tbl_formatnotr` iPOS
- [x] **A3** Reset data persiapan ikut menghapus tabel stok (S3 E7 diperluas)
  - 📌 TRUNCATE menyertakan tabel stok + `doc_sequences` (TRUNCATE tidak memicu trigger append-only per baris; hanya di Mode Persiapan). Tes: reset → mutasi, saldo, nomor = 0 → impor ulang

## B. `stockService` (satu pintu)

- [x] **B1** `apply(tx, movements, opts)`: urut + `ON CONFLICT DO NOTHING` balance → lock produk `ORDER BY id FOR UPDATE` → lock balance → kebijakan stok (tersedia; kecuali `SYNC`/`allowNegative`) → keluar: habiskan lapisan tertua + `stock_layer_consumptions`, kekurangan = `last_purchase_cost` `is_estimated` → masuk: lapisan baru → ledger, balance, `last_purchase_cost`; kembalikan HPP per mutasi
  - 📌 Lock produk memakai **`FOR NO KEY UPDATE`** (saling-kunci antar penulis stok sama dengan FOR UPDATE, tapi tidak menghalangi cek FK dokumen lain). Barang masuk saat stok minus: bagian yang menutup kekurangan tidak dijadikan lapisan → Σ lapisan = saldo tetap benar tanpa hitung ulang mundur. Pesan stok kurang dalam satuan jual ("tinggal 80 zak")
- [x] **B2** `reserve(tx, lines)` / `release(tx, lines)` dengan urutan lock yang sama (dipakai S7)
  - 📌 Juga `lockForCount()` untuk posting opname (qty sistem dibaca di bawah lock yang sama)
- [x] **B3** Tes: contoh Urea PRD §6.6 (7.183,33/kg, sisa Rp 30.400.000), stok tidak cukup 409, stok minus estimasi, pembalikan dengan `layerReceivedAt`, invarian Σ ledger = saldo = Σ lapisan, dua transaksi paralel urutan terbalik tanpa deadlock
  - 📌 `stock/service.test.ts` 8 tes; invarian dicek setelah setiap tes; 4 transaksi paralel urutan terbalik tanpa deadlock

## C. Impor stok awal iPOS (FR-MIG-02 lingkup Stok)

- [x] **C1** Sidik struktur lingkup stok (`tbl_itemstok`, `tbl_item_im`)
  - 📌 `STOCK_FINGERPRINT` (`tbl_itemstok`, `tbl_item_im`)
- [x] **C2** Pratinjau: jumlah lapisan, total qty, **nilai persediaan iPOS**, temuan (stok tanpa lapisan, barang tidak dikenal, stok minus)
  - 📌 `POST /imports/ipos/stock/inspect`; angka sisi iPOS dihitung SQL di DB sumber (S3-11); temuan: barang tak dikenal, stok tanpa lapisan, lapisan berlebih, stok minus
- [x] **C3** Impor: butuh lingkup master sudah diimpor; ditolak bila lingkup stok sudah ada / sudah ada mutasi; satu transaksi lewat `stockService.apply`; `legacy_refs`; batch `scope = ["stock"]`
  - 📌 `POST /imports/ipos/stock/commit`: satu transaksi, satu panggilan `stockService.apply` (OPENING, `allowNegative` untuk stok minus iPOS), `last_purchase_cost` (S4-4), `legacy_refs` per lapisan (`stock_layer` → movement). Tanggal lapisan iPOS dibaca sebagai teks + `+07:00` agar tidak bergeser oleh zona waktu proses
- [x] **C4** Rekonsiliasi: jumlah barang berstok, total qty, nilai persediaan, barang dengan selisih
  - 📌 Barang berstok, lapisan, total qty, **nilai persediaan** (toleransi pembulatan HPP 4 desimal, S4-5), stok minus — tipe `ReconciliationRow` kini string desimal + `ok` (master S3 ikut disesuaikan)
- [x] **C5** Layar Impor iPOS: langkah lingkup Stok setelah Master
  - 📌 Langkah 4 "Impor stok awal" setelah master; DB sementara baru dihapus setelah stok diimpor atau tombol "Selesai & tutup file"
  - 📌 **Temuan owner 2026-10-26:** semua stok tampil 0 — log: master diimpor 09.57 dengan versi lama (yang langsung menutup file), langkah stok tidak pernah dijalankan. Layar tidak menjelaskannya → ditambah **status per lingkup** (Master ✓ / Stok awal belum) + petunjuk "pilih file yang sama, jalankan langkah 4" di Impor iPOS, dan peringatan + tombol di layar Stok. Dicek juga: kolom STOK `DB Item.xlsx` = `tbl_itemstok` untuk 414/416 barang (2 barang +1 karena backup 13 jam lebih baru); `tbl_item.stok` iPOS memang kosong (DQ-6)
- [x] **C6** Fixture fiktif diperluas (lapisan FIFO, harga 20 desimal) + tes
  - 📌 Fixture: 2 lapisan Urea (satu HPP 20 desimal), lapisan habis, kantor DEP, stok tanpa lapisan, stok minus, barang tak dikenal; `stock-import.test.ts` 6 tes termasuk **FIFO berlanjut** dari lapisan iPOS tertua (HPP jual pertama 7.131,2577)
- [x] **C7** Uji backup asli: nilai persediaan = iPOS (Analisis: Rp 1,79 M, 366 item)
  - 📌 **2026-10-26, backup `.claude/file/` di cluster sementara (hanya angka): 288 barang berstok · 357 lapisan · 95.620 satuan dasar · nilai Rp 1.793.173.974,00 — semua baris rekonsiliasi OK**, 0 stok minus, 0 HPP estimasi, cek konsistensi 0 masalah. Lapisan tertua 1 Sep 2024 WIB. Pratinjau 0,2 dtk, impor 0,7 dtk

## D. Stok & kartu stok (FR-INV-02, 03, 07, 12, 13)

- [x] **D1** `GET /stock`: per barang — fisik, dipesan, tersedia (dalam satuan dasar + satuan jual), stok minimum, menipis; Owner: HPP rata-rata lapisan & nilai; filter cari/kategori/menipis
  - 📌 Plus ringkasan (barang aktif, menipis/habis, minus, nilai total); "menipis" = tersedia ≤ minimum atau habis (stok minimum iPOS semuanya 0)
- [x] **D2** `GET /stock/:productId/card?from&to&unit`: saldo awal, masuk, keluar, saldo berjalan, sumber dokumen
  - 📌 Periode default awal bulan s/d hari ini (WIB); saldo berjalan dihitung SQL window function; nomor dokumen PS/OP tampil
- [x] **D3** `GET /stock/:productId/layers` (Owner): lapisan FIFO tersisa
  - 📌 Hanya `cost.read`
- [x] **D4** `GET /stock/consistency` (G-4): saldo ≠ Σ ledger, Σ lapisan ≠ saldo
  - 📌 Dipakai banner merah di layar Stok bila ada selisih
- [x] **D5** Tes RBAC: KASIR melihat stok tanpa HPP/nilai
  - 📌 Tes: KASIR melihat stok & kartu stok tanpa `value`/`avgCost`/`unitCost`; lapisan 403

## E. Penyesuaian stok (FR-INV-06)

- [x] **E1** `POST /stock/adjustments`: nomor `PS`, alasan wajib (Rusak/Hilang/Kedaluwarsa/Sampel/Lainnya + catatan), baris dalam satuan pilihan → satuan dasar, + / −; audit; `Idempotency-Key`
  - 📌 Tes: nomor `0001/PS/UTM/MMYY`, ZAK → KG, Idempotency-Key sama → dokumen sama tanpa mutasi kedua, "Lainnya" wajib catatan, pecahan ditolak untuk barang tanpa qty desimal, stok fisik kurang 409, audit
- [x] **E2** `GET /stock/adjustments` + detail
  - 📌 Detail di dialog dari daftar

## F. Stok opname desktop (FR-INV-05)

- [x] **F1** Buat sesi (nomor `OP`, gudang, catatan) → isi hitungan per barang (satuan pilihan) → tinjau selisih (qty & nilai untuk Owner) → posting: qty sistem diambil **saat posting**, selisih jadi mutasi `OPNAME`; batal
  - 📌 Satuan hitung bebas (ZAK/KG), disimpan satuan dasar; selisih tampil langsung; nilai selisih untuk Owner
- [x] **F2** Tes: penjualan/penyesuaian selama sesi tetap dihitung; posting dua kali ditolak
  - 📌 Tes: penjualan 1 ZAK di tengah sesi → selisih jadi 0 saat posting; posting/hitung setelah POSTED 409; sesi kosong 422; batal

## G. Layar

- [x] **G1** Menu Persediaan: **Stok**, **Penyesuaian**, **Stok Opname** (gaya "modern simple")
  - 📌 Menu Persediaan: Barang · Stok · Penyesuaian · Stok Opname · Data Lain; tombol "Kartu Stok" di form barang
- [x] **G2** Stok: tiga angka (Fisik · Dipesan · Tersedia), filter Semua/Menipis, nilai (Owner)
  - 📌 `formatStockQty`: "80 zak 20 kg" + "4.020 kg"; status Aman/Menipis/Habis/Minus; kartu angka
- [x] **G3** Kartu stok per barang (dari daftar stok & form barang)
  - 📌 Plus tabel lapisan FIFO untuk Owner
- [x] **G4** Penyesuaian: daftar + form (cari barang, satuan, + / −, alasan)
  - 📌 `ProductPicker` baru (cari + ↑/↓ + Enter, debounce 150 ms); arah Kurangi/Tambah; satuan per baris
- [x] **G5** Stok Opname: daftar sesi + layar hitung (cari/scan barang, isi jumlah, selisih) + posting
  - 📌 Smoke test headless dengan data tiruan: Stok, Kartu Stok, Opname tampil tanpa error JS

## Definition of Done

- [x] Stok awal dari backup iPOS bernilai sama dengan iPOS dan FIFO berlanjut — C7 + tes C6
- [ ] Owner bisa menyesuaikan stok dan menjalankan opname dari layar; kartu stok menjelaskan setiap perubahan
  - 📌 API teruji + layar dirender (data tiruan); **tinggal dicoba owner di aplikasi** (restart `npm run dev`)
- [x] Invarian stok (ledger = saldo = lapisan) lolos di tes & endpoint konsistensi
- [x] `npm run typecheck && npm run lint && npm test` hijau — 22 file, 143 tes; `npm run build` bersih
