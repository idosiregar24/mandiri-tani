# Sprint 10 — Laporan Owner, Buku Kas & Impor Histori iPOS

> Milestone **M4 Laporan**. Requirement: PRD §5.6 (FR-FIN-01…12), FR-PKP-08, 12, 13,
> FR-MIG-02 (lingkup **Histori**), FR-MIG-03/04. Aturan: `rules/backend-standards.md`,
> `rules/database-standards.md` §7 (laporan = SQL), `rules/security-standards.md` §2
> (HPP/laba hanya `cost.read`), `rules/design-standards.md` §0.

**Dikerjakan sebelum sisa S2** (owner 2026-10-30: "s10"). Akibatnya: tes memakai sesi
login yang sudah ada (S2 B), user KASIR dibuat langsung lewat repo di tes; halaman
Pengguna belum ada.

**Ringkasan status (2026-10-30):** 23/24 item · **262 tes** hijau. Buku kas, 9 laporan (layar + Excel + Cetak/PDF), dashboard, impor histori 2 tahun (backup asli cocok 1:1). **Sisa:** uji manual owner di aplikasi (F2).

## Bahan dari data toko (backup iPOS 2026-10-24, angka agregat)

| Hal | Angka | Akibat |
|---|---|---|
| Nota jual | 9.705 (KSR 5.453, JL 4.252), ±1,55 baris/nota, Rp 1,0–1,7 M/bulan | Laporan langsung punya riwayat 2 tahun bila histori diimpor |
| HPP per baris jual | `tbl_item_ik` (15.513 baris keluar); **1.319 baris (8,5%) tanpa HPP** (DQ-3) | Laba ditandai "HPP tidak diketahui" untuk baris itu, tidak dihitung sebagai laba 100% |
| Faktur beli | 450 BL langsung | Laporan Pembelian Detail & riwayat harga beli per supplier |
| Kas keluar | 498 transaksi `KASO`, Rp 847 jt (ekspedisi, bongkar, BBM/mobil, upah) | Biaya operasional di Laba Rugi bulan-bulan lama |
| Ongkos angkut | 1.522 nota | Baris sendiri "Pendapatan ongkos angkut" di Laba Rugi, bukan bagian laba barang |
| Komposisi omzet | Pupuk 89% | Rekap harian pupuk (pengganti sheet "DATA PENGELUARAN PUPUK") |

## Keputusan sprint ini

