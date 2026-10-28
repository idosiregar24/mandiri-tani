# Analisis Sumber Data — iPOS 5 & Catatan Excel Mandiri Tani

| | |
|---|---|
| **Tanggal analisis** | 2026-10-24 |
| **Sumber** | `.claude/file/` (18 file) — **berisi data pribadi pelanggan, jangan di-commit** |
| **Dampak** | Skema [`mandiri_tani_schema.sql`](mandiri_tani_schema.sql) dan PRD §1.7, §5, §6.7, §9, §10 disesuaikan dengan temuan di sini |

Dokumen ini hanya memuat **angka agregat**. Nama, alamat, dan nomor HP
pelanggan sengaja tidak disalin ke dokumen proyek.

---

## 1. Inventaris file

| File | Isi | Status pakai |
|---|---|---|
| `DB Mandiri Tani.i5bu` | **Backup database iPOS 5** = *PostgreSQL custom dump* (`pg_dump -Fc`, arsip 1.12, server **PostgreSQL 9.5.3**, DB `i5_mandiritani`, dibuat 2026-10-24 12:01). 106 tabel, 57 berisi data | **Sumber utama migrasi** |
| `DB Item.xlsx` = `DB Item Satu Harga.xlsx` (identik) | Template ekspor iPOS tipe **O** (satu harga): 416 item | Sama dengan `tbl_item` |
| `DB Item Sataun.xlsx` | Template tipe **S** (multi-satuan, maks 4 satuan) | 13 item KG→ZAK×50 |
| `DB Item Jumlah.xlsx` | Template tipe **J** (harga bertingkat per jumlah) | **Semua kolom harga tier = 0** → fitur tidak dipakai |
| `DB Item Level.xlsx` | Template tipe **L** (level harga 1–6 per satuan) | **Level 2–6 = 0** → fitur tidak dipakai |
| `DB TOKO.xlsx` | Daftar item dari layar iPOS (417 baris) | Sama dengan `tbl_item` |
| `DB Pelanggan.xlsx` | 1.238 pelanggan | Sama dengan `tbl_supel` tipe PL |
| `DB Supplier.xlsx`, `DB Supplier 2.xlsx` | 37 supplier (beda biner, isi sama) | Sama dengan `tbl_supel` tipe SU |
| `DB Sales.xlsx` | Header saja, 0 salesman | Fitur salesman/komisi tidak dipakai |
| `LAPORAN PENJUALAN BULAN APRIL 2026.pdf` | Laporan Penjualan Rekap iPOS (15 hlm) | Acuan tata letak laporan |
| `LAPORAN PEMBELIAN BULAN APRIL 2026.pdf` | Laporan Pembelian Detail iPOS (4 hlm) | Acuan tata letak laporan |
| `DAFTAR PUPUK MANDIRI TANI.xlsx` | Catatan manual per merek (MAHKOTA / DAUN / CAMPURAN): *barang ready*, *barang terjual*, **barang yang belum diambil**, sisa stok | → terjual-belum-diambil (FR-PKP) + saldo awal saat go-live |
| `DATA PENGELUARAN PUPUK DARI TANGGAL 27 SEPTEMBER 2024.xlsx` | Matriks harian keluar-masuk per varian pupuk (ZAK & **KILO**), pembelian masuk, saldo awal, catatan rekonsiliasi bon kertas vs komputer | → laporan rekap harian pupuk (FR-FIN-11) |
| `DATA PENJUALAN.xlsx` (+ Copy) | Template kosong: tanggal, pelanggan, nama pupuk, jumlah zak, **angkutan** | → Faktur Penjualan + ongkos angkut |
| `DATA TONASE RAM 1,2 & 82 MANDIRI.xlsx` | Tonase harian RAM sawit | **Di luar konteks** — terunggah tidak sengaja (owner, 2026-10-24); tidak dipakai |

## 2. Profil bisnis dari data (Sep 2024 – Okt 2026)

