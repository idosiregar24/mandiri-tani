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

**Ringkasan status:** 0 selesai · 1 sebagian · 30 belum mulai.

## A. Repository & tooling

- [ ] **A1** `git init` di root proyek (`Mandiri Tani/`), `.gitignore` (node_modules, out, dist, `resources/postgres/`, `*.log`, `.env*`, **`.claude/file/`**, `*.i5bu`, `*.dump`), `.editorconfig`, commit awal berisi `.claude/` **tanpa** `.claude/file/` — cek `git status` sebelum commit: tidak boleh ada xlsx/pdf/i5bu data toko
  - 📌 **Status:** Sebagian (2026-10-24). `git init -b main`, remote `origin` = `https://github.com/idosiregar24/mandiri-tani.git`, `README.md`, `.gitignore` (termasuk `.claude/file/`, `*.i5bu`, `*.dump`, `.claude/settings.local.json`) sudah dibuat; `git add --dry-run .` terverifikasi tidak menyertakan data toko. **Commit & push dilakukan owner sendiri.** `.editorconfig` menyusul bersama scaffold (A2)
- [ ] **A2** Scaffold `electron-vite` (template React + TypeScript) → struktur `src/main`, `src/preload`, `src/renderer`; tambah `src/server`, `src/shared`, `db/migrations`, `scripts`, `test`
- [ ] **A3** TypeScript strict di semua tsconfig; path alias `@/*` (renderer) dan `@shared/*`; ESLint + Prettier; script `typecheck`, `lint`, `test`, `dev`, `build`, `dist`
- [ ] **A4** Vitest terpasang (unit dulu; integrasi DB di D5)
- [ ] **A5** Isi tabel "Versi terpasang" di `plan/README.md`

## B. Renderer dasar

- [ ] **B1** Tailwind CSS v4 (`@tailwindcss/vite`), `src/renderer/styles/app.css` dengan token `tani-*` + status (design-standards §1), font Inter self-hosted
- [ ] **B2** `npx shadcn@latest init` (Vite, Radix), tambah `button`, `card`, `dialog`, `input`, `label`, `sonner`; pastikan alias sesuai folder `components/ui`
- [ ] **B3** React Router + TanStack Query provider + Zustand terpasang; `lib/api-client.ts` (fetch `/api/v1`, mapping error `{error:{code,message}}`)
- [ ] **B4** **Boot screen** yang membaca state lifecycle via `window.pos.onLifecycle()` (BOOTING … READY / FATAL) dengan pesan Bahasa Indonesia; layar FATAL dengan tombol "Coba lagi" dan "Buka folder log"

## C. PostgreSQL portable & PgManager

- [ ] **C1** Pilih major PostgreSQL (≥ 15; terbaru yang tersedia sebagai zip binaries Windows x64) → `resources/postgres/VERSION` + SHA-256 di `scripts/postgres.sha256`
- [ ] **C2** `scripts/fetch-postgres.mjs`: unduh zip, verifikasi checksum, ekstrak ke `resources/postgres/` hanya `bin`, `lib`, `share` (buang pgAdmin, doc, include, symbols, StackBuilder)
- [ ] **C3** `src/main/paths.ts`: binDir (dev vs packaged), dataDir `%APPDATA%/pos-desktop`, pgdata/logs/backups; fallback `C:\ProgramData\pos-desktop` bila path non-ASCII (PRD §3.1)
- [ ] **C4** `src/main/secrets.ts`: generate & simpan password `postgres` + `pos_app` terenkripsi `safeStorage`
- [ ] **C5** `PgManager.initCluster()` — PRD §3.3 lengkap: initdb (`--pwfile`, scram, UTF8, locale), `mandiri_tani.conf`, `pg_hba.conf` loopback saja, buat role `pos_app` + DB `mandiri_tani`; gagal → pindahkan ke `pgdata.failed-<ts>`
- [ ] **C6** `PgManager.start()` — PRD §3.4: probe port 5433→5440, `pg_ctl status` (pakai cluster yatim), tangani PID basi, `pg_ctl start -w -t 60`, readiness `pg_isready` + `SELECT 1`
- [ ] **C7** `PgManager.stop()` — `-m fast -w -t 30`, fallback `-m immediate`; idempoten
- [ ] **C8** Verifikasi manual & catat di 📌: (a) postgres tetap hidup setelah `pg_ctl` keluar dan tidak terbunuh bersama terminal dev, (b) kill paksa proses Electron → boot berikutnya memakai cluster yatim, (c) matikan paksa `postgres.exe` → boot berikutnya pulih (PID basi + WAL recovery)

