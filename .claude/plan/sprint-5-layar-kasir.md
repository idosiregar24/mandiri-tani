# Sprint 5 — Layar Kasir (keranjang, harga, satuan, shortcut)

> Milestone **M2 POS Kasir**. Requirement: PRD §5.3 (FR-POS-01…06, 21, 22, 25, 28), §6.3
> (resolusi harga), §8.3 (scanner). Aturan: `rules/frontend-standards.md` §6 (keyboard-first),
> `rules/design-standards.md` §3 (layar kasir). Lanjutannya: Sprint 6 (shift, bayar, simpan,
> cetak struk) → transaksi KSR pertama end-to-end.

**Dikerjakan sebelum sisa Sprint 2** (keputusan owner 2026-10-29: "kerjakan kasir terlebih
dahulu"). Yang sudah ada dari S2: login PIN/password, sesi, role, otorisasi PIN Owner di server.

**Ringkasan status (2026-10-29):** 14/16 item · **180 tes** hijau. Layar kasir jalan (diuji otomatis di Edge headless). Sisa: B3 `EXPLAIN ANALYZE` 20.000 produk (S13), D1 dicoba owner. Bayar F9 menyusul di Sprint 6.

## Cara toko memakai kasir iPOS (backup 2026-10-24, KSR, angka agregat)

| Temuan | Angka | Akibat untuk desain |
|---|---|---|
| Baris per nota | 1 baris 65%, 2 baris 26%, maks 9 | Keranjang pendek; total & tombol Bayar selalu terlihat tanpa scroll |
| Barang sama 2× dalam satu nota | **0** | Scan/pilih ulang barang+satuan yang sama **menambah qty** baris itu (FR-POS-01) |
| Harga baris ≠ harga master | **54%** baris (4.412 / 8.105) | Ubah harga = satu tombol/klik, langsung terketik; tidak butuh PIN (D-2) |
| Diskon per baris | **0** | Diskon baris tidak ditampilkan di keranjang (tetap ada di data, `0`) |
| Potongan nota | 173 nota, nominal, **selalu menjadikan total kelipatan Rp 1.000** | F10 "Total jadi" menghitung potongan (FR-POS-28) |
| Total nota kelipatan Rp 1.000 | 100% (harga baris 99,9% kelipatan Rp 1.000) | Pembulatan otomatis (FR-POS-12) **tidak** dibangun di v1 |
| Satuan | KG 1.897 baris, ZAK 1.116; qty desimal **0** | Ganti satuan (F4) penting untuk pupuk; QtyInput bilangan bulat untuk produk tanpa `allow_decimal_qty` |
| Pembayaran | Tunai 100%; kembalian di 46% nota (median Rp 20.000); "TF/transfer" di keterangan 126 nota | S6: tombol uang cepat + metode Transfer terpisah |
| Kredit di KSR | 0 (semua kredit lewat JL) | Kasir tidak menawarkan piutang |
| Jam ramai | 07.00–10.00 (957 nota dari 2.552 setahun) | Scan → bayar harus bisa tanpa mouse |
| User / PC / shift | 1 / 1 / 1 | Satu kasir (Q-S2-2: 1 orang) |
| Setting iPOS | `DEF_PEL_UMUM = UMUM`, `HARGA_JUAL_KASIR = O` (satu harga), `MODE_LACI_STATUS = 0` (tanpa laci) | Pelanggan default UMUM; tanpa laci |

## Keputusan sprint ini

| # | Keputusan | Alasan |
|---|---|---|
| S5-1 | Resolusi harga = **satu fungsi murni** `resolvePrice()` di `src/shared/pricing.ts`, dipakai renderer (tampilan) **dan** server (saat simpan, S6). Server tidak percaya harga master dari klien: `list_price` dihitung ulang | PRD §6.3 "WAJIB satu fungsi"; tidak ada logika harga kedua |
| S5-2 | Pencarian kasir = endpoint ringan `GET /pos/products` (20 hasil, kode/barcode persis didahulukan, lalu nama `ILIKE` trigram) berisi satuan jual, semua harga & **stok tersedia**. Scanner memakai `GET /pos/lookup?code=` (barcode/SKU persis → satuan) | Satu request per ketikan/scan; target ≤ 150 ms |
| S5-3 | Keranjang di **Zustand** (`features/pos/store.ts`), tidak disimpan di localStorage. Nota tertahan (FR-POS-08) ke server di S7 | frontend-standards §3 |
| S5-4 | HPP **tidak** dikirim ke layar kasir. Peringatan "di bawah HPP" (FR-POS-07) diputuskan server saat simpan (S6) → 423 PIN Owner | KASIR tanpa `cost.read` |
| S5-5 | `/kasir` = layar penuh tanpa sidebar; tombol **Menu** (Esc dua kali / tombol kiri atas) kembali ke backoffice. Kasir (role KASIR) setelah login langsung ke `/kasir` | design-standards §4 |
| S5-6 | Ubah harga baris terpilih = **Ctrl+H** atau klik kolom harga (tombol baru; F1–F12 sudah terpakai di PRD §5.3). Qty cepat `5*` lalu scan/pilih (FR-POS-03) | 54% baris diubah harganya — harus satu tombol |

## A. Logika bersama (`src/shared`)

- [x] **A1** `pricing.ts`: `resolvePrice(prices, { groupId, qty })` → `{ price, source: RETAIL|TIER|GROUP|GROUP_TIER } | null`; tes unit (umum, tier, grup, grup+tier, grup tanpa harga → umum, tanpa harga → null, tidak menurunkan dari satuan lain)
  - 📌 4 tes: umum + tier, grup menang atas tier umum, grup tanpa harga → umum, tanpa harga / di bawah tier terkecil → null
- [x] **A2** `pos.ts`: hitung baris (`qty × harga − diskon`), subtotal, potongan nota dari "Total jadi", alokasi potongan nota ke baris (*largest remainder*, Σ = potongan), parse `5*`; tes unit
  - 📌 `lineTotal`, `subtotal`, `suggestedTotal` (ke bawah Rp 1.000), `discountForTarget`, `allocateDiscount` (largest remainder, Σ tepat), `parseQtyPrefix` (`5*`, `2,5*`); 4 tes
- [x] **A3** Skema `pos.ts` (Zod): query cari, hasil `PosProduct` (satuan jual, harga, stok tersedia dalam satuan dasar)
  - 📌 `schemas/pos.ts`: `PosProduct` (satuan jual + semua baris harga + `availableQty`), `PosLookupResult` — tanpa field HPP

## B. Server

- [x] **B1** `GET /pos/products?q=` (`products.read`): ≤ 20 hasil, SKU/barcode persis dulu, aktif saja, satuan `is_sellable`, harga semua grup & tier, stok tersedia gudang utama; tanpa HPP
  - 📌 Setiap kata harus ada di nama ("npk mutiara" → NPK MUTIARA 16-16-16); SKU/barcode persis lalu awalan nama didahulukan; satu query (JSON per produk)
- [x] **B2** `GET /pos/lookup?code=` (`products.read`): barcode → satuan barcode itu; SKU → satuan jual default; 404 `PRODUCT_NOT_FOUND` dengan pesan untuk kasir
  - 📌 Barcode → satuan barcode itu; SKU → satuan jual default → dasar. 404 `PRODUCT_NOT_FOUND` "…Cari dengan nama barang."
- [ ] **B3** Tes: KASIR & OWNER 200, tanpa sesi 401; urutan hasil; stok tersedia = fisik − dipesan; tidak ada field HPP; `EXPLAIN ANALYZE` dicatat (data uji)
  - 📌 5 tes (KASIR & OWNER 200, 401, 400, urutan, stok tersedia = 500 − 100 dipesan, tanpa kata cost/hpp). **Sisa:** `EXPLAIN ANALYZE` dengan 20.000 produk (S13)

## C. Layar kasir (renderer)

- [x] **C1** `lib/hotkeys.ts`: peta aksi → tombol (PRD §5.3 + Ctrl+H) + `useHotkeys(scope, handlers)`; satu sumber untuk bantuan F1
  - 📌 `lib/hotkeys.ts` `POS_HOTKEYS` + `useHotkeys`; `inInput: 'empty'` → ↑/↓/Del juga bekerja dari kolom scan yang kosong; F6/F7/F9 ditandai "segera"
- [x] **C2** `lib/scanner.ts`: `useScanner(onScan)` — ketikan cepat (jeda < 35 ms, ≥ 4 karakter, diakhiri Enter) dikenali sebagai scan dan **tidak** ikut terketik ke input yang fokus (PRD §8.3)
  - 📌 `createScanDetector` (jeda ≤ 35 ms, ≥ 4 huruf, Enter) + `useScanner`: burst yang masuk ke kolom lain dikembalikan ke nilai semula; kolom scan membaca sendiri. 3 tes unit
- [x] **C3** `features/pos/store.ts` (Zustand): `addItem` (gabung barang+satuan sama), `setQty`, `changeUnit` (harga ter-resolve ulang kecuali MANUAL), `setPrice` (→ MANUAL), `removeLine`, `setCustomer`, `setTotalTarget`, `clear`; selector sempit
  - 📌 Harga MANUAL bertahan saat qty/pelanggan berubah, di-reset saat ganti satuan; harga diketik = harga daftar → kembali ke sumber master; `isShort()` menjumlah semua baris barang yang sama dalam satuan dasar
- [x] **C4** Halaman `/kasir` layar penuh: kolom scan (selalu kembali fokus), keranjang `PosCart` (baris ≥ 44 px, font ≥ 16 px, baris terpilih hijau muda + garis kiri), panel kanan (total ≥ 48 px, potongan, pelanggan, tombol Bayar F9 — nonaktif "Segera (Sprint 6)"), status bar (kasir, perangkat, server/DB)
  - 📌 Diuji di Edge headless 1366×768 (server uji + data sintetis): tanpa scroll horizontal, total 48 px, baris terpilih hijau muda + garis kiri, status bar kasir/shift/server
- [x] **C5** Cari barang: ketik di kolom scan → daftar hasil (↑/↓, Enter) dengan stok & harga per satuan; F3 membuka daftar penuh; tidak ditemukan → bunyi + `Notice` merah
  - 📌 Hasil cari muncul di bawah kolom scan (stok + harga per satuan jual default sesuai grup pelanggan); F3 = fokus ke kolom yang sama (tidak ada dialog terpisah — satu tempat mencari). Tidak ditemukan → bunyi + Notice merah yang tetap tampil
- [x] **C6** Aksi baris: F5 qty, F4 satuan, Ctrl+H harga (harga kosong wajib diisi), Del hapus (konfirmasi), ↑/↓ pindah baris; stok tidak cukup → peringatan kuning di baris (blok final di server S6)
  - 📌 Klik jumlah/satuan/harga di baris juga membuka dialognya; ganti ke satuan tanpa harga langsung membuka dialog harga; barang tanpa harga master → dialog harga terbuka saat ditambahkan
- [x] **C7** F10 potongan nota: "Total jadi" (default dibulatkan ke bawah ke Rp 1.000) atau nominal; F8 pelanggan (cari nama/HP; default UMUM; info grup); F1 bantuan shortcut
  - 📌 F10 default = subtotal dibulatkan ke bawah Rp 1.000; "Hapus potongan". F8: baris pertama "Umum", cari nama/HP, grup tampil; harga baris non-manual ter-resolve ulang ke harga grup (diuji: urea ZAK Gold 585.000)
- [x] **C8** Navigasi: KASIR setelah login → `/kasir`; menu "Kasir" di sidebar aktif; keluar/kunci layar Ctrl+Shift+L
  - 📌 KASIR → `/kasir` tepat setelah login (langganan store sesi di `App.tsx`), tombol Menu ke backoffice; menu Kasir aktif; Ctrl+Shift+L = keluar. Keranjang tetap ada setelah kunci layar (satu kasir)

## D. Selesai

- [ ] **D1** Uji manual di aplikasi: scan/ketik → 3 barang (termasuk KG→ZAK), ubah harga, potongan "Total jadi", tanpa mouse
  - 📌 Alur lengkap tanpa mouse sudah dijalankan otomatis di Edge headless (login PIN → cari → `3*kcl` → barang tanpa harga → F4 KG → F5 25 → Ctrl+H → F8 Gold → scan barcode → F10 → kode salah → F1 → Del → kunci). **Sisa:** dicoba owner/kasir di aplikasi dengan data impor iPOS
- [x] **D2** PRD §5.3 tabel shortcut + S5-6; README status
  - 📌 PRD §5.3 tabel shortcut: Ctrl+H; README status

**Definition of Done:** typecheck/lint/test hijau; teks UI Bahasa Indonesia; HPP tidak pernah
sampai ke layar kasir; seluruh alur keranjang bisa tanpa mouse.