| Aspek | Temuan |
|---|---|
| Lokasi | Satu toko: **MANDIRI TANI**, Jl. Poros RAPP km 72, Bukit Kesuma, Pelalawan (Riau). iPOS punya 3 "kantor", hanya **UTM** yang dipakai |
| Pengguna & perangkat | 1 user (`ADMIN`) di 1 komputer untuk semua transaksi. Fitur shift tidak dipakai |
| Volume penjualan | 9.705 nota: **KSR** (kasir) 5.453, **JL** (faktur jual) 4.252. 2026: ~230–450 nota/bulan, **Rp 1,0–1,7 miliar/bulan** |
| Isi nota | Rata-rata **1,55 baris/nota**, maks 16. Tidak ada qty desimal |
| Komposisi omzet 12 bln | **Pupuk 89%**, Pestisida/racun 11%, Alat <1%, Bibit <1% |
| Barang terlaris | KCL Mahkota, NPK Mutiara 16-16-16, NPK 13.8.27 Mahkota, Dolomit, Urea, SS Merauke |
| Item | 416 item: RACUN 263, ALT 79, PUPUK 40, BIBIT 34. 266 item laku dalam 12 bulan |
| Satuan | PCS, LTR, BTL, GLN, PAIL, KG, ZAK, BOX, GRAM. **13 pupuk** satuan dasar **KG** + **ZAK = 50 KG** (ecer per kg: 1.699 baris jual) |
| Barcode | **Tidak ada satu pun** barcode terisi |
| Harga jual | Setting iPOS `HITUNG_HARGA_JUAL = Manual`. **65% baris jual memakai harga berbeda dari harga master saat ini**; 64 dari 124 item yang laku sejak Sep-2026 terjual dengan >1 harga (mis. Urea/ZAK 495rb–640rb). Harga **dinegosiasikan per transaksi** |
| Level harga & grosir | Tidak dipakai (semua level 2–6 dan tier jumlah = 0) |
| Grup pelanggan | General 1.057, **RAM 1** 69, **RAM 2** 50, Gold 31 (diskon 10%), Silver 29 (8%), Bronze 2 (6%) |
| KSR vs JL | KSR: 80% pelanggan UMUM. JL: 99% pelanggan bernama, **semua penjualan kredit lewat JL** |
| Kredit | 2.187 nota kredit; **485 nota tunai + kredit sekaligus**. Jatuh tempo default **10 hari**. Limit kredit **tidak pernah** diisi |
| Piutang terbuka (per 24-10-2026) | **308 nota, Rp 2,62 miliar, 165 pelanggan**, tertua Sep-2024 |
| Pelunasan piutang | 2.548 pembayaran, semua tunai; **294 pembayaran melunasi >1 nota** sekaligus |
| Biaya lain (ongkos angkut) | Ada di **1.522 nota** (Rp 25rb–600rb). April 2026: Rp 14,7 jt |
| Potongan | Hanya di level nota (281 nota), dipakai untuk **membulatkan total** (mis. 1.215.000 → 1.200.000). Tidak ada diskon per baris |
| Metode bayar | Tunai & kredit. **Transfer dicatat sebagai tunai** + keterangan "TF/TRANSFER" (±450 nota). Debit/e-money tidak dipakai. Bank terdaftar: BCA, Mandiri |
| Keterangan nota | Dipakai untuk status pengiriman: "DIANTAR", "DIAMBIL", "SUDAH", "LADANG", "DP", "ONGKOS" (1.075 nota) |
| Pembelian | 450 faktur **BL** langsung (tanpa PO, tanpa penerimaan terpisah). April 2026: Rp 1,32 miliar. 49 faktur kredit |
| Hutang supplier | Tabel pelunasan hutang **kosong** → sisa "hutang" Rp 3,13 miliar di iPOS **tidak bisa dipercaya** |
| Retur, rakitan, PO, deposit, transfer gudang | **Tidak pernah dipakai** |
| Kas keluar | 498 transaksi, Rp 847 jt: biaya ekspedisi, bongkar muat, BBM & perbaikan mobil, upah |
| Stok opname | 95 baris, per item ad-hoc (1–7 item per sesi) |
| Metode HPP | **FIFO** (`METHOD_HPP = FIFO`). Nilai persediaan (lapisan FIFO) **Rp 1,79 miliar**, `tbl_itemstok` = Σ lapisan untuk 366/366 item. Per item bisa beda (`tbl_item.hppsys`: 1 = FIFO 415 item, 2 = **LIFO 1 item**) — rincian urutan lapisan di §7 |
| Jual saat stok habis | Diizinkan (`JUAL_STOK_HABIS = 1`), tapi saat ini tidak ada stok minus |
| Akuntansi | iPOS membuat 50.435 baris jurnal otomatis — **tidak dimigrasi** (v1 tanpa buku besar) |

