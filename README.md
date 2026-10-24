# mandiri-tani

POS & backoffice **offline-first** untuk toko tani Mandiri Tani — aplikasi desktop
Windows (Electron) dengan PostgreSQL portable dan server lokal di dalamnya.

Dokumen produk & aturan kerja ada di [`.claude/`](.claude/CLAUDE.md):
PRD, skema database, rencana sprint (`.claude/plan/`), standar kode (`.claude/rules/`).

## Menjalankan (developer)

Butuh: Windows 10/11 x64, Node.js ≥ 22.12, Git.

```bash
npm install
npm run fetch:postgres   # sekali: unduh PostgreSQL 18 portable ke resources/postgres (±320 MB)
npm run dev              # buka aplikasi (Electron + Vite, hot reload)
```

Saat pertama dijalankan aplikasi membuat database sendiri di
`%APPDATA%\pos-desktop\pgdata` (±1 menit), lalu menyalakan server di
`http://0.0.0.0:3000` — cek `http://127.0.0.1:3000/api/v1/health`.

| Perintah | Fungsi |
|---|---|
| `npm run typecheck` | TypeScript strict (main/server & renderer) |
| `npm run lint` | ESLint |
| `npm test` | Vitest — memakai **PostgreSQL asli** (cluster sementara, port 5439+) |
| `npm run build` | Bundle produksi ke `out/` |
| `npm run dist` | Installer Windows (NSIS) ke `release/` |

## Struktur

```
src/main/       Electron main: siklus hidup, PgManager (initdb/pg_ctl), window, IPC
src/preload/    jembatan sempit window.pos
src/server/     server Express (tanpa electron): db, migrasi, middleware, modul API
src/renderer/   UI React + Tailwind v4 + shadcn/ui
src/shared/     kode bersama main/server/UI
db/migrations/  migrasi SQL forward-only
tools/uji-cetak/  uji cetak Epson LX-310 (tanpa install)
```

> Folder `.claude/file/` berisi data nyata toko (pelanggan, backup iPOS) dan
> **tidak pernah** di-commit.
