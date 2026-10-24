# Rencana Data & Go-Live — dari iPOS 5 ke Mandiri Tani POS

> Requirement: PRD §5.9 (FR-MIG-01 … FR-MIG-10). Analisis data:
> `File Skema/Mandiri Tani v1.0/Analisis-Sumber-Data-iPOS.md`.

## 1. Prinsip

1. **Sekarang (pengembangan): pakai backup yang ada.**
   `.claude/file/DB Mandiri Tani.i5bu` (dump iPOS 2026-10-24 12:01) adalah
   data pengembangan. Hanya di laptop developer, tidak pernah di-commit.
2. **Saat go-live: impor backup iPOS TERBARU.** Importer tidak terikat ke file
   sekarang — ia membaca backup `.i5bu` mana pun dengan struktur iPOS 5 yang
   sama, kapan pun dibuat.
3. **Sebelum go-live semuanya bisa diulang.** Selama aplikasi dalam *Mode
   Persiapan*, Owner boleh menghapus data hasil impor dan mengimpor ulang
   berkali-kali (gladi). Setelah go-live dinyatakan, impor dikunci.
4. **iPOS tidak pernah disentuh.** Importer hanya membaca file backup; bila
   go-live gagal, toko kembali memakai iPOS tanpa kehilangan apa pun.

## 2. Mode aplikasi

| Mode | Penanda | Boleh | Tidak boleh |
|---|---|---|---|
| **Persiapan** | `settings.system.go_live_at = null` (banner kuning "MODE PERSIAPAN — data belum resmi" di semua layar) | Impor iPOS (DEVELOPMENT/REHEARSAL/GO_LIVE), **Reset data persiapan**, transaksi uji | — |
| **Produksi** | `go_live_at` terisi (oleh Owner, dengan konfirmasi ketik "GO LIVE") | Transaksi resmi; impor Excel produk (FR-MD-12) | Impor iPOS lingkup master/stok/piutang, Reset data. Jalan kembali hanya lewat **restore backup** pra-go-live (Owner, tercatat audit) |

**Reset data persiapan (FR-MIG-08):** Owner, ketik ulang nama toko untuk
konfirmasi → backup otomatis `pre-reset-<ts>.dump` → hapus semua data bisnis
(produk, harga, pelanggan, supplier, stok & mutasi, penjualan, pengambilan,
pembelian, piutang/hutang, kas, opname, `legacy_refs`; batch impor ditandai
`DISCARDED`) — **tetap** menyimpan user, perangkat, pengaturan, printer,
audit log. Dijalankan dalam satu transaksi dengan `TRUNCATE … ` berurutan
(trigger append-only dinonaktifkan hanya di dalam transaksi ini, hanya di
Mode Persiapan).

## 3. Pengembangan (mulai Sprint 3)

- [ ] `npm run dev:import-ipos -- "<path ke .i5bu>"`: buat ulang DB dev → migrasi → impor (`purpose = DEVELOPMENT`) → cetak ringkasan rekonsiliasi. Bisa diulang kapan saja.
- [ ] Test otomatis **tidak** memakai backup asli. Fixture `test/fixtures/ipos-mini.sql`: subset DDL tabel iPOS yang dipakai importer (`tbl_item`, `tbl_itemsatuanjml`, `tbl_itemhj`, `tbl_itemstok`, `tbl_item_im`, `tbl_supel`, `tbl_supelgrup`, `tbl_ikhd`, `tbl_ikdt`, `tbl_byrpiutangdt`, `tbl_conf`, …) + baris **fiktif** yang meniru kasus nyata (KG/ZAK×50, nota tunai+kredit, pelunasan multi-nota, item tanpa HPP, pelanggan duplikat).
- [ ] **Sidik struktur** (FR-MIG-09): sebelum transformasi, importer memeriksa tabel & kolom wajib di `ipos_import`; bila backup dari versi iPOS berbeda dan kolom hilang/berubah → berhenti dengan daftar perbedaan yang jelas, bukan impor setengah jadi.
- [ ] Ringkasan rekonsiliasi dibandingkan dengan angka di Analisis §2 (416 item, 1.238 pelanggan, 308 nota piutang Rp 2,62 M, nilai stok Rp 1,79 M) — dipakai sebagai sanity check developer.

