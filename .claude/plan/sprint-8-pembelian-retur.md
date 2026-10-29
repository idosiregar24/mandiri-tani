# Sprint 8 — Pembelian Langsung (BL), Riwayat Harga Beli, Retur Beli & Retur Jual

> Milestone **M3 Pembelian & AR/AP**. Requirement: PRD §5.4 (FR-PUR-02…07), FR-POS-17 (retur
> jual), §6.6 (HPP). Aturan: skill `stock-movement`. Lanjutannya: Sprint 9 (pelunasan
> hutang/piutang).

**Ringkasan status (2026-10-29):** 10/11 item · **220 tes** hijau. Sisa: harga beli terakhir di pencarian barang (A3).

## Cara toko membeli di iPOS (backup 2026-10-24, `tbl_imhd/tbl_imdt`, angka agregat)

| Temuan | Angka | Akibat |
|---|---|---|
| Faktur pembelian | 450 BL langsung, **0 dari PO** | Hanya faktur langsung (FR-PUR-04); PO + penerimaan terpisah (FR-PUR-01/02/03, S) **tidak dibangun** |
| Baris per faktur | rata-rata 1,86, maks 15; ZAK 351 / KG 15; qty desimal 0 | Formulir pendek, satuan default ZAK |
| Potongan / ongkos / PPN | **0 / 0 / 0** | Kolom ada di "Detail lain" (terlipat); Q-RE-2 tidak berdampak pada data toko |
| Kredit | 49 faktur (11%), tidak pernah campur tunai+kredit; termin ±9–10 hari | Pilihan **Tunai / Kredit**; jatuh tempo default = termin supplier |
| No. faktur supplier | ditulis di keterangan (47 faktur) | Kolom khusus "No. faktur supplier" |
| Supplier | 36 dipakai | Pilih supplier dengan pencarian |

## Keputusan sprint ini

| # | Keputusan | Alasan |
|---|---|---|
| S8-1 | Satu langkah = `goods_receipts` (POSTED→INVOICED) + `purchase_invoices` (`is_direct`) + stok `PURCHASE_RECEIPT` + kas / hutang dalam **satu transaksi**. Nomor **`BL`** (`0000177/BL/UTM/1026`, melanjutkan iPOS) | D-8; FR-PUR-04 |
| S8-2 | HPP lapisan = (total baris **+ alokasi ongkos bila dicentang**) / qty dasar; potongan nota **tidak** mengurangi HPP (default iPOS, Q-RE-2 — toko tidak pernah memakainya) | PRD §6.6 |
| S8-3 | Tunai dibayar dari akun **KAS_TOKO** (bukan laci kasir); transfer dari rekening yang dipilih; kredit → `payables` | Pembelian dibayar owner, bukan dari laci |
| S8-4 | Koreksi faktur beli = **retur beli** (`RB`), tidak ada void/edit. Retur memakai lapisan penerimaan asal dulu (`preferLayerSourceLineId`); penyelesaian potong hutang atau uang kembali ke kas | PRD §6.6, golden rule 4 |
| S8-5 | Retur jual (`RJ`, `sales.return` → PIN Owner untuk kasir) dari nota mana pun (void tetap untuk nota hari ini): sisa **belum diambil** dibatalkan dulu (lepas reservasi, tanpa mutasi fisik), lalu yang sudah keluar kembali ke stok (`SALE_RETURN` @ HPP baris) bila "kembali ke stok"; penyelesaian uang kembali (kas LACI) atau potong piutang | FR-POS-17; rencana pengambilan §3.3 |
| S8-6 | Pembelian & retur beli hanya **Owner** (`purchases.*`) | PRD §4.2 |

## A. Server

- [x] **A1** Migrasi `0005_purchasing.sql`: tabel bagian 5 (PO, penerimaan, faktur, retur beli) + `payables` + `sale_returns`/`sale_return_items` (persis file skema); reset persiapan ikut
  - 📌 Dibentuk dari file skema (11 tabel). **File skema diperbarui:** `client_op_id uuid UNIQUE` di `purchase_invoices` & `purchase_returns` (Idempotency-Key). Generator migrasi diperbaiki untuk index dua baris
