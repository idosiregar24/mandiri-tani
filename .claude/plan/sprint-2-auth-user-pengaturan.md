# Sprint 2 — Login, User, Hak Akses, Audit & Pengaturan

> Milestone **M0 Fondasi**. Requirement: PRD §4.2 (matriks hak akses), §5.8
> (FR-SYS-01, 02, 03, 06), §7.4 (NFR-SEC-02, 03, 05, 06), FR-POS-20 (otorisasi PIN
> Owner — lapisan server). Aturan: `rules/security-standards.md` §1–3, §7;
> `rules/backend-standards.md`; `rules/design-standards.md` §0.

**Dikerjakan sesudah S3 & S4.** Yang sudah ada dan tidak dibangun ulang:
tabel `users`, `devices`, `sessions`, `authorization_grants`, `audit_logs`,
`settings`, `doc_sequences` (migrasi `0001`); perangkat hub `K01`
(`db/bootstrap.ts`); `numbering.ts` (S4 A2); `recordAudit()`;
`permissions.ts`; `requirePermission()`; `AppShell` + menu
(`lib/navigation.ts`). Sampai sprint ini selesai, semua request lewat
**kunci akses lokal = OWNER** (S3-1) dan `useRole()` selalu `OWNER`.

**Ringkasan status (2026-10-29):** 13/27 item (A3, A4, B1–B7, C3, D1–D3) · **164 tes** hijau. Aplikasi kembali bisa dipakai: wizard pertama kali → login. Belum dicoba di jendela aplikasi (lihat catatan E3).n & wizard (C3, D1–D3) selesai.

## Keputusan sprint ini

| # | Keputusan | Alasan |
|---|---|---|
| S2-1 | **Kunci akses lokal tidak lagi = OWNER.** Kunci itu hanya membuktikan "ini jendela aplikasi di PC hub (K01)" dan hanya membuka: status setup, wizard first-run (selama belum ada user), daftar user untuk layar login, dan `POST /auth/login`. Semua endpoint bisnis butuh **token sesi** | Tetap tanpa bypass IP/localhost (security §1); perangkat lain belum bisa login sampai pairing S11 |
| S2-2 | Login: **KASIR** = username + PIN 6 digit; **OWNER** = username + password (PIN Owner wajib juga, untuk otorisasi & mode kasir). User boleh login dengan metode apa pun yang kredensialnya ada | FR-SYS-03; PIN cepat untuk kasir |
| S2-3 | Sesi: token acak 32 byte, disimpan SHA-256; kedaluwarsa **idle** 12 jam (login PIN) / 8 jam (login password); `last_used_at` diperbarui paling sering 1×/menit; logout & nonaktif user = cabut semua sesinya | security §1 |
| S2-4 | Lockout: 5 gagal → `locked_until = now + 5 menit`; pesan selalu generik "Username atau PIN salah"; gagal, terkunci, dan berhasil dicatat audit | FR-SYS-03, NFR-SEC-05 |
| S2-5 | Layar login menampilkan **kartu nama user aktif** (nama + role, tanpa data lain) lalu kotak PIN/password — hanya di PC hub (lewat kunci akses lokal) | Kasir baru tidak perlu menghafal username (design §0) |
| S2-6 | Otorisasi PIN Owner (`authorization_grants`) dibangun **lapisan servernya** di sprint ini: `POST /auth/authorize`, `requirePermission()` mengembalikan **423** untuk permission `OWNER_AUTHORIZABLE`, grant sekali pakai ≤ 2 menit, terikat permission + perangkat + peminta. Komponen `AuthorizeDialog` dibuat; dipakai pertama kali di S5/S7 | Satu pola untuk semua aksi sensitif; teruji sebelum dipakai |
| S2-7 | Kolom `created_by` yang boleh NULL sejak S3/S4 (S3-2, S4-1) **tetap nullable** untuk data lama; mulai sprint ini service mewajibkan `ctx.userId` | Migrasi forward-only; data impor sebelum ada akun tetap sah |
| S2-8 | Pengaturan per kunci (`settings.key`) dengan skema Zod per kunci di `src/shared/schemas/settings.ts`; simpan = `settings.write` + audit before/after. Kunci sprint ini: `store` (profil toko), `pos.cashier_discount_limit` (default 5%), `auth` (opsional, nilai default di atas) | FR-SYS-01, §4.2 batas diskon kasir |
| S2-9 | Hash: **argon2id** `@node-rs/argon2` (N-API, tanpa kompilasi). Rate limit: limiter memori sendiri per IP (login & authorize 10/menit) dan per perangkat (600/menit) — tanpa dependensi baru | security §1, §4; satu proses, tidak perlu store bersama |