## 3. Masalah kualitas data (perlu dibersihkan saat migrasi)

| # | Masalah | Jumlah | Penanganan importer |
|---|---|---|---|
| DQ-1 | Item tanpa harga pokok master | 149 | HPP awal diambil dari lapisan FIFO, bukan `tbl_item.hargapokok` |
| DQ-2 | Item tanpa harga jual master | 76 | Impor tanpa harga; layar kasir meminta harga manual |
| DQ-3 | Baris jual iPOS tanpa HPP (keluar sebelum ada lapisan) | 1.319 (8,5%) | Histori laba untuk baris ini ditandai "HPP tidak diketahui" |
| DQ-4 | Nama pelanggan duplikat | 14 kelompok / 15 baris | Laporan duplikat → digabung manual oleh owner sesudah impor |
| DQ-5 | Kode pelanggan berupa nama (bukan `PLxxxx`) | 9; supplier 17 | Kode lama disimpan di `legacy_refs`; kode baru dibuat berurutan |
| DQ-6 | `tbl_item.stok` tidak sinkron | 338/416 beda | Abaikan; pakai `tbl_itemstok` |
| DQ-7 | Merek kosong, merek tertanam di nama (MAHKOTA, DAUN, MERAUKE, YARAMILA, DGW) | 416 | Opsional: saran merek dari nama, dikonfirmasi owner |
| DQ-8 | Konversi HPP tidak konsisten (ZA MAHKOTA: 5.000/kg × 50 = 250.000 ≠ 188.000/zak) | beberapa | Laporan selisih, owner memutuskan |
| DQ-9 | Pupuk "SP 36" bersatuan PCS | 1 | Dikonfirmasi owner (kemungkinan ZAK) |
| DQ-10 | Transfer tercatat sebagai tunai | ±450 | Tidak bisa diperbaiki retroaktif; sistem baru memisahkan metode Transfer |
| DQ-11 | Hutang supplier tanpa catatan pelunasan | 49 faktur | Saldo awal hutang **diinput manual** dari catatan owner |
| DQ-12 | Semua transaksi atas nama `ADMIN` | 100% | Sistem baru: login per orang |

## 4. Pemetaan iPOS → skema baru

