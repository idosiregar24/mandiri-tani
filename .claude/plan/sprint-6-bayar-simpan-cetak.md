# Sprint 6 — Bayar, Simpan Transaksi & Cetak Struk (tanpa shift)

> Milestone **M2 POS Kasir**. Requirement: PRD §5.3 (FR-POS-05…07, 10, 14–16, 23, 25, 29),
> §6.5–6.7, §8.1. Aturan: skill `stock-movement`, golden rule 1 (satu dokumen = satu transaksi,
> cetak sesudah COMMIT). Lanjutannya: Sprint 7 (Faktur JL, kredit, tahan nota, diambil nanti).

**Ringkasan status (2026-10-29):** 12/12 item · **207 tes** hijau. Diuji end-to-end di layar (Edge headless, data sintetis): KSR tunai + kembalian, uang pas, Faktur JL dengan ongkos + transfer + piutang, cetak struk & faktur (dokumen dicek, printer tiruan), riwayat, batal dengan PIN Owner. **Belum:** cetak ke printer fisik (thermal & LX-310).

## Keputusan sprint ini

| # | Keputusan | Alasan |
|---|---|---|
| S6-1 | **Shift tidak dipakai di v1** (owner 2026-10-29: "untuk buka tutup shift tidak perlu"). Tabel `shifts` tetap dibuat (skema sinkron, `sales.shift_id` NULL). FR-POS-18 & laporan per shift ditunda | 1 kasir, 1 PC; iPOS juga tanpa shift |
| S6-2 | Tanpa shift, **void hanya untuk nota hari ini** (tanggal Asia/Jakarta); nota lama dikoreksi lewat retur (S8) | Pengganti aturan "shift masih OPEN" (FR-POS-16) |
| S6-3 | Uang tunai masuk akun kas **LACI** (`cash_transactions` SALES, tanpa shift); transfer/QRIS ke akun kas metode itu. Kas yang dicatat = uang diterima − kembalian | Buku kas tetap lengkap tanpa shift |
| S6-4 | Server menghitung ulang semuanya: harga daftar (`resolvePrice`), subtotal, potongan, alokasi, total, kembalian. Klien hanya mengirim satuan, qty, harga jual, "potongan nota", pembayaran | Satu sumber kebenaran; klien tidak bisa memalsukan total |
| S6-5 | Di bawah HPP dicek **sesudah** `stockService.apply` (HPP FIFO yang benar-benar terpakai) → 423 `sales.sell_below_cost` untuk KASIR, seluruh transaksi di-rollback | HPP hanya diketahui saat lapisan dipakai |
| S6-6 | Batas potongan kasir = `settings.pos.cashierDiscountLimitPercent` (default **5%** subtotal); lebih → 423 `sales.discount.unlimited` | PRD §4.2; potongan iPOS rata-rata Rp 25.098 (pembulatan) |
| S6-7 | Cetak struk di main process: `DocumentBuilder` murni (`src/shared/receipts.ts` → baris teks) + encoder ESC/POS (struk) / ESC/P (faktur). Renderer memanggil `window.pos.printDocument()` **setelah** API sukses; gagal cetak → banner + "Cetak ulang", transaksi tetap tersimpan | Golden rule 1, desktop-runtime §5 |
| S6-8 | `Idempotency-Key` dibuat sekali saat dialog Bayar dibuka; kirim ulang (jaringan putus) mengembalikan nota yang sama | NFR-REL-04 |

## A. Database & server

- [x] **A1** Migrasi `0004_sales.sql`: `shifts`, `sales`, `sale_items`, `sale_payments`, `sale_pickups`, `sale_pickup_items`, `receivables`, `cash_transactions` (+ append-only); reset data persiapan ikut menghapus tabel ini
  - 📌 Dibentuk otomatis dari DDL `mandiri_tani_schema.sql` (8 tabel identik → file skema tidak berubah); reset persiapan ikut TRUNCATE tabel ini
- [x] **A2** `salesService.complete()` (satu transaksi): validasi, harga daftar ulang, nomor `KSR`/`JL`, `sales` + `sale_items` + `sale_payments`, `stockService.apply` (SALE), HPP & cek di bawah HPP, potongan & alokasi, kas, piutang (S7), audit; idempoten
  - 📌 Satu PIN Owner menyetujui **semua** kebutuhan satu nota (`approveInTx`: di bawah HPP, potongan > batas, lewat limit kredit); grant dipakai di transaksi nota → batal bila nota gagal (tidak perlu minta PIN lagi). Juga sudah: FAKTUR (pelanggan wajib, ongkos, piutang + jatuh tempo termin), barang diambil nanti (reservasi). Audit `sale.price_override` / `sale.approved`