## 4. Gladi (minimal 1×, 1–2 minggu sebelum go-live)

- [ ] Minta owner membuat backup iPOS terbaru (menu backup iPOS → file `.i5bu`).
- [ ] Reset data persiapan → impor `purpose = REHEARSAL` dengan backup itu.
- [ ] Owner mencocokkan laporan rekonsiliasi dengan laporan iPOS (stok per item, saldo piutang per pelanggan, daftar nota jatuh tempo).
- [ ] Catat waktu yang dibutuhkan setiap langkah → jadwal malam go-live.
- [ ] Latihan kasir & admin memakai data hasil gladi (transaksi uji boleh, akan dihapus).
- [ ] Kumpulkan: daftar **hutang supplier** sebenarnya (DQ-11), daftar **barang belum diambil** (DAFTAR PUPUK), daftar pengguna & PIN (Q-14), keputusan HPP (Q-10).

## 5. Malam go-live (setelah toko tutup)

| # | Langkah | Siapa | Selesai bila |
|---|---|---|---|
| 1 | Hentikan transaksi di iPOS; buat backup `.i5bu` terakhir; salin ke flashdisk | Owner/Admin | File ada di 2 tempat |
| 2 | Di aplikasi baru (masih Mode Persiapan): **Reset data persiapan** | Owner | Data uji gladi hilang |
| 3 | Impor `purpose = GO_LIVE`: master → stok awal → piutang terbuka → (histori, bila Q-13 = ya) | Owner | Batch `COMMITTED` |
| 4 | Laporan rekonsiliasi: jumlah item/pelanggan, qty & nilai stok, total piutang per pelanggan = iPOS | Owner | Selisih 0, dicetak & ditandatangani |
| 5 | Input **saldo awal hutang supplier** per faktur (FR-MIG-05) | Owner | Total = catatan owner |
| 6 | Input **saldo awal barang belum diambil** (`plan/sprint-7-pengambilan-barang.md` §8) | Admin | Daftar = DAFTAR PUPUK |
| 7 | Opname cepat pupuk utama (fisik vs sistem) + penyesuaian bila perlu | Admin | Selisih dijelaskan |
| 8 | Buat user per orang, set printer, uji 1 transaksi KSR + 1 JL + 1 pengambilan, lalu **void** | Owner | Struk & bukti tercetak |
| 9 | **Nyatakan Go-Live** (ketik "GO LIVE") → `go_live_at` terisi, backup otomatis `go-live-<ts>.dump` | Owner | Banner persiapan hilang |

## 6. Setelah go-live

- iPOS **tidak dipakai input lagi** (hindari input ganda); disimpan read-only
  untuk melihat histori minimal 3 bulan.
- Minggu pertama: rekonsiliasi harian kas & stok pupuk utama; catatan masalah
  langsung ke `plan/`.
- **Rencana mundur:** bila hari pertama gagal total, toko kembali ke iPOS
  (backup langkah 1 tidak tersentuh); transaksi yang sempat dibuat di aplikasi
  baru diinput ulang manual di iPOS dari struk.

## 7. Requirement baru (dicatat di PRD §5.9)

| ID | Ringkas |
|---|---|
| FR-MIG-08 | Mode Persiapan + **Reset data persiapan** + impor ulang tanpa batas sebelum go-live |
| FR-MIG-09 | Importer menerima backup iPOS 5 mana pun dengan sidik struktur; error jelas bila struktur berbeda |
| FR-MIG-10 | **Nyatakan Go-Live** mengunci impor & reset; jalan kembali hanya restore backup |
