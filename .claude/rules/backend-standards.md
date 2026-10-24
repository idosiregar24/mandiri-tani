# Backend Standards — Embedded API (Node.js + Express 5 + TypeScript)

Berlaku untuk semua kode di `src/server/` dan `src/shared/`. Lihat juga
[`database-standards.md`](database-standards.md) (SQL, transaksi, stok),
[`sync-standards.md`](sync-standards.md) (endpoint sync & idempotensi),
[`security-standards.md`](security-standards.md) (auth, permission, audit).

## 1. Arsitektur berlapis: route → service → repo

```
routes.ts   → HANYA: parse & validasi input (Zod dari src/shared), cek
              permission (requirePermission), panggil service, kirim JSON.
service.ts  → business rule PRD §5: resolusi harga, validasi stok, HPP,
              state machine dokumen, alokasi pembayaran. Membuka transaksi
              lewat withTransaction() dan meneruskan `tx` ke repo.
repo.ts     → SQL berparameter saja. Menerima `db: Queryable` (pool atau tx).
              Tidak ada business rule, tidak ada pemanggilan service lain.
```

```ts
// src/server/modules/sales/routes.ts
router.post('/sales', requirePermission('sales.create'), async (req, res) => {
  const input = CompleteSaleInput.parse(req.body);           // Zod (src/shared)
  const sale = await salesService.complete(input, req.ctx);  // ctx: user, device, requestId
  res.status(201).json({ data: sale });
});
```

- Route handler **tidak pernah** menulis SQL atau membuka transaksi.
- Service boleh memanggil service lain **dengan meneruskan `tx` yang sama**
  (mis. `stockService.apply(tx, movements)` di dalam `salesService.complete`)
  — satu dokumen = satu transaksi (NFR-REL-02).
- Server **tidak boleh** meng-import `electron` (ADR-07: harus bisa jalan di
  Vitest & dipindah ke `utilityProcess`). Kebutuhan dari Electron (path data,
  versi app) masuk lewat `createServer(config)`.

## 2. Struktur

```
src/server/
├── app.ts                 # createApp(deps): express app + middleware + router
├── server.ts              # createServer(config) → { start(), stop() }
├── db/                    # pool.ts, tx.ts (withTransaction/withClient), migrate.ts
├── middleware/            # requestId, auth, requirePermission, errorHandler, rateLimit
├── lib/                   # errors.ts (AppError), clock.ts, numbering.ts
└── modules/<modul>/       # routes.ts · service.ts · repo.ts (+ *.test.ts)
src/shared/
├── schemas/<modul>.ts     # Zod: dipakai server (validasi) & renderer/mobile (form)
├── permissions.ts         # peta role → permission (PRD §4.2) — satu-satunya
├── money.ts · qty.ts      # helper decimal.js — lihat database-standards §4
└── constants.ts           # prefix dokumen, source_type, status (union TS)
```

Nama modul mengikuti PRD: `auth`, `devices`, `products`, `stock`, `sales`,
`shifts`, `purchases`, `ar-ap`, `cash`, `reports`, `sync`, `settings`,
`backups`. Jangan disingkat (`purchases`, bukan `pur`).

## 3. Kontrak HTTP

- Prefix `/api/v1`. JSON saja. Respons sukses: `{ "data": … }` (+ `"meta"`
  untuk paginasi). Respons error:
  ```json
  { "error": { "code": "STOCK_INSUFFICIENT", "message": "Stok Pupuk Urea tidak cukup (sisa 3 sak)", "details": { "productId": "…" } } }
  ```
- `code` = SCREAMING_SNAKE stabil (dipakai klien untuk logika); `message` =
  Bahasa Indonesia untuk ditampilkan langsung.
- Status: 400 validasi (Zod), 401 tanpa/token salah, 403 permission, 404,
  409 konflik bisnis (stok, status dokumen, duplikat nomor), 422 aturan bisnis
  lain, 423 butuh otorisasi supervisor (`AUTHORIZATION_REQUIRED`), 503 DB
  tidak tersedia / maintenance.
- Lempar `AppError(code, message, status, details)` dari service; satu
  `errorHandler` memetakan `ZodError`, `AppError`, dan error PG (`23505` →
  409 `DUPLICATE`, `23503` → 409 `REFERENCE_IN_USE`, `40001/40P01` sudah
  di-retry oleh `withTransaction`).
- Endpoint pembuat dokumen menerima header **`Idempotency-Key`** (UUID) dan
  menyimpannya sebagai `client_op_id` — kirim ulang mengembalikan dokumen
  yang sama (NFR-REL-04).
- Uang & qty dikirim sebagai **string desimal** (`"150000.00"`, `"2.5"`),
  bukan number JSON — hindari float di klien.
- Waktu = ISO 8601 dengan offset (`2026-10-24T09:15:00+07:00`).
- List: `?limit=&cursor=` (keyset) untuk tabel besar; `?page=` hanya untuk
  tabel master kecil.

## 4. Konfigurasi & lifecycle server

- `createServer({ port: 3000, host: '0.0.0.0', db, dataDir, appVersion, logger })`.
- `stop()` = `server.close()` + tunggu request berjalan ≤ 5 dtk + `pool.end()`
  (dipanggil main process sebelum `pg_ctl stop` — `desktop-runtime-standards.md` §3).
- Middleware wajib berurutan: `requestId` → logger (pino) → `express.json({ limit: '2mb' })`
  → rate limit → auth → router → `errorHandler`.
- Tidak ada `console.log` di kode server — pakai logger dengan `request_id`.

## 5. Waktu & angka

- Waktu server dari `clock.now()` (dapat di-mock di test), zona
  `Asia/Jakarta` untuk tanggal bisnis (nomor dokumen `YYMMDD`, laporan harian).
- Semua aritmetika uang/qty lewat `src/shared/money.ts` / `qty.ts`
  (decimal.js). **Dilarang** `Number(price) * qty` atau `parseFloat` untuk
  uang/qty.

## 6. Testing (Vitest)

- Unit test untuk setiap fungsi business rule murni: resolusi harga, HPP
  rata-rata, alokasi diskon nota, alokasi pembayaran piutang, expected cash
  shift, pembulatan.
- Test integrasi service dan route **memakai PostgreSQL asli** (binaries
  portable yang sama, cluster sementara di port 5439 — helper
  `test/pg.ts`), bukan mock DB. Setiap test dalam transaksi yang di-rollback
  atau database baru per file.
- Setiap route ber-permission punya minimal: 1 test role yang berhak, 1 test
  role yang ditolak (403) — `security-standards.md` §3.
- Coverage: service bisnis (stock, sales, prices, ar-ap, sync) ≥ 80%,
  keseluruhan ≥ 60%.

## 7. Gaya kode

- TypeScript `strict`, ESLint + Prettier; `npm run lint && npm run typecheck`
  lulus sebelum commit.
- Fungsi publik service bernama kata kerja domain (`complete`, `hold`,
  `void`, `post`, `allocate`) — bukan `handleX`/`doX`.
- Komentar kode & identifier Bahasa Inggris; semua string untuk user
  (pesan error, label) Bahasa Indonesia.