| # | Keputusan | Alasan |
|---|---|---|
| S10-1 | Modul **`reports`** hanya baca. Semua angka dihitung SQL (`GROUP BY`, window function) dalam transaksi `READ ONLY` dengan `SET LOCAL statement_timeout = '60s'` | database §1, §7 |
| S10-2 | Periode = `from`/`to` tanggal `YYYY-MM-DD` **WIB**, inklusif, maks 2 tahun; tanggal bisnis = `(trx_at AT TIME ZONE 'Asia/Jakarta')::date` | backend §5 |
| S10-3 | Penjualan yang dihitung: `status = 'COMPLETED'` dan `source IN ('APP','SYNC','IPOS_IMPORT')`. **`OPENING_PICKUP` tidak pernah masuk omzet/laba** (omzetnya sudah di iPOS). Retur (`sale_returns`) mengurangi pada **tanggal retur** | FR-FIN-04, FR-PKP-14 |
| S10-4 | **Laba kotor** = `net_amount` − HPP. HPP baris = `cost_total` bagian yang sudah keluar gudang + **estimasi** untuk sisa belum diambil (HPP lapisan FIFO saat ini) → ditandai `estimasi`. `cost_per_base` NULL (histori DQ-3) → "HPP tidak diketahui": omzetnya tampil, laba & margin baris itu kosong, jumlahnya disebut di bawah tabel | FR-FIN-04/05, FR-PKP-13 |
| S10-5 | **Ongkos angkut** (`other_charges`) bukan laba barang: tampil terpisah di Laba Rugi sebagai pendapatan; biaya ekspedisi masuk dari Buku Kas (OPEX) | FR-FIN-06, data iPOS |
| S10-6 | Hak akses: **Owner** semua laporan. **Kasir** (`reports.sales`) hanya "Penjualan saya hari ini" (nota yang ia buat, tanpa HPP) — tidak ada shift (S6-1). Field HPP/laba/nilai persediaan **dibuang di server** untuk role tanpa `cost.read` | PRD §4.2, security §2 |
| S10-7 | **Buku kas manual** (modul `cash`): Kas Masuk `KSIN` / Kas Keluar `KASO` (kode iPOS, 4 digit) dan **Setor/Pindah kas** `TRF` (dua baris OUT+IN dalam satu transaksi). Kasir hanya akun LACI; Owner semua akun. Tidak ada ubah/hapus — salah input dikoreksi dengan transaksi kebalikan. Kategori OPEX boleh ditambah Owner (`cash_categories`, `is_operating_expense`) | FR-FIN-01/02, ledger append-only |
| S10-8 | **Arus kas** per akun: saldo awal (Σ sebelum `from`), masuk & keluar per kategori, saldo akhir. Saldo awal kas toko saat go-live = Kas Masuk kategori Modal Owner. Periode sebelum transaksi aplikasi pertama → `Notice`: "Sebelum go-live hanya kas keluar dari iPOS yang tercatat" | FR-FIN-03, jawaban owner 2026-10-30 |
| S10-9 | **Ekspor**: Excel lewat `?format=xlsx` di endpoint yang sama (paket `exceljs`, tanpa internet, angka sebagai sel angka berformat id-ID). **Cetak** = tampilan cetak A4 (`@media print`) + `window.print()` (dialog OS — pengecualian FR-FIN-10). **PDF** = `window.pos.saveReportPdf()` (Electron `printToPDF` + dialog simpan), bukan `?format=pdf` di server | FR-FIN-10; tanpa pustaka PDF di server — catat di Penyimpangan |
| S10-10 | **Impor histori iPOS** (lingkup `history`, butuh `master`; ditolak bila sudah pernah): nota KSR/JL → `sales` `source = IPOS_IMPORT`, nomor/tanggal/keterangan asli, **tanpa** mutasi stok, **tanpa** kas, **tanpa** piutang (piutang terbuka sudah dari lingkup `receivables`). Baris: harga & potongan asli, potongan nota dialokasikan *largest remainder*, HPP = Σ `tbl_item_ik.jumlahdasar × hargadasar` per baris (NULL bila tidak ada). Faktur BL → `goods_receipts` (`INVOICED`) + baris + `purchase_invoices` `is_direct`, tanpa stok/lapisan/hutang. `KASO` → `cash_transactions` `MANUAL` OUT dari Kas Toko, kategori dari kata kunci keterangan. `cashier_id`/`created_by` = user yang mengimpor; perangkat = K01. Satu transaksi; `legacy_refs` per dokumen; rekonsiliasi jumlah & total per bulan per tipe vs iPOS | FR-MIG-02/03/04, D-14, jawaban owner 2026-10-30 |
| S10-11 | **Histori pelunasan piutang (BP) tidak diimpor** di sprint ini — menyusul bersama Kartu Piutang (FR-ARAP-07). Piutang terbuka tetap = iPOS (S9) | Jawaban owner 2026-10-30: 308 piutang S9 bernilai sisa; histori BP butuh piutang "lunas" untuk ±1.900 nota |
| S10-12 | **Rekap harian pupuk** dari `stock_movements` (stok fisik): baris = tanggal, kolom = barang (kategori dipilih, default PUPUK), isi = keluar dipisah **ZAK** dan **KG ecer** (satuan baris nota), plus masuk (pembelian/penyesuaian), saldo awal & akhir. Berlaku sejak stok awal impor — periode histori tidak punya mutasi | FR-FIN-11 |
| S10-13 | **Dashboard** di Beranda: Owner = omzet & laba hari ini / bulan ini vs periode yang sama sebelumnya, 10 barang terlaris 30 hari, stok menipis, piutang jatuh tempo, barang belum diambil lewat janji / > 30 hari. Kasir = penjualan saya hari ini. Tanpa grafik di sprint ini (angka + tabel; design §0) | FR-FIN-09, FR-PKP-12 |

## A. Fondasi

- [x] **A1** Paket `exceljs` (versi dipin, dicatat di README); `src/server/lib/xlsx.ts` (`buildReportXlsx({ title, period, columns, rows, totals })` → Buffer; kolom uang/qty sebagai angka, judul + periode di atas) + tes
  - 📌 exceljs **4.4.0** (dipin; `uuid` bawaannya di-override ke 11.1.1 → `npm audit` 0). `lib/xlsx.ts` + 1 tes (baca ulang file: angka, persen, tanggal, total, catatan)