- [x] **A3** `GET /sales/:id`, `GET /sales?date=&q=` (riwayat), tanpa HPP untuk KASIR
  - 📌 Kasir hanya melihat nota miliknya; HPP hanya untuk Owner
- [x] **A4** `POST /sales/:id/void` (`sales.void`, 423 untuk KASIR): hari ini saja, alasan wajib, stok kembali dengan harga lapisan asal (SALE_VOID), kas OUT, audit
  - 📌 Lapisan FIFO dibuat ulang per konsumsi (harga & tanggal asli); nota diambil-nanti → reservasi dilepas; piutang VOIDED (ditolak bila sudah ada pembayaran); kas OUT kategori SALE_REFUND
- [x] **A5** Tes: total & kembalian, kurang bayar 422, stok tidak cukup 409, di bawah HPP 423 lalu sukses dengan grant, potongan > 5% 423, idempoten, void + stok/kas kembali, void kemarin ditolak, KASIR tanpa HPP, invarian stok
  - 📌 `sales/routes.test.ts` 12 tes (KSR, kembalian, transfer > total, kurang bayar, MANUAL + audit, stok 409 tanpa efek, 423 → grant sekali pakai, idempoten, ongkos ditolak di KSR, FAKTUR kredit + jatuh tempo, lewat limit 423, diambil nanti, void + kas net 0, void kemarin ditolak, riwayat per kasir)

## B. Cetak

- [x] **B1** `src/shared/receipts.ts`: model struk KSR (meniru struk iPOS), terbilang (FR-POS-30) untuk faktur; tes snapshot teks
  - 📌 `src/shared/receipts.ts` (struk KSR & faktur JL 96 kolom, halaman lanjutan "Hal n/m"), `terbilang.ts` (12 tes), `text-layout.ts` dipindah dari main
- [x] **B2** Main: `pos:printer:document` → builder → ESC/POS/ESC/P → `windows-raw`; printer dari setelan peran; tes byte
  - 📌 `hardware/document.ts` + IPC `pos:printer:document` (Zod, printer dari setelan peran, pesan jelas bila printer belum diatur/tidak ada); 3 tes byte
- [x] **B3** Cetak ulang dengan tanda **SALINAN**
  - 📌 Riwayat → Cetak (SALINAN); Ctrl+P = nota terakhir

## C. Layar kasir

- [x] **C1** Dialog Bayar (F9): total besar, Tunai dengan tombol cepat (Uang pas, 50rb, 100rb, pembulatan ke atas), kembalian besar; Transfer/QRIS per rekening + no. referensi; Enter selesai
  - 📌 Kosong + Enter = uang pas (54% nota iPOS); tombol uang cepat (pas, kelipatan 10rb/50rb/100rb); Alt+1…9 cara bayar; bayar campur; FAKTUR: sisa jadi piutang; Alt+N diambil nanti (hanya bila pelanggan bernama)
- [x] **C2** Selesai: layar sukses (nomor nota, kembalian ≥ 48 px, status cetak), keranjang kosong, fokus ke scan; Enter/Esc = transaksi berikutnya
  - 📌 Cetak otomatis + status; Enter = transaksi baru. **Bug ditemukan saat uji layar & diperbaiki:** dialog yang menutup merebut fokus dari dialog berikutnya → `focusScan()` tidak memindah fokus selama masih ada dialog terbuka
- [x] **C3** Riwayat hari ini (Ctrl+P cetak ulang terakhir; daftar nota: cetak ulang, void dengan PIN Owner)
  - 📌 Ctrl+D "Nota hari ini": cari, cetak ulang, batal (alasan → PIN Owner). Hasil cari barang disegarkan setelah jual/batal
- [x] **C4** Dialog PIN Owner (`AuthorizeDialog`) untuk 423 → ulang otomatis dengan grant
  - 📌 `components/shared/AuthorizeDialog.tsx` (username Owner diingat per PC, PIN 6 angka); dipakai Bayar & Batal

**Definition of Done:** typecheck/lint/test hijau; transaksi KSR end-to-end di layar uji; cetak
gagal tidak membatalkan nota.
