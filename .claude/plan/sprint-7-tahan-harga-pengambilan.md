# Sprint 7 — Tahan Nota, Harga Terakhir Pelanggan & Pengambilan Barang

> Milestone **M2 POS Kasir**. Requirement: PRD FR-POS-08 (tahan nota), FR-POS-27 (harga
> terakhir pelanggan), §5.3b FR-PKP (pengambilan). Rencana fitur pengambilan lengkap:
> [`sprint-7-pengambilan-barang.md`](sprint-7-pengambilan-barang.md). Sudah selesai di S6:
> Faktur JL, kredit, ongkos angkut, "diambil nanti" (reservasi), void, PIN Owner.

**Ringkasan status (2026-10-29):** 9/10 item · **213 tes** hijau. Sisa: petunjuk harga terakhir di baris keranjang (B2). **Belum:** cetak bukti AB ke LX-310 fisik.

## Keputusan sprint ini

| # | Keputusan | Alasan |
|---|---|---|
| S7-1 | Nota tertahan = baris `sales` **HELD** (tanpa nomor, tanpa stok, tanpa kas). Ambil kembali (F7) **memindahkan** nota ke keranjang dan menghapus baris HELD dalam satu transaksi; disimpan lagi lewat `POST /sales` biasa | FR-POS-08: tahan restart; satu jalur simpan |
| S7-2 | Harga di nota tertahan disimpan apa adanya; saat diambil kembali harga **MANUAL** tetap, harga daftar di-resolve ulang (harga master bisa berubah) | D-2 |
| S7-3 | Harga terakhir = 3 nota COMPLETED terakhir pelanggan itu untuk **satuan barang yang sama**, tampil di dialog harga (klik = pakai) dan sebagai petunjuk di baris keranjang (mode Faktur) | FR-POS-27 |
| S7-4 | v1 tanpa "sebagian dibawa sekarang" di dialog Bayar: nota diambil nanti seluruhnya (PENDING); yang dibawa saat itu dicatat dengan **Pengambilan** langsung sesudahnya | Lebih sederhana untuk kasir; data iPOS tidak membedakan |
| S7-5 | Pengambilan dalam satuan baris nota; satu bukti AB boleh lintas nota pelanggan yang sama; batal pengambilan = `pickups.cancel` (PIN Owner untuk kasir), stok kembali dengan HPP & tanggal lapisan asal | Rencana fitur §3.3, §9 |
| S7-6 | Bukti AB dicetak di **LX-310** (peran faktur), 2 rangkap = 2 halaman (Pelanggan / Arsip), kolom tanda tangan penerima & petugas | Rencana fitur §3.2 |

## A. Server

- [x] **A1** `POST /sales/held`, `GET /sales/held`, `POST /sales/held/:id/recall` (`sales.hold`)
  - 📌 `sales/held.ts`; daftar nota tertahan untuk semua kasir (satu PC); ambil kembali → 404 bila sudah diambil orang lain
- [x] **A2** `GET /pos/last-prices?customerId=&productUnitId=` (3 terakhir)
  - 📌 `pos/repo.ts lastPrices` (3 nota COMPLETED terakhir, satuan yang sama)
- [x] **A3** Modul `pickups`: `GET /pickups/outstanding?customerId=|q=`, `POST /pickups` (Idempotency-Key, nomor `AB`, `SALE_PICKUP`, `picked_up_qty`, HPP baris, status nota PARTIAL/COMPLETE, audit), `GET /pickups?customerId=`, `GET /pickups/:id`, `POST /pickups/:id/cancel` (`pickups.cancel`)
  - 📌 `modules/pickups`: kunci baris nota urut id; HPP baris = rata-rata tertimbang semua pengambilan (`cost_per_base` NULL sampai ada yang diambil); batal = lapisan FIFO dibuat ulang per konsumsi
- [x] **A4** Tes: tahan → ambil kembali (baris HELD hilang, tidak ada stok/kas), harga terakhir, ambil sebagian, lintas nota, melebihi sisa ditolak, fisik kurang ditolak, idempoten, batal (stok & sisa kembali, PIN), void nota ditolak setelah ada pengambilan
  - 📌 `pickups/routes.test.ts` 6 tes: lintas 2 nota + status PARTIAL/COMPLETE + HPP, melebihi sisa, pelanggan lain, idempoten, void ditolak, batal 423 → PIN → stok & sisa kembali + invarian dipesan, fisik kurang 409, tahan/ambil kembali (tanpa efek stok, tidak muncul di riwayat), harga terakhir. Total **213 tes**

## B. Layar

- [x] **B1** F6 Tahan (label default nama pelanggan) & F7 daftar nota tertahan (Enter = ambil kembali)
  - 📌 F6 ditolak bila nota kosong/ada barang tanpa harga; F7 ditolak bila keranjang berisi (tahan dulu) — tidak ada nota yang hilang diam-diam
- [ ] **B2** Harga terakhir di dialog harga + petunjuk di baris (Faktur)
  - 📌 Di dialog harga: chip 3 harga terakhir (tanggal · qty), klik = pakai. **Belum:** petunjuk di baris keranjang
- [x] **B3** Ringkasan nota: "Masih ada N barang belum diambil" saat pelanggan dipilih
  - 📌 Tautan "Masih ada N barang belum diambil (F11)" di ringkasan → langsung ke layar Pengambilan pelanggan itu
- [x] **B4** Layar **Pengambilan Barang** (F11 dari kasir, menu Penjualan): pilih pelanggan / no. nota → sisa per baris → qty (Ambil semua) → penerima, diambil/diantar, kendaraan → Simpan & cetak; riwayat + batal
  - 📌 `/pengambilan` (menu Penjualan & F11 dari kasir) gaya kartu yang sama; cari pelanggan F8 atau no. nota (satu pelanggan → otomatis); umur > 30 hari kuning; Ambil semua; chip Diambil/Diantar; F9 simpan & cetak; Ctrl+D riwayat (cetak ulang SALINAN, batal + PIN)
- [x] **B5** Bukti AB (`receipts.ts`), 2 rangkap
  - 📌 `receipts.ts pickupNote`: 96 kolom, Lembar Pelanggan + Lembar Arsip, kolom Sisa, tanda tangan
- [x] **B6** Uji layar end-to-end
  - 📌 Edge headless 1366×768: F6 → F7 → Enter; Faktur diambil nanti (Alt+N) 10 zak → info di ringkasan → F11 → ambil 4 → AB 2 halaman (sisa 6); kolom kanan muat tanpa scroll

**Definition of Done:** typecheck/lint/test hijau; stok fisik turun hanya saat pengambilan;
invarian `reserved_qty` = Σ sisa belum diambil.