- [x] **A2** Skema bersama `src/shared/schemas/reports.ts` (`ReportPeriod`, query & baris tiap laporan) dan `cash.ts` (`CashEntryInput`, `CashTransferInput`, `CashCategoryInput`)
  - 📌 `reports.ts` (periode maks 2 tahun, query & tipe 9 laporan) dan `cash.ts`
- [x] **A3** `modules/reports` kerangka: `withReport(pool, fn)` (READ ONLY + 60 dtk), periode WIB, pembuang field HPP per role, `sendReport(res, report, format)` (JSON atau xlsx); migrasi `0007_reports.sql` **hanya bila** `EXPLAIN ANALYZE` butuh index (mis. `cash_transactions (trx_at)`) — file skema ikut diperbarui
  - 📌 `reports/common.ts`: `withReport` (READ ONLY + 60 dtk), `inPeriod` (rentang timestamptz WIB agar index terpakai), `COUNTED_SALE`, `sendReport` (JSON/xlsx). Belum perlu migrasi — dicek ulang saat `EXPLAIN` (C9)

## B. Buku kas

- [x] **B1** `modules/cash`: `POST /cash-transactions` (KSIN/KASO), `POST /cash-transfers` (TRF), `GET /cash-transactions?accountId=&from=&to=&cursor=`, `GET /cash-accounts` (saldo), `GET/POST/PUT /cash-categories` (Owner, kategori sistem tidak bisa diubah); audit; tanpa Idempotency-Key (skema `cash_transactions` tidak punya `client_op_id` → tombol nonaktif selama menyimpan, seperti S9-3)
  - 📌 `modules/cash`: `GET /cash/balances`, `GET/POST /cash-transactions`, `POST /cash-transfers`, `GET/POST/PUT /cash-categories`. Kategori otomatis (Penjualan, Pelunasan, dst.) ditolak untuk input manual; Modal & Prive boleh. Owner boleh mencatat tanggal lampau, kasir hanya hari ini & LACI. TRF: satu nomor di baris keluar, baris masuk menyebut nomornya
- [x] **B2** Tes: nomor KSIN/KASO/TRF, saldo per akun, kasir hanya LACI (403 akun lain), kategori arah salah ditolak, ledger tidak bisa diubah
  - 📌 `cash/routes.test.ts` 5 tes: nomor KSIN/KASO/TRF, saldo, kasir LACI saja (403), tanggal, arah kategori, ledger ditolak diubah, kategori baru `OPEX_PARKIR_RETRIBUSI`

## C. Laporan (server)

- [x] **C1** `GET /reports/sales` — **Penjualan Rekap ala iPOS** (No Transaksi, Tanggal, Kode Pel., Jml Item, Sub Total, Pot., Pajak, Biaya Lain, Total Akhir, Bayar Tunai, Bayar Kredit) + `groupBy=day|customer|category|payment_method` (FR-FIN-07/12); kasir = nota sendiri hari ini
  - 📌 Kasir: tanggal dipaksa hari ini & hanya nota buatannya. Cara bayar: tunai dikurangi kembalian, kredit dari `credit_amount`
- [x] **C2** `GET /reports/profit-by-item`, `/profit-by-invoice`, `/profit-loss` (FR-FIN-04/05/06; S10-4, S10-5) — hanya `reports.profit`
  - 📌 HPP baris = `cost_total` + sisa belum diambil × HPP FIFO rata-rata sekarang (estimasi); baris tanpa HPP tidak masuk laba. Retur: nilai mengurangi penjualan, HPP kembali = mutasi `SALE_RETURN`. Per nota: retur dihitung kapan pun terjadinya
- [x] **C3** `GET /reports/cashflow` (FR-FIN-03; S10-8) — hanya `reports.cashflow`
  - 📌 Saldo awal = Σ sebelum `from`; `beforeGoLive` hanya bila ada kas impor iPOS dan belum ada nota aplikasi sebelum `from`
- [x] **C4** `GET /reports/purchases` — **Pembelian Detail ala iPOS** (per faktur + baris: barang, qty, satuan, harga, potongan, total) (FR-FIN-12)
  - 📌 Kredit = `payables.amount` faktur itu; faktur batal tampil tapi tidak dijumlah
- [x] **C5** `GET /reports/daily-fertilizer?categoryId=&from=&to=` (FR-FIN-11; S10-12)
  - 📌 Kategori default = nama diawali PUPUK. Satuan keluar dari baris nota (SALE/VOID → `sale_items`, AB/batal AB → `sale_pickup_items`); semua hari di periode ditampilkan; Excel menghitung sisa harian