| iPOS | Skema baru | Aturan |
|---|---|---|
| `tbl_kantor` (UTM) | `warehouses` (kode `UTM`, "Gudang Utama") | Hanya UTM |
| `tbl_itemjenis` | `categories` | RACUN → "Pestisida", ALT → "Alat Pertanian", PUPUK, BIBIT |
| `tbl_itemsatuan` | `units` | 11 satuan apa adanya (ZAK, bukan SAK) |
| `tbl_item` | `products` | `sku` = `kodeitem`, `name` = `namaitem`, `base_unit` = `satuan`, `min_stock` = `stokmin`, `tipe` 1 = STANDARD |
| `tbl_itemsatuanjml` | `product_units` | Tipe `D` = dasar (konversi 1), `K` = turunan (`jumlahkonv`) |
| `tbl_item.hargajual1` + `tbl_itemhj` (tipe S) | `product_prices` (grup NULL, min_qty 1) | Harga 0 tidak diimpor |
| `tbl_supelgrup` | `customer_groups` (+ `discount_percent`) | General → UMUM |
| `tbl_supel` PL / SU | `customers` / `suppliers` | `limitjmlhupi = 0` → `credit_limit NULL` (tanpa batas); termin 0 → 10 hari |
| `tbl_itemstok` + lapisan `tbl_item_im` | `stock_movements` **OPENING** + `stock_cost_layers` | Satu lapisan baru per baris `tbl_item_im` dengan `sisa > 0` (qty = sisa, harga = `hargadasar`, tanggal = `tanggal` asli) → FIFO berlanjut persis seperti di iPOS |
| `tbl_ikhd` + `tbl_ikdt` sisa kredit | `receivables` **OPENING** | Per nota: `jmlkredit − krd_jml_byr − krd_jml_pot` > 0 → 308 baris, nomor/tanggal/jatuh tempo asli |
| `tbl_ikhd`/`tbl_ikdt` (histori) | `sales`/`sale_items` `source = 'IPOS_IMPORT'` | **Diimpor** (D-14). Tanpa mutasi stok; HPP baris = Σ(`tbl_item_ik.jumlahdasar × hargadasar`) per baris |
| `tbl_imhd`/`tbl_imdt` (histori) | `purchase_invoices` `is_direct` | Diimpor; histori harga beli per supplier. Kredit → hanya yang dicentang Owner jadi `payables` (D-13) |
| `tbl_byrpiutanghd/dt` | `receivable_payments` + alokasi | Diimpor (histori) |
| `tbl_acckashd` KASO | `cash_transactions` | Diimpor; kategori dari kata kunci keterangan (EKSPEDISI, BONGKAR, MINYAK/MOBIL, UPAH, lain-lain) |
| `tbl_formatnotr` (kantor UTM) | `doc_sequences` | `last_no` per tipe untuk tahun berjalan = `nomor` iPOS (mis. JL 1788, KSR 2060 per 2026-10-24) → nota pertama sistem baru melanjutkan nomor iPOS (Q-16). `nomor` bisa **negatif** (RB −2, BH −1 — iPOS mengurangi counter saat nota dihapus) → disimpan sebagai `max(0, nomor)` |
| `tbl_conf` | `settings` | `DEF_JATUH_TEMPO` → `ar.default_term_days = 10`; `JUAL_STOK_HABIS` → `stock.allow_negative` |
| `tbl_user`, jurnal, log aktivitas, opname lama | — | **Tidak dimigrasi** |

Setiap baris hasil impor dicatat di `legacy_refs (system='IPOS5', entity, legacy_key, entity_id)`
dan setiap proses impor di `import_batches` (nama file, SHA-256, ringkasan, pelaku).

## 5. Cara membaca file `.i5bu`

> File di `.claude/file/` adalah **data pengembangan**. Saat go-live yang
> diimpor adalah backup iPOS **terbaru** — prosedurnya di
> [`plan/sprint-14-go-live-migrasi.md`](../../plan/sprint-14-go-live-migrasi.md).

1. **Produksi (importer FR-MIG):** aplikasi sudah membawa binaries PostgreSQL
   portable → `pg_restore --no-owner --no-privileges --dbname=ipos_import`
   ke database sementara di cluster yang sama, transformasi dengan SQL
   (`INSERT … SELECT` + `legacy_refs`) di dalam **satu transaksi**, lalu
   `DROP DATABASE ipos_import`. `pg_restore` versi baru membaca arsip 1.12
   (pg_dump 9.5). **Verifikasi Sprint 3.**
2. **Cadangan:** format custom terdokumentasi (header → TOC → blok data
   zlib berisi teks `COPY`). Analisis ini memakai parser Python stdlib
   sendiri tanpa PostgreSQL — artinya importer tetap mungkin walau
   `pg_restore` gagal pada objek tertentu (fungsi/trigger iPOS lama).
3. Importer **hanya membaca** file sumber; file `.i5bu` dihitung SHA-256-nya
   dan tidak pernah diunggah ke mana pun.