## A. Fondasi

- [ ] **A1** Paket `@node-rs/argon2`; `src/server/lib/passwords.ts` (`hashSecret`, `verifySecret`, parameter argon2id dicatat); tes unit; **dicek di build terpaket** (`npm run build:win` → login berhasil)
  - 📌 Paket & `lib/passwords.ts` selesai (m=19456, t=2, p=1 tercatat di setiap hash; 2 tes). **Sisa:** cek di build terpaket
- [ ] **A2** Skema bersama `src/shared/schemas/auth.ts` (`LoginInput`, `AuthorizeInput`, `SessionUser`), `users.ts` (`UserCreateInput`, `UserUpdateInput`, PIN = 6 digit angka, password ≥ 8 huruf), `settings.ts` (S2-8)
  - 📌 `auth.ts` selesai (`LoginInput` = username + metode + rahasia; aturan PIN/password hanya dicek saat diatur, bukan saat login). **Sisa:** `users.ts`, `settings.ts` (bagian C)
- [x] **A3** Migrasi `0004_auth.sql` hanya bila perlu (mis. index `sessions (expires_at)`, `audit_logs` kolom tambahan); file skema diperbarui di commit yang sama — **atau** catat "tidak perlu migrasi"
  - 📌 Tidak perlu migrasi: tabel `0001` sudah cukup (sesi & grant dicari lewat `token_hash` UNIQUE)
- [x] **A4** `lib/rate-limit.ts` (S2-9) + tes (batas, jendela bergeser, header `Retry-After`, 429 `RATE_LIMITED` berbahasa Indonesia)
  - 📌 `lib/rate-limit.ts` jendela bergeser, kunci dipilih pemanggil, kunci lama dibersihkan; memakai `clock` (bisa dimock). Login & authorize 10/menit/IP, API umum 600/menit/perangkat. 2 tes unit

## B. Login & sesi (server)

- [x] **B1** `modules/auth`: `POST /auth/login` (password atau PIN) → token + `SessionUser`; lockout S2-4; audit `auth.login`, `auth.login_failed`, `auth.locked`; pesan generik
  - 📌 Username tidak ada → verifikasi hash dummy (waktu balasan sama); kegagalan & penguncian di-COMMIT dulu, baru dibalas 401/429 (`ACCOUNT_LOCKED` menyebut sisa menit); username tidak peka huruf besar
- [x] **B2** Middleware `authenticate` diganti: `Authorization: Bearer <token sesi>` → `req.ctx { role, userId, deviceId, via: 'SESSION', sessionId }`; kunci akses lokal hanya lewat header terpisah `X-Local-Access-Key` dan hanya untuk rute S2-1
  - 📌 `authenticate({ pool })` + `requireLocalAccess()` (header `X-Local-Access-Key`) hanya untuk `/auth/login` & `/auth/login-users`. `req.ctx` kini berisi `userId`, `username`, `fullName`, `sessionId`, `loginMethod`, `approvedBy`, `ip`
- [x] **B3** `GET /auth/me`, `POST /auth/logout` (revoke), idle timeout S2-3, user nonaktif → 401 di request berikutnya
  - 📌 Idle diperpanjang paling sering 1×/menit; user nonaktif → 401 di request berikutnya (tes)
- [x] **B4** `GET /auth/login-users` (kunci akses lokal saja): user aktif → id, nama, role, metode login yang tersedia (S2-5)
  - 📌 Hanya dengan kunci akses lokal; tanpa hash; urutan metode: kasir PIN dulu, Owner password dulu