- [x] **C6** `GET /reports/undelivered` (per pelanggan / per barang: qty, nilai, umur, lewat janji) & `GET /reports/pickups` (riwayat AB per periode/pelanggan/barang, termasuk yang dibatalkan) (FR-PKP-08, 13)
  - 📌 Nota saldo awal belum diambil (`OPENING_PICKUP`) ikut dihitung di sini (barangnya nyata menunggu)
- [x] **C7** `GET /reports/stock` — posisi & nilai persediaan per kategori, stok menipis, stok minus, **barang tidak laku N hari** (FR-FIN-08; memakai data S4)
  - 📌 Total & hitungan menipis/minus dari `stockSummary` S4 (angka sama dengan halaman Stok)
- [x] **C8** `GET /reports/dashboard` (S10-13)
  - 📌 Owner: omzet = Σ total nota, laba = laba kotor laporan Laba Rugi (angka sama). Bulan lalu = tanggal yang sama, dipotong ke akhir bulan
- [x] **C9** Tes: setiap laporan Owner 200 + Kasir 403 (kecuali C1/C8 versi kasir), respons kasir tanpa field HPP/laba, `OPENING_PICKUP` & VOIDED tidak terhitung, retur mengurangi, HPP estimasi & tidak diketahui, xlsx terbaca ulang; `EXPLAIN ANALYZE` laporan utama dengan ±10.000 nota uji dicatat
  - 📌 `EXPLAIN ANALYZE` dengan data asli (9.705 nota, 15.039 baris, lewat `test/real-backup.test.ts`): semua laporan ≤ 0,25 dtk, laba per nota 10 bulan 0,19 dtk. Laporan Persediaan sempat 2,6 dtk (statistik basi sesudah impor massal → nested loop) → CTE `MATERIALIZED` + importer menjalankan `ANALYZE` → 60 ms. Tidak perlu migrasi index

## D. Impor histori iPOS

- [x] **D1** Sidik struktur `HISTORY_FINGERPRINT` (`tbl_ikhd`, `tbl_ikdt`, `tbl_item_ik`, `tbl_imhd`, `tbl_imdt`, `tbl_acckashd`) + rencana transformasi murni `ipos-history-plan.ts` (alokasi potongan, HPP per baris, kategori kas dari kata kunci, catatan DQ) + tes unit
  - 📌 `HISTORY_FINGERPRINT` + `loadHistoryRows` (ANALYZE dulu — hasil restore belum punya statistik) + `ipos-history-plan.ts` murni (2 tes unit). Aturan dari data asli: total = subtotal − potnomfaktur + biayalain; `jmltunai` termasuk kembalian; HPP baris dari `tbl_item_ik`, lapisan berharga 0 = DQ-3; satuan yang sudah dihapus dari barang → satuan dasar, kode asli tetap di baris; kas keluar per baris detail, kategori dari kata kunci
- [x] **D2** `POST /imports/ipos/history/inspect|commit` (S10-10): satu transaksi, insert massal, `legacy_refs` (`sale`, `purchase_invoice`, `cash_transaction`), `import_batches.scope = ['history']`, nomor bentrok / pelanggan atau barang tak dikenal → catatan (tidak gagal total); reset persiapan ikut menghapus
  - 📌 `history-import.ts` + `history-repo.ts` (insert massal `unnest`, 1.000 baris/perintah). Pelanggan tak dikenal → Umum (omzet tetap masuk); nomor bentrok / barang tak dikenal → dilewati + catatan. Faktur beli: `goods_receipts` INVOICED + `purchase_invoices is_direct`, tanpa stok/lapisan/hutang. **Batasan:** pembagian tunai/kredit faktur beli lama tidak tersimpan (skema tidak punya kolomnya) → "Bayar Kredit" histori pembelian = 0
- [x] **D3** Fixture `ipos-mini.sql` ditambah nota KSR/JL (dengan & tanpa HPP), BL, KASO; tes impor + rekonsiliasi + ditolak bila diulang
  - 📌 Fixture ditambah kolom histori, `tbl_item_ik`, `tbl_acckashd/dt` (20 tabel). `history-import.test.ts` 4 tes: butuh master, KASIR 403, pratinjau + catatan, rekonsiliasi, tanpa stok/piutang/hutang/kas otomatis, alokasi potongan, kembalian, ditolak bila diulang, laporan terisi