## 6. Keputusan desain yang lahir dari data

| # | Keputusan | Dasar |
|---|---|---|
| D-1 | Dua mode penjualan: **Kasir** (KSR, cepat, UMUM, tunai) dan **Faktur Penjualan** (JL, pelanggan wajib, kredit, ongkos angkut, pengiriman) | 56% / 44% transaksi; seluruh kredit lewat JL |
| D-2 | **Ubah harga di baris adalah alur normal**, bukan pengecualian: kasir boleh, otorisasi hanya bila di bawah HPP. Tampilkan **harga terakhir ke pelanggan ini** | 65% baris memakai harga di luar master |
| D-3 | Barcode opsional; pencarian nama/kode cepat adalah jalur utama | 0 barcode terisi |
| D-4 | **Biaya lain / ongkos angkut** di header nota (masuk total, tercetak) | 1.522 nota |
| D-5 | **Terjual-belum-diambil**: stok fisik gudang **baru berkurang saat barang diambil**; sampai itu barang dikunci sebagai *Dipesan* (tersedia = fisik − dipesan); riwayat pengambilan per bukti `AB` (keputusan owner — iPOS tidak bisa) | Sheet DAFTAR PUPUK + keterangan "DIAMBIL/DIANTAR"; `plan/sprint-7-pengambilan-barang.md` |
| D-6 | Metode **Transfer** per rekening (BCA, Mandiri) terpisah dari Tunai | DQ-10 |
| D-7 | Limit kredit opsional (`NULL` = tanpa batas); termin default 10 hari | Setting & data iPOS |
| D-8 | Penomoran memakai kode tipe yang sudah dikenal toko: **KSR, JL, BL, BP**, … | Laporan iPOS |
| D-9 | Fitur yang tidak pernah dipakai turun prioritas: split bill, bundling, rakitan, PO, PPN, mutasi gudang, level harga | §2 |
| D-10 | ~~Modul RAM sawit~~ — **dibatalkan**: file tonase di luar konteks; "RAM 1/RAM 2" diimpor sebagai grup pelanggan biasa | Keputusan owner 2026-10-24 |
| D-11 | HPP **FIFO seperti iPOS** (keputusan owner); saldo awal = salinan lapisan FIFO iPOS (`tbl_item_im` sisa > 0) sehingga nilai persediaan sama persis (Rp 1,79 M) | iPOS `METHOD_HPP = FIFO` |
| D-12 | Dua role v1: **KASIR** & **OWNER**; aksi sensitif kasir lewat PIN Owner | Keputusan owner; iPOS hanya 1 akun ADMIN |
| D-13 | Hutang supplier: Owner **mencentang** dari 49 faktur kredit iPOS mana yang belum lunas (25 di antaranya dari Nov–Des 2025, kemungkinan besar sudah dibayar di luar iPOS) | DQ-11 |
| D-14 | Histori 2 tahun **diimpor** | Keputusan owner |

## 7. Cara kerja iPOS dari aplikasinya (reverse engineering, 2026-10-28)

