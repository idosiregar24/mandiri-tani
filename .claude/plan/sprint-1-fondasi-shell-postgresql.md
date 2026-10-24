# Sprint 1 — M0 Fondasi: Shell, PostgreSQL Portable, Server Skeleton

> Sumber: PRD §2, §3, §9 (baris S1); rules `desktop-runtime-standards.md`,
> `database-standards.md`, `backend-standards.md`. Checklist boleh dicentang
> langsung di file ini, dengan catatan 📌 singkat per item.

**Tujuan sprint:** `npm run dev` membuka aplikasi yang menyalakan
PostgreSQL portable sendiri, menjalankan migrasi, melayani
`GET /api/v1/health` di `0.0.0.0:3000`, menampilkan boot screen →
halaman placeholder, dan mematikan PostgreSQL dengan bersih saat ditutup.
`npm run dist` menghasilkan installer NSIS yang melakukan hal yang sama di
mesin bersih.

**Ringkasan status (2026-10-24):** 25 selesai · 5 sebagian · 1 belum mulai.
`npm run dev` sudah dijalankan owner: aplikasi menyala, membuat database sendiri, menampilkan status sistem, dan **uji cetak LX-310 berhasil** (Sprint 0). Sisa: verifikasi manual crash/sleep, build installer (G2).

## A. Repository & tooling

- [x] **A1** `git init` di root proyek, `.gitignore`, `.editorconfig`, commit awal tanpa `.claude/file/`
  - 📌 `git init -b main` + remote `origin`; `.gitignore` mengecualikan data toko, `node_modules`, `out`, binaries PG (`resources/postgres/{bin,lib,share}` — `VERSION` di-commit), `.cache/`. Commit & push oleh owner
- [x] **A2** Struktur `src/main`, `src/preload`, `src/renderer`, `src/server`, `src/shared`, `db/migrations`, `scripts`, `test`
  - 📌 Disusun manual (bukan template `create electron`) agar sesuai PRD §2.5; electron-vite 6 dengan entry default
- [x] **A3** TypeScript strict, alias `@/*` & `@shared/*`, ESLint + Prettier, script `typecheck`/`lint`/`test`/`dev`/`build`/`dist`
  - 📌 TypeScript **6.0.3** (typescript-eslint belum mendukung 7). `npm run dev` lewat `scripts/electron-vite.mjs` yang menghapus `ELECTRON_RUN_AS_NODE` (VS Code mewariskannya → Electron jalan sebagai Node)
- [x] **A4** Vitest terpasang
  - 📌 Vitest 5, `globalSetup` = satu cluster PostgreSQL sementara (binaries asli); DB baru per file tes
- [x] **A5** Tabel "Versi terpasang" di `plan/README.md`

## B. Renderer dasar

- [x] **B1** Tailwind v4, token `tani-*` + status, Inter self-hosted
- [ ] **B2** shadcn: `button`, `card` (sebagian)
  - 📌 **Sebagian.** `button` & `card` via CLI. **CLI salah membaca alias → menginstal paket npm asing `cn`**; sudah dicopot & import diperbaiki. `dialog`, `input`, `label`, `sonner` menyusul di Sprint 2 (dibutuhkan login/form) — cek ulang import setiap `shadcn add`
- [x] **B3** React Router + TanStack Query + Zustand; `lib/api-client.ts`
  - 📌 Zustand terpasang, belum dipakai (keranjang kasir S5)
- [x] **B4** Boot screen dari `window.pos.onLifecycle()` + layar FATAL ("Coba lagi", "Buka folder log")

## C. PostgreSQL portable & PgManager

- [x] **C1** PostgreSQL **18.4-1** → `resources/postgres/VERSION`; SHA-256 tercatat di `scripts/postgres.sha256`
- [x] **C2** `scripts/fetch-postgres.mjs` (hanya `bin/lib/share`, ±146 MB)
  - 📌 CDN EDB ±30 KB/s per koneksi → `scripts/lib/parallel-download.mjs` (16 koneksi, retry per potongan, bisa dilanjutkan; ±300 KB/s). Ekstrak memakai `tar.exe` bawaan Windows (GNU tar dari Git Bash salah membaca `C:`). Ditambah `npm run fetch:electron` karena unduhan binary Electron oleh npm terputus
- [x] **C3** `src/main/paths.ts` (dev vs packaged, `%APPDATA%/pos-desktop`, fallback ProgramData untuk path non-ASCII)
- [x] **C4** `src/main/secrets.ts` — password `postgres` & `pos_app` terenkripsi `safeStorage` (DPAPI)
- [x] **C5** `PgManager.initCluster()` — initdb scram/UTF8/`builtin C.UTF-8`, `mandiri_tani.conf`, `pg_hba` loopback, role + DB, gagal → `pgdata.failed-<ts>`
  - 📌 Ditambah penanda `mandiri_tani.initialized` + `discardIncompleteCluster()`: first run yang terputus setelah initdb (terjadi nyata saat dev pertama) otomatis diulang dari awal