- [x] **D4** Jalankan dengan backup asli (lokal): jumlah nota, Σ total akhir per bulan, Σ HPP vs iPOS — dicatat **agregat saja** di 📌
  - 📌 Backup asli (agregat): KSR 5.453 nota Rp 2.813.957.000 · JL 4.252 nota Rp 26.608.283.000 · HPP diketahui Rp 23.119.861.326 · 1.307 baris tanpa HPP · 0 bulan selisih · BL 450 faktur Rp 24.396.531.600 · KASO 498 dok Rp 847.317.000 — **semua cocok**. Catatan: 214 baris satuan sudah dihapus, 4 nota bayar kurang dari total, 34 kas keluar tanpa kata kunci. Impor 5,7 dtk

## E. Layar

- [x] **E1** `/laporan`: daftar kartu laporan per grup (Penjualan, Laba, Kas, Pembelian, Persediaan, Pengambilan) — hanya yang boleh dilihat role; komponen `ReportLayout` (judul, pilih periode cepat "Hari ini · Bulan ini · Bulan lalu · Pilih tanggal", tombol **Cetak**, **PDF**, **Excel**) + gaya cetak A4; label "Segera" di menu dihapus
  - 📌 `/laporan` (kartu per kelompok, disaring role — kasir hanya Penjualan) + `features/reports/ReportLayout.tsx` (Hari ini · Bulan ini · Bulan lalu · Tahun ini · Pilih tanggal; Cetak `window.print()` A4 dengan `@page` portrait/landscape; Simpan PDF; Excel lewat `apiDownload`). AppShell diberi varian `print:` (sidebar & bar atas hilang saat cetak). Menu "Laporan" aktif + "Buku Kas"
- [x] **E2** Halaman laporan C1–C7 (`DataTable`, baris total di bawah, angka `tabular-nums` rata kanan, keterangan HPP estimasi/tidak diketahui)
  - 📌 7 halaman lazy (`/laporan/penjualan|laba|arus-kas|pembelian|pupuk|pengambilan|persediaan`), chunk 4–11 kB. Baris > 500 dipotong di layar ("Tampilkan semua"; Excel selalu lengkap). Barang yang seluruh penjualannya tanpa HPP tampil "HPP tidak ada", bukan Rp 0. Penjualan per nota di layar tanpa kolom Jml Item & Sub Total agar muat 1366 px (Excel berisi semua kolom iPOS)
- [x] **E3** `/kas` (Owner; kasir lewat tombol di kasir untuk LACI): saldo per akun (`StatCard`), daftar transaksi, dialog **Kas Masuk**, **Kas Keluar**, **Setor/Pindah Kas**, kelola kategori biaya
  - 📌 `/kas`: saldo per akun, buku kas berhalaman, dialog Kas Masuk / Kas Keluar (pilihan akun & kategori berupa chip, tanggal lampau hanya Owner), Setor/Pindah Kas & Kategori biaya (Owner). Kasir hanya melihat Laci Kasir
- [x] **E4** Beranda: dashboard Owner / kasir (S10-13)
  - 📌 `features/reports/Dashboard.tsx` di Beranda: Owner = omzet & laba kotor hari ini / bulan ini dengan ▲▼% vs kemarin / bulan lalu s.d. tanggal sama, 10 terlaris 30 hari, kartu perhatian (stok menipis, piutang lewat jatuh tempo, barang belum diambil). Kasir = penjualan sendiri
- [x] **E5** Bridge `window.pos.saveReportPdf()` → kanal `pos:report:save-pdf` (validasi sender + payload Zod, `printToPDF` A4, dialog simpan); tanpa desktop → tombol PDF disembunyikan
  - 📌 IPC `pos:report:save-pdf` (sender dicek, payload Zod `SavePdfRequest` di `@shared/printing` — preload tetap hanya `require("electron")`), dialog simpan asli, `printToPDF` A4. Tombol PDF tidak tampil di luar desktop
- [x] **E6** Impor iPOS: langkah **"Histori 2 tahun"** (pratinjau jumlah per tipe & bulan, catatan data, rekonsiliasi)
  - 📌 Langkah 7 "Impor histori 2 tahun" (angka iPOS per jenis, catatan data, tombol impor) + rekonsiliasi langkah 8; baris "Histori 2 tahun" di status lingkup; salinan iPOS sementara dihapus setelah piutang **dan** histori selesai

