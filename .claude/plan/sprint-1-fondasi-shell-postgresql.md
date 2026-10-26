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

**Ringkasan status (2026-10-26):** 29 selesai · 1 sebagian · 1 menunggu owner.
`npm run dev` sudah dijalankan owner: aplikasi menyala, membuat database sendiri, menampilkan status sistem, dan **uji cetak LX-310 berhasil** (Sprint 0). 2026-10-26: installer dibuild, build terpaket diuji (boot, jalur produksi, kill paksa, crash PostgreSQL, tutup normal). Sisa — **butuh owner/mesin lain**: install di Windows bersih + HP di Wi-Fi + uninstall (G2); logoff Windows & sleep → resume (F2, juga dijadwalkan ulang di S13).

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
- [x] **B2** shadcn: `button`, `card`, `dialog`, `input`, `label`, `select`, `tabs`, `table`, `badge`, `checkbox`, `textarea`
  - 📌 Semua via CLI (2026-10-26, sekalian kebutuhan S3 D6). **CLI selalu salah membaca alias → menginstal paket npm asing `cn`** dan menulis `import { cn } from "cn"` — terjadi lagi, dicopot & diperbaiki; kini **ESLint menolak import `cn`** sehingga tidak bisa lolos diam-diam. `sonner` sengaja tidak dipasang: design-standards §3 melarang toast yang hilang sendiri untuk error (pakai `Notice`)
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
- [x] **C8** Verifikasi manual crash
  - 📌 Otomatis (tes): adopsi cluster yang masih hidup dari sesi sebelumnya ✓, PID basi ✓, port terpakai ✓, postgres tetap hidup setelah `pg_ctl` keluar ✓.
  - 📌 **Build terpaket, 2026-10-26:** (1) kill paksa proses utama Electron → postgres tetap hidup → buka ulang: *"adopting PostgreSQL left running by a previous session"*, READY 0,3 dtk ✓. (2) kill paksa Electron **dan** postgres (`postmaster.pid` basi tertinggal, pendekatan cabut listrik) → buka ulang: PID basi dibersihkan, PG *"automatic recovery in progress … redo done"*, READY 3,7 dtk ✓. Cabut listrik sungguhan (cache disk OS) diuji di S13 (NFR-REL)

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
- [x] **E4** Produksi: Express melayani renderer; window pindah ke `http://127.0.0.1:3000/` setelah READY
  - 📌 Terbukti di `release/win-unpacked` (2026-10-26): log menunjukkan `GET /` + aset dari server setelah READY; SPA fallback 200; health terjangkau lewat IP LAN (`10.1.1.1:3000`). **Bug ditemukan & diperbaiki:** build memakai URL aset relatif (`./assets/…`, perlu untuk boot screen `file://`) → muat ulang halaman dalam (`/barang/123`) akan meminta `/barang/assets/…` dan layar kosong. Server kini menyisipkan `<base href="/">` ke shell SPA (tes di `server.test.ts`)

## F. Lifecycle Electron

- [x] **F1** Single-instance lock, `userData` = `%APPDATA%/pos-desktop`, urutan boot PRD §3.2
- [ ] **F2** Shutdown: `before-quit` → server → pool → `pg_ctl stop`; `session-end`; `powerMonitor.resume` (sebagian)
  - 📌 **Sebagian.** Kode lengkap; tutup jendela normal di dev ✓ dan di build terpaket ✓ (2026-10-26: proses & postgres berhenti, `postmaster.pid` terhapus, 0,4 dtk). Belum diuji (tidak bisa dari sesi ini): logoff/shutdown Windows saat aplikasi terbuka, sleep → resume — owner, atau di S13
- [x] **F3** Preload `window.pos` (lifecycle, info, log, printer), IPC memvalidasi pengirim + Zod, BrowserWindow sandbox

## G. Packaging

- [x] **G1** `electron-builder.yml` + `build/installer.nsh`
  - 📌 NSIS x64 perMachine, `extraResources` postgres + migrations, `electronDist` lokal, rule firewall TCP 3000 Private. **`npm run dist` berhasil (2026-10-26):** `release/MandiriTaniPOS-Setup-0.1.0.exe` 158 MB (`win-unpacked` 523 MB). Belum ada ikon aplikasi (ikon Electron bawaan) & belum ditandatangani — dicatat untuk S14
  - 📌 Catatan dev: menjalankan `.exe` dari terminal VS Code gagal diam-diam karena `ELECTRON_RUN_AS_NODE=1` diwariskan — hapus variabel itu dulu (sama seperti `scripts/electron-vite.mjs`). Tidak terjadi bila dibuka dari shortcut
- [ ] **G2** `npm run dist` → install di Windows bersih → app menyala, health terjangkau dari HP di Wi-Fi, uninstall menyisakan data
  - 📌 **Menunggu owner.** Installer sudah ada (G1). Perlu mesin Windows bersih (atau VM) + HP: jalankan installer (minta admin sekali), buka `http://<IP-PC>:3000/api/v1/health` dari HP, uninstall → cek `%APPDATA%\pos-desktop` masih ada

## Definition of Done Sprint 1

- [x] `npm run typecheck && npm run lint && npm test` hijau — 8 file, **42 tes**, ±30 dtk (akhir S1); terus hijau saat S3
- [x] Boot normal ≤ 8 dtk (HDD) / ≤ 4 dtk (SSD) — ukur di boot kedua (pertama = initdb ±1 menit)
  - 📌 SSD laptop dev, build terpaket: *app starting* → READY **1,26 dtk**; klik → health menjawab **1,8 dtk**. HDD belum diukur (ukur di PC toko saat G2)
- [ ] Skenario C8 dan G2 terverifikasi dan dicatat — C8 ✓, G2 menunggu owner
- [x] `mandiri_tani_schema.sql` tervalidasi terhadap PostgreSQL asli (D3)
- [x] `plan/README.md` diperbarui