- [x] **A2** `POST /purchases` (faktur langsung, Idempotency-Key), `GET /purchases?q=&supplierId=&page=`, `GET /purchases/:id`
  - 📌 Faktur bertanggal mundur → lapisan FIFO di tanggal itu (12.00 WIB) sehingga terpakai lebih dulu; no. faktur supplier ganda per supplier → 409 `DUPLICATE_SUPPLIER_INVOICE`; kredit tanpa termin supplier → 10 hari
- [ ] **A3** `GET /purchases/price-history?productId=` (harga beli per supplier, terbaru) + harga beli terakhir di pencarian barang Owner
  - 📌 `GET /purchases/price-history` (20 terbaru) dipakai formulir sebagai saran harga + satuan default. **Belum:** harga beli terakhir di pencarian barang Owner
- [x] **A4** `POST /purchases/:id/returns` (retur beli `RB`), `GET` di detail faktur
  - 📌 Retur dihitung per satuan barang di faktur (tabel retur tidak menyimpan baris terima — cukup karena satu barang satu baris per faktur); potong hutang ditolak bila sisa hutang < nilai retur
- [x] **A5** `POST /sales/:id/returns` (retur jual `RJ`), `GET /sales/:id` menyertakan qty sudah diretur
  - 📌 Nota dengan retur tidak bisa di-void lagi (`VOID_HAS_RETURNS`); nota diambil-nanti yang seluruhnya diretur → `CANCELLED`
- [x] **A6** Tes: HPP lapisan (dengan/tanpa ongkos), kredit → hutang + jatuh tempo, tunai → kas KAS_TOKO, nomor BL, no. faktur supplier ganda ditolak, idempoten, KASIR 403, retur beli memakai lapisan asal + potong hutang, retur > diterima ditolak, retur jual (sudah diambil / belum diambil / tidak kembali stok) + kas/piutang, KASIR 423
  - 📌 `purchases/routes.test.ts` 7 tes. Total **220 tes**

## B. Layar (backoffice, Owner)

- [x] **B1** `/pembelian`: daftar faktur (cari, supplier, total, tunai/kredit, status hutang)
  - 📌 Kolom Bayar: Tunai / Transfer / "Hutang Rp …" / Kredit lunas
- [x] **B2** `/pembelian/baru`: supplier, tanggal, no. faktur supplier, baris (cari barang, satuan, qty, harga beli — harga beli terakhir sebagai saran), Tunai/Kredit + jatuh tempo, "Detail lain" (potongan, ongkos + centang masuk HPP, catatan); Simpan
  - 📌 **Temuan uji layar & diperbaiki:** satuan default baris = KG (satuan dasar) → kini satuan pembelian terakhir, atau satuan terbesar (ZAK)
- [x] **B3** Detail faktur + **Retur beli**
  - 📌 Detail: HPP per satuan dasar, qty diretur, hutang (terbayar/terpotong, jatuh tempo), daftar retur
- [x] **B4** Kasir: Nota hari ini → **Retur** (selain Batal) + cari nota lama; dialog qty per baris, kembali ke stok, uang kembali / potong piutang, PIN Owner
  - 📌 Ctrl+D: chip "Hari ini · Semua tanggal"; tombol **Retur** (semua nota) & **Batal** (hanya hari ini); dialog retur: qty per baris, centang "Rusak", Uang kembali / Potong piutang (hanya nota kredit), PIN Owner
- [x] **B5** Uji layar
  - 📌 Edge headless: Owner faktur kredit 20 → retur 2 (potong hutang); kasir jual → retur → 423 → PIN → `0001/RJ/UTM/1026` uang kembali

**Definition of Done:** typecheck/lint/test hijau; nilai persediaan = Σ lapisan; hutang & piutang
konsisten dengan dokumen.