- [x] **E7** Cetak Laporan Penjualan **format iPOS 5** (permintaan owner 2026-11-10: "cetak laporan penjualan belum sama dengan iPOS")
  - 📌 **Reverse engineering** (tanpa membuka proteksi iPOS): katalog laporan dari `rep5.conf` (SQLite, `tbl_laporan`: 187 laporan, menu `LAP_JL` = 10 jenis), tata letak dari `Report/LapPenjualan/*.repx` (kode C# serialisasi DevExpress 10.1/12.1 — band, posisi 1/10 mm, font, binding, skrip `BeforePrint` di resource base64), form filter dari `Help_iPos5.chm` (laporanpenjualan1.htm), hasil cetak dibandingkan dengan PDF asli "Laporan Penjualan Bulan April 2026" (15 hal. A4 mendatar)
  - 📌 **Form cetak** (tombol Cetak di Laporan Penjualan → `SalesPrintDialog`): Periode s/d, No Transaksi s/d, Pelanggan (kode) s/d, Gudang, User, Modul (Semua · Penjualan JL · Kasir KSR) + daftar jenis: **Penjualan Rekap**, **Penjualan Detail**, **Penjualan Harian**, **Jual Per Pelanggan Detail**, **Jual Per Pelanggan Rekap**, **Jual Per Retur**; tombol **Pratinjau** · **Cetak** · **Excel**. Kasir: hanya penjualannya hari ini (sama dengan S10-6)
  - 📌 **Pratinjau** (`features/reports/print/ReportPreview`) = jendela Preview iPOS: halaman kertas asli (Report Header di hal. 1, judul kolom bergaris ganda + footer "tgl jam · USER · n/m" tiap halaman, total keseluruhan boleh berlanjut ke halaman berikut), kertas A4/F4/Letter, tegak/mendatar, zoom, navigasi halaman, **Cetak** (dialog Windows: printer, salinan, halaman), **Simpan PDF** (ukuran kertas persis), **Excel**. Angka `{0:n}` id-ID (`1.200.000,00`), tanggal `dd/MM/yyyy`, Arial, margin 3,8 mm — sama dengan template
  - 📌 Server `GET /reports/sales/print?type=…` (+ `?format=xlsx`) dan `GET /reports/filter-options` (Owner). Tes: 6 tes integrasi (semua jenis, filter, kasir tanpa field HPP, Excel) + tes unit format/paginasi
  - 📌 **Tidak diikutkan:** laporan per Sales (toko tidak punya data salesman), Rekap Per Gudang (satu gudang), filter Pajak, tombol Disain/Buat Baru/Hapus (desainer laporan DevExpress). Kolom iPOS yang tidak terisi di toko ini tetap dicetak seperti iPOS: Dept. kosong, K.Debit/K.Kredit 0,00. Kekeliruan template iPOS "Jual Per Retur" (label Potongan/Pajak tertukar) **tidak** ditiru

## F. Penutup

- [x] **F1** `npm run typecheck && npm run lint && npm test` hijau; README (status S10, versi `exceljs`, penyimpangan S10-9/S10-11) & PRD (FR-MIG-02 BP ditunda) diperbarui
  - 📌 typecheck/lint/test hijau (**262 tes**, 1 dilewati = tes backup asli lokal); build bersih. README (versi exceljs, penyimpangan S10) & PRD (FR-MIG-02 BP ditunda, FR-FIN-10 PDF, Lampiran A) diperbarui. **Uji tampilan otomatis**: build renderer dibuka di Edge (Playwright, data sintetis) — 13 layar tanpa error konsol; 2 masalah tampilan ditemukan & diperbaiki
- [ ] **F2** Uji manual di aplikasi: impor histori dari backup asli → Penjualan Rekap bulan lalu cocok dengan laporan iPOS → Laba per barang → Kas Keluar → Arus Kas → Excel & PDF terbuka
  - 📌 **Menunggu owner** (butuh login di aplikasi asli): impor histori dari backup asli lewat halaman Impor iPOS, bandingkan Penjualan Rekap satu bulan dengan laporan iPOS, coba Kas Keluar, Cetak/PDF/Excel

**Definition of Done:** total Penjualan Rekap per bulan hasil impor = iPOS; laba kotor
tidak pernah menghitung baris tanpa HPP sebagai laba penuh; kasir tidak menerima satu
pun field HPP/laba; semua laporan bisa dicetak A4 dan diekspor Excel.
