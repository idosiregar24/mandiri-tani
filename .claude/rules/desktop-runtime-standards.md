# Desktop Runtime Standards — Electron Main, PostgreSQL Portable, Perangkat Keras, Packaging

Berlaku untuk `src/main/`, `src/preload/`, `scripts/`, `electron-builder.yml`.
Spesifikasi lengkap lifecycle: PRD §3; perangkat keras: PRD §8.

## 1. Tanggung jawab main process

```
src/main/
├── index.ts            # entry: single-instance lock, urutan boot, event app
├── lifecycle.ts        # state machine boot/shutdown (PRD §3.2) + broadcast ke renderer
├── paths.ts            # SATU-SATUNYA tempat path: binDir, dataDir, pgdata, logs, backups
├── pg/PgManager.ts     # initdb, configure, start, status, stop, port probe, PID basi
├── pg/backup.ts        # pg_dump / pg_restore, retensi
├── secrets.ts          # safeStorage encrypt/decrypt secrets.bin
├── window.ts           # BrowserWindow (opsi keamanan — security-standards §5)
├── ipc/                # handler ipcMain per area: printer.ts, lifecycle.ts, app.ts
└── hardware/           # escpos/ (encoder + receipt builder), transports/ (network, serial, windows-raw)
```

- Main process **memiliki** lifecycle PostgreSQL: tidak ada kode lain yang
  memanggil `pg_ctl`/`initdb`/`pg_dump`.
- Server API diimpor dari `src/server` sebagai `createServer(config)`; main
  hanya memanggil `start()`/`stop()` dan meneruskan config (path, port,
  kredensial DB). Server tidak meng-import electron.

## 2. Menjalankan binaries PostgreSQL

- **Selalu** `execFile`/`spawn` dengan array argumen, `shell: false`,
  `windowsHide: true`. Path install & `%APPDATA%` bisa berisi spasi atau
  karakter non-ASCII — jangan pernah menyusun command string.
- Path binaries: `app.isPackaged ? process.resourcesPath + '/postgres/bin'
  : '<repo>/resources/postgres/bin'` — hanya di `paths.ts`.
- Setiap pemanggilan punya timeout & menangkap stdout/stderr ke log app.
- Password tidak pernah lewat argumen command line (terlihat di task
  manager): initdb memakai `--pwfile` sementara (dihapus segera), koneksi
  memakai `PGPASSWORD` di `env` proses anak atau langsung lewat `pg` Pool.
- Urutan boot, deteksi cluster yatim, PID basi, port fallback 5433→5440,
  dan konfigurasi `mandiri_tani.conf`: ikuti PRD §3.3–3.4 persis. Nilai
  `fsync`, `synchronous_commit`, `full_page_writes` **tidak boleh** diubah.

## 3. Shutdown

- `before-quit`: `preventDefault()` sekali, jalankan `shutdown()`:
  `server.stop()` → `pool.end()` → `pg_ctl stop -m fast -w -t 30` → fallback
  `-m immediate` → `app.exit(0)`. Idempoten (dipanggil dua kali = aman).
- `BrowserWindow` event `session-end` (logoff/shutdown Windows): jalur
  cepat langsung ke `pg_ctl stop -m fast -t 10`.
- `powerMonitor.on('resume')`: health check DB (PRD §3.7), restart PG bila
  mati, kirim status ke renderer.
- Jangan pernah memblok shutdown karena shift masih OPEN atau antrean
  cetak — data sudah di DB.

## 4. IPC

- Kanal bernama `pos:<area>:<aksi>` (`pos:printer:print`,
  `pos:lifecycle:state`). Satu file handler per area di `src/main/ipc/`.
- `ipcMain.handle` (request/response) — bukan `ipcMain.on` + reply manual.
- Payload divalidasi Zod (`src/shared/bridge.ts` mendefinisikan skema &
  tipe `window.pos`); sender divalidasi (security-standards §5).
- IPC hanya untuk hardware, lifecycle, dan info aplikasi. **Data bisnis
  lewat REST API** (ADR-01) — jangan menambah `pos:sales:create`.

## 5. Printer ESC/POS & laci

- Alur: `ReceiptBuilder` (data nota → model baris) → `EscPosEncoder`
  (→ `Uint8Array`) → `PrinterTransport.send(bytes)`.
- Transport: `network` (TCP 9100, modul `net`), `serial` (`serialport`),
  `windows-raw` (job RAW ke spooler Windows, tanpa dialog). Satu interface
  `PrinterTransport { send(bytes, { timeoutMs }): Promise<void> }`.
- Lebar 32 kolom (58 mm) / 48 kolom (80 mm); wrap nama barang; angka rata
  kanan; transliterasi non-ASCII. Buka laci `1B 70 00 19 FA` (pin 2) /
  `1B 70 01 19 FA` (pin 5) sesuai setting.
- Cetak **setelah** API mengembalikan sukses (transaksi sudah COMMIT).
  Gagal cetak → simpan job di antrean memori + kembalikan error terstruktur
  ke renderer; jangan pernah memicu rollback/void.
- Encoder & builder diuji dengan snapshot byte (Vitest) — tidak butuh
  printer fisik.
- Modul native (`serialport`, helper spooler) wajib di-rebuild untuk ABI
  Electron (`electron-builder install-app-deps`) dan diuji di build
  terpaket, bukan hanya di dev.

## 6. Packaging (Electron Builder → NSIS)

- `electron-builder.yml`: `appId: id.mandiritani.pos`, `productName:
  Mandiri Tani POS`, target `nsis` x64, `nsis.perMachine: true`
  (butuh admin sekali untuk rule firewall), `oneClick: false`,
  `allowToChangeInstallationDirectory: true`.
- `extraResources`: `resources/postgres/**` → `postgres/` (bin, lib, share
  saja — buang `pgAdmin 4`, `doc`, `include`, `symbols`, `StackBuilder`
  untuk ukuran installer).
- Skrip NSIS custom (`build/installer.nsh`): tambah rule firewall TCP 3000
  profil Private saat install; hapus saat uninstall. Uninstall **tidak**
  menghapus `%APPDATA%/pos-desktop` (data toko) — tampilkan pesan bahwa data
  tetap tersimpan.
- `resources/postgres/` di-`.gitignore`; diunduh oleh
  `scripts/fetch-postgres.mjs` (versi dari `resources/postgres/VERSION`,
  verifikasi checksum SHA-256 yang dicatat di repo).
- Versi aplikasi = `package.json` `version` (semver); tampil di struk
  diagnostik, health endpoint, dan halaman Tentang.

## 7. Log

- Log app: pino → `%APPDATA%/pos-desktop/logs/app-YYYY-MM-DD.log`, retensi
  30 hari. Log PG di folder yang sama (`logging_collector`).
- Jangan log: password, PIN, token, isi `secrets.bin`, body request
  login/authorize.
