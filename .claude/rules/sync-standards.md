# Sync Standards — Protokol Offline-First (Hub ⇄ Perangkat)

Sasaran produk #1: **POS jalan offline, data bisa disinkronkan.** Hub (PC
kasir dengan PostgreSQL) adalah sumber kebenaran. Perangkat lain (HP staf,
HP owner, kelak Mode Terminal) menyimpan salinan lokal + antrean operasi.
Requirement: PRD §5.7 (FR-SRV-03..08, FR-MOB). Transport sama untuk LAN
(v1) dan Tailscale (v2) — protokol tidak boleh berasumsi satu subnet.

## 1. Tiga kelas data

| Kelas | Contoh | Arah | Aturan konflik |
|---|---|---|---|
| **Master** | produk, satuan, barcode, harga, pelanggan, grup, supplier, gudang, metode bayar, kategori, merek, `stock_balances` (read-only) | Hub → perangkat (**pull**) | Hub menang. Perangkat **tidak** mengedit master saat offline di v1 |
| **Dokumen dari perangkat** | penjualan (Mode Terminal), hitungan opname, pelunasan piutang | Perangkat → hub (**push**) | Tidak ada konflik: dokumen immutable, ber-`op_id`; koreksi = dokumen baru |
| **Online-only** | posting opname, void, retur, ubah harga, laporan, user | Request langsung ke API | Butuh koneksi ke hub; UI menonaktifkan aksi saat offline dengan pesan jelas |

Menambah entitas ke sinkron = menentukan kelasnya dulu. Jangan membuat
master bisa diedit offline tanpa ADR baru (butuh resolusi konflik).

## 2. Kolom wajib di sisi hub

- Master: `updated_at` (trigger `clock_timestamp()`), `deleted_at`
  (tombstone), `index (updated_at)`. **Hard delete dilarang** — penghapusan
  tidak akan pernah sampai ke perangkat.
- Dokumen dari perangkat: `client_op_id uuid UNIQUE`, `device_id`, waktu
  bisnis (`trx_at`) dari perangkat terpisah dari `created_at` server.
- ID dibuat perangkat (UUIDv7) — server tidak mengganti ID.

## 3. Pull — `GET /api/v1/sync/pull`

Satu entitas per request; klien menarik entitas berurutan sesuai
dependensi FK: `units → categories → brands → customer_groups → customers
→ suppliers → warehouses → payment_methods → products → product_units →
product_barcodes → product_prices → product_components → stock_balances`.

```
GET /api/v1/sync/pull?entity=products&since=2026-10-24T02:00:00.000Z&limit=500
→ 200 {
  "data": {
    "server_time": "2026-10-24T02:05:11.204Z",
    "rows": [ { …, "updated_at": "…", "deleted_at": null } ],
    "has_more": true,
    "cursor": "eyJ1IjoiMjAyNi0xMC0yNFQwMjowNDo1OS44NzBaIiwiaSI6Ii4uLiJ9",   // hanya bila has_more
    "next_since": "2026-10-24T02:04:59.870Z"                               // hanya bila !has_more
  }
}
GET /api/v1/sync/pull?entity=products&cursor=eyJ1Ijoi…&limit=500           // halaman berikutnya
```

- `since` = ISO timestamp (sesuai spesifikasi). Perangkat baru: tanpa
  `since` → snapshot penuh (dipaginasi).
- **Halaman pertama** sebuah sesi pull: server mengambil baris
  `updated_at > since − OVERLAP` (**OVERLAP = 120 dtk**) untuk menangkap
  transaksi panjang yang commit terlambat dengan `updated_at` lebih tua.
  Akibatnya baris bisa terkirim dua kali — **klien wajib upsert
  idempoten** (berdasarkan `id`, abaikan bila `updated_at` lokal ≥ yang
  datang).
- **Halaman berikutnya** (`has_more = true`): klien mengirim `cursor`
  opaque (= `(updated_at, id)` baris terakhir) dan server memakai keyset
  ketat `(updated_at, id) > cursor` **tanpa** OVERLAP. Menerapkan OVERLAP
  di setiap halaman akan membuat klien berputar tanpa akhir saat > `limit`
  baris berubah dalam 120 dtk (mis. import produk massal).
- Halaman terakhir (`has_more = false`) mengembalikan `next_since` =
  `updated_at` baris terakhir (atau `since` lama bila kosong); klien
  menyimpannya per entitas untuk sesi berikutnya. Tidak pernah `now()`
  klien.
