# PRD — Mandiri Tani POS & Backoffice Desktop v1.0 (Offline-First)

| | |
|---|---|
| **Versi dokumen** | 1.0 (draft siap eksekusi) |
| **Tanggal** | 2026-10-24 |
| **Penyusun** | Ido Refael Siregar (dibantu Claude) |
| **Status** | Draft — keputusan terbuka di §10 |
| **Skema DB otoritatif** | [`mandiri_tani_schema.sql`](mandiri_tani_schema.sql) (lebih otoritatif dari sketsa §6 bila berbeda) |
| **Data nyata toko** | [`Analisis-Sumber-Data-iPOS.md`](Analisis-Sumber-Data-iPOS.md) — hasil bedah backup iPOS 5 + Excel (keputusan D-1…D-11) |
| **Rencana sprint** | [`../../plan/README.md`](../../plan/README.md) |
| **Fase berikutnya** | [`../Mandiri Tani v2.0/PRD-v2.0-Remote-Tailscale.md`](../Mandiri%20Tani%20v2.0/PRD-v2.0-Remote-Tailscale.md) |

**Konvensi.** Kata **WAJIB / HARUS** = requirement mengikat, **SEBAIKNYA** =
direkomendasikan, **BOLEH** = opsional. Prioritas memakai MoSCoW
(**M**ust / **S**hould / **C**ould / **W**on't-v1). Setiap requirement punya
ID (`FR-POS-07`, `NFR-REL-03`) — rujuk ID ini di commit, plan, dan test.

---

## 1. Executive Summary & Visi Produk

### 1.1 Ringkasan

Mandiri Tani POS adalah aplikasi **Point of Sale + Backoffice desktop
Windows** untuk toko pertanian (pupuk, pestisida, benih, alat & sarana
produksi pertanian) dengan kapabilitas setara iPOS (Inspirasibiz):
multi-satuan bertingkat, multi-level harga, kartu stok, pembelian,
hutang/piutang, dan laporan laba kotor.

Arsitekturnya **Modern Embedded Local Server**: satu installer `.exe`
membawa Electron (UI kasir + backoffice), server HTTP Node.js (Express)
yang berjalan di dalam proses Electron, dan **PostgreSQL portable** yang
dinyalakan/dimatikan otomatis oleh aplikasi via `pg_ctl`. Tidak ada
dependensi internet maupun server cloud: **toko tetap berjualan 100% saat
internet mati**.

Laptop/PC kasir sekaligus menjadi **hub data toko**. Perangkat lain di
jaringan Wi-Fi toko (HP staf untuk stok opname / cek harga, HP owner,
terminal kasir tambahan di masa depan) tersambung ke hub lewat REST API
port 3000 dan **menyinkronkan data** dengan protokol offline-first
(antrean lokal + `?since=`).

### 1.2 Masalah yang diselesaikan

| Masalah di toko tani | Jawaban produk |
|---|---|
| Barang dijual dalam banyak satuan (sak 50 kg dan ecer per kg; dus isi 12 botol dan per botol) | Multi-satuan bertingkat dengan konversi otomatis, barcode per satuan, stok disimpan dalam satuan dasar |
| Harga berbeda untuk petani biasa, anggota kelompok tani, pembeli grosir | Multi-level harga: per satuan, grosir bertingkat kuantitas, harga per grup pelanggan |
| Petani sering bayar setelah panen ("yarnen") | Piutang per pelanggan dengan limit kredit, jatuh tempo, pelunasan bertahap, aging |
| Internet di desa tidak stabil | Seluruh sistem lokal; sinkron antar-perangkat lewat LAN, tidak lewat internet |
| Listrik sering padam / laptop mati mendadak | PostgreSQL ACID + WAL: transaksi yang sudah commit tidak hilang; boot berikutnya pulih otomatis |
| Stok selisih dan tidak tahu laba sebenarnya | Kartu stok otomatis, stok opname, HPP FIFO (seperti iPOS), laporan laba kotor per barang/faktur/periode |

### 1.3 Visi

> "Kasir toko tani yang tidak pernah berhenti karena internet, tidak
> pernah kehilangan transaksi karena listrik, dan memberi pemilik angka
> laba yang bisa dipercaya."

### 1.4 Sasaran v1.0 (terukur)

| ID | Sasaran | Ukuran |
|---|---|---|
| G-1 | Berjualan tanpa internet | 100% fitur v1 berfungsi dengan kabel jaringan dicabut |
| G-2 | Kasir cepat | Scan/cari → baris masuk keranjang ≤ 150 ms (p95); bayar → printer **mulai** mencetak ≤ 2 dtk (LX-310 menyelesaikan ½ halaman ±3–6 dtk) |
| G-3 | Tanpa kehilangan data | 0 transaksi committed hilang pada uji cabut-listrik 50× (NFR-REL-01) |
| G-4 | Stok akurat | Saldo kartu stok = `stock_balances` untuk 100% produk (cek otomatis harian) |
| G-5 | Bisa disinkronkan | Perangkat LAN yang offline 1 hari dapat push ≥ 500 operasi tanpa duplikat |
| G-6 | Mudah dipasang | Install `.exe` → siap transaksi pertama ≤ 10 menit, tanpa install PostgreSQL terpisah |

### 1.5 Ruang lingkup

**Masuk v1.0:** Master data & inventori, POS ritel (mode **Kasir** dan
**Faktur Penjualan**), **terjual-belum-diambil & pengambilan barang
bertahap**, shift & kas laci, pembelian, retur, hutang/piutang, laporan laba
kotor & arus kas, local server LAN, protokol sinkronisasi + aplikasi mobile
staf (LAN), backup lokal, **migrasi data dari iPOS 5 (bisa diulang sampai
go-live)**, installer NSIS.

**Tidak masuk v1.0 (Won't-v1):**

- Akses remote dari luar toko → **v2.0 via Tailscale** (lihat dokumen
  v2.0). Catatan: spesifikasi awal menyebut Cloudflare Tunnel; keputusan
  proyek memakai **Tailscale** (ADR-05).
- Multi-cabang / sinkron antar-toko.
- Akuntansi double-entry penuh (jurnal umum, neraca) — v1 hanya buku kas
  dan laba kotor.
- QRIS dinamis / payment gateway (butuh internet) — v1 QRIS statis +
  konfirmasi manual.
- Fitur resto (meja, waiter, kitchen printer) — toko tani tidak
  membutuhkannya; arsitektur tidak menutup kemungkinan ini.
- e-Faktur pajak, integrasi marketplace, pupuk bersubsidi (RDKK/Kartu
  Tani) — lihat §10.
- Tonase RAM sawit / pembelian TBS — di luar konteks produk ini (keputusan
  owner 2026-10-24).

### 1.6 Asumsi domain (validasi dengan pemilik toko — §10)

Asumsi bertanda ✔ sudah dikonfirmasi oleh data iPOS (Analisis §2).

- A-1 ✔: Satu toko (Jl. Poros RAPP km 72, Bukit Kesuma, Pelalawan), satu gudang (`UTM`).
- A-2: 1 PC/laptop kasir utama (hub) + 0–3 HP staf + 1 HP owner. Saat ini ✔ 1 PC, 1 user `ADMIN`.
- A-3 ✔: Toko non-PKP secara default (PPN hanya di 8 dari 9.705 nota).
- A-4 ✔: Tidak ada qty desimal; pupuk ecer dijual per **KG bulat** (satuan dasar KG, ZAK = 50 KG). `allow_decimal_qty` tetap tersedia.
- A-5 ✔: **Dua printer** (§8.1): (1) **Epson LX-310** (dot matrix, ESC/P, USB), continuous form **½ halaman 9,5"×5,5", 1 lembar** — Faktur Penjualan (JL), bukti pengambilan (AB), dokumen ½ halaman lain; (2) **printer struk thermal** (ESC/POS, kertas gulung ±48 huruf ≈ 80 mm, model menyusul) — struk kasir (KSR). Tanpa laci uang.
- A-6 ✔: Barang tanpa barcode — pencarian nama/kode adalah jalur utama, scanner pelengkap.
- A-7 ✔: Harga jual dinegosiasikan per transaksi; harga master hanya titik awal.

### 1.7 Kondisi saat ini (dari backup iPOS 5, Sep 2024 – Okt 2026)

| Ukuran | Nilai |
|---|---|
| Nota penjualan | 9.705 (KSR kasir 56%, JL faktur 44%); 2026: ~230–450 nota & Rp 1,0–1,7 miliar per bulan |
| Komposisi omzet 12 bulan | Pupuk 89%, pestisida 11%, alat & bibit < 1% |
| Item / pelanggan / supplier | 416 / 1.238 / 37 |
| Piutang terbuka | 308 nota, **Rp 2,62 miliar**, 165 pelanggan |
| Nilai persediaan (FIFO) | Rp 1,79 miliar |
| Nota dengan ongkos angkut | 1.522 |
| Baris jual dengan harga ≠ master | 65% |
| Fitur iPOS yang tidak pernah dipakai | Retur, PO, rakitan, level harga, harga grosir, shift, barcode, pelunasan hutang |

Rincian, masalah kualitas data (DQ-1…DQ-12), dan pemetaan tabel:
[`Analisis-Sumber-Data-iPOS.md`](Analisis-Sumber-Data-iPOS.md).

---

## 2. Arsitektur Sistem & Tech Stack

### 2.1 Diagram konteks

```
┌──────────────────────────── PC / Laptop Kasir (Windows 10/11 x64) ────────────────────────────┐
│                                                                                               │
│  ┌──────────────── Electron App (satu proses utama = "main") ─────────────────┐               │
│  │                                                                            │               │
│  │  Renderer (Chromium)          Main process (Node.js)                       │               │
│  │  ┌──────────────────┐ IPC ┌────────────────────────────────────────────┐   │               │
│  │  │ React + Vite UI  │◄───►│ AppLifecycle  · PgManager (pg_ctl)          │   │               │
│  │  │ Kasir/Backoffice │     │ HardwareBridge (ESC/P LX-310, ESC/POS)      │   │               │
│  │  │                  │HTTP │ Embedded API: Express  0.0.0.0:3000          │   │               │
│  │  │  fetch /api/v1 ──┼────►│   └─ pg Pool (max 10) ──────────┐           │   │               │
│  │  └──────────────────┘     └─────────────────────────────────┼───────────┘   │               │
│  └─────────────────────────────────────────────────────────────┼───────────────┘               │
│                                                                ▼ TCP 127.0.0.1:5433           │
│   ┌──────────────────────────────────────────────────────────────────────────┐                │
│   │ PostgreSQL portable (resources/postgres/bin) · data: %APPDATA%/pos-desktop/pgdata │        │
│   └──────────────────────────────────────────────────────────────────────────┘                │
│        USB ─► Epson LX-310 dot matrix (ESC/P, continuous form)   · Laci kasir manual           │
│        USB HID ────────► Barcode scanner (emulasi keyboard)                                   │
└───────────────────────────────────────▲───────────────────────────────────────────────────────┘
                                        │ HTTP :3000 (Wi-Fi/LAN toko, private network)
          ┌─────────────────────────────┼──────────────────────────────┐
          │                             │                              │
   HP Staf (stok opname,          HP Owner (dashboard,           [v1.x] Terminal kasir
   cek harga) — outbox lokal       laporan) — LAN saja di v1      tambahan (mode Terminal)
                                        │
                              [v2.0] Tailscale tailnet → owner dari luar toko
```

### 2.2 Komponen

| Komponen | Teknologi | Tanggung jawab |
|---|---|---|
| Desktop shell | Electron (stable terbaru saat Sprint 1, dicatat di `plan/README.md`) | Window, lifecycle, single-instance lock, IPC hardware, auto-start PG & server |
| Build | `electron-vite` (main/preload/renderer) + **Electron Builder** target **NSIS** | Satu `.exe` installer; PG binaries dibundel via `extraResources` |
| UI | React + Vite + TypeScript strict, Tailwind CSS v4, shadcn/ui (Radix), lucide-react | Layar kasir keyboard-first & backoffice |
| State | **Zustand** (state klien: keranjang, UI, hotkey) + **TanStack Query** (state server: cache, refetch) | Keputusan: Zustand dipilih atas Redux Toolkit (lebih ringan, cukup untuk skala ini) |
| Form & validasi | React Hook Form + **Zod** (skema dibagi server & klien di `src/shared`) | Satu sumber aturan validasi |
| Embedded API | **Express 5** di Node.js main process, port **3000**, host **0.0.0.0** | REST JSON `/api/v1`, auth, business logic, sinkronisasi |
| DB driver | `pg` (node-postgres) `Pool` + helper `withTransaction()` | Koneksi terkelola, transaksi eksplisit, raw SQL berparameter (tanpa ORM — ADR-06) |
| Database | **PostgreSQL portable** (zip binaries Windows, major dipin — `resources/postgres/VERSION`), port **5433**, `listen_addresses=127.0.0.1` | ACID, MVCC, JSONB, data di `%APPDATA%/pos-desktop/pgdata` |
| Mobile client | React + **Capacitor** (Android), komponen dibagi dengan renderer | Stok opname, cek harga, dashboard owner; outbox offline (§5.7) |
| Printer | Encoder **ESC/P** (Epson LX-310 dot matrix, v1) / ESC/POS (thermal, cadangan) + transport Windows RAW spooler (USB) / Network / Serial | Cetak nota & faktur langsung tanpa dialog Windows |
| Test | Vitest (unit + integrasi dengan PostgreSQL asli), Playwright-Electron (E2E alur kasir, *Should*) | |

### 2.3 Alur komunikasi

1. **Renderer → API.** Produksi: `BrowserWindow.loadURL('http://127.0.0.1:3000/')`
   — Express melayani build statis renderer, sehingga UI dan API satu
   origin (tanpa CORS). Dev: Vite dev server mem-proxy `/api` ke `:3000`.
   Renderer memakai **API yang sama persis** dengan klien mobile (ADR-01).
2. **Renderer ↔ Main (IPC).** Hanya untuk hal yang bukan data bisnis:
   cetak struk, buka laci, status lifecycle (boot screen), info aplikasi,
   pilih folder backup. Diekspos lewat `contextBridge` di preload dengan
   API sempit (`window.pos.print(receipt)`), tidak pernah `ipcRenderer`
   mentah.
3. **API → PostgreSQL.** `pg.Pool` ke `127.0.0.1:5433`, role aplikasi
   `pos_app` (bukan superuser). Setiap operasi tulis multi-tabel lewat
   `withTransaction()`.
4. **Klien LAN → API.** HTTP ke `http://<ip-hub>:3000/api/v1`, token
   perangkat + token sesi user. Sinkron via `GET /sync/pull?since=` dan
   `POST /sync/push` (§5.7, `rules/sync-standards.md`).
5. **Remote (v2.0).** Tailscale di PC hub; server sudah bind `0.0.0.0`
   sehingga antarmuka tailnet ikut terlayani tanpa perubahan kode.

### 2.4 Model proses & batasan

Spesifikasi meminta server **in-process** di main Electron. Konsekuensinya:
event loop main dipakai bersama oleh window management, IPC, dan HTTP.
Aturan:

- Tidak ada kerja CPU berat sinkron di server (agregasi laporan dikerjakan
  SQL, bukan loop JS; export Excel besar di-stream).
- Server ditulis sebagai modul `createServer(config) → { start, stop }`
  tanpa import `electron`, sehingga **BOLEH** dipindah ke
  `utilityProcess` Electron bila profiling menunjukkan UI tersendat
  (ADR-07). Ini juga membuat server bisa dites di Vitest tanpa Electron.

### 2.5 Struktur repository

```
mandiri-tani-pos/
├── src/
│   ├── main/            # Electron main: lifecycle, PgManager, window, IPC, hardware
│   ├── preload/         # contextBridge API sempit
│   ├── server/          # Express API (tanpa import electron)
│   │   ├── app.ts       # createApp()
│   │   ├── db/          # pool, withTransaction, migrate runner
│   │   ├── middleware/  # auth, error, request-id, rate-limit
│   │   └── modules/{auth,products,stock,sales,shifts,purchases,ar-ap,cash,reports,sync,settings}/
│   │         routes.ts · service.ts · repo.ts
│   ├── renderer/        # React app kasir & backoffice
│   └── shared/          # Zod schema, tipe, konstanta, money/qty helper — dipakai server & UI
├── mobile/              # Capacitor app (Sprint 12)
├── db/migrations/       # 0001_init.sql, 0002_… (forward-only)
├── resources/postgres/  # binaries PG portable (gitignored, diunduh script)
├── scripts/             # fetch-postgres.mjs, dev helpers
└── electron-builder.yml
```

### 2.6 Architecture Decision Records

| ID | Keputusan | Alasan |
|---|---|---|
| ADR-01 | Renderer memakai REST API, bukan IPC, untuk data | Satu jalur kode untuk desktop & mobile; API teruji oleh UI sendiri |
| ADR-02 | Primary key **UUIDv7** dibuat aplikasi (`uuid` npm) | Klien offline bisa membuat ID tanpa server; urut waktu → index B-tree tetap rapat |
| ADR-03 | Uang `NUMERIC(18,2)`, HPP `NUMERIC(18,4)`, qty `NUMERIC(18,4)`; JS memakai `decimal.js` | Tidak ada float untuk uang/qty; `pg` mengembalikan NUMERIC sebagai string |
| ADR-04 | HPP metode **FIFO** per produk × gudang, dengan tabel lapisan (`stock_cost_layers`) | Keputusan owner 2026-10-24: sama seperti iPOS, sehingga laba & nilai persediaan bisa dibandingkan langsung; saldo awal menyalin lapisan FIFO iPOS |
| ADR-05 | Akses remote memakai **Tailscale** (v2.0), bukan Cloudflare Tunnel | API POS tidak pernah terbuka ke internet publik; tailnet privat + ACL; HTTPS via `tailscale serve` |
| ADR-06 | Raw SQL berparameter dengan `pg`, tanpa ORM | Kontrol penuh atas lock & transaksi stok; skema SQL eksplisit |
| ADR-07 | Express di main process, dirancang bisa pindah ke `utilityProcess` | Sesuai spesifikasi, dengan jalan keluar bila ada masalah performa |
| ADR-08 | Mobile client = Capacitor app, bukan PWA | Service worker butuh *secure context* (HTTPS); di LAN HTTP polos PWA tidak bisa offline. Capacitor membawa bundle sendiri |

---

## 3. Lifecycle & Process Management

### 3.1 Lokasi file

| Item | Lokasi |
|---|---|
| Binaries PG | `<install>/resources/postgres/{bin,lib,share}` (read-only) |
| Data cluster | `%APPDATA%/pos-desktop/pgdata` |
| Log PG | `%APPDATA%/pos-desktop/logs/postgres.log` (rotasi oleh PG: `logging_collector`) |
| Log aplikasi | `%APPDATA%/pos-desktop/logs/app-YYYY-MM-DD.log` (retensi 30 hari) |
| Backup | `%APPDATA%/pos-desktop/backups/` (+ folder tambahan pilihan owner, mis. flashdisk) |
| Konfigurasi | `%APPDATA%/pos-desktop/config.json` (port terpilih, kode perangkat, path backup) |
| Rahasia | `%APPDATA%/pos-desktop/secrets.bin` — password DB terenkripsi Electron `safeStorage` (DPAPI) |

`pos-desktop` ditetapkan lewat `app.setName()`/`userData` agar tetap sama
walau `productName` berubah. Data **tidak pernah** disimpan di folder
instalasi, sehingga update/uninstall aplikasi tidak menyentuh data.

**Risiko path non-ASCII (NFR-COMP-03):** nama user Windows dengan karakter
non-ASCII/spasi dapat bermasalah untuk PostgreSQL. Semua pemanggilan
binaries **WAJIB** `execFile`/`spawn` dengan array argumen (tanpa shell).
Bila path `pgdata` mengandung karakter non-ASCII, gunakan fallback
`C:\ProgramData\pos-desktop\pgdata` (ditulis di `config.json`).

### 3.2 State machine boot

```
BOOTING ─► CHECK_SINGLE_INSTANCE ─(instance lain ada)─► fokus window lama, keluar
   │
   ▼
RESOLVE_PATHS ─► DB_INIT? ─(pgdata belum ada)─► INITDB ─► CONFIGURE ─┐
   │                                                                  │
   ▼ (pgdata ada)                                                     │
DB_PROBE (pg_ctl status) ─► running milik kita? ─ya─► DB_READY        │
   │ tidak                                                            │
   ▼                                                                  │
DB_STARTING (pg_ctl start -w) ◄───────────────────────────────────────┘
   │ sukses (pg_isready)
   ▼
DB_READY ─► MIGRATING (advisory lock) ─► SERVER_STARTING (listen 0.0.0.0:3000)
   ─► BACKUP_CHECK (backup harian bila belum ada) ─► READY (load UI)

Semua state error ─► FATAL (layar error: pesan Bahasa Indonesia, tombol
"Coba lagi", "Buka folder log", "Pulihkan dari backup" [Owner])
```

Renderer menampilkan **boot screen** yang membaca state via IPC
(`pos:lifecycle-state`). Target waktu boot normal (cluster sudah ada)
≤ 8 detik di HDD, ≤ 4 detik di SSD.

### 3.3 First run: `initdb`

Langkah (dikerjakan `PgManager.initCluster()`):

1. Generate password acak 32 byte untuk superuser `postgres` dan role
   aplikasi `pos_app`; simpan terenkripsi di `secrets.bin`.
2. Tulis password superuser ke file sementara (izin hanya user saat ini),
   lalu:
   ```
   initdb -D <pgdata> -U postgres --pwfile=<tmp> --auth=scram-sha-256
          --encoding=UTF8 --locale-provider=builtin --builtin-locale=C.UTF-8
   ```
   (PG < 17: `--locale=C`.) Hapus file sementara segera setelahnya.
3. Tulis `postgresql.conf` terkelola — append satu baris
   `include_if_exists = 'mandiri_tani.conf'` dan tulis file tersebut:
   ```
   port = 5433
   listen_addresses = '127.0.0.1'
   max_connections = 30
   shared_buffers = 128MB
   work_mem = 8MB
   fsync = on                     # JANGAN dimatikan (NFR-REL-01)
   synchronous_commit = on
   full_page_writes = on
   wal_level = replica
   max_wal_size = 512MB
   checkpoint_timeout = 5min
   logging_collector = on
   log_directory = '<abs>/logs'
   log_filename = 'postgres-%a.log'
   log_truncate_on_rotation = on
   log_min_duration_statement = 500   # query > 500 ms dicatat
   idle_in_transaction_session_timeout = 60s
   timezone = 'Asia/Jakarta'
   ```
4. Tulis `pg_hba.conf` minimal: hanya `host all all 127.0.0.1/32
   scram-sha-256` dan `host all all ::1/128 scram-sha-256`. Tidak ada
   entri `trust`, tidak ada entri jaringan lain.
5. Start sementara, buat role `pos_app` (LOGIN, bukan superuser) dan
   database `mandiri_tani` OWNER `pos_app`, `CREATE EXTENSION pg_trgm`
   (oleh superuser), lalu lanjut ke boot normal.

Bila langkah mana pun gagal, folder `pgdata` setengah jadi **WAJIB**
dipindah ke `pgdata.failed-<timestamp>` (bukan dihapus) agar initdb bisa
diulang dan log bisa diperiksa.

### 3.4 Start normal: `pg_ctl start`

1. **Cek port.** Pastikan `127.0.0.1:5433` bebas. Bila dipakai proses
   lain (bukan cluster kita), coba 5434–5440, simpan port terpilih di
   `config.json`, dan teruskan ke PG lewat `-o "-p <port>"`.
2. **Probe.** `pg_ctl status -D <pgdata>`:
   - *running* dan `postmaster.pid` menunjuk ke data dir kita → cluster
     yatim dari sesi sebelumnya yang crash → **pakai saja** (langsung
     DB_READY).
   - *no server running* tapi `postmaster.pid` ada → PID basi
     (crash/listrik padam). PG menangani PID basi saat start; bila start
     gagal karena PID dipakai proses lain (Windows bisa mendaur ulang
     PID), pastikan proses itu bukan `postgres.exe` lalu hapus
     `postmaster.pid` dan ulangi sekali.
3. **Start.**
   ```
   pg_ctl start -D <pgdata> -l <logs>/pg_ctl.log -w -t 60 -o "-p <port>"
   ```
   `-w` menunggu sampai siap menerima koneksi. Setelah crash, start bisa
   lebih lama karena **WAL recovery** — boot screen menampilkan
   "Memulihkan database setelah aplikasi tertutup tidak normal…".
4. **Readiness.** `pg_isready -h 127.0.0.1 -p <port>` lalu
   `SELECT 1` lewat pool.
5. `pg_ctl` di Windows otomatis menjalankan `postgres.exe` dengan
   *restricted token*, sehingga aplikasi yang dijalankan "as
   Administrator" tetap aman. **Verifikasi Sprint 1:** postgres tetap
   hidup setelah `pg_ctl` keluar dan tidak ikut terbunuh oleh job object
   proses induk.

### 3.5 Migrasi

- File `db/migrations/NNNN_nama.sql`, forward-only, dijalankan berurutan
  oleh runner internal di startup (`schema_migrations` mencatat nama +
  checksum + waktu).
- Runner mengambil `pg_advisory_lock(<konstanta>)` agar tidak pernah dua
  runner bersamaan; setiap file dalam satu transaksi.
- Checksum file yang sudah diterapkan berubah → FATAL (mencegah edit
  migrasi lama).
- **Sebelum** menerapkan migrasi baru pada database yang sudah berisi
  data, buat backup otomatis `pre-migrate-<versi>.dump`.

### 3.6 Shutdown terkendali

Pemicu: user menutup window / menu Keluar (`before-quit`), logoff/shutdown
Windows (`session-end` pada BrowserWindow), perintah update.

```
1. app.on('before-quit', e => { if (!shuttingDown) e.preventDefault(); shutdown() })
2. Tolak request baru (server.close()), tunggu request berjalan ≤ 5 dtk
3. Bila ada shift OPEN → JANGAN blok shutdown; shift tetap OPEN dan dilanjutkan saat buka lagi
4. await pool.end()
5. pg_ctl stop -D <pgdata> -m fast -w -t 30
6. Bila gagal/timeout → pg_ctl stop -m immediate (aman: WAL recovery saat boot berikutnya), catat di log
7. app.exit(0)
```

`session-end` (Windows memberi waktu sangat singkat): langsung lompat ke
langkah 5 dengan `-t 10`. Mode `fast` membatalkan transaksi yang belum
commit (rollback) — transaksi yang sudah commit aman.

### 3.7 Sleep, resume, dan mati mendadak

| Kejadian | Penanganan |
|---|---|
| Laptop sleep/hibernate (`powerMonitor.suspend`) | Tidak ada aksi khusus; catat waktu |
| Resume (`powerMonitor.resume`) | Health check: `pg_ctl status` + `SELECT 1`. Gagal → restart PG (§3.4). Pool membuang koneksi rusak (`pool.on('error')`). Klien LAN me-retry otomatis |
| Listrik padam / force shutdown | Tidak bisa ditangani saat kejadian; dijamin oleh `fsync=on` + WAL. Boot berikutnya: PID basi + WAL recovery (§3.4) |
| Main process crash | `postgres.exe` bisa tetap hidup (yatim). Boot berikutnya mendeteksi & memakainya (§3.4 langkah 2) |
| Disk penuh | PG menolak tulis → API mengembalikan `503 DB_UNAVAILABLE`, UI menampilkan banner merah. Monitor sisa disk; peringatan saat < 2 GB |

Antivirus dapat mengunci file `pgdata` dan merusak kinerja. Panduan
instalasi **SEBAIKNYA** menyarankan pengecualian folder
`%APPDATA%\pos-desktop\pgdata`.

### 3.8 Backup & restore

- **FR-SYS-10 (M):** backup otomatis `pg_dump -Fc` sekali sehari (saat
  boot pertama hari itu atau 30 menit setelah READY), ke
  `backups/daily/mandiri_tani-YYYYMMDD-HHmm.dump`, retensi 14 harian + 8
  mingguan. Juga ke folder tambahan bila diset owner.
- **FR-SYS-11 (M):** backup manual dari menu Pengaturan (Owner).
- **FR-SYS-12 (M):** restore (Owner saja): server masuk *maintenance mode*
  (tolak semua request kecuali status), `pg_restore` ke database baru
  `mandiri_tani_restore`, verifikasi, lalu rename atomik; database lama
  disimpan sebagai `mandiri_tani_old_<ts>` sampai owner menghapusnya.
- Integritas: setiap backup diverifikasi dengan `pg_restore --list`;
  gagal → notifikasi di dashboard.

### 3.9 Update aplikasi

- Update memakai installer NSIS baru (auto-update = *Could* v1.x).
- Major PostgreSQL **dipin** per rilis aplikasi. Mengganti major (mis.
  17 → 18) adalah rilis khusus dengan prosedur dump → initdb baru →
  restore; tidak pernah diam-diam.

---

## 4. User Persona, Hak Akses & Alur Kerja

### 4.1 Persona

| Persona | Role | Konteks | Kebutuhan utama |
|---|---|---|---|
**v1 memakai dua role saja: `KASIR` dan `OWNER`** (keputusan owner
2026-10-24 — sekarang semua transaksi iPOS atas nama satu akun ADMIN).
Role tambahan (mis. Supervisor Gudang) bisa ditambah kemudian lewat migrasi
CHECK + peta permission, tanpa mengubah kode fitur.

| Persona | Role | Konteks | Kebutuhan utama |
|---|---|---|---|
| **Sari — Kasir** | `KASIR` | Di meja kasir, antrean petani saat pagi; juga melayani pengambilan barang; tidak paham komputer mendalam | Cari/scan cepat, ganti satuan, ubah harga tawar, struk keluar, input pengambilan, terima cicilan piutang |
| **Owner** | `OWNER` | Kadang di toko, sering di luar; memegang uang, harga, pembelian, dan stok | Harga jual, pembelian & hutang, opname, laporan laba, piutang petani, kas; memberi otorisasi PIN untuk aksi kasir yang sensitif; di v1 via PC toko / HP di Wi-Fi toko, di v2 dari mana saja (Tailscale) |

### 4.2 Matriks hak akses (kontrak — `rules/security-standards.md` §3)

Permission berbentuk kunci `modul.aksi`, dipetakan ke role di kode
(`src/shared/permissions.ts`). v1 memakai role tetap; per-user override =
*Could* (mis. bila kelak kasir diizinkan menginput barang datang).

| Permission | KASIR | OWNER |
|---|:-:|:-:|
| `sales.create`, `sales.hold`, `shift.open/close` | ✔ | ✔ |
| `sales.discount` (≤ batas diskon kasir, default 5%) | ✔ | ✔ |
| `sales.discount.unlimited` | ⛔ (otorisasi Owner) | ✔ |
| `sales.price_override` (ubah harga di baris, ≥ HPP — alur normal, D-2) | ✔ | ✔ |
| `sales.sell_below_cost` | ⛔ (otorisasi Owner) | ✔ |
| `sales.void` (batalkan nota selesai) | ⛔ (otorisasi Owner) | ✔ |
| `sales.return` | ⛔ (otorisasi Owner) | ✔ |
| `sales.credit` (jual piutang) | ✔ bila dalam limit | ✔ |
| `sales.credit.over_limit` | ⛔ (otorisasi Owner) | ✔ |
| `cash.in/out` (kas masuk/keluar laci) | ✔ | ✔ |
| `sales.pending_pickup` (jual "diambil nanti"), `pickups.create`, `pickups.read` | ✔ | ✔ |
| `pickups.cancel` (batalkan pengambilan) | ⛔ (otorisasi Owner) | ✔ |
| `ar.payment` (terima pelunasan piutang) | ✔ | ✔ |
| `products.read`, `stock.read` | ✔ (tanpa HPP) | ✔ |
| `customers.create` (tambah pelanggan cepat: nama + HP) | ✔ | ✔ |
| `reports.sales` (penjualan per shift) | ✔ (shift sendiri) | ✔ |
| `products.write`, `prices.write`, `customers.write`, `suppliers.write` | ⛔ | ✔ |
| `cost.read` (lihat HPP/laba) | ⛔ | ✔ |
| `purchases.*`, `ap.payment`, `stock.opname`, `stock.adjust`, `stock.transfer` | ⛔ | ✔ |
| `reports.profit`, `reports.cashflow`, `reports.*` lainnya | ⛔ | ✔ |
| `users.manage`, `devices.manage`, `settings.write`, `backup.create`, `backup.restore` | ⛔ | ✔ |
| `imports.ipos`, `system.reset_preparation`, `system.go_live` | ⛔ | ✔ |

**Otorisasi Owner (FR-POS-20, M):** aksi bertanda "otorisasi" memunculkan
dialog PIN; Owner memasukkan username + PIN di layar kasir. Aksi tercatat di
`audit_logs` dengan `actor_id` (kasir) **dan** `approved_by` (Owner).
Otorisasi berlaku **satu aksi**, tidak menaikkan hak sesi. Bila Owner tidak
di toko, aksi tersebut ditunda (nota bisa ditahan dengan F6).

### 4.3 Alur kerja utama

**Kasir — satu hari:**
```
Login (username + PIN) → Buka Shift (input modal awal, hitung pecahan)
→ [loop] Scan/cari barang → (ubah qty/satuan) → F8 Pilih pelanggan (opsional)
        → F9 Bayar (Cash/QRIS/Transfer/Piutang/kombinasi) → nota tercetak di LX-310 → sobek
→ (sesekali) F6 Tahan nota / F7 Ambil nota tertahan · Kas keluar (beli es, bensin)
→ Tutup Shift (hitung uang laci per pecahan → selisih tercatat) → cetak rekap shift → Logout
```

**Kasir — pelanggan datang mengambil barang:**
```
F11 Pengambilan Barang → cari pelanggan / ketik no. nota → isi qty diambil → nama penerima
→ simpan & cetak bukti AB (2 rangkap) → stok fisik berkurang
```

**Owner — barang datang dari supplier:**
```
Faktur Pembelian langsung (BL): supplier, barang, qty, harga beli, tunai/kredit + jatuh tempo
→ stok bertambah + lapisan HPP FIFO baru → hutang supplier tercatat bila kredit → pembayaran hutang bertahap
(PO + penerimaan terpisah tersedia bila nanti dibutuhkan — FR-PUR-01, Should)
```

**Owner — stok opname:**
```
Buat sesi opname (gudang, filter kategori) → hitung di desktop atau HP (offline boleh)
→ review selisih → Posting opname → mutasi penyesuaian otomatis di kartu stok
```

**Owner — kendali:**
```
Atur harga → pantau dashboard (omzet hari ini, laba kotor, stok menipis, piutang jatuh tempo,
barang belum diambil) → laporan laba rugi kotor & arus kas per periode → otorisasi PIN bila diminta kasir
```

---

## 5. Functional Requirements

### 5.1 Master Data

| ID | Requirement | Prio |
|---|---|:-:|
| FR-MD-01 | CRUD produk: SKU unik (auto/generate), nama, kategori (bertingkat), merek, tipe (`STANDARD`, `BUNDLE`, `ASSEMBLY`, `SERVICE`), satuan dasar, lacak stok (ya/tidak), izinkan qty desimal, stok minimum/maksimum, status aktif | M |
| FR-MD-02 | **Multi-satuan bertingkat**: tiap produk punya 1 satuan dasar + n satuan turunan, masing-masing dengan `konversi ke satuan dasar` (mis. PCS=1, PAK=6, DUS=24). UI menampilkan rantai "1 DUS = 4 PAK = 24 PCS" dan memvalidasi konversi > 0 dan unik per produk. Konversi satuan yang sudah dipakai transaksi tidak boleh diubah (buat satuan baru) | M |
| FR-MD-03 | Barcode per satuan (barcode PCS ≠ barcode DUS); satu satuan boleh > 1 barcode; barcode unik global; generator barcode internal (prefix `2` + EAN-13) untuk barang tanpa barcode | M |
| FR-MD-04 | **Multi-level harga** per satuan: (a) harga umum, (b) harga **grosir bertingkat** berdasarkan min qty (mis. ≥10 sak), (c) harga per **grup pelanggan** (Member, Kelompok Tani, Grosir) — masing-masing juga boleh bertingkat. Aturan resolusi di FR-POS-05 | M |
| FR-MD-05 | Atribut dinamis produk (JSONB): mis. bahan aktif, no. registrasi pestisida, berat kemasan, masa kedaluwarsa default. Skema atribut per kategori dapat dikonfigurasi (key, label, tipe) | S |
| FR-MD-06 | Item **paket/bundling** (`BUNDLE`): komponen + qty per komponen; tidak punya stok sendiri; saat dijual, stok komponen berkurang | C (tidak dipakai di iPOS) |
| FR-MD-07 | Item **rakitan** (`ASSEMBLY`, Bill of Materials): punya stok sendiri; dibentuk lewat dokumen Perakitan (FR-INV-08) | C (tidak dipakai di iPOS) |
| FR-MD-08 | Pelanggan: kode, nama, HP, alamat/desa, grup pelanggan, **limit kredit**, termin pembayaran default (hari), catatan. Pelanggan `UMUM` (walk-in) bawaan, tidak bisa dihapus | M |
| FR-MD-09 | Supplier: kode, nama, kontak, alamat, termin pembayaran default | M |
| FR-MD-10 | Gudang/lokasi: ≥ 1, satu default untuk penjualan | M |
| FR-MD-11 | Metode pembayaran: Cash, QRIS (gambar QRIS statis untuk ditampilkan), Transfer (rekening tujuan), Piutang; aktif/nonaktif | M |
| FR-MD-12 | Import produk & harga dari Excel/CSV (template sendiri **dan** template ekspor iPOS tipe O/S/J/L), dengan pratinjau & laporan error per baris | S |
| FR-MD-13 | Cetak label harga / barcode rak | C |
| FR-MD-14 | Penghapusan master = **nonaktif + soft delete** (`deleted_at`), tidak pernah hard delete (agar riwayat & sinkron tetap konsisten) | M |

### 5.2 Inventori & Stok

| ID | Requirement | Prio |
|---|---|:-:|
| FR-INV-01 | Stok disimpan dalam **satuan dasar** per (produk, gudang) di `stock_balances`; setiap perubahan stok **WAJIB** menulis `stock_movements` (ledger append-only) dalam transaksi yang sama | M |
| FR-INV-13 | **Tiga angka stok** di semua layar stok & pencarian kasir: **Fisik** (`qty`, barang di gudang), **Dipesan** (`reserved_qty`, terjual belum diambil), **Tersedia** (= fisik − dipesan). Penjualan divalidasi terhadap **Tersedia**; opname menghitung **Fisik** | M |
| FR-INV-02 | **Kartu stok**: per produk & gudang & periode — saldo awal, masuk, keluar, saldo berjalan, sumber dokumen (klik → buka dokumen), tampil dalam satuan dasar atau satuan pilihan | M |
| FR-INV-03 | **HPP FIFO** (sama seperti iPOS): setiap barang masuk berbiaya membuat lapisan harga; barang keluar memakai lapisan tertua lebih dulu. Aturan lengkap di §6.6. Layar stok menampilkan nilai persediaan & rincian lapisan (Owner) | M |
| FR-INV-04 | **Saldo awal stok** (go-live): input qty + HPP per produk per gudang; satu kali per produk (dokumen `OPENING`) | M |
| FR-INV-05 | **Stok opname**: sesi per gudang (opsional filter kategori/rak) → snapshot qty sistem saat posting → input qty fisik (desktop atau HP) → review selisih (qty & nilai) → posting = mutasi `OPNAME` otomatis. Penjualan selama sesi tetap boleh; qty sistem diambil saat posting, bukan saat sesi dibuat | M |
| FR-INV-06 | **Penyesuaian stok** manual dengan alasan wajib (Rusak, Hilang, Kedaluwarsa, Sampel, Lainnya + catatan) | M |
| FR-INV-07 | **Peringatan stok menipis**: daftar produk dengan stok ≤ minimum; badge di dashboard; saran qty order = maks − stok | M |
| FR-INV-08 | **Perakitan**: hasil (produk `ASSEMBLY`) + qty → komponen keluar sesuai BOM (boleh disesuaikan per dokumen), hasil masuk dengan HPP = Σ biaya komponen + biaya tambahan | C |
| FR-INV-09 | Mutasi antar gudang (keluar dari A, masuk ke B, satu dokumen, HPP tidak berubah) | C (satu gudang) |
| FR-INV-10 | Kebijakan stok negatif: setting `stock.allow_negative` (default **tidak**). Di kasir desktop: stok tidak cukup → blok, kecuali otorisasi Owner. Dokumen hasil sinkron dari perangkat offline **selalu diterapkan** dan selisih masuk laporan "Stok Minus" | M |
| FR-INV-11 | Batch & tanggal kedaluwarsa (pestisida/benih) | W-v1 (lihat §10) |
| FR-INV-12 | Laporan nilai persediaan (qty × HPP) per gudang/kategori per tanggal | M |

### 5.3 Penjualan & Kasir (POS Ritel)

**Layout layar kasir:** kiri = keranjang (tabel baris besar: nama, satuan,
qty, harga, diskon, subtotal); kanan = panel total (angka total sangat
besar), pelanggan terpilih, info shift, tombol aksi; atas = kolom
scan/cari yang **selalu kembali fokus** setelah setiap aksi.

| ID | Requirement | Prio |
|---|---|:-:|
| FR-POS-01 | **Scanner barcode**: input dari scanner HID dikenali (§8.3) dan langsung menambah baris; barcode satuan DUS menambah 1 DUS. Scan ulang barang+satuan yang sama menambah qty baris yang ada | M |
| FR-POS-02 | Pencarian barang: ketik nama/SKU/sebagian (pg_trgm) → daftar hasil dengan stok & harga, navigasi panah, Enter memilih. Hasil ≤ 150 ms untuk 20.000 produk | M |
| FR-POS-03 | Pengali qty cepat: ketik `5*` lalu scan → qty 5; `2,5*` untuk desimal bila produk mengizinkan | M |
| FR-POS-04 | Ganti satuan pada baris (F4 / klik) → harga ter-resolve ulang | M |
| FR-POS-05 | **Resolusi harga** per baris: (1) harga grup pelanggan untuk satuan itu, tier dengan `min_qty` terbesar ≤ qty → (2) harga umum, tier yang sama → (3) tidak ada harga → kolom harga kosong dan **wajib diisi** kasir. Harga hasil resolusi disimpan di `list_price`; **mengubah harga di baris adalah alur normal** (D-2, `sales.price_override` dimiliki kasir) → `price_source = MANUAL`. Harga **tidak pernah** diturunkan otomatis dari harga satuan lain | M |
| FR-POS-06 | Diskon per baris (nominal atau %) dan diskon nota; diskon nota dialokasikan proporsional ke baris (untuk laba per barang). Batas diskon kasir di setting | M |
| FR-POS-07 | Peringatan jual di bawah HPP (butuh `sales.sell_below_cost`) | M |
| FR-POS-08 | **Hold / pending bill**: tahan nota dengan label (nama pembeli); daftar nota tertahan, ambil kembali, hapus (dengan alasan). Nota tertahan tidak memengaruhi stok dan tersimpan di DB (tahan restart) | M |
| FR-POS-09 | **Split bill**: pindahkan sebagian baris/qty dari nota aktif ke nota baru (mis. pembeli bayar terpisah), lalu bayar masing-masing | C |
| FR-POS-10 | **Multi-metode pembayaran** dalam satu nota (mis. sebagian Cash + sisanya Piutang). Cash: input uang diterima + tombol cepat nominal (pas, 50rb, 100rb), kembalian dihitung. QRIS statis & Transfer: input no. referensi (opsional), konfirmasi manual kasir | M |
| FR-POS-11 | **Jual piutang** (hanya mode Faktur): wajib pelanggan non-UMUM; boleh sebagian tunai + sebagian kredit dalam satu nota (485 nota di iPOS); cek limit kredit bila diisi (`NULL` = tanpa batas, D-7) — lewat limit butuh `sales.credit.over_limit`; jatuh tempo = tanggal + termin pelanggan (default **10 hari**, bisa diubah) | M |
| FR-POS-12 | Pembulatan total (setting: tanpa / ke atas / terdekat, satuan Rp 100/500/1000), selisih disimpan di `rounding_amount` | S |
| FR-POS-13 | PPN opsional (setting nonaktif default; bila aktif: harga termasuk PPN, `tax_amount` dihitung dan dicetak) | C |
| FR-POS-14 | Selesai bayar: transaksi tersimpan **sebelum** cetak; nota dicetak otomatis ke LX-310 (setting; jumlah rangkap/salinan bisa diatur), kertas maju ke perforasi. Laci sesuai `drawer.mode` (§8.2, default manual). Gagal cetak **tidak** membatalkan transaksi → banner + tombol cetak ulang | M |
| FR-POS-15 | Cetak ulang struk (tanda "SALINAN") dari riwayat transaksi | M |
| FR-POS-16 | **Void nota** yang sudah selesai: butuh `sales.void`/otorisasi + alasan; membuat mutasi balik stok, membatalkan pembayaran & piutang terkait, tercatat audit. Hanya untuk nota shift yang masih OPEN; selain itu gunakan retur | M |
| FR-POS-17 | **Retur penjualan**: dari no. nota (ketik nomor / cari pelanggan) → pilih baris & qty retur (≤ qty terjual − sudah diretur) → kembali ke stok (ya/tidak, mis. rusak) → pengembalian: tunai dari laci / potong piutang / saldo deposit (*Could*) | S (tidak pernah dipakai di iPOS) |
| FR-POS-18 | **Shift kasir**: buka (modal awal), satu shift OPEN per perangkat; tutup = input hitung fisik per pecahan → sistem menghitung *expected cash* = modal + penjualan cash + kas masuk + pelunasan piutang tunai − kas keluar − refund tunai; selisih wajib catatan bila ≠ 0; cetak rekap shift | M |
| FR-POS-19 | Kas masuk/keluar laci selama shift dengan kategori & catatan (mis. "Beli es", "Setor ke owner") | M |
| FR-POS-20 | Otorisasi Owner via PIN di layar kasir (lihat §4.2) | M |
| FR-POS-21 | Info pelanggan di layar: grup, saldo piutang, sisa limit | M |
| FR-POS-22 | Shortcut keyboard (tabel di bawah), bisa dilihat dengan F1 | M |
| FR-POS-23 | Penomoran nota **sama dengan iPOS**: `0002061/KSR/UTM/1026` & `0001789/JL/UTM/1026` (urut 7 digit/tipe/gudang/BLNTHN, reset tahunan), melanjutkan nomor terakhir iPOS — §6.7 | M |
| FR-POS-24 | Tampilan pelanggan (customer display) layar kedua | C |
| FR-POS-25 | **Dua mode penjualan** (D-1): **Kasir** (`channel = KASIR`, prefix KSR) — cepat, default pelanggan UMUM, dibayar lunas; **Faktur Penjualan** (`channel = FAKTUR`, prefix JL) — pelanggan wajib, boleh kredit/sebagian kredit, ongkos angkut, cetak faktur A5/A4 + struk. **Kedua mode** boleh "barang diambil nanti" (§5.3b). Keduanya satu tabel `sales`, satu `salesService.complete` | M |
| FR-POS-26 | **Biaya lain / ongkos angkut** di header nota (nominal + keterangan), masuk total & dicetak; dilaporkan terpisah dari penjualan barang | M |
| FR-POS-27 | **Harga terakhir pelanggan**: saat memilih barang di Faktur, tampilkan 3 harga jual terakhir barang+satuan itu ke pelanggan ini (tanggal & harga) sebagai acuan negosiasi | M |
| FR-POS-28 | **Potongan nota nominal** untuk membulatkan total (mis. 1.215.000 → 1.200.000): input "Total jadi" menghitung potongan otomatis; persen tetap tersedia. Saran diskon dari `customer_groups.discount_percent` | M |
| FR-POS-29 | Metode **Transfer per rekening** (BCA, Mandiri, …) dengan no. referensi — tidak lagi dicatat sebagai tunai + keterangan "TF" (DQ-10) | M |
| FR-POS-30 | **Terbilang** total dalam Bahasa Indonesia di faktur & bukti bayar ("tiga ratus tujuh puluh lima ribu rupiah") — satu fungsi `terbilang()` di `src/shared`, diuji unit (0, belasan, "seratus/seribu", juta, miliar) | M |

**Shortcut kasir (default, dapat diatur):**

| Tombol | Aksi | Tombol | Aksi |
|---|---|---|---|
| F1 | Bantuan shortcut | F7 | Ambil nota tertahan |
| F2 | Fokus kolom scan/cari | F8 | Pilih pelanggan |
| F3 | Cari barang (dialog) | F9 | Bayar |
| F4 | Ganti satuan baris terpilih | F10 | Diskon nota |
| F5 | Ubah qty baris terpilih | F12 | Kas masuk/keluar |
| F6 | Tahan nota | Del | Hapus baris (konfirmasi) |
| ↑/↓ | Pindah baris | Esc | Tutup dialog / batal |
| Ctrl+P | Cetak ulang struk terakhir | Ctrl+R | Retur penjualan |
| F11 | Pengambilan Barang | Alt+N (di dialog bayar) | Barang diambil nanti |
| Ctrl+Shift+L | Kunci layar (logout cepat) | Enter (di dialog bayar) | Selesaikan transaksi |

### 5.3b Terjual — Belum Diambil & Pengambilan Barang (FR-PKP) — D-5

Petani sering membayar pupuk hari ini dan mengambilnya minggu depan,
bertahap, atau minta diantar ke ladang. iPOS 5 langsung mengurangi stok
saat nota dibuat, sehingga stok komputer lebih kecil dari isi gudang dan toko
mencatat manual di Excel ("barang yang belum diambil"). Di sistem ini **stok
gudang baru berkurang saat barang benar-benar diambil**, sementara barang
yang sudah terjual dikunci sebagai **Dipesan** agar tidak terjual dua kali.
Rencana lengkap (alur, contoh angka, kasus tepi, tugas per sprint):
[`plan/sprint-7-pengambilan-barang.md`](../../plan/sprint-7-pengambilan-barang.md).

| ID | Requirement | Prio |
|---|---|:-:|
| FR-PKP-01 | Di dialog bayar (mode Kasir **dan** Faktur): pilihan **"Barang diambil nanti"**; per baris boleh isi qty yang dibawa sekarang (sisanya belum diambil); rencana tanggal ambil & catatan opsional. Pelanggan wajib bernama (UMUM ditolak; tambah pelanggan cepat nama + HP) | M |
| FR-PKP-02 | Saat nota selesai: qty dibawa sekarang → mutasi `SALE` (stok fisik −); sisa → **reservasi** (`reserved_qty` +, stok fisik **tetap**). Validasi terhadap stok **Tersedia** | M |
| FR-PKP-03 | Pembayaran tidak bergantung pengambilan: nota lunas/kredit sejak tanggal transaksi | M |
| FR-PKP-04 | Nota/faktur mencetak blok **BARANG BELUM DIAMBIL** + nomor nota **lebar ganda** sebagai bukti untuk mengambil (QR hanya bila kelak printer thermal) | M |
| FR-PKP-05 | Layar **Pengambilan Barang** (F11): cari nama pelanggan / ketik nomor nota (cukup angka urutnya) → semua sisa barang pelanggan dari semua nota → qty diambil per baris (≤ sisa, tombol "Ambil semua") → nama penerima (wajib, boleh diwakilkan), HP, kendaraan, metode diambil/diantar (+tujuan), catatan → simpan `AB/…` | M |
| FR-PKP-06 | Simpan pengambilan = mutasi `SALE_PICKUP` (stok fisik −, dipesan −) dengan HPP saat itu, `picked_up_qty` +, status nota `PARTIAL`/`COMPLETE`, audit; satu transaksi DB | M |
| FR-PKP-07 | Cetak **Bukti Pengambilan** 2 rangkap (pelanggan & arsip) dengan tanda tangan penerima & petugas | M |
| FR-PKP-08 | **Riwayat pengambilan** per nota, per pelanggan, dan per periode (no. AB, tanggal, barang, qty, penerima, petugas, status) — append-only | M |
| FR-PKP-09 | **Batalkan pengambilan** (salah input): `pickups.cancel`/otorisasi + alasan → status `CANCELLED` + mutasi `SALE_PICKUP_CANCEL` (fisik +, dipesan +). Tidak ada edit/hapus | M |
| FR-PKP-10 | **Retur sisa belum diambil**: lepas reservasi tanpa mutasi fisik, `cancelled_qty` +, uang kembali tunai / potong piutang. Void nota ditolak bila sudah ada pengambilan POSTED | M |
| FR-PKP-11 | Pengambilan ditolak bila stok **fisik** kurang (selisih/hilang) — pesan meminta penyesuaian/opname dulu | M |
| FR-PKP-12 | Dashboard & layar kasir: jumlah/nilai barang belum diambil, **lewat janji ambil**, umur > N hari (setting, default 30); saat memilih pelanggan tampil sisa barangnya | M |
| FR-PKP-13 | Laporan **Barang belum diambil** per pelanggan / per barang (qty, nilai, umur) — pengganti sheet DAFTAR PUPUK; laba kotor menandai HPP **estimasi** untuk sisa yang belum diambil | M |
| FR-PKP-14 | **Saldo awal barang belum diambil** saat go-live (nota `source = OPENING_PICKUP`, stok fisik + dipesan; tidak masuk omzet/laba) | M |

### 5.4 Pembelian

| ID | Requirement | Prio |
|---|---|:-:|
| FR-PUR-01 | **Purchase Order**: supplier, tanggal, perkiraan datang, baris (produk, satuan, qty, harga, diskon), status `DRAFT → SENT → PARTIAL → RECEIVED / CLOSED / CANCELLED`; cetak/ekspor PDF PO | S (iPOS: semua pembelian faktur langsung) |
| FR-PUR-02 | **Penerimaan barang** dari PO (sebagian/lengkap) atau tanpa PO: qty diterima per baris, biaya per satuan (default dari PO), gudang tujuan, no. surat jalan supplier. Posting = stok masuk + HPP diperbarui | M |
| FR-PUR-03 | **Faktur pembelian** dari satu/lebih penerimaan supplier yang sama: no. faktur supplier, tanggal, jatuh tempo (default termin supplier), diskon & biaya lain (ongkos angkut) di level faktur → hutang tercatat. Harga baris faktur mengikuti penerimaan (koreksi harga setelah posting = W-v1) | M |
| FR-PUR-04 | **Faktur pembelian langsung** (penerimaan + faktur satu langkah) untuk pembelian tunai kecil | M |
| FR-PUR-05 | Ongkos angkut di faktur **BOLEH** dibebankan ke HPP (alokasi proporsional nilai baris) — setting per faktur | S |
| FR-PUR-06 | **Retur pembelian** ke supplier: dari faktur (atau tanpa faktur), stok keluar dengan HPP rata-rata saat itu; penyelesaian: potong hutang / refund tunai | M |
| FR-PUR-07 | Riwayat harga beli per produk per supplier; harga beli terakhir tampil saat input PO | S |

### 5.5 Hutang & Piutang

| ID | Requirement | Prio |
|---|---|:-:|
| FR-ARAP-01 | Setiap nota piutang / faktur pembelian belum lunas menjadi baris `receivables` / `payables` dengan tanggal dokumen, jatuh tempo, nilai, terbayar, status `OPEN → PARTIAL → PAID` | M |
| FR-ARAP-02 | **Pelunasan bertahap**: satu pembayaran dapat dialokasikan ke ≥ 1 dokumen (default FIFO jatuh tempo terlama, bisa diatur manual); pembayaran tidak boleh melebihi sisa | M |
| FR-ARAP-03 | Pelunasan piutang di kasir (masuk laci shift bila tunai) atau di backoffice; cetak bukti bayar | M |
| FR-ARAP-04 | Daftar jatuh tempo: piutang/hutang jatuh tempo hari ini, 7 hari ke depan, lewat jatuh tempo; badge di dashboard | M |
| FR-ARAP-05 | **Aging** piutang & hutang: belum jatuh tempo, 1–30, 31–60, 61–90, > 90 hari, per pelanggan/supplier | M |
| FR-ARAP-06 | Saldo awal piutang/hutang (go-live) per pelanggan/supplier per dokumen | M |
| FR-ARAP-07 | Kartu piutang per pelanggan (mutasi & saldo berjalan); cetak/kirim (PDF) | S |
| FR-ARAP-08 | Penghapusan piutang tak tertagih (`WRITTEN_OFF`, Owner, alasan wajib, audit) | C |

### 5.6 Keuangan & Laporan

| ID | Requirement | Prio |
|---|---|:-:|
| FR-FIN-01 | **Buku kas**: setiap uang masuk/keluar non-piutang tercatat di `cash_transactions` per akun kas (Laci Kasir, Kas Toko/Brankas, Bank) dengan kategori (Penjualan, Pembelian, Pelunasan Piutang, Pembayaran Hutang, Operasional, Modal, Prive, Setoran/Transfer antar akun) | M |
| FR-FIN-02 | Kas masuk/keluar operasional di backoffice (listrik, gaji harian, bensin) dengan kategori yang dapat dikelola | M |
| FR-FIN-03 | **Laporan arus kas** per periode & akun: saldo awal, masuk per kategori, keluar per kategori, saldo akhir | M |
| FR-FIN-04 | **Laba kotor per barang** (periode): qty terjual (satuan dasar), penjualan bersih (setelah diskon baris & alokasi diskon nota, tanpa PPN), HPP, laba, margin %; dikurangi retur | M |
| FR-FIN-05 | **Laba kotor per faktur** (nota): total bersih, HPP, laba per nota | M |
| FR-FIN-06 | **Laba rugi kotor per periode**: penjualan bersih − retur − HPP = laba kotor; − biaya operasional (kategori kas keluar Operasional) = laba bersih operasional (perkiraan) | M |
| FR-FIN-07 | Laporan penjualan: per hari/kasir/shift/pelanggan/kategori/metode bayar | M |
| FR-FIN-08 | Laporan stok: posisi stok, nilai persediaan, stok menipis, stok minus, barang tidak laku (tanpa penjualan N hari) | M |
| FR-FIN-09 | Dashboard owner: omzet & laba hari ini/bulan ini vs periode lalu, top 10 barang, stok menipis, piutang jatuh tempo | M |
| FR-FIN-10 | Semua laporan: filter periode, cetak (A4 via dialog OS — pengecualian dari aturan "tanpa dialog" yang hanya untuk struk), ekspor Excel (`.xlsx`) & PDF | M |
| FR-FIN-11 | **Rekap keluar-masuk pupuk harian**: matriks tanggal × produk (ZAK dan KG ecer dipisah), baris pembelian masuk, saldo awal & akhir — pengganti sheet "DATA PENGELUARAN PUPUK" | M |
| FR-FIN-12 | Laporan **Penjualan Rekap** & **Pembelian Detail** dengan kolom setara laporan iPOS (No Transaksi, Tanggal, Kode Pel., Jml Item, Sub Total, Pot., Pajak, Biaya Lain, Total Akhir, Bayar Tunai, Bayar Kredit) agar owner bisa membandingkan langsung | M |

### 5.7 Local Server, Perangkat & Sinkronisasi

| ID | Requirement | Prio |
|---|---|:-:|
| FR-SRV-01 | Server Express listen `0.0.0.0:3000`; port terpakai saat boot → FATAL dengan pesan proses yang memakai port (port tidak berpindah otomatis karena klien LAN dikonfigurasi ke 3000) | M |
| FR-SRV-02 | `GET /api/v1/health` (tanpa auth): status app, versi, status DB, waktu server — untuk klien mendeteksi hub | M |
| FR-SRV-03 | **Pairing perangkat**: Owner membuat kode pairing (QR berisi `http://<ip>:3000` + kode 6 digit, berlaku 5 menit) → perangkat memanggil `POST /devices/pair` → menerima token perangkat + kode perangkat (`H01`, `H02`…). Owner dapat mencabut perangkat | M |
| FR-SRV-04 | Halaman "Koneksi" menampilkan IP LAN hub, QR pairing, daftar perangkat (terakhir terlihat, versi app, antrean tertunda bila dilaporkan) | M |
| FR-SRV-05 | **Sync pull**: `GET /api/v1/sync/pull?entity=<nama>&since=<ISO_TIMESTAMP>&limit=500` mengembalikan perubahan master satu entitas (termasuk tombstone `deleted_at`) dengan `has_more` + `cursor` (halaman berikutnya) atau `next_since` (sesi berikutnya) — detail di `rules/sync-standards.md` §3 | M |
| FR-SRV-06 | **Sync push**: `POST /api/v1/sync/push` menerima batch operasi dari outbox perangkat; setiap operasi ber-`op_id` (UUID) → idempoten (kirim ulang = hasil yang sama, tanpa duplikat) | M |
| FR-SRV-07 | Hasil per operasi: `APPLIED`, `DUPLICATE`, `REJECTED` (validasi — permanen, tampil ke user untuk ditindaklanjuti), `RETRY` (sementara) | M |
| FR-SRV-08 | Deteksi selisih jam perangkat vs server; > 5 menit → peringatan di perangkat & di halaman Koneksi | S |
| FR-SRV-09 | Firewall Windows: installer menambah rule inbound TCP 3000 **profil Private saja** | M |
| FR-SRV-10 | Discovery hub otomatis di LAN (mDNS `_mandiritani._tcp`) | C |
| FR-SRV-11 | **Mode Terminal**: aplikasi desktop kedua tanpa PG lokal, tersambung ke hub, outbox offline untuk penjualan | C (v1.x) |

**Aplikasi mobile staf (Capacitor, Android) — FR-MOB:**

| ID | Requirement | Prio |
|---|---|:-:|
| FR-MOB-01 | Pairing via scan QR dari halaman Koneksi | M |
| FR-MOB-02 | Cek harga & stok (scan kamera / cari), bekerja offline dari data hasil pull terakhir | M |
| FR-MOB-03 | Stok opname: ambil sesi opname, hitung (offline boleh), push hasil | M |
| FR-MOB-04 | Dashboard owner read-only (butuh online ke hub) | S |
| FR-MOB-05 | Indikator status sinkron: terakhir sinkron, jumlah operasi tertunda, operasi REJECTED | M |

### 5.8 Sistem & Pengaturan

| ID | Requirement | Prio |
|---|---|:-:|
| FR-SYS-01 | Wizard first-run: profil toko (nama, alamat, telepon, logo), akun Owner, gudang default, printer struk, kode perangkat hub `K01` | M |
| FR-SYS-02 | Manajemen user (Owner): username, nama, role, password (backoffice) + PIN 6 digit (kasir & otorisasi), aktif/nonaktif — user tidak pernah dihapus | M |
| FR-SYS-03 | Login: username + password atau username + PIN (mode kasir); kunci 5 menit setelah 5 gagal | M |
| FR-SYS-04 | Template nota (JSONB `settings.receipt`): ukuran kertas (½ / 1 halaman continuous form), kolom (80/96/137), draft/NLQ, header/footer bebas, kasir, info piutang, blok barang belum diambil, kolom tanda tangan | M |
| FR-SYS-05 | Pengaturan printer **per peran** (`faktur` → LX-310 ESC/P, `struk` → thermal ESC/POS): nama antrean Windows (hanya antrean siap; pilih otomatis USB+Normal), panjang halaman / lebar struk, potong kertas, jumlah salinan, **cetak uji & atur posisi kertas**, mode laci (§8.2). Job dipantau setelah kirim — tertahan Error/Offline → dibatalkan + pesan jelas | M |
| FR-SYS-06 | Audit log viewer (Owner): filter user/aksi/tanggal, read-only | M |
| FR-SYS-10–12 | Backup & restore (§3.8) | M |

### 5.9 Migrasi dari iPOS 5 (FR-MIG)

Sumber: file backup iPOS `.i5bu` (= `pg_dump -Fc` PostgreSQL 9.5). Pemetaan
lengkap: Analisis §4.

| ID | Requirement | Prio |
|---|---|:-:|
| FR-MIG-01 | Wizard **Impor dari iPOS** (Owner): pilih file `.i5bu` → hitung SHA-256 → `pg_restore` ke DB sementara `ipos_import` memakai binaries PG bawaan → pratinjau jumlah per entitas + daftar masalah kualitas data (DQ-*) → konfirmasi → transformasi dalam **satu transaksi** → hapus DB sementara | M |
| FR-MIG-02 | Lingkup bertahap yang bisa dipilih: **Master** (satuan, kategori, item, satuan turunan, harga, grup, pelanggan, supplier, bank) → **Stok awal** (qty `tbl_itemstok`; **lapisan FIFO disalin** dari `tbl_item_im` sisa > 0, mutasi `OPENING`) → **Piutang terbuka** (per nota, nomor/tanggal/jatuh tempo asli, `receivables.source_type = OPENING`) → **Histori 2 tahun** (keputusan owner: **ya** — 9.705 nota penjualan beserta HPP per baris dari `tbl_item_ik`, 450 faktur pembelian, 2.548 pelunasan piutang, 498 kas keluar; tanpa mutasi stok, `sales.source = IPOS_IMPORT`) agar laporan & harga terakhir pelanggan langsung punya riwayat | M |
| FR-MIG-03 | Setiap entitas impor tercatat di `legacy_refs` (kode lama → id baru) dan setiap proses di `import_batches` (`purpose` DEVELOPMENT/REHEARSAL/GO_LIVE); impor lingkup yang sudah terisi **ditolak** — ulangi lewat Reset data persiapan (FR-MIG-08) | M |
| FR-MIG-04 | Rekonsiliasi otomatis setelah impor, ditampilkan & bisa dicetak: jumlah item/pelanggan, total qty & nilai stok vs iPOS, total & jumlah piutang terbuka vs iPOS (target: selisih 0) | M |
| FR-MIG-05 | **Hutang supplier — konfirmasi per faktur** (DQ-11): iPOS mencatat 49 faktur beli kredit (Rp 3,13 M) tanpa satu pun pelunasan. Importer menampilkan daftar ke-49 faktur (supplier, tanggal, nilai, jatuh tempo); Owner **mencentang yang benar-benar belum lunas** (boleh isi sisa bila sudah dicicil) → hanya itu yang menjadi `payables` OPENING. Faktur lain tetap masuk histori sebagai lunas. Tambahan hutang di luar iPOS bisa diinput manual | M |
| FR-MIG-06 | Laporan duplikat pelanggan (DQ-4) + alat **gabung pelanggan** (memindahkan piutang & histori, audit) | S |
| FR-MIG-07 | Importer hanya membaca file sumber, tidak mengirimnya ke mana pun, dan tidak mengimpor user/password, jurnal akuntansi, maupun log aktivitas iPOS | M |
| FR-MIG-08 | **Mode Persiapan** (sebelum go-live, banner di semua layar): Owner boleh **Reset data persiapan** (backup otomatis → hapus semua data bisnis hasil impor & transaksi uji, simpan user/perangkat/pengaturan/audit) lalu impor ulang tanpa batas — untuk pengembangan dan gladi | M |
| FR-MIG-09 | Importer menerima **backup iPOS 5 mana pun** (tidak terikat file pengembangan), memeriksa sidik struktur tabel/kolom wajib lebih dulu, dan berhenti dengan daftar perbedaan yang jelas bila struktur tidak cocok | M |
| FR-MIG-10 | **Nyatakan Go-Live** (Owner, konfirmasi ketik): mengisi `settings.system.go_live_at`, backup otomatis, mengunci impor iPOS & reset. Jalan kembali hanya lewat restore backup pra-go-live. Prosedur: [`plan/sprint-14-go-live-migrasi.md`](../../plan/sprint-14-go-live-migrasi.md) | M |

---

## 6. Database Schema Design

DDL lengkap & otoritatif: [`mandiri_tani_schema.sql`](mandiri_tani_schema.sql).
Bagian ini menjelaskan desain dan alasannya.

### 6.1 Konvensi

- **PK** `id uuid` — UUIDv7 dibuat aplikasi (ADR-02); `DEFAULT
  gen_random_uuid()` hanya pengaman. Pengecualian: `audit_logs` &
  `stock_movements` punya `seq bigint identity` untuk urutan stabil.
- Nama tabel `snake_case` jamak; FK `<singular>_id`.
- **Status** = `text` + `CHECK (status IN (...))`, bukan PG `ENUM` (mudah
  ditambah lewat migrasi).
- **Uang** `NUMERIC(18,2)`; **HPP** `NUMERIC(18,4)`; **qty**
  `NUMERIC(18,4)`; konversi satuan `NUMERIC(18,4)`.
- Semua tabel: `created_at`, `updated_at timestamptz` — `updated_at` diisi
  **trigger** `set_updated_at()` memakai `clock_timestamp()` (waktu server,
  dasar `?since=`).
- **Tabel master yang disinkron** (produk, satuan, harga, barcode,
  pelanggan, grup, supplier, gudang, metode bayar, kategori, merek):
  soft delete `deleted_at` (tombstone) + index `updated_at`.
- **Dokumen** (penjualan, pembelian, retur, opname, dll): tidak pernah
  dihapus atau diedit setelah `POSTED/COMPLETED`; koreksi = dokumen
  pembalik (void/retur/penyesuaian).
- **Ledger append-only**: `stock_movements`, `audit_logs`,
  `cash_transactions` — trigger menolak `UPDATE`/`DELETE`.
- Kolom asal: `device_id` + `client_op_id` (UNIQUE) pada dokumen yang bisa
  dibuat perangkat offline, untuk idempotensi.
- Waktu bisnis (`trx_at`) terpisah dari waktu server (`created_at`).

### 6.2 Peta relasi (ringkas)

```
units ─┐                 customer_groups ──< customers ──< receivables ──< receivable_payment_allocations >── receivable_payments
       │                        │
categories ──< products >── brands      product_prices (product_unit × customer_group? × min_qty)
                 │  │                         │
                 │  └──< product_units >──────┘──< product_barcodes
                 │            │
                 ├──< product_components (BOM: parent → component)
                 ├──< stock_balances (product × warehouse)  >── warehouses
                 └──< stock_movements (ledger, source_type + source_id)

devices ──< shifts ──< sales ──< sale_items          sales ──< sale_payments >── payment_methods
users  ──<┘   │          │  └──< sale_returns ──< sale_return_items
              │          └── customers
              └──< cash_transactions >── cash_accounts, cash_categories

suppliers ──< purchase_orders ──< purchase_order_items
          ──< goods_receipts ──< goods_receipt_items (→ po_item)
          ──< purchase_invoices ──< purchase_invoice_items (→ receipt_item)
          ──< purchase_returns ──< purchase_return_items
          ──< payables ──< payable_payment_allocations >── payable_payments

stock_opnames ──< stock_opname_lines   stock_adjustments ──< stock_adjustment_lines
stock_transfers ──< stock_transfer_lines   assemblies ──< assembly_lines
customers ──< sale_pickups ──< sale_pickup_items >── sale_items       (pengambilan barang: mutasi SALE_PICKUP, lepas reservasi)
import_batches ──< legacy_refs (kode iPOS → id baru)
settings (key → jsonb) · doc_sequences · sync_ops · sessions · audit_logs · schema_migrations
```

### 6.3 Multi-satuan & harga

- `product_units(product_id, unit_id, conversion_qty)` — `conversion_qty`
  = jumlah **satuan dasar** dalam 1 satuan ini (PCS=1, PAK=6, DUS=24).
  Tepat satu baris `is_base = true` dengan `conversion_qty = 1`
  (partial unique index). Hierarki "Dus > Pak > Pcs" diturunkan dari
  urutan `conversion_qty`, tidak perlu parent pointer.
- `product_barcodes(product_unit_id, barcode UNIQUE)` — barcode mengarah ke
  satuan, sehingga scan langsung tahu satuannya.
- `product_prices(product_unit_id, customer_group_id NULL, min_qty,
  price)` dengan `UNIQUE NULLS NOT DISTINCT (product_unit_id,
  customer_group_id, min_qty)` (PG ≥ 15). `customer_group_id NULL` = harga
  umum; `min_qty > 1` = tier grosir.
- Query resolusi harga (FR-POS-05):
  ```sql
  SELECT price, customer_group_id, min_qty
  FROM product_prices
  WHERE product_unit_id = $1 AND deleted_at IS NULL
    AND min_qty <= $3
    AND (customer_group_id = $2 OR customer_group_id IS NULL)
  ORDER BY (customer_group_id IS NULL), min_qty DESC
  LIMIT 1;
  ```
  Catatan: aturan ini memilih harga grup bila ada untuk tier mana pun ≤
  qty, sebelum harga umum. Implementasi **WAJIB** satu fungsi
  (`PriceService.resolve`) yang dites unit.

### 6.4 Stok

- `stock_balances(product_id, warehouse_id)` PK komposit, `qty` = **stok
  fisik** satuan dasar, `reserved_qty` = terjual belum diambil; tersedia =
  `qty − reserved_qty`. Keduanya **selalu** diperbarui dalam transaksi yang
  sama dengan dokumennya — `qty` hanya lewat `stock_movements`, `reserved_qty`
  lewat `stockService.reserve/release` dan mutasi `SALE_PICKUP*`.
- `stock_movements`: `qty` bertanda (+ masuk, − keluar), `unit_cost`
  (HPP per satuan dasar saat mutasi), `source_type` (`SALE`,
  `SALE_VOID`, `SALE_RETURN`, `PURCHASE_RECEIPT`, `PURCHASE_RETURN`,
  `OPENING`, `OPNAME`, `ADJUSTMENT`, `TRANSFER_OUT`, `TRANSFER_IN`,
  `ASSEMBLY_OUT`, `ASSEMBLY_IN`), `source_id`, `source_line_id`,
  `moved_at` (waktu bisnis), `seq` (urutan insert).
- Saldo berjalan kartu stok **dihitung**, tidak disimpan (dokumen sinkron
  bisa datang terlambat dengan `moved_at` lampau):
  ```sql
  SELECT moved_at, source_type, source_id, qty,
         SUM(qty) OVER (ORDER BY moved_at, seq) + $opening AS running_balance
  FROM stock_movements
  WHERE product_id = $1 AND warehouse_id = $2 AND moved_at >= $from AND moved_at < $to
  ORDER BY moved_at, seq;
  ```
- **Pemeriksaan konsistensi harian (G-4):**
  `stock_balances.qty = SUM(stock_movements.qty)` per (produk, gudang);
  selisih → log error + notifikasi Owner.

### 6.5 Konkurensi & locking

Isolation default `READ COMMITTED` + row lock eksplisit:

1. Kumpulkan semua (product_id, warehouse_id) yang terdampak dokumen,
   **urutkan** (product_id, warehouse_id).
2. `INSERT INTO stock_balances … ON CONFLICT DO NOTHING` untuk baris yang
   belum ada.
3. `SELECT … FROM stock_balances WHERE (product_id, warehouse_id) IN (…)
   ORDER BY product_id, warehouse_id FOR UPDATE`.
4. `SELECT … FROM products WHERE id = ANY($1) ORDER BY id FOR UPDATE`
   untuk **semua** produk terdampak — lock produk menyerialkan akses ke
   lapisan FIFO-nya; lapisan lalu dibaca `ORDER BY received_at, id FOR UPDATE`.
5. Validasi stok (FR-INV-10), pakai/buat lapisan FIFO, tulis movement,
   update balance & `last_purchase_cost` — semua dalam satu `withTransaction()`.

Urutan lock yang konsisten mencegah deadlock antara dua kasir/HP.
Deadlock/serialization error (`40P01`, `40001`) di-retry otomatis maks 3×
oleh `withTransaction`.

### 6.6 HPP metode FIFO (sama seperti iPOS — ADR-04)

Setiap **barang masuk berbiaya** membuat satu **lapisan** di
`stock_cost_layers` (produk × gudang, tanggal masuk, qty masuk, **qty sisa**,
harga per satuan dasar). Setiap **barang keluar** menghabiskan lapisan
**tertua lebih dulu** dan mencatat pemakaiannya di `stock_layer_consumptions`.

```
Contoh Urea (satuan dasar KG):
  01-10  beli 100 ZAK @ 355.000  → lapisan A: 5.000 kg @ 7.100/kg
  15-10  beli 100 ZAK @ 380.000  → lapisan B: 5.000 kg @ 7.600/kg
  20-10  jual 120 ZAK (6.000 kg) → pakai A 5.000 kg @ 7.100 + B 1.000 kg @ 7.600
         HPP baris = (35.500.000 + 7.600.000) / 6.000 = 7.183,33/kg
  Sisa persediaan = lapisan B 4.000 kg @ 7.600 = Rp 30.400.000
```

| Mutasi | Aturan lapisan |
|---|---|
| Penerimaan / faktur pembelian | Lapisan baru, harga = (total baris + alokasi ongkos) / base_qty |
| Penjualan dibawa langsung, **pengambilan barang** (`SALE_PICKUP`), retur beli, penyesuaian −, opname −, rakitan keluar | Habiskan lapisan tertua di gudang itu; `unit_cost` mutasi = rata-rata tertimbang lapisan yang terpakai. Retur beli menghabiskan lapisan **dari penerimaan asalnya** lebih dulu, baru FIFO |
| Void, batal pengambilan, retur jual (restock) | Lapisan baru dengan **harga persis** dari pemakaian yang dibalik, `received_at` = tanggal lapisan asal (urutan FIFO terjaga) |
| Mutasi antar gudang | Habiskan lapisan di gudang asal → lapisan baru di gudang tujuan dengan harga & tanggal yang sama |
| Penyesuaian +, opname + | Lapisan baru seharga harga beli terakhir (`last_purchase_cost`) |
| Saldo awal impor iPOS | **Salin lapisan FIFO iPOS** (`tbl_item_im` dengan sisa > 0) apa adanya → nilai persediaan sama persis dengan iPOS |
| Barang belum diambil (reservasi) | **Belum** memakai lapisan; HPP ditetapkan saat diambil |

**Stok minus** (dokumen sinkron / otorisasi Owner) — lapisan habis: kekurangan
dibebankan dengan harga beli terakhir dan ditandai `is_estimated = true`
(laporan laba menandai "HPP estimasi"). Tidak ada penghitungan ulang mundur
saat barang datang kemudian — sama seperti perilaku iPOS, tapi lebih baik
dari iPOS yang memberi HPP 0 (DQ-3).

`sale_items.cost_per_base` = snapshot HPP dari lapisan yang terpakai (laba
historis tidak berubah). Invarian harian: `Σ stock_cost_layers.qty_remaining
= stock_balances.qty` per produk × gudang (bila stok ≥ 0); **nilai
persediaan = Σ qty_remaining × unit_cost**.

### 6.7 Penomoran dokumen

**Sama persis dengan iPOS** (keputusan owner Q-16): format
`{URUT}/{TIPE}/{DEPT}/{BLNTHN}` — mis. `0001789/JL/UTM/1026`.

| Bagian | Aturan (dari `tbl_formatnotr` iPOS) |
|---|---|
| `URUT` | Nomor urut **per tipe per gudang**, **reset tiap tahun** (1 Januari), diisi nol di depan: **7 digit** untuk `KSR`, `JL`, `BL`; **4 digit** untuk tipe lain (seperti iPOS) |
| `TIPE` | Kode iPOS yang sudah dikenal: `KSR` penjualan kasir, `JL` faktur penjualan, `RJ` retur jual, `BL` faktur pembelian, `RB` retur beli, `BP` bayar piutang, `KASO` kas keluar, `KSIN` kas masuk, `PJ` pesanan jual, `TRF` mutasi gudang. Tipe baru (tidak ada di iPOS): `AB` ambil barang, `BH` bayar hutang, `PS` penyesuaian stok, `SH` shift, `RK` rakitan, `PO` pesanan beli |
| `DEPT` | Kode gudang (`UTM`) |
| `BLNTHN` | Bulan + 2 digit tahun dari tanggal dokumen (`1026` = Oktober 2026) |

- **Melanjutkan nomor iPOS:** saat impor go-live, nilai terakhir per tipe
  (`tbl_formatnotr.nomor`, mis. JL = 1788, KSR = 2060 per backup
  2026-10-24) disalin ke `doc_sequences`, sehingga nota pertama di sistem
  baru adalah lanjutan langsung dari iPOS (`0001789/JL/UTM/1026`). Histori
  hasil impor memakai nomor aslinya; `UNIQUE(number)` menjamin tidak bentrok.
- `doc_sequences(doc_type, dept_code, year)` — `UPDATE … SET last_no =
  last_no + 1 RETURNING last_no` **di dalam transaksi dokumen** (rollback =
  nomor tidak terbuang). Hanya **hub** yang menomori dokumen di v1 (HP staf
  tidak membuat nota; hitungan opname tidak bernomor).
- Mode Terminal (v1.x, kasir kedua offline) kelak memakai kode `DEPT`
  sendiri (mis. `UTM2`) agar urutnya tidak bentrok — diputuskan saat fitur
  itu dibuat.
- Nota tertahan (`HELD`) belum bernomor.

### 6.8 JSONB

| Kolom | Isi | Index |
|---|---|---|
| `products.attributes` | atribut dinamis (bahan aktif, no. registrasi…) | GIN `jsonb_path_ops` |
| `settings.value` | `receipt`, `printer`, `pos`, `tax`, `rounding`, `stock`, `backup` | — (PK key) |
| `payment_methods.config` | rekening tujuan, path gambar QRIS | — |
| `shifts.denominations` | hitungan pecahan saat buka/tutup | — |
| `audit_logs.before/after` | snapshot perubahan | — |
| `sync_ops.result` | respons operasi untuk replay idempoten | — |

Aturan: JSONB untuk data **konfigurasi / atribut bebas**; apa pun yang
dipakai untuk join, constraint, atau agregasi laporan **WAJIB** kolom
biasa.

### 6.9 Index performa (utama)

| Index | Untuk |
|---|---|
| `product_barcodes(barcode)` UNIQUE | scan ≤ 150 ms |
| `products USING gin (name gin_trgm_ops)` | cari nama |
| `products(sku)` UNIQUE, `products(updated_at)` | cari SKU, sync pull |
| `stock_movements(product_id, warehouse_id, moved_at, seq)` | kartu stok |
| `stock_movements(source_type, source_id)` | buka dokumen sumber / void |
| `sales(trx_at)`, `sales(shift_id)`, `sales(customer_id, trx_at)` | laporan, rekap shift |
| `sale_items(product_id)` + `sale_items(sale_id)` | laba per barang |
| `receivables(customer_id) WHERE status <> 'PAID'` | saldo piutang & limit |
| `receivables(due_date) WHERE status <> 'PAID'` | jatuh tempo |
| `shifts(device_id) WHERE status = 'OPEN'` UNIQUE | satu shift terbuka per perangkat |
| `cash_transactions(cash_account_id, trx_at)` | arus kas |

### 6.10 Kebijakan foreign key

- Master → dokumen: `ON DELETE RESTRICT` (master tidak pernah dihapus
  fisik).
- Header → baris dokumen: `ON DELETE CASCADE` hanya untuk dokumen DRAFT /
  HELD (penghapusan dokumen POSTED dicegah di service + tidak ada route).
- Semua FK ber-index (PostgreSQL tidak membuat index FK otomatis).

---

## 7. Non-Functional Requirements

### 7.1 Reliabilitas & integritas (ACID)

| ID | Requirement |
|---|---|
| NFR-REL-01 | `fsync`, `synchronous_commit`, `full_page_writes` **on** dan tidak boleh diubah oleh setting apa pun. Uji: 50× matikan paksa proses/VM saat transaksi berlangsung → 0 transaksi committed hilang, 0 transaksi setengah jadi |
| NFR-REL-02 | Setiap operasi bisnis multi-tabel (bayar nota = sales + items + payments + stock + receivable + cash) = **satu transaksi DB**. Tidak ada efek samping di luar DB (cetak, notifikasi) sebelum COMMIT |
| NFR-REL-03 | Retry otomatis untuk `40001`/`40P01` (maks 3×, backoff 50–200 ms); error lain → rollback & error terstruktur |
| NFR-REL-04 | Idempotensi: endpoint pembuat dokumen menerima header `Idempotency-Key` (desktop) / `op_id` (sync); pengiriman ganda (klik dua kali, retry jaringan) tidak membuat dokumen ganda |
| NFR-REL-05 | Recovery boot setelah crash otomatis tanpa intervensi user (§3.4, §3.7) |
| NFR-REL-06 | RPO ≤ 24 jam (backup harian) untuk kerusakan disk; RPO 0 untuk crash/listrik padam (WAL). RTO restore ≤ 15 menit |

### 7.2 Connection pool

| ID | Requirement |
|---|---|
| NFR-DB-01 | `pg.Pool`: `max = 10`, `idleTimeoutMillis = 30000`, `connectionTimeoutMillis = 5000`; `statement_timeout = 15s` (laporan: 60s via `SET LOCAL`) |
| NFR-DB-02 | Klien dilepas di `finally` — hanya lewat helper `withClient()`/`withTransaction()`, tidak pernah `pool.connect()` manual di service |
| NFR-DB-03 | `pool.on('error')` dicatat; koneksi rusak dibuang otomatis; endpoint health melaporkan `totalCount/idleCount/waitingCount` |
| NFR-DB-04 | Saat shutdown: `pool.end()` sebelum `pg_ctl stop` |

### 7.3 Performa

Volume nyata saat ini (iPOS): 416 item, 1.238 pelanggan, ~450 nota & ~700
baris/bulan. Target di bawah sengaja jauh di atasnya (headroom ±50×).

| ID | Target (PC: Core i3 gen 8, RAM 8 GB, SSD; 20.000 produk, 500.000 baris penjualan) |
|---|---|
| NFR-PERF-01 | Scan barcode → baris di keranjang ≤ 150 ms p95 |
| NFR-PERF-02 | Simpan transaksi bayar (10 baris) ≤ 300 ms p95 |
| NFR-PERF-03 | Laporan laba per barang 1 bulan ≤ 3 dtk |
| NFR-PERF-04 | Sync pull 20.000 produk pertama kali ≤ 30 dtk di Wi-Fi toko |
| NFR-PERF-05 | Memori aplikasi (Electron + PG) ≤ 800 MB saat idle |
| NFR-PERF-06 | Spesifikasi minimum: Windows 10 22H2 x64, RAM 4 GB, ruang disk 2 GB + data |

### 7.4 Keamanan

| ID | Requirement |
|---|---|
| NFR-SEC-01 | PostgreSQL hanya listen `127.0.0.1`; `pg_hba` scram-sha-256; aplikasi login sebagai `pos_app` (bukan superuser) |
| NFR-SEC-02 | Semua endpoint selain `/health` & `/devices/pair` butuh token; **tidak ada bypass untuk request dari localhost** (proxy seperti `tailscale serve` membuat request tampak dari 127.0.0.1) |
| NFR-SEC-03 | Password: argon2id; PIN 6 digit di-hash + lockout; token = 32 byte acak, disimpan sebagai hash SHA-256 |
| NFR-SEC-04 | Electron: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, CSP ketat, IPC memvalidasi pengirim & payload (Zod) |
| NFR-SEC-05 | Audit log append-only untuk: login/gagal login, otorisasi Owner, void, retur, ubah harga, penyesuaian/opname stok, ubah user/role, restore, tutup shift dengan selisih |
| NFR-SEC-06 | Rate limit: login 10/menit/IP; API umum 600/menit/perangkat |
| NFR-SEC-07 | Detail lengkap: `rules/security-standards.md` |

### 7.5 Usability & lokalisasi

- Seluruh teks UI, pesan error, struk, laporan dalam **Bahasa Indonesia**.
- Format `id-ID`: `Rp 1.500.000`, qty `2,5 kg`, tanggal `24 Okt 2026`,
  zona waktu `Asia/Jakarta`.
- Layar kasir 100% bisa dioperasikan tanpa mouse; fokus selalu terlihat.
- Target sentuh ≥ 44 px (layar sentuh kasir & mobile).
- Kontras teks ≥ 4.5:1 (toko terang/siang hari).
- Resolusi minimum 1366×768.

### 7.6 Observability & maintainability

- Log terstruktur JSON (pino) dengan `request_id`, rotasi harian.
- Menu "Bantuan → Ekspor diagnostik" mengemas log + versi + status
  (tanpa data bisnis) menjadi zip untuk dukungan teknis.
- TypeScript strict di seluruh kode; coverage service bisnis ≥ 80%
  (stok, harga, pembayaran, sync), keseluruhan ≥ 60%.
- Tes integrasi memakai PostgreSQL asli (binaries yang sama), bukan mock.

---

## 8. Peripherals & Network Integration

### 8.1 Cetak nota langsung (tanpa dialog Windows)

**Toko memakai DUA printer** (foto struk & faktur iPOS, 2026-10-24). Setiap
jenis dokumen diarahkan ke printernya lewat setting `printer.roles`:

| Peran | Printer | Bahasa | Dokumen |
|---|---|---|---|
| `faktur` | **Epson LX-310** (USB, driver `LX-310_Drv_Ver1_1497909`) | ESC/P | Faktur Penjualan (JL), Bukti Pengambilan (AB), bukti bayar piutang, rekap shift |
| `struk` | **Printer struk thermal** (model & lebar menyusul — Q-17) | ESC/POS | Struk kasir (KSR) penjualan kecil |

**Struk kasir (KSR) meniru struk iPOS:** "MANDIRI TANI" besar di tengah;
alamat & telepon; No. nota + tanggal (kanan), Kasir + jam, Pel. (UMUM/CASH);
per barang: nama, lalu `harga x qty SATUAN = jumlah`; **TOTAL**, `BRS=n ,
QTY=x`, Tunai, Kembali; catatan "Barang yang telah dibeli tidak dapat
dikembalikan kecuali ada perjanjian / Terimakasih" (dibungkus otomatis
mengikuti lebar kertas); feed lalu potong kertas (bila ada pemotong).
Perbaikan vs iPOS: nama kasir asli (bukan ADMIN), label TOTAL, tidak ada
teks terpotong ("Email: s").

**Printer faktur: Epson LX-310** — printer **dot matrix 9-pin, kertas
continuous form (sobek di perforasi)**. Akibatnya:

| Aspek | LX-310 (v1) | Printer thermal (bila kelak dipakai) |
|---|---|---|
| Bahasa perintah | **ESC/P** (Epson) | ESC/POS |
| Kertas | Continuous form, lebar cetak 8" — **80 kolom** (10 cpi), 96 (12 cpi), 137 (condensed) | Gulungan 58/80 mm (32/48 kolom) |
| Panjang halaman | Diatur (`ESC C`) — mis. ½ halaman 5,5" = 33 baris @ 6 lpi; nota panjang lanjut ke halaman berikut dengan "Hal 1/2" | Tidak ada halaman |
| Potong kertas | Tidak ada — maju ke perforasi (tear-off) | Pemotong otomatis |
| Laci uang | **Tidak ada port laci** (§8.2) | RJ11 di printer |
| QR / barcode | Tidak bawaan (bit-image lambat & buram) → **tidak dipakai** | Bawaan |
| Rangkap | Bisa kertas NCR 2–3 rangkap (asli pelanggan + arsip) | Satu lembar |
| Kecepatan | ±3–6 dtk per ½ halaman | < 1 dtk |

**Arsitektur:** `DocumentBuilder` (data nota/faktur/bukti ambil → model
baris teks per halaman) → **`PrinterEncoder`** dipilih dari setting
`printer.language`: **`escp`** (LX-310, default v1) atau `escpos` (thermal)
→ `PrinterTransport` (kirim byte). Dijalankan di main process, dipanggil
renderer via IPC `pos:printer:print`.

| Transport | Implementasi | Kapan |
|---|---|---|
| `windows-raw` | Job datatype `RAW` ke antrean printer Windows yang dibuat driver Epson — **tanpa** dialog | **v1: LX-310 via USB** — dibangun & diuji pertama di Sprint 6 |
| `network` | Socket TCP mentah ke `ip:9100` (modul `net`) | Printer LAN (cadangan) |
| `serial` | `serialport` (COMx) | Printer/pemicu laci serial (cadangan) |

Mode teks mentah dipilih (bukan cetak grafis lewat driver Windows): pada
dot matrix, cetak teks memakai font printer → cepat, tajam, tembus ke
rangkap NCR; cetak grafis lambat dan buram.

**Perintah inti ESC/P (LX-310):**

| Fungsi | Byte |
|---|---|
| Inisialisasi | `ESC @` → `1B 40` |
| Tabel karakter PC437 | `ESC t 1` → `1B 74 01` |
| Mode draft (cepat) / NLQ (rapi) | `ESC x 0/1` → `1B 78 00/01` (setting; default draft) |
| Pitch 10 cpi / 12 cpi / condensed | `ESC P` → `1B 50` · `ESC M` → `1B 4D` · `SI` → `0F` (batal: `DC2` → `12`) |
| Tebal on/off | `ESC E` / `ESC F` → `1B 45` / `1B 46` |
| Lebar ganda (judul, TOTAL, no. nota) on/off | `ESC W 1/0` → `1B 57 01/00` |
| Spasi baris 1/6" | `ESC 2` → `1B 32` |
| Panjang halaman n inci | `ESC C NUL n` → `1B 43 00 n` (½ halaman: n = 5,5 → pakai `ESC C n` 33 baris) |
| Ganti halaman / maju ke perforasi | `FF` → `0C` |
| Baris baru | `CR LF` → `0D 0A` |

**Kertas (dikonfirmasi foto faktur iPOS, 2026-10-24):** continuous form
**½ halaman ±9,5" × 5,5"**, 1 lembar (bukan NCR), lubang sprocket kiri-kanan.
Acuan visual lokal: `.claude/file/contoh-faktur-ipos-LX310.jpg` (gitignored —
memuat nama pelanggan).

**Tata letak Faktur Penjualan (JL) — meniru faktur iPOS** yang sudah dikenal
toko & pelanggan. 12 cpi = **96 kolom**, 6 lpi = **33 baris** per ½ halaman:

```
[logo] FAKTUR PENJUALAN            No Transaksi : 0001789/JL/UTM/1026      Dept : UTM
       MANDIRI TANI                Tanggal      : 24/10/2026 12.05         User : SARI
       JL. POROS RAPP km. 72       Pelanggan    : PAK PAIMA SIMAMORA JALAN SEHAT
       0813-6144-1706              Alamat       : JL. SEHAT
------------------------------------------------------------------------------------------------
No Kode Item      Nama Item                         Jml Satuan        Harga  Pot%          Total
------------------------------------------------------------------------------------------------
 1 NARA UP 5      NARA UP 5 LTR                    1,00 PAIL     330.000,00  0,00     330.000,00
 2 METSULINDO 100 METSULINDO 100 GR                1,00 BTL       45.000,00  0,00      45.000,00
------------------------------------------------------------------------------------------------
Keterangan :                       Jml Item   :   2,00    Sub Total   :              375.000,00
                                   Potongan   :   0,00    Biaya Lain  :                    0,00
       Penerima                    Tanggal Jt : 03/11/2026 TOTAL AKHIR :             375.000,00
                                                          Tunai       :                    0,00
                                                          Transfer    :                    0,00
   (..............)                                       Kredit      :              375.000,00
Terbilang : tiga ratus tujuh puluh lima ribu rupiah       Kembali     :                    0,00
```

| Bagian | Isi | Catatan |
|---|---|---|
| Kop kiri | Logo (opsional), "FAKTUR PENJUALAN" tebal, nama, alamat, telepon toko dari `settings.store` | Logo dicetak sebagai bit-image ESC/P (`ESC *`, ±1") bila `receipt.show_logo` — lebih lambat ±1 dtk; default **aktif** agar mirip iPOS |
| Kop kanan | No Transaksi (**tebal**), Tanggal + jam, Pelanggan, Alamat, Dept (kode gudang), User (nama kasir login — bukan "ADMIN") | "Kode Sales" & "PPN" iPOS tidak dicetak (tidak dipakai; PPN muncul bila FR-POS-13 aktif) |
| Tabel | No · Kode Item · Nama Item · Jml · Satuan · Harga · Pot% · Total | Lebar kolom: 2·14·30·6·6·12·5·13 (+ spasi = 96). Nama/kode panjang dibungkus ke baris berikut seperti iPOS |
| Ringkasan tengah | Jml Item, Potongan, Biaya Lain, Tanggal Jt (hanya bila ada kredit) | |
| Ringkasan kanan | Sub Total, **TOTAL AKHIR** (tebal), lalu **hanya metode yang dipakai**: Tunai, Transfer, QRIS, Kredit, Kembali | Baris iPOS yang selalu 0 (DP PO, Deposit, K. Debit, K. Kredit) tidak dicetak |
| Kiri bawah | Keterangan, kotak tanda tangan **Penerima**, **Terbilang** (FR-POS-30) | Ruang kosong di kiri bawah dibiarkan untuk **stempel toko** (dibubuhkan manual seperti sekarang) |
| Tambahan | Blok **BARANG BELUM DIAMBIL** (FR-PKP-04) di atas Keterangan bila ada sisa; "Hal 1/2" bila baris barang > ±12 | Nota > 1 halaman: kop & header tabel diulang |

- **Nota Kasir (KSR)**: dicetak di **printer struk thermal**, bukan LX-310
  (format struk di atas). Bila printer struk mati, kasir boleh mencetak KSR
  ke LX-310 dengan format ½ halaman (cadangan).
- **Bukti Pengambilan (AB)**: ½ halaman, kop sama, judul "BUKTI PENGAMBILAN
  BARANG", tabel Nama Item · Satuan · Diambil · Sisa · No. Nota asal,
  penerima & kendaraan, tanda tangan Penerima + Petugas Gudang.
- Rekap shift, bukti bayar piutang: ½ halaman, kop sama.
- Font printer Sans Serif/Roman mode NLQ untuk faktur (lebih mirip iPOS),
  draft untuk cetak cepat — setting. Angka rata kanan format `id-ID`;
  karakter non-ASCII ditransliterasi (PC437).
- **Cetak uji wajib di Sprint 6**: cetak faktur contoh di LX-310 asli dan
  bandingkan dengan faktur iPOS (posisi di dalam perforasi, tidak terpotong,
  terbaca setelah disobek).

**Aturan:**
- Dicetak **setelah** COMMIT (NFR-REL-02). Gagal cetak → transaksi tetap
  sah, antrean cetak menyimpan job, tombol "Cetak ulang" (cetak ulang
  bertanda "SALINAN").
- Setelah cetak, kertas maju ke perforasi (`FF`) agar langsung bisa disobek;
  menu **"Atur posisi kertas"** mencetak garis uji untuk menyetel awal
  halaman (masalah umum continuous form).
- Timeout transport 10 dtk (dot matrix lambat); error dipetakan ke pesan
  ("Printer tidak merespons — cek kabel/daya/kertas/tuas kertas").
- Laporan A4 tetap memakai dialog cetak OS (`webContents.print`) ke printer
  lain/PDF.

### 8.2 Laci kasir

LX-310 **tidak punya port laci**. Setting `drawer.mode`:
- `none` (**default v1**) — laci dibuka manual (kunci/tuas); tombol "Buka
  laci" disembunyikan.
- `serial` / `usb-trigger` — kotak pemicu laci terpisah (RJ11→USB/serial)
  bila toko membelinya kelak.
- `printer` — hanya untuk printer thermal ESC/POS (`1B 70 00 19 FA`).

Rekonsiliasi kas laci saat tutup shift (FR-POS-18) tetap berjalan apa pun
modenya.

### 8.3 Barcode scanner (HID keyboard emulation)

- Scanner dikonfigurasi mengirim **suffix Enter**.
- Deteksi di renderer (`useScanner` hook, listener `keydown` global di
  layar kasir): buffer karakter; bila ≥ 4 karakter tiba dengan jeda
  antar-tombol ≤ 30 ms dan diakhiri Enter → dianggap scan, dikirim ke
  handler scan, **tidak** diketik ke input yang sedang fokus. Ketikan
  manusia (jeda lebih lama) diperlakukan normal.
- Ambang jeda dapat dikalibrasi di pengaturan ("Scan barcode uji").
- Barcode tidak ditemukan → bunyi error + dialog "Barang tidak ditemukan"
  dengan opsi cari manual.
- Mobile: scan kamera (plugin barcode Capacitor).

### 8.4 Jaringan lokal

- Server bind `0.0.0.0:3000` → melayani `127.0.0.1` (renderer), IP LAN
  (HP/terminal), dan kelak antarmuka Tailscale (v2.0).
- Installer NSIS (perMachine, butuh admin sekali saat install)
  menjalankan:
  ```
  netsh advfirewall firewall add rule name="Mandiri Tani POS (LAN)" dir=in action=allow protocol=TCP localport=3000 profile=private
  ```
  dan menghapusnya saat uninstall. Jaringan toko harus diset "Private"
  di Windows (panduan instalasi).
- Rekomendasi: IP hub statis / DHCP reservation di router agar klien
  tidak kehilangan alamat.
- Klien Android: izinkan HTTP cleartext hanya untuk rentang IP privat
  (network security config), karena LAN v1 tidak memakai HTTPS. HTTPS
  hadir di v2.0 lewat `tailscale serve`.
- CORS: hanya origin aplikasi sendiri; klien Capacitor memakai origin
  `capacitor://localhost`/`https://localhost` yang di-whitelist.

### 8.5 Remote access (pratinjau v2.0)

Cloudflare Tunnel **diganti Tailscale** (ADR-05). Tidak ada kode v1 yang
bergantung pada Tailscale; v1 hanya menjamin: bind `0.0.0.0`, tidak ada
kepercayaan berbasis IP/localhost, auth token di semua endpoint, dan
protokol sync yang tahan koneksi putus-sambung. Detail: dokumen v2.0.

---

## 9. Implementation Roadmap

Sprint = 2 minggu. Detail checklist per sprint: `plan/`.

| Milestone | Sprint | Isi | Keluaran |
|---|---|---|---|
| **M0 Fondasi** | S1 | Scaffold Electron + electron-vite + React + Tailwind v4 + shadcn; PG portable (fetch script); `PgManager` (initdb, start, stop, PID basi, port); migration runner; Express skeleton + health; boot screen; graceful shutdown; installer NSIS kerangka | App terpasang dari `.exe`, PG hidup/mati otomatis |
| | S2 | Auth (password/PIN, sesi, rate limit), user & role, permission, audit log, settings, first-run wizard, app shell (sidebar backoffice), doc_sequences | Login & shell siap |
| **M1 Master & Inventori** | S3 | Produk multi-satuan, barcode, harga, kategori/merek, pelanggan & grup, supplier, gudang, metode bayar (transfer per rekening); **importer iPOS lingkup Master** (pg_restore → transformasi → rekonsiliasi) | Master nyata toko terisi |
| | S4 | Stock service (ledger + lock + HPP), **impor stok awal dari iPOS**, kartu stok (stok buku & fisik), penyesuaian, opname (desktop), stok menipis, nilai persediaan, cek konsistensi harian | Stok = iPOS |
| **M2 POS Kasir** | S5 | Layar kasir: cari/scan, keranjang (Zustand), resolusi harga + **ubah harga baris**, satuan (KG/ZAK), potongan nota nominal, shortcut, scanner hook | Bisa membuat keranjang |
| | S6 | Shift buka/tutup, pembayaran tunai/transfer/QRIS, simpan transaksi (stok+kas), **cetak ESC/P ke Epson LX-310 via USB** (nota ½ halaman, atur posisi kertas), cetak ulang, kas masuk/keluar | **Transaksi KSR pertama end-to-end** |
| | S7 | **Faktur Penjualan (JL)**: pelanggan wajib, tunai+kredit, ongkos angkut, harga terakhir pelanggan, cetak faktur; **terjual-belum-diambil + layar Pengambilan Barang (AB)**, riwayat & bukti pengambilan; hold/resume, void, otorisasi PIN Owner | **Transaksi JL + piutang + pengambilan end-to-end** |
| **M3 Pembelian & Hutang/Piutang** | S8 | Faktur pembelian langsung (BL), riwayat harga beli, retur jual & retur beli, PO + penerimaan (S) | Siklus beli |
| | S9 | Pelunasan piutang multi-nota + alokasi, jatuh tempo, aging, **impor piutang terbuka iPOS** + rekonsiliasi, saldo awal hutang manual | Siklus uang = iPOS |
| **M4 Laporan** | S10 | Laba kotor (barang/faktur/periode), arus kas, Penjualan Rekap & Pembelian Detail ala iPOS, rekap harian pupuk, barang belum diambil & riwayat pengambilan, dashboard owner, ekspor Excel/PDF; **impor histori iPOS 2 tahun** | Laporan owner (dengan riwayat iPOS) |
| **M5 Sinkronisasi** | S11 | Pairing perangkat, `sync/pull` (?since= + overlap, cursor keyset, tombstone), `sync/push` (op_id, idempoten), halaman Koneksi, firewall rule | API sync teruji |
| | S12 | App mobile Capacitor: pairing QR, cek harga/stok offline, stok opname offline + push, status sync | HP staf tersinkron |
| **M6 Hardening & Rilis** | S13 | Backup/restore, uji cabut listrik 50×, uji sleep/resume, uji 2 kasir+HP bersamaan (deadlock), performa 20k produk, ekspor diagnostik | Lolos NFR |
| | S14 | Installer produksi (ikon, versi, code signing bila tersedia), panduan instalasi, **gladi migrasi dari backup iPOS terbaru** + paralel 1 minggu (iPOS & sistem baru, rekonsiliasi harian), UAT di toko, perbaikan | **Rilis v1.0** |

**Setelah v1.0:** v1.x — Mode Terminal (FR-SRV-11), auto-update, batch &
kedaluwarsa. **v2.0 — Tailscale** remote access untuk owner & staf di
luar toko (dokumen terpisah).

**Definition of Done (setiap item):** sesuai FR/NFR yang dirujuk; tes unit
/integrasi lulus; `npm run typecheck && npm run lint && npm test` hijau;
teks UI Bahasa Indonesia; permission & audit diterapkan; plan dicentang
dengan catatan status.

---

## 10. Pertanyaan Terbuka (perlu jawaban Owner / tim)

| # | Pertanyaan | Dampak |
|---|---|---|
| Q-1 | Apakah toko PKP (wajib PPN)? | FR-POS-13 default |
| Q-2 | Apakah menjual pupuk bersubsidi (RDKK / Kartu Tani, HET)? Perlu pencatatan khusus? | Bisa jadi modul baru |
| Q-3 | Berapa terminal kasir sekarang & rencana? (bila > 1 PC kasir, Mode Terminal naik ke Must) | FR-SRV-11 |
| Q-4 | ~~Printer?~~ **Terjawab: Epson LX-310 (dot matrix, ESC/P), USB** — §8.1 | — |
| Q-15 | ~~Kertas & laci?~~ **Terjawab:** faktur ½ halaman 9,5"×5,5", 1 lembar, format iPOS; **tidak ada laci uang**; struk KSR **di printer thermal terpisah** (koreksi asumsi sebelumnya) | §8.1–8.2 |
| Q-17 | Printer struk thermal: merek/model, lebar kertas (58/80 mm — dari foto ±48 huruf ≈ 80 mm), ada pemotong otomatis? Sambung USB? Jawab dengan menu Uji Cetak → Printer Struk Kasir | §8.1 |
| Q-16 | ~~Format nomor nota?~~ **Terjawab: sama dengan iPOS**, melanjutkan nomor terakhir iPOS — §6.7 | — |
| Q-5 | Perlu batch & tanggal kedaluwarsa untuk pestisida/benih di v1? | FR-INV-11 |
| Q-6 | ~~Data dari sistem lama?~~ **Terjawab:** iPOS 5 (`.i5bu`) + Excel — §5.9 | — |
| Q-7 | HP staf Android semua? (iOS butuh perangkat Mac untuk build) | FR-MOB |
| Q-8 | ~~Satuan dasar pupuk?~~ **Terjawab:** KG, ZAK = 50 KG untuk 13 pupuk ecer; pupuk lain hanya ZAK | — |
| Q-9 | ~~RAM sawit?~~ **Terjawab:** di luar konteks — file tonase tidak dipakai; "RAM 1/RAM 2" hanya nama grup pelanggan | — |
| Q-10 | ~~Metode HPP?~~ **Terjawab: FIFO seperti iPOS** — ADR-04, §6.6 | — |
| Q-11 | Hutang supplier: **diselesaikan lewat centang per faktur saat impor** (FR-MIG-05) — owner cukup tahu faktur mana yang belum lunas, tidak perlu menyiapkan angka total | FR-MIG-05 |
| Q-12 | Diskon grup Bronze/Silver/Gold (6/8/10%) masih berlaku? Selama ini jarang diterapkan | FR-POS-28 |
| Q-13 | ~~Impor histori?~~ **Terjawab: ya, histori 2 tahun diimpor** — FR-MIG-02 | — |
| Q-14 | ~~Pengguna?~~ **Terjawab: v1 dua role — KASIR dan OWNER** (§4). Nama akun dibuat di wizard first-run | — |

---

## Lampiran A — Ringkasan endpoint API v1

Semua di bawah `/api/v1`, JSON, auth `Authorization: Bearer <session>` +
`X-Device-Token` untuk perangkat non-hub. Error:
`{ "error": { "code": "STOCK_INSUFFICIENT", "message": "Stok Pupuk Urea tidak cukup (sisa 3 sak)", "details": {…} } }`.

| Area | Endpoint |
|---|---|
| Sistem | `GET /health` · `GET/PUT /settings/:key` · `POST /backups` · `GET /backups` · `POST /backups/:id/restore` |
| Auth | `POST /auth/login` · `POST /auth/pin-login` · `POST /auth/authorize` (otorisasi PIN Owner → token sekali pakai) · `POST /auth/logout` · `GET /me` |
| Perangkat | `POST /devices/pairing-codes` · `POST /devices/pair` · `GET /devices` · `POST /devices/:id/revoke` |
| Master | `GET/POST /products` · `GET/PUT /products/:id` · `GET /products/search?q=` · `GET /products/by-barcode/:code` · `GET /products/:id/price?unit=&group=&qty=` · CRUD `/units`, `/categories`, `/brands`, `/customers`, `/customer-groups`, `/suppliers`, `/warehouses`, `/payment-methods` · `POST /imports/products` |
| Stok | `GET /stock/balances` · `GET /stock/card?product=&warehouse=&from=&to=` · CRUD+`POST /:id/post` untuk `/stock/opnames`, `/stock/adjustments`, `/stock/transfers`, `/assemblies` · `GET /stock/low` |
| Penjualan | `POST /sales/held` · `GET /sales/held` · `PUT/DELETE /sales/held/:id` · `POST /sales` (selesaikan, `channel` KASIR/FAKTUR) · `GET /sales` · `GET /sales/:id` · `POST /sales/:id/void` · `POST /sales/:id/split` · `POST /sale-returns` · `GET /customers/:id/last-prices?product=&unit=` |
| Pengambilan | `GET /pickups/outstanding?customer=&product=&agingDays=` · `POST /pickups` · `GET /pickups` · `GET /pickups/:id` · `POST /pickups/:id/cancel` · `GET /reports/undelivered` · `GET /reports/pickups` |
| Migrasi & go-live | `POST /imports/ipos/inspect` (upload → sidik struktur → pratinjau) · `POST /imports/ipos/:batchId/commit` · `GET /imports/:batchId/reconciliation` · `POST /imports/opening-pickups` · `POST /system/reset-preparation` · `POST /system/go-live` |
| Shift & kas | `POST /shifts/open` · `GET /shifts/current` · `POST /shifts/:id/close` · `POST /cash-transactions` · `GET /cash-transactions` |
| Pembelian | CRUD + aksi status `/purchase-orders`, `/goods-receipts` (`/:id/post`), `/purchase-invoices`, `/purchase-returns` |
| Hutang/Piutang | `GET /receivables` · `POST /receivable-payments` · `GET /payables` · `POST /payable-payments` · `GET /aging/{receivables,payables}` |
| Laporan | `GET /reports/{profit-by-item,profit-by-invoice,profit-loss,cashflow,sales,stock-value,low-stock,negative-stock,dashboard}` · `?format=xlsx|pdf` |
| Sinkron | `GET /sync/pull?entity=&since=&cursor=&limit=` · `POST /sync/push` |

## Lampiran B — Glosarium

| Istilah | Arti |
|---|---|
| Satuan dasar | Satuan terkecil penyimpanan stok suatu produk (PCS, KG) |
| HPP | Harga Pokok Penjualan — biaya rata-rata per satuan dasar |
| Hub | PC kasir utama yang menjalankan PostgreSQL & server |
| Outbox | Antrean operasi lokal di perangkat yang belum terkirim ke hub |
| Tombstone | Penanda baris terhapus (`deleted_at`) agar penghapusan ikut tersinkron |
| Yarnen | "Bayar panen" — pembelian petani dibayar setelah panen (piutang) |