- [x] **C6** `PgManager.start()` — port 5433→5440, adopsi cluster yatim, PID basi, `pg_ctl start -w`, `pg_isready`
  - 📌 **Bug kritis ditemukan & diperbaiki:** `pg_ctl start` lewat `execFile` tak pernah selesai di Windows karena postmaster mewarisi pipe stdout/stderr → aplikasi tersangkut di "Menyalakan database". Sekarang output ke file + tunggu event `exit`. Tes start/stop turun dari 60 dtk (timeout) ke < 2 dtk
- [x] **C7** `PgManager.stop()` — fast, fallback immediate, idempoten
- [ ] **C8** Verifikasi manual crash (sebagian)
  - 📌 **Sebagian.** Otomatis (tes): adopsi cluster yang masih hidup dari sesi sebelumnya ✓, PID basi ✓, port terpakai ✓, postgres tetap hidup setelah `pg_ctl` keluar ✓. Belum: kill paksa Electron dari Task Manager & cabut listrik/VM → catat hasil

## D. Database & migrasi

- [x] **D1** `pool.ts` (NUMERIC/INT8 string, DATE string, statement_timeout 15 dtk) + `tx.ts` (`withTransaction` retry 40001/40P01 ×3, `withClient`)
- [x] **D2** Migration runner — advisory lock, checksum (CRLF dinormalkan), satu file satu transaksi, migrasi rusak di-rollback penuh
- [x] **D3** `0001_system.sql` (11 tabel sistem + `ensure_updated_at_triggers()` + audit append-only)
  - 📌 **Seluruh `mandiri_tani_schema.sql` kini dieksekusi di tes** (`test/schema.test.ts`: ≥ 50 tabel, trigger `updated_at` lengkap, **semua FK ber-index**, ledger append-only). Tes ini menemukan FK tanpa index `device_pairing_codes.used_by_device_id` → diperbaiki di skema & 0001
- [x] **D4** Seed perangkat hub `K01` (idempoten)
- [x] **D5** Helper tes `test/global-setup.ts` + `test/pg.ts`

## E. Embedded server

- [x] **E1** `createApp` + `createServer` tanpa electron (dijaga ESLint), request id, pino, helmet CSP, kontrak error
- [x] **E2** `GET /api/v1/health` (versi, DB, pool, waktu) + tes
- [x] **E3** Listen `0.0.0.0:3000`; port terpakai → `PORT_IN_USE` berbahasa Indonesia (tes)
- [ ] **E4** Produksi: Express melayani renderer; window pindah ke `http://127.0.0.1:3000/` setelah READY (sebagian)
  - 📌 **Sebagian.** Kode & `npm run build` jalan; jalur produksi baru terbukti setelah installer (G2)

## F. Lifecycle Electron

- [x] **F1** Single-instance lock, `userData` = `%APPDATA%/pos-desktop`, urutan boot PRD §3.2
- [ ] **F2** Shutdown: `before-quit` → server → pool → `pg_ctl stop`; `session-end`; `powerMonitor.resume` (sebagian)
  - 📌 **Sebagian.** Kode lengkap; tutup jendela normal di dev ✓. Belum diuji: logoff/shutdown Windows saat aplikasi terbuka, sleep → resume
- [x] **F3** Preload `window.pos` (lifecycle, info, log, printer), IPC memvalidasi pengirim + Zod, BrowserWindow sandbox

## G. Packaging

- [ ] **G1** `electron-builder.yml` + `build/installer.nsh` (sebagian)
  - 📌 **Sebagian.** Ditulis: NSIS x64 perMachine, `extraResources` postgres + migrations, `electronDist` lokal, rule firewall TCP 3000 Private. Belum di-build
- [ ] **G2** `npm run dist` → install di Windows bersih → app menyala, health terjangkau dari HP di Wi-Fi, uninstall menyisakan data

## Definition of Done Sprint 1

- [x] `npm run typecheck && npm run lint && npm test` hijau — 8 file, **42 tes**, ±30 dtk
- [ ] Boot normal ≤ 8 dtk (HDD) / ≤ 4 dtk (SSD) — ukur di boot kedua (pertama = initdb ±1 menit)
- [ ] Skenario C8 dan G2 terverifikasi dan dicatat
- [x] `mandiri_tani_schema.sql` tervalidasi terhadap PostgreSQL asli (D3)
- [x] `plan/README.md` diperbarui
