# Sprint 11 — Sinkronisasi LAN (Pairing Perangkat, Sync Pull, Sync Push & Halaman Koneksi)

> Milestone **M5 Sinkronisasi**. Requirement: PRD §5.7 (FR-SRV-01…08), §5.8 (FR-MOB-01…05),
> rules/sync-standards.md, rules/security-standards.md §1–2.
>
> Sasaran: Menghubungkan perangkat tambahan (HP Staf, HP Owner, kelak Mode Terminal) ke Hub
> (PC Kasir) secara aman melalui jaringan lokal (Wi-Fi/LAN) tanpa internet, menyediakan protokol
> pull/push offline-first dengan deteksi jam (clock skew), serta layar antarmuka Koneksi untuk Owner.

## Keputusan sprint ini

| # | Keputusan | Alasan |
|---|---|---|
| S11-1 | **Pairing 6 Digit & QR**: Owner membuat kode pairing 6 digit angka (mis. `849201`) berlaku 5 menit, disimpan hash SHA-256 di `device_pairing_codes`. QR memuat JSON `{ hub: "http://<ip>:3000", code: "849201", expiresAt: "..." }` | FR-SRV-03; mudah diketik manual atau dipindai kamera |
| S11-2 | **Kode & Token Perangkat**: Mobile = `H01`, `H02`, ...; Terminal = `T01`, `T02`, ... Token perangkat = 32-byte hex acak kriptografis, disimpan SHA-256 di `devices.token_hash` | DDL `devices.code CHECK (K01, H.., T..)` |
| S11-3 | **Autentikasi Perangkat**: Endpoint `/sync/*` dapat diautentikasi dengan token sesi user maupun token perangkat (Bearer). Saat request diterima, `last_seen_at` diperbarui, dan selisih `device_time` vs waktu server disimpan di `last_clock_skew_ms` (> 5 menit = peringatan FR-SRV-08) | rules/sync-standards.md §6 |
| S11-4 | **Sync Pull (`GET /sync/pull`)**: Mendukung 13 entitas master sesuai urutan dependensi FK (`units` s.d. `stock_balances`). Halaman 1: `updated_at > since − 120s` (OVERLAP); halaman 2+: keyset `(updated_at, id) > cursor` tanpa overlap. Field biaya/HPP disaring aman di server untuk role tanpa `cost.read` | rules/sync-standards.md §3 |
| S11-5 | **Sync Push (`POST /sync/push`)**: Menerima batch maks 100 `OutboxOp`. Tiap operasi dalam transaksi sendiri: idempoten via `sync_ops(op_id)`. Hasil: `APPLIED`, `DUPLICATE`, `REJECTED`, `RETRY`. Penjualan sinkron (`sale.create`) diizinkan membuat stok minus bila fisik kurang (karena sudah terjadi di lapangan) | rules/sync-standards.md §4–5 |
| S11-6 | **Halaman Koneksi (`/koneksi`)**: Status server, IP LAN hub, waktu server, dialog pairing (QR SVG + kode 6 angka + timer countdown), dan tabel daftar perangkat terpasang + tombol Cabut Akses (Revoke) | FR-SRV-04 |

## A. Fondasi & Skema

- [x] **A1** Skema bersama `src/shared/schemas/devices.ts` (`Device`, `PairingCodeInput`, `PairDeviceInput`, `NetworkInfo`) dan `src/shared/schemas/sync.ts` (`SyncEntity`, `SyncPullQuery`, `SyncPullResult`, `OutboxOp`, `SyncPushInput`, `SyncPushResult`)
- [x] **A2** Helper network LAN di Node.js (`src/server/lib/network.ts`): deteksi IPv4 lokal non-internal dari `os.networkInterfaces()`, port aktif, URL hub utama

## B. Modul Devices & Pairing (Server)

