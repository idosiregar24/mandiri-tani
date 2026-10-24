# Security Standards

Turunan PRD §4.2 (matriks hak akses) dan §7.4 (NFR-SEC). Server POS
listen di `0.0.0.0:3000` — **setiap perangkat di Wi-Fi toko (dan kelak di
tailnet) bisa menjangkaunya**. Anggap jaringan tidak tepercaya.

## 1. Authentication

- **User:** username + password (backoffice) atau username + PIN 6 digit
  (kasir & otorisasi). Hash **argon2id** (`@node-rs/argon2`, N-API — aman
  untuk Electron). Jangan bcrypt/sha untuk password.
- Lockout: 5 gagal → `locked_until = now + 5 menit`; pesan gagal generik
  ("Username atau PIN salah"). Login gagal dicatat audit.
- **Sesi:** token acak 32 byte (`crypto.randomBytes`), dikirim
  `Authorization: Bearer`, disimpan di DB **sebagai SHA-256** (`sessions.token_hash`).
  Kedaluwarsa: kasir 12 jam idle, backoffice 8 jam; logout = revoke.
- **Perangkat:** setiap perangkat non-hub punya token perangkat
  (`X-Device-Token`, hash di `devices.token_hash`) dari pairing (kode 6
  digit sekali pakai, berlaku 5 menit). Perangkat dicabut → semua
  requestnya 401.
- **Tidak ada bypass berbasis IP/localhost.** Request dari `127.0.0.1`
  tetap wajib token — `tailscale serve` (v2.0) dan proxy lain membuat
  request remote tampak lokal. Jangan menulis `if (req.ip === '127.0.0.1')`
  untuk melonggarkan apa pun.

## 2. Authorization — 3 lapis

1. **Permission di route:** `requirePermission('sales.void')`. Peta role →
   permission **hanya** di `src/shared/permissions.ts` (sumber: PRD §4.2).
   UI membaca peta yang sama untuk menyembunyikan menu — tapi UI bukan
   pengaman.
2. **Kepemilikan/scope di service:** kasir hanya melihat laporan shift
   miliknya; void hanya untuk nota di shift yang masih OPEN; HPP/laba
   (`cost.read`) tidak dikirim ke role tanpa izin — **filter di query/
   serializer**, bukan disembunyikan di UI.
3. **Otorisasi supervisor (FR-POS-20):** aksi yang butuh otorisasi
   menghasilkan `423 AUTHORIZATION_REQUIRED` + `permission`. Klien
   memanggil `POST /auth/authorize` (username + PIN pemberi izin) →
   token `authorization_grants` sekali pakai, ≤ 2 menit, terikat ke
   permission & perangkat. Request diulang dengan header
   `X-Authorization-Grant`. Grant tidak pernah menaikkan hak sesi.

Data sensitif per role:
- `products.avg_cost`, `cost_per_base`, laporan laba → hanya `cost.read` (Owner).
- Laporan arus kas & laba → hanya Owner.
- Kasir: harga & stok boleh, HPP tidak.

## 3. Test RBAC wajib

Setiap route ber-permission: minimal 1 test role berhak (2xx) + 1 test role
ditolak (403). Aksi otorisasi: test tanpa grant (423), grant dari role tanpa
izin (403), grant kedaluwarsa/terpakai (401). Respons ke role tanpa
`cost.read` di-assert **tidak** mengandung field HPP/laba.

## 4. Input & output

- Semua body/query/params divalidasi Zod (`src/shared/schemas`) sebelum ke
  service. `express.json({ limit: '2mb' })`.
- SQL selalu berparameter (`database-standards.md` §7).
- Serializer eksplisit per respons (whitelist field) — jangan kirim baris
  DB mentah (`password_hash`, `pin_hash`, `token_hash` tidak boleh pernah
  keluar).
- Rate limit: login & authorize 10/menit/IP; API umum 600/menit/perangkat;
  pairing 5/menit/IP.
- CORS: hanya origin aplikasi sendiri (`http://127.0.0.1:3000`) dan origin
  Capacitor yang di-whitelist. Tanpa `*`.
- Header keamanan via `helmet` (CSP untuk build renderer yang dilayani Express).

## 5. Electron

- `BrowserWindow`: `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`, `webSecurity: true`; navigasi & `window.open` ke luar
  origin aplikasi diblok (`will-navigate`, `setWindowOpenHandler`).
- Preload mengekspos API sempit lewat `contextBridge` (`window.pos.*`) —
  tidak pernah `ipcRenderer` mentah. Handler `ipcMain.handle` memvalidasi
  `event.senderFrame.url` dan payload (Zod).
- Tidak ada `shell.openExternal` dengan URL dari input user tanpa
  whitelist skema (`https:` saja).

## 6. Database & rahasia

- PostgreSQL `listen_addresses = '127.0.0.1'`, `pg_hba` hanya loopback
  `scram-sha-256` — tidak pernah `trust`, tidak pernah `0.0.0.0/0`.
- Aplikasi login sebagai `pos_app` (bukan superuser).
- Password DB dibuat acak saat initdb, disimpan terenkripsi `safeStorage`
  (DPAPI) di `%APPDATA%/pos-desktop/secrets.bin`. Tidak pernah di log, env
  file, atau source code.
- Backup `.dump` berisi seluruh data toko — folder backup hanya bisa diatur
  Owner; restore hanya Owner (audit).

## 7. Audit trail — append-only

Wajib dicatat via `auditService.record(tx, …)` **di dalam transaksi aksi
itu sendiri**: login/gagal login/lockout, otorisasi supervisor (pemberi &
peminta), void nota, retur, ubah harga, harga manual, jual di bawah HPP,
lewat limit kredit, penyesuaian & posting opname, tutup shift dengan
selisih, ubah user/role/PIN, pairing/cabut perangkat, ubah setting,
backup/restore. `audit_logs` ditolak `UPDATE/DELETE` oleh trigger; tidak ada
endpoint hapus untuk siapa pun, termasuk Owner.

## 8. Jaringan

- Firewall Windows: rule inbound TCP 3000 **profil Private saja** (dibuat
  installer). Jangan menyarankan user mematikan firewall.
- v1 memakai HTTP polos di LAN — jangan kirim data yang tidak perlu ke
  perangkat (prinsip minimal: HP staf tidak menerima HPP).

## 9. Sebelum merge

Jalankan `/security-review` untuk diff yang menyentuh: auth/sesi/pairing,
permission, endpoint sync, IPC/preload, penanganan file (backup/restore,
import Excel), atau apa pun yang memindahkan uang/stok.