- Baris dengan `deleted_at` → klien menghapus/menandai lokal.
- Field sensitif disaring per role perangkat/user (HPP tidak pernah ke
  perangkat tanpa `cost.read`).

## 4. Push — `POST /api/v1/sync/push`

Perangkat menyimpan setiap aksi offline di **outbox lokal**:

```ts
type OutboxOp = {
  op_id: string;          // UUIDv7, dibuat SEKALI saat aksi user terjadi
  type: 'opname.count' | 'sale.create' | 'receivable_payment.create';
  payload: unknown;       // divalidasi Zod di server (src/shared/schemas/sync.ts)
  device_time: string;    // ISO
  attempts: number;
  status: 'PENDING' | 'SENT' | 'REJECTED';
  last_error?: { code: string; message: string };
};
```

```
POST /api/v1/sync/push   { "ops": [OutboxOp, …] }   (maks 100 op / batch, FIFO)
→ 200 { "data": { "results": [ { "op_id": "…", "status": "APPLIED" | "DUPLICATE" | "REJECTED" | "RETRY", "result": {…}, "error": {…} } ] } }
```

Server, **per operasi, dalam transaksi sendiri**:
1. Cek `sync_ops(op_id)`: ada → kembalikan `DUPLICATE` + `result` tersimpan
   (tanpa efek apa pun).
2. Validasi payload (Zod) & aturan bisnis → gagal permanen = `REJECTED`
   (simpan di `sync_ops` agar retry tetap konsisten).
3. Terapkan lewat **service yang sama** dengan endpoint online (mis.
   `salesService.complete(tx, input, { source: 'SYNC', device })`) — tidak
   ada jalur logika kedua untuk data sinkron.
4. Simpan `sync_ops(op_id, status, result)` di transaksi yang sama → COMMIT.
5. Error sementara (DB sibuk, deadlock setelah retry) → `RETRY`, tidak
   disimpan di `sync_ops`.

Aturan klien:
- Kirim berurutan (FIFO); operasi yang bergantung pada operasi sebelumnya
  tidak dikirim sebelum pendahulunya `APPLIED/DUPLICATE`.
- `APPLIED/DUPLICATE` → hapus dari outbox. `REJECTED` → tetap tampil di
  "Perlu perhatian" untuk user (jangan dibuang diam-diam). `RETRY`/error
  jaringan → backoff eksponensial (2 s → maks 5 menit).
- `op_id` **tidak pernah** dibuat ulang saat retry.

## 5. Stok & aturan bisnis untuk dokumen sinkron

- Dokumen sinkron sudah terjadi di dunia nyata → server **menerapkannya
  walau stok jadi negatif** (`source: 'SYNC'` melewati blok FR-INV-10),
  lalu mencatatnya di laporan "Stok Minus". Validasi lain (produk ada,
  qty > 0, harga ≥ 0) tetap `REJECTED`.
- Harga pada dokumen sinkron = harga yang dilihat perangkat (snapshot);
  server tidak me-resolve ulang, tapi menandai bila berbeda dari harga hub
  saat ini (audit).
- Nomor dokumen dibuat perangkat (`KSR/T01/2610/00007`); bentrok `UNIQUE`
  → `REJECTED` dengan kode `DOC_NUMBER_CONFLICT` (indikasi counter
  perangkat rusak — pairing ulang menginisialisasi counter dari server).

## 6. Waktu

- Waktu otoritatif = waktu server. Setiap push/pull menyertakan
  `device_time`; server mencatat selisih (`devices.last_clock_skew_ms`);
  > 5 menit → peringatan (FR-SRV-08).
- `since` dan `next_since` selalu berasal dari **jam server**, tidak pernah
  dari jam perangkat.

## 7. Test wajib untuk setiap entitas/operasi sinkron

- Pull: perubahan, tombstone, paginasi `has_more`, baris yang commit
  terlambat dalam OVERLAP tetap terkirim, field sensitif tersaring.
- Push: kirim sekali → APPLIED; kirim ulang op_id sama → DUPLICATE dengan
  hasil identik & tanpa efek ganda (stok, kas, piutang); payload rusak →
  REJECTED dan tetap REJECTED saat diulang; dua perangkat push bersamaan
  pada produk sama → tanpa deadlock, saldo benar.