- [x] **B5** Otorisasi PIN Owner (S2-6): `POST /auth/authorize` (username + PIN Owner, permission) → grant; `requirePermission()` untuk KASIR pada permission `OWNER_AUTHORIZABLE`: tanpa header → 423 `AUTHORIZATION_REQUIRED` + `permission`; dengan `X-Authorization-Grant` valid → lanjut & grant dipakai di transaksi yang sama (`ctx.approvedBy` → `audit_logs.approved_by`)
  - 📌 Perubahan dari rencana: grant **dipakai (atomik) saat request diterima** oleh `requirePermission()`, bukan di transaksi aksi — satu grant tidak pernah melayani dua request walau aksi pertama gagal (kasir minta PIN lagi). Pool dibaca dari `app.locals.pool`, jadi route tidak bisa lupa. Audit `auth.authorize` menyimpan `approved_by`
- [x] **B6** Tes RBAC (security §3): login benar/salah/terkunci/nonaktif; token kedaluwarsa/dicabut → 401; tiap route yang ada sekarang: 1 role berhak 2xx + KASIR ditolak 403 (helper `test/api.ts` login sebagai OWNER/KASIR); grant: tanpa (423), dari KASIR (403), kedaluwarsa/terpakai (401), permission lain (403)
  - 📌 `test/api.ts` kini membuat akun OWNER & KASIR sungguhan dan login lewat API (stub kasir dihapus) → semua tes 403 lama memakai sesi asli. `auth/routes.test.ts` 12 tes: login, pesan generik, lockout + audit, nonaktif, rate limit, logout, idle bergeser, daftar user, grant (423, sekali pakai, kedaluwarsa, aksi lain, PIN kasir, PIN salah)
- [x] **B7** Tidak ada log password/PIN/token (cek redaksi pino untuk `authorization`, `x-local-access-key`, body login/authorize)
  - 📌 Logger request hanya mencatat method/path/status/ms (tanpa header & body); logger main sudah meredaksi `password`, `pin`, `token`

## C. User, pengaturan, setup & audit (server)

- [ ] **C1** `modules/users` (`users.manage`): daftar, tambah, ubah nama/role, atur ulang password/PIN, nonaktif/aktif — **tanpa hapus**; nonaktif mencabut sesi; tidak bisa menonaktifkan/menurunkan Owner aktif terakhir; audit setiap perubahan (tanpa hash di before/after)
- [ ] **C2** `modules/settings`: `GET /settings/:key` (semua user login, field per kunci di-whitelist), `PUT /settings/:key` (`settings.write`, Zod S2-8, audit)
- [x] **C3** `modules/setup` (FR-SYS-01): `GET /setup/status` (`needsSetup` bila belum ada user); `POST /setup` sekali saja, satu transaksi: profil toko (`settings.store`), akun Owner pertama (password + PIN), gudang default (pakai UTM bila sudah ada dari impor, atau buat), audit `system.setup`. Ditolak 409 bila sudah ada user
  - 📌 `modules/setup` di balik kunci akses lokal; `pg_advisory_xact_lock` → dua wizard bersamaan menghasilkan tepat 1 Owner (tes 201 + 409). Gudang `UTM` sudah dibuat migrasi `0002`, wizard hanya mengganti **nama**-nya (kode tetap UTM). Balasan = sesi Owner (langsung masuk). Skema `users.ts` & `settings.ts` (A2) ikut dibuat. 5 tes
- [ ] **C4** `GET /audit-logs` (Owner, FR-SYS-06): filter user, aksi, tanggal; keyset `?cursor=`; tanpa endpoint ubah/hapus
- [ ] **C5** Service yang menulis `created_by` (impor, penyesuaian, opname) memakai `ctx.userId` (S2-7) + tes

## D. Layar (renderer)

- [x] **D1** Sesi di klien: `lib/session.ts` → Zustand (token di memori, bukan localStorage), `useRole()`/`useCan()` membaca role sesi; api-client mengirim token; 401 → kembali ke layar login dengan pesan "Sesi berakhir, silakan masuk lagi"
  - 📌 `lib/session.ts` Zustand (memori saja); `useRole()` = role sesi, tanpa sesi = KASIR (hak paling kecil). api-client: token sesi, `hub: true` untuk rute pra-login (header `X-Local-Access-Key`), 401 `UNAUTHENTICATED` → keluar otomatis + pesan. `AuthGate`: wizard / login / aplikasi; cache data dihapus saat keluar