Dicek dengan [rea](https://github.com/morluto/rea) pada iPOS 5.0.7 yang
terpasang (`C:\Program Files (x86)\Inspirasibiz\iPos 5.0 Profesional`).

**Program tidak bisa dibaca langsung.** `iPos5p.exe` adalah .NET Framework 4
(1.031 kelas, 16.942 method), tetapi diobfuscate: nama kelas/method/resource
diacak dan string (termasuk SQL) dienkripsi. `update/*.i5up` (skrip upgrade
DB) juga terenkripsi. Proteksi itu **sengaja tidak dibongkar**. Sumber yang
dipakai: struktur & tabel konfigurasi di backup `.i5bu`, manual resmi
`Help_iPos5.chm`, template cetak `Report/**/*.repx|*.fr3` (hanya binding
kolom, tanpa SQL). Backup memuat 6 trigger (mis. `trg_update_hpp` pada
`tbl_item_im.hargadasar`, `*_update_notrs`) tetapi **tanpa isi fungsinya**.

**Penomoran** (`tbl_formatnotr`, cocok dengan `numbering.ts`): slot
`[CNT] / tipe / [DEPT] / [BLNTHN]`, `resetid = YY` (reset tahunan), 7 digit
untuk JL/KSR/BL, 4 digit sisanya. Kas masuk memakai kode `KSIN`.

**HPP FIFO** — diuji pada salinan sementara tabel stok saja (1.138 lapisan
`tbl_item_im`, 15.513 baris keluar `tbl_item_ik`):

| Hal | Temuan |
|---|---|
| Sumber lapisan | `BL` pembelian 835, `SA` saldo awal 264, `OP` opname lebih 39 |
| Pemakai lapisan | `KSR` 8.148 baris, `JL` 7.294, `OP` opname kurang 71 |
| Urutan lapisan | Menurut **tanggal dokumen** lapisan (`tbl_item_im.tanggal`). Tidak ada baris keluar yang memakai lapisan bertanggal sesudah penjualannya; baris jual yang memakai beberapa lapisan selalu tertua dulu (418/418). Sama dengan `stock_cost_layers ORDER BY received_at, id` |
| Harga keluar | Selalu = harga lapisan (`hargadasar`), tanpa rata-rata |
| Konsistensi | `sisa = masuk − keluar` di semua lapisan; `keluar` = Σ baris keluar per lapisan; tidak ada lapisan atau saldo minus **pada saat backup** (baris jual tanpa lapisan dari masa lalu: DQ-3) |
| Penghitungan ulang mundur | **Tidak.** 806 baris keluar (47 item) memakai lapisan lebih tua sesudah lapisan lebih baru terpakai — pembelian bertanggal mundur dipakai penjualan berikutnya, penjualan lama tidak dialokasikan ulang (sesuai PRD §6.6) |
| Lapisan bertanggal sama | 13 kasus; urutan pemecah seri iPOS **belum diketahui** (dampak kecil) |
| `tgl_trs` | **Bukan** waktu input (lapisan SA bertanggal 2024-09-01 punya `tgl_trs` s/d 2026) — jangan dipakai importer |
| Item LIFO | 1 item `hppsys = 2`, lapisannya memang habis dari yang terbaru. Sistem baru FIFO saja → HPP jual item itu sesudah go-live bisa beda dari iPOS (Q-RE-1) |

**Setelan HPP pembelian** (`tbl_conf`): `TRS_IM_BIAYA_HPP = 0` (biaya/ongkos
nota beli **tidak** masuk HPP), `TRS_IM_POT_HPP = 0` (potongan nota beli
**tidak** mengurangi HPP), `PJKPPN_TO_HPP = 1` (PPN masukan masuk HPP;
iPOS toko tidak memakai PPN). Dampak ke modul pembelian: PRD §6.6 (Q-RE-2).

**Penjualan** (manual iPOS): *Penjualan* (JL) = backoffice, harga bisa
ditawar, cetak kertas besar; *Kasir* (KSR) = cepat, struk kecil, F5 pending /
F6 daftar pending, bayar kombinasi tunai/kartu/kredit. "Harga jual < harga
pokok" hanya konfirmasi (setting). Laporan laba iPOS memakai kolom `total`,
`pokok`, `laba`, `proclaba`, `procgpm`.

| # | Pertanyaan ke owner |
|---|---|
| Q-RE-1 | Satu item ber-HPP LIFO di iPOS — sengaja? Di sistem baru otomatis FIFO |
| Q-RE-2 | Tetap seperti iPOS: ongkos & potongan nota beli tidak mengubah HPP? |

Yang belum terjawab dan butuh pengamatan langsung (log SQL di server
PostgreSQL iPOS saat transaksi uji): urutan pemecah seri lapisan bertanggal
sama, isi fungsi trigger iPOS. Ditunda sampai benar-benar dibutuhkan (S7/S8).
