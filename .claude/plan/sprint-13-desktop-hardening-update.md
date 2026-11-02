# Sprint 13 — Desktop Hardening & Auto-Update GitHub Releases

> Milestone **M6 Hardening & Maintenance**. Requirement: PRD §3.6–3.9, §5.7, ADR-05,
> rules/desktop-runtime-standards.md, rules/security-standards.md.
>
> Sasaran: Membangun mekanisme update jarak jauh (auto-update) berbasis GitHub Releases
> untuk aplikasi desktop kasir (Electron NSIS), dengan notifikasi pembaruan ramah-kasir,
> progress bar pengunduhan, instalasi aman (graceful shutdown PostgreSQL sebelum restart),
> serta hardening backup/restore database di antarmuka Pengaturan.

## Keputusan sprint ini

| # | Keputusan | Alasan |
|---|---|---|
| S13-1 | **GitHub Releases Provider**: Menggunakan `electron-updater` dengan target `github` mengarah ke repo `idosiregar24/mandiri-tani`. File rilis berupa `MandiriTaniPOS-Setup-<versi>.exe` + `latest.yml`. | 100% gratis, CDN cepat, terintegrasi langsung dengan `electron-builder`. |
| S13-2 | **Auto-Download Dimatikan (`autoDownload: false`)**: Aplikasi hanya memeriksa pembaruan (`checkForUpdates()`), tetapi tidak langsung mendownload secara diam-diam. Pengguna kasir memilih kapan mengunduh agar tidak mengganggu transaksi atau membebani bandwidth toko saat jam sibuk. | Mengutamakan kenyamanan dan kestabilan kasir toko. |
| S13-3 | **Graceful Shutdown sebelum Install**: Pemasangan update (`pos:updater:install`) memanggil `lifecycle.shutdown()` terlebih dahulu (HTTP stop -> Pool end -> `pg_ctl stop -m fast`), baru memanggil `autoUpdater.quitAndInstall()`. | Mencegah korupsi data PostgreSQL dan lock file database saat NSIS installer menimpa binary. |
| S13-4 | **State Machine & IPC Updater**: Status updater didefinisikan ketat di `@shared/updater` (`IDLE`, `CHECKING`, `AVAILABLE`, `NOT_AVAILABLE`, `DOWNLOADING`, `DOWNLOADED`, `ERROR`). IPC hanya mengekspos aksi safe (`check`, `download`, `install`, `getStatus`, event `onStatusChange`). | Mengikuti security-standards §5 & desktop-runtime-standards §4. |
| S13-5 | **UI Notifikasi & Menu Pengaturan**: Dialog modal modern muncul saat update tersedia (`AVAILABLE`) atau siap dipasang (`DOWNLOADED`), plus tab/seksi "Pembaruan & Backup" di menu Pengaturan untuk cek manual dan kelola backup database harian. | Transparansi versi & kemudahan operasional Owner. |

## A. Konfigurasi Packaging & Dependencies

- [x] **A1** Pasang `electron-updater` dan tambahkan blok `publish` di `electron-builder.yml`:
  ```yaml
  publish:
    provider: github
    owner: idosiregar24
    repo: mandiri-tani
    releaseType: release
  ```
- [x] **A2** Skema & tipe bersama di `src/shared/updater.ts` (Status updater, UpdateInfo, UpdateProgress, UpdateError) dan update `src/shared/bridge.ts` (`IPC.updater*` + interface `PosBridge.updater`).

## B. Modul Updater di Electron Main

- [x] **B1** `src/main/updater.ts`: Service pengelola `autoUpdater` (lifecycle, event listener, download progress throttling, proteksi environment dev vs packaged).
- [x] **B2** IPC handlers di `src/main/ipc.ts`: `pos:updater:get-status`, `pos:updater:check`, `pos:updater:download`, `pos:updater:install`.
- [x] **B3** Integrasi boot di `src/main/index.ts`: Trigger `checkForUpdates()` otomatis 10 detik setelah boot `READY` jika dalam mode packaged (atau dev test flag).
- [x] **B4** Preload bridge di `src/preload/index.ts`: Ekspos `window.pos.updater` ke renderer.

## C. Hardening Database & Backup Management

- [x] **B5** Integrasi shutdown: Jamin `lifecycle.shutdown()` dipanggil bersih sebelum restart update.
- [x] **B6** API/IPC backup database untuk UI: list file backup yang ada di `paths.backupDir`, trigger backup manual, dan info status backup harian.

## D. Antarmuka Pengguna (Renderer React)

- [x] **D1** Hook `useUpdater()` di renderer: langganan event IPC updater, state reactive, fungsi `checkForUpdates()`, `downloadUpdate()`, `installUpdate()`.
- [x] **D2** Komponen dialog `UpdateNotificationDialog.tsx`:
  - Popup otomatis saat ada versi baru (`AVAILABLE`)
  - Tampilkan versi, tanggal, dan release notes / changelog
  - Tampilkan progress bar saat `DOWNLOADING`
  - Tampilkan tombol "Pasang & Mulai Ulang" saat `DOWNLOADED`
- [x] **D3** Seksi "Pembaruan Aplikasi" di halaman Pengaturan (`src/renderer/pages/settings/StoreSettingsPage.tsx`):
  - Informasi versi aktif saat ini
  - Tombol manual `Periksa Pembaruan Sekarang`
  - Status koneksi ke server rilis
- [x] **D4** Seksi "Pencadangan Database" di halaman Pengaturan:
  - Daftar file backup lokal (nama, tanggal, ukuran)
  - Tombol `Cadangkan Database Sekarang`

## E. Verifikasi & Tes

- [x] **E1** Tes unit logic updater & bridge schema (`npm test` — 294 tes lulus).
- [x] **E2** `npm run typecheck` & `npm run lint` hijau tanpa error.
- [x] **E3** Verifikasi build paket `npm run build` sukses.