## D. Database & migrasi

- [ ] **D1** `src/server/db/pool.ts` (konfigurasi NFR-DB-01, parser NUMERIC tetap string, `date` tetap string) + `tx.ts` (`withTransaction` dengan retry 40001/40P01, `withClient`)
- [ ] **D2** Migration runner (`migrate.ts`): `schema_migrations` (nama, checksum, applied_at), advisory lock, satu file satu transaksi, checksum berubah → error
- [ ] **D3** `db/migrations/0001_system.sql` dari `mandiri_tani_schema.sql` bagian 0–1: extension `pg_trgm`, fungsi `set_updated_at`/`forbid_mutation`, tabel `settings`, `users`, `devices`, `device_pairing_codes`, `sessions`, `authorization_grants`, `audit_logs`, `doc_sequences`, `sync_ops` + trigger. 📌 Jalankan seluruh `mandiri_tani_schema.sql` sekali ke DB kosong untuk memvalidasi sintaks — perbaiki file skema bila ada error
- [ ] **D4** Seed perangkat hub `K01` (kind HUB) saat first run
- [ ] **D5** Helper test `test/pg.ts`: cluster sementara (port 5439) dari binaries yang sama, migrasi, teardown — dipakai test integrasi

## E. Embedded server

- [ ] **E1** `src/server/app.ts` + `server.ts` (`createServer(config) → {start, stop}`), tanpa import electron; middleware requestId, pino logger, `express.json`, `helmet`, `errorHandler` (AppError/Zod/PG → kontrak error backend-standards §3)
- [ ] **E2** `GET /api/v1/health` → versi app, status DB, statistik pool, waktu server; test integrasi
- [ ] **E3** Listen `0.0.0.0:3000`; port terpakai → FATAL dengan pesan jelas (FR-SRV-01)
- [ ] **E4** Produksi: Express melayani build renderer statis di `/`; `BrowserWindow.loadURL('http://127.0.0.1:3000/')`. Dev: Vite proxy `/api` → 3000

## F. Lifecycle Electron

- [ ] **F1** `src/main/index.ts`: `requestSingleInstanceLock` (instance kedua memfokuskan window pertama), `app.setName('pos-desktop')` / userData, urutan boot PRD §3.2 lewat `lifecycle.ts`
- [ ] **F2** Shutdown PRD §3.6: `before-quit` → `server.stop()` → `pool.end()` → `PgManager.stop()` → `app.exit(0)`; `session-end` jalur cepat; `powerMonitor.resume` health check
- [ ] **F3** Preload `contextBridge` → `window.pos.onLifecycle`, `window.pos.appInfo`; tipe di `src/shared/bridge.ts`; BrowserWindow dengan opsi keamanan (security-standards §5)

## G. Packaging

- [ ] **G1** `electron-builder.yml`: NSIS x64, `perMachine: true`, `oneClick: false`, `extraResources` postgres; `build/installer.nsh` menambah/menghapus rule firewall TCP 3000 profil Private
- [ ] **G2** `npm run dist` → install di Windows bersih (VM / akun user lain, idealnya dengan nama user berspasi) → app menyala, `http://<ip-lan>:3000/api/v1/health` terjangkau dari HP di Wi-Fi yang sama, uninstall tidak menghapus `%APPDATA%/pos-desktop`

## Definition of Done Sprint 1

- [ ] `npm run typecheck && npm run lint && npm test` hijau
- [ ] Boot normal ≤ 8 dtk (HDD) / ≤ 4 dtk (SSD) — catat angka nyata di 📌
- [ ] Skenario C8 (a–c) dan G2 terverifikasi dan dicatat
- [ ] `mandiri_tani_schema.sql` tervalidasi terhadap PostgreSQL asli (D3)
- [ ] `plan/README.md` diperbarui: status S1, versi terpasang, penyimpangan bila ada
