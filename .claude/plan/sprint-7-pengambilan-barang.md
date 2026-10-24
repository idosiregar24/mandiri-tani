# Fitur: Terjual — Belum Diambil (Pengambilan Barang Bertahap)

> Requirement: PRD §5.3b (FR-PKP-01 … FR-PKP-14). Skema: `sales.fulfillment_status`,
> `sale_items.picked_up_qty/cancelled_qty`, `stock_balances.reserved_qty`,
> `sale_pickups`, `sale_pickup_items`, `stock_movements.source_type = SALE_PICKUP`.
> Dikerjakan lintas sprint — lihat §10. Centang di sini seiring progres.

## 1. Masalah

Petani membeli pupuk hari ini tapi baru mengambilnya minggu depan (atau
bertahap, atau minta diantar ke ladang). Di iPOS 5 stok langsung berkurang
saat nota dibuat, sehingga:

- stok di komputer **lebih kecil** dari barang yang benar-benar ada di gudang;
- toko harus mencatat manual di Excel ("DAFTAR PUPUK — barang yang belum
  diambil") dan di keterangan nota ("SUDAH DIAMBIL", "DIANTAR");
- opname fisik selalu selisih, dan tidak ada riwayat siapa mengambil apa, kapan.

## 2. Konsep: tiga angka stok

| Angka | Arti | Sumber |
|---|---|---|
| **Stok fisik** | Barang yang benar-benar ada di gudang | `stock_balances.qty` |
| **Dipesan (belum diambil)** | Sudah terjual & dibayar/dikreditkan, masih di gudang | `stock_balances.reserved_qty` |
| **Tersedia dijual** | Boleh dijual ke pembeli lain | fisik − dipesan (dihitung) |

Contoh — Urea (ZAK), stok fisik 100:

| Kejadian | Fisik | Dipesan | Tersedia |
|---|---:|---:|---:|
| Awal | 100 | 0 | 100 |
| Pak Budi beli 20 zak, **belum diambil** | 100 | 20 | 80 |
| Kasir lain menjual 10 zak dibawa langsung | 90 | 20 | 70 |
| Minggu depan Pak Budi ambil 15 zak | 75 | 5 | 70 |
| Pak Budi ambil sisa 5 zak | 70 | 0 | 70 |

**Aturan inti:**

1. Penjualan memeriksa **tersedia**, bukan fisik — barang yang sudah dipesan
   orang tidak bisa terjual dua kali.
2. Stok fisik hanya berkurang ketika barang **benar-benar keluar gudang**:
   dibawa saat bayar (`SALE`), atau saat pengambilan (`SALE_PICKUP`).
3. Uang/piutang tidak terkait pengambilan: nota tetap lunas/kredit sejak hari
   transaksi. Pengambilan murni urusan barang.
4. Opname menghitung **stok fisik** — barang titipan pelanggan ikut dihitung
   karena memang masih di gudang.

## 3. Alur

### 3.1 Saat menjual (Kasir maupun Faktur)

```
Keranjang → F9 Bayar → [ ] Barang diambil nanti  (shortcut Alt+N)
   ├─ pelanggan wajib bernama (UMUM ditolak; tambah cepat: nama + HP)
   ├─ per baris: "dibawa sekarang" (default 0 bila dicentang, bisa diisi sebagian)
   ├─ rencana tanggal ambil (opsional) + catatan
   └─ pembayaran seperti biasa (tunai / transfer / kredit / campuran)
Simpan (1 transaksi DB):
   ├─ baris dibawa sekarang  → stockService.apply: SALE (fisik −)
   ├─ sisa                   → stockService.reserve (dipesan +)
   └─ fulfillment_status = PENDING (tidak ada yang dibawa) / PARTIAL / TAKEN
Cetak struk/faktur dengan blok:
   "BARANG BELUM DIAMBIL: Urea 20 ZAK — tunjukkan nota ini saat mengambil" + QR no. nota
```

### 3.2 Saat pelanggan datang mengambil

```
Menu Pengambilan Barang (F11) → cari pelanggan / scan QR nota / ketik no. nota
→ tampil SEMUA sisa barang pelanggan itu dari semua nota (tanggal nota, barang, sisa, umur hari)
→ isi qty diambil per baris (tombol "Ambil semua"; tidak boleh > sisa)
→ penerima (nama wajib — bisa diwakilkan, HP), kendaraan/no. polisi, metode: diambil / diantar (+ tujuan), catatan
→ Simpan: nomor AB/K01/2610/00001
   ├─ stockService.apply: SALE_PICKUP (fisik −, dipesan −) dengan HPP saat ini
   ├─ sale_items.picked_up_qty += qty; status nota → PARTIAL / COMPLETE
   └─ audit_logs "pickup.create"
→ Cetak Bukti Pengambilan (2 rangkap: pelanggan & arsip; kolom tanda tangan penerima & petugas gudang)
```

### 3.3 Koreksi & pembatalan (tidak pernah edit/hapus)

| Kasus | Penanganan |
|---|---|
| Salah input pengambilan | **Batalkan pengambilan** (Supervisor/Owner, alasan wajib): status `CANCELLED`, mutasi `SALE_PICKUP_CANCEL` (fisik +, dipesan +), sisa nota kembali seperti sebelumnya |
| Pelanggan tidak jadi mengambil sisa | **Retur sisa belum diambil** (`sales.return`): `cancelled_qty` +, reservasi dilepas, **tanpa** mutasi fisik (barang tidak pernah keluar), uang dikembalikan tunai / potong piutang |
| Nota salah total | **Void** hanya bila belum ada pengambilan POSTED; void melepas reservasi dan membalik barang yang dibawa saat bayar |

### 3.4 Pengingat & tindak lanjut

- Dashboard: jumlah nota & nilai barang belum diambil; **lewat janji ambil**;
  **umur > N hari** (setting `pickup.aging_warn_days`, default 30).
- Daftar per pelanggan bisa dicetak / dikirim (pengganti sheet DAFTAR PUPUK).
- Info di layar kasir saat memilih pelanggan: "Pak Budi masih punya 5 ZAK Urea belum diambil (nota JL/K01/2610/00012)".

## 4. HPP & laporan laba

- **Omzet** diakui pada tanggal nota (sama seperti iPOS — uang/piutang terjadi saat itu).
- **HPP** dicatat saat barang keluar gudang (`unit_cost` di `sale_pickup_items`
  dan di mutasi). `sale_items.cost_per_base` = rata-rata tertimbang dari bagian
  yang sudah keluar.
- Selama masih ada sisa, laporan laba memakai **HPP saat ini** untuk sisa itu
  dan menandai nota sebagai *"HPP estimasi — barang belum diambil penuh"*.
  Setelah diambil penuh, angka menjadi final.

## 5. Hak akses (tambahan PRD §4.2)

| Permission | KASIR | SUPERVISOR | OWNER |
|---|:-:|:-:|:-:|
| `sales.pending_pickup` (jual dengan "diambil nanti") | ✔ | ✔ | ✔ |
| `pickups.create` (input pengambilan) | ✔ | ✔ | ✔ |
| `pickups.cancel` (batalkan pengambilan) | ⛔ (otorisasi) | ✔ | ✔ |
| `pickups.read` (riwayat & daftar belum diambil) | ✔ | ✔ | ✔ |

## 6. Skema (sudah di `mandiri_tani_schema.sql`)

| Objek | Isi |
|---|---|
| `stock_balances.reserved_qty` | Total dipesan per produk × gudang (satuan dasar), `≥ 0` |
| `stock_movements.source_type` | + `SALE_PICKUP`, `SALE_PICKUP_CANCEL` |
| `sales.fulfillment_status` | `TAKEN` / `PENDING` / `PARTIAL` / `COMPLETE` / `CANCELLED` |
| `sales.pickup_planned_date`, `pickup_note` | Janji ambil & catatan |
| `sales.source = OPENING_PICKUP` | Saldo awal barang belum diambil saat go-live (§8) |
| `sale_items.picked_up_qty`, `cancelled_qty` | Sisa = qty − picked_up − cancelled |
| `sale_pickups` | Header pengambilan: pelanggan, gudang, penerima, kendaraan, metode, status, pembatalan |
| `sale_pickup_items` | Baris: `sale_item_id`, qty, base_qty, `unit_cost` |
| `doc_sequences` prefix `AB` | Nomor bukti Ambil Barang |

**Invarian** (dicek otomatis harian bersama G-4 dan di test):
`stock_balances.reserved_qty = Σ (qty − picked_up_qty − cancelled_qty) × conversion_qty`
untuk nota COMPLETED per produk × gudang (bundle: per komponen).

## 7. API & layar

| Endpoint | Fungsi |
|---|---|
| `POST /sales` (+ `pickup: { later: true, takeNow: [{lineNo, qty}], plannedDate, note }`) | Jual dengan barang belum diambil |
| `GET /pickups/outstanding?customer=&product=&agingDays=` | Sisa belum diambil (per baris nota) |
| `POST /pickups` (Idempotency-Key) | Simpan pengambilan |
| `GET /pickups?customer=&from=&to=` · `GET /pickups/:id` | Riwayat pengambilan |
| `POST /pickups/:id/cancel` (otorisasi) | Batalkan pengambilan |
| `GET /stock/balances` | Kini mengembalikan `physical`, `reserved`, `available` |
| `GET /reports/undelivered` · `GET /reports/pickups` | Laporan |

| Layar | Isi |
|---|---|
| Dialog Bayar | Centang "Barang diambil nanti", qty dibawa sekarang per baris, rencana tanggal |
| **Pengambilan Barang** (F11) | Cari pelanggan/nota/QR → sisa per baris → qty diambil → penerima → simpan & cetak |
| Detail Nota | Tab **Riwayat Pengambilan** (no. AB, tanggal, qty, penerima, petugas, status) |
| Detail Pelanggan | Kartu "Barang belum diambil" + riwayat pengambilan |
| Stok / Kartu Stok | Kolom Fisik · Dipesan · Tersedia; klik Dipesan → daftar nota |
| Dashboard | Widget belum diambil, lewat janji, umur > N hari |

## 8. Saldo awal saat go-live

iPOS sudah **mengurangi stok** untuk barang yang terjual tapi belum diambil,
sehingga stok hasil impor iPOS **lebih kecil** dari isi gudang. Langkah
"Saldo awal barang belum diambil" (wizard go-live, `plan/sprint-14-go-live-migrasi.md`):

1. Input per pelanggan: no. nota iPOS (referensi), barang, satuan, qty sisa —
   sumber: sheet DAFTAR PUPUK + cek fisik.
2. Sistem membuat nota `source = OPENING_PICKUP` (tanpa pembayaran/piutang
   baru — sudah tercatat di iPOS — dan **tidak masuk laporan omzet/laba**),
   semua baris status belum diambil.
3. Mutasi `OPENING` **+qty fisik** dan **+dipesan** untuk qty tersebut →
   stok fisik = stok iPOS + barang titipan = isi gudang sebenarnya.
4. Opname cepat produk pupuk utama untuk memastikan angka fisik cocok.

## 9. Kasus tepi

| Kasus | Aturan |
|---|---|
| Stok tersedia kurang saat menjual | Blok seperti FR-INV-10 (otorisasi Supervisor bila dipaksa) |
| Stok **fisik** kurang saat pengambilan (selisih opname/hilang) | Blok dengan pesan "Stok fisik X tinggal N — lakukan penyesuaian/opname dulu"; tidak boleh fisik minus lewat pengambilan |
| Pengambilan dalam satuan lain (beli 2 ZAK, ambil 50 KG) | v1: pengambilan dalam satuan baris nota; pecahan hanya bila produk `allow_decimal_qty`. Ambil per KG = *Could* |
| Diwakilkan orang lain | `receiver_name` wajib diisi nama pengambil sebenarnya; tercetak di bukti |
| Satu kedatangan untuk beberapa nota | Satu dokumen AB boleh berisi baris dari banyak nota pelanggan yang sama |
| Penjualan dari perangkat offline (Mode Terminal, v1.x) | Reservasi diterapkan saat push; bila membuat dipesan > fisik → tetap diterima, ditandai di laporan "Dipesan melebihi stok" |
| Konkurensi (2 kasir menjual produk yang sama) | `reserve`/`apply` lewat `stockService` dengan urutan lock yang sama — tidak terjual ganda |
| Harga berubah sebelum diambil | Tidak berpengaruh — harga terkunci di nota |
| Barang rusak di gudang sebelum diambil | Penyesuaian stok (Rusak) mengurangi fisik; sistem memperingatkan bila fisik < dipesan → owner memutuskan ganti barang/retur |

## 10. Rincian tugas per sprint

**S4 — Stok**
- [ ] Kolom `reserved_qty`, `stockService.reserve(tx, lines)` / `release(tx, lines)` dengan urutan lock yang sama dengan `apply`
- [ ] Source type `SALE_PICKUP` / `SALE_PICKUP_CANCEL` di `apply` (mengurangi/menambah `reserved_qty` sekaligus `qty`)
- [ ] `GET /stock/balances` → fisik · dipesan · tersedia; layar stok & kartu stok tiga kolom
- [ ] Validasi jual terhadap **tersedia**; cek invarian reservasi harian
- [ ] Test: contoh tabel §2 end-to-end, konkurensi, invarian

**S6–S7 — Penjualan & Pengambilan**
- [ ] Dialog Bayar: "Barang diambil nanti" + qty dibawa sekarang + rencana tanggal (Kasir & Faktur), pelanggan wajib bernama
- [ ] Struk/faktur mencetak blok barang belum diambil + QR no. nota
- [ ] Layar **Pengambilan Barang** (F11), `POST /pickups`, nomor `AB`, cetak bukti 2 rangkap
- [ ] Riwayat pengambilan di Detail Nota & Detail Pelanggan; info sisa di layar kasir saat pilih pelanggan
- [ ] Batalkan pengambilan (otorisasi) + mutasi balik; void nota ditolak bila ada pengambilan POSTED
- [ ] Test: ambil sebagian, ambil lintas nota, batal, double-submit (Idempotency-Key), fisik kurang

**S8–S9 — Retur & Piutang**
- [ ] Retur sisa belum diambil (`cancelled_qty`, lepas reservasi, refund/potong piutang)

**S10 — Laporan & Dashboard**
- [ ] Laporan barang belum diambil (per pelanggan/barang, nilai, umur), riwayat pengambilan, widget dashboard, pengingat lewat janji
- [ ] Laporan laba menandai HPP estimasi untuk sisa belum diambil
- [ ] Rekap harian pupuk (FR-FIN-11) memakai keluar fisik (SALE + SALE_PICKUP)

**S14 — Go-live**
- [ ] Wizard "Saldo awal barang belum diambil" (§8) + opname cepat pupuk

## 11. Pertanyaan untuk owner

- Berapa lama barang boleh dititip sebelum ditindaklanjuti (default peringatan 30 hari)?
- Apakah ada biaya penitipan/antar? (Ongkos antar sudah bisa lewat "biaya lain".)
- Perlu tanda tangan digital penerima di layar/HP, atau cukup tanda tangan di bukti cetak?