- [x] **D2** Layar **Masuk**: kartu user (S2-5) → kotak PIN (6 kotak besar, keyboard angka) atau password; Enter = masuk; pesan terkunci menyebut sisa menit; fokus otomatis
  - 📌 Kartu nama user (1 user → langsung kotak PIN); PIN = **satu kotak besar** bertitik (bukan 6 kotak terpisah — lebih mudah diketik) yang langsung masuk saat 6 angka; tukar PIN/password; Esc = ganti pengguna; pesan terkunci dari server (sisa menit)
- [x] **D3** **Wizard first-run** (tampil bila `needsSetup`): 1 Profil toko → 2 Akun Owner (nama, username, password, PIN ×2) → 3 Gudang → 4 Selesai (tautan ke Impor iPOS & Uji Cetak). Satu tombol utama per langkah
  - 📌 3 langkah (Profil toko → Akun Pemilik → Gudang) dalam satu form `SetupInput` yang divalidasi per langkah; error server melompat ke langkah yang salah. Langkah 4 "Selesai" tidak dibuat: sesudah simpan Owner langsung masuk ke Beranda
- [ ] **D4** `AppShell`: menu disaring role sesi (item terlarang disembunyikan), kartu user di sidebar (nama, role) + **Keluar**; judul Beranda menyapa nama user
  - 📌 Menu sudah disaring role sesi (`navFor(useRole())`); kartu user + **Keluar** di sidebar. **Sisa:** sapaan nama di Beranda
- [ ] **D5** Halaman **Pengguna** (Owner): `DataTable` + `ActivePill`, tambah/ubah lewat dialog, atur ulang PIN/password, nonaktifkan lewat `RowActions` + `ConfirmDialog`
- [ ] **D6** Halaman **Profil Toko** (`/pengaturan`, hapus label "Segera"): nama, alamat, telepon, logo (opsional), batas diskon kasir
- [ ] **D7** Halaman **Catatan Aktivitas** (audit, Owner): filter, label aksi berbahasa Indonesia ("Login gagal", "Ubah harga"), read-only
- [ ] **D8** Komponen `AuthorizeDialog` (username Owner + PIN → grant → callback ulangi request) + hook `useAuthorizedMutation` yang menangani 423 sekali; tes komponen

## E. Penutup

- [ ] **E1** Hapus perlakuan "kunci akses lokal = OWNER" dari kode & komentar (S3-1 ditutup); perbarui `security-standards`/PRD bila ada yang berubah
- [ ] **E2** Semua tes lama diubah ke login sesi; `npm run typecheck && npm run lint && npm test` hijau
- [ ] **E3** Uji manual di build terpaket: first-run di data kosong → login Owner → buat Kasir → login Kasir (menu sedikit, Impor/Penyesuaian tersembunyi, API 403) → 5× PIN salah → terkunci → audit menampilkan semuanya

## Definition of Done

- [ ] Semua item A–E dicentang dengan catatan 📌
- [ ] Tidak ada endpoint bisnis yang bisa diakses tanpa token sesi (tes)
- [ ] Teks UI & pesan error Bahasa Indonesia, bahasa sehari-hari
- [ ] Dicoba owner: wizard, login Owner/Kasir, tambah kasir, kunci karena salah PIN

## Pertanyaan ke owner (tidak menghalangi mulai)

| # | Pertanyaan | Default bila belum dijawab |
|---|---|---|
| Q-S2-1 | Bila Owner lupa password **dan** PIN, bagaimana memulihkannya? | Disarankan membuat **2 akun Owner**; pemulihan lain dibahas di S13 (backup/restore) |
| Q-S2-2 | Berapa banyak kasir & apakah mereka memakai PC yang sama bergantian? | **Dijawab owner 2026-10-29: 1 kasir.** Satu PC hub; ganti user (kasir ↔ Owner) = Keluar lalu Masuk |