- [x] **B1** `modules/devices`:
  - `POST /devices/pairing-codes` (Owner, `devices.manage`): buat PIN 6 digit (5 menit), simpan sha256 di `device_pairing_codes`
  - `POST /devices/pair` (Publik/tanpa sesi): verifikasi kode, alokasi nomor `H01..` / `T01..`, buat token 32-byte, catat audit `device.pair`
  - `GET /devices` (Owner): daftar semua perangkat (K01, H.., T..) dengan status, versi, last seen, clock skew
  - `POST /devices/:id/revoke` (Owner): tandai `revoked_at = now()`, cabut sesi terkait, audit `device.revoke`
  - `GET /devices/network-info` (Owner / local access): info IP LAN hub & port
- [x] **B2** Middleware autentikasi perangkat: dukung token perangkat pada `Bearer <token>` untuk rute sinkron, update `last_seen_at` & `last_clock_skew_ms`
- [x] **B3** Tes unit & integrasi modul devices (`src/server/modules/devices/routes.test.ts`): 6 tes hijau (pairing berhasil, kode kedaluwarsa/salah ditolak, alokasi kode berurutan H01, H02, token valid, cabut perangkat)

## C. Sync Pull (Server)

- [x] **C1** `modules/sync/pull.ts`: Handler pull per 13 entitas master (`units`, `categories`, `brands`, `customer_groups`, `customers`, `suppliers`, `warehouses`, `payment_methods`, `products`, `product_units`, `product_barcodes`, `product_prices`, `stock_balances`)
- [x] **C2** Keyset pagination & overlap 120 dtk: parameter `since`, `limit` (default 500), `cursor` berbasis `to_char(updated_at AT TIME ZONE 'UTC')` mikrodetik + id, penghitungan `has_more` dan `next_since`
- [x] **C3** Penyaringan field sensitif (HPP/harga beli dibuang bila peminta tidak punya izin `cost.read`)
- [x] **C4** Tes sync pull (`src/server/modules/sync/routes.test.ts`): entitas units, tombstone `deleted_at`, keyset page 2 tanpa duplikasi/loop, filter `last_purchase_cost` untuk KASIR vs OWNER

## D. Sync Push (Server)

- [x] **D1** `modules/sync/push.ts`: Loop batch FIFO, periksa `sync_ops(op_id)` untuk idempotensi `DUPLICATE`, transaksi per op
- [x] **D2** Handler tipe operasi:
  - `sale.create`: eksekusi lewat service penjualan dengan mode `source: 'SYNC'` (mengizinkan stok minus lewat `stock.apply`)
  - `opname.count`: catat hasil hitungan fisik dari HP staf ke sesi opname
  - `receivable_payment.create`: pembayaran piutang dari lapangan
- [x] **D3** Penanganan status `REJECTED` (payload rusak / aturan bisnis) dan `RETRY` (kegagalan sementara)
- [x] **D4** Tes sync push (`src/server/modules/sync/routes.test.ts`): kirim sekali `APPLIED`, kirim ulang `op_id` sama `DUPLICATE` tanpa mutasi ganda, payload salah `REJECTED`, penjualan sinkron tembus stok minus

## E. Layar Koneksi (Renderer)

- [x] **E1** Hook API & store perangkat: `useDevices()`, `useNetworkInfo()`, `useCreatePairingCode()`, `useRevokeDevice()`
- [x] **E2** Komponen QR Code SVG murni (`src/renderer/components/shared/QrCodeSvg.tsx`)
- [x] **E3** Dialog Pairing (`src/renderer/features/devices/PairingDialog.tsx`): pilihan HP/Terminal, kode 6 digit besar, QR code, countdown 5 menit
- [x] **E4** Halaman `/koneksi` (`src/renderer/pages/devices/ConnectionPage.tsx`): kartu status Hub (IP LAN, port, waktu server), tabel perangkat dengan status, versi app, waktu aktif, indikator clock skew, tombol cabut
- [x] **E5** Navigasi: Menu "Koneksi & Sinkron" di sidebar AppShell untuk Owner (`devices.manage`) dan route di `App.tsx`

## F. Penutup

- [x] **F1** `npm run typecheck`, `npm run lint`, `npm test` hijau (277/277 tes lulus)
- [x] **F2** Pembaruan `plan/README.md`
