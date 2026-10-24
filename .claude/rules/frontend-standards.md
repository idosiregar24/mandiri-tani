# Frontend Standards — React + Vite + TypeScript (Renderer & Mobile)

Berlaku untuk `src/renderer/` (desktop) dan `mobile/` (Capacitor). Untuk
aturan visual lihat [`design-standards.md`](design-standards.md).

## 1. Struktur folder

```
src/renderer/
├── app/                 # main.tsx, router, providers (QueryClient, Theme, Auth)
├── pages/<modul>/       # satu file per layar: ProductList.tsx, ProductForm.tsx, PosScreen.tsx
├── features/<modul>/    # api.ts (hook TanStack Query), store.ts (Zustand), komponen khusus modul
├── components/
│   ├── ui/              # shadcn primitives — generate via CLI, jangan ubah logic-nya
│   └── shared/          # dipakai ≥ 2 modul: DataTable, PageHeader, MoneyInput, QtyInput, StatusChip
├── lib/                 # api-client.ts, format.ts (id-ID), hotkeys.ts, scanner.ts, utils.ts (cn)
└── styles/              # app.css (Tailwind v4 @theme — design-standards §1)
```

Import lewat alias `@/…` (→ `src/renderer/*`) dan `@shared/…` (→ `src/shared/*`).
Tidak ada path relatif panjang (`../../../`).

## 2. Data dari server: TanStack Query + api-client

- Semua request lewat `lib/api-client.ts` (fetch ke `/api/v1`, menyisipkan
  `Authorization`, memetakan `{ error: { code, message } }` ke `ApiError`).
  Tidak ada `fetch` mentah di komponen.
- Setiap modul punya `features/<modul>/api.ts` berisi hook:
  `useProducts(params)`, `useProduct(id)`, `useCreateProduct()` … dengan
  query key terpusat (`productKeys.list(params)`).
- Mutasi: invalidasi query terkait di `onSuccess`; mutasi pembuat dokumen
  mengirim header `Idempotency-Key` yang dibuat **sekali per niat user**
  (simpan di state form, bukan dibuat ulang tiap retry).
- Uang & qty dari API adalah **string** — tampilkan lewat `format.ts`,
  hitung lewat `@shared/money` / `@shared/qty`. Dilarang `parseFloat`.

## 3. State klien: Zustand

- Zustand hanya untuk state yang **bukan** milik server: keranjang kasir
  aktif, baris terpilih, dialog terbuka, preferensi UI, sesi login di memori.
- Satu store per fitur (`features/pos/store.ts` → `usePosStore`), dengan
  action bernama domain (`addItem`, `changeUnit`, `setQty`, `applyDiscount`).
  Selector sempit (`usePosStore(s => s.lines)`) agar layar kasir tidak
  re-render penuh setiap ketikan.
- Data server **tidak** disalin ke Zustand. Keranjang menyimpan id + qty +
  satuan + hasil resolusi harga yang dikembalikan server.
- Persist (`zustand/middleware` persist) hanya untuk preferensi UI.
  Nota tertahan disimpan di **server** (`/sales/held`), bukan localStorage.

## 4. Form: React Hook Form + Zod

```tsx
import { ProductInput } from '@shared/schemas/products';
const form = useForm<ProductInput>({ resolver: zodResolver(ProductInput), defaultValues });
```

- Skema Zod **diimpor dari `src/shared/schemas`** — skema yang sama dipakai
  server untuk validasi. Jangan menulis skema kedua di renderer.
- Komponen form shadcn (`Form`, `FormField`, `FormItem`, `FormLabel`,
  `FormMessage`). Kolom wajib → `<FormLabel required>`; jangan tulis
  "(opsional)".
- Uang pakai `MoneyInput` (tampil `1.500.000`, nilai string desimal); qty
  pakai `QtyInput` (koma desimal, hormati `allow_decimal_qty`).
- Error server `400` dengan `details.fieldErrors` dipetakan ke
  `form.setError` per kolom.

## 5. Tabel: TanStack Table

Semua tabel data lewat `components/shared/DataTable.tsx` (TanStack Table
v8), bukan `<table>` manual per halaman. Filter & paginasi untuk data besar
(penjualan, kartu stok, laporan) di server (query param), bukan di klien.
Keranjang kasir **bukan** DataTable — komponen khusus `PosCart` yang
dioptimalkan keyboard.

## 6. Keyboard-first (layar kasir)

- Shortcut didefinisikan **sekali** di `lib/hotkeys.ts` (peta aksi → tombol,
  PRD §5.3) dan dipasang lewat `useHotkeys(scope)`. Halaman bantuan F1
  membaca peta yang sama. Jangan `addEventListener('keydown')` tersebar.
- Scanner: `useScanner(onScan)` dari `lib/scanner.ts` (PRD §8.3, ambang
  jeda dari setting). Scan tidak boleh ikut terketik ke input yang fokus.
- Setelah setiap aksi (tambah baris, tutup dialog, bayar) fokus **kembali
  ke kolom scan**. Dialog: fokus awal di kontrol utama, `Esc` menutup,
  `Enter` mengonfirmasi aksi utama.
- Tidak ada aksi kasir yang hanya bisa dilakukan dengan mouse.

## 7. Bridge ke Electron

- Renderer **tidak** tahu Node/Electron. Akses hardware & lifecycle hanya
  via `window.pos` (tipe di `src/shared/bridge.ts`, diisi preload):
  `window.pos.print(receipt)`, `window.pos.openDrawer()`,
  `window.pos.onLifecycle(cb)`, `window.pos.appInfo()`.
- Komponen yang memakai `window.pos` harus menangani ketiadaannya
  (`isDesktop()`), karena halaman yang sama bisa dibuka di browser/mobile.

## 8. Mobile (Capacitor)

- Berbagi `src/shared` dan komponen `components/shared` sebisa mungkin;
  layar mobile terpisah di `mobile/src/pages`.
- Data offline & outbox di SQLite/IndexedDB lewat modul `mobile/src/sync`
  — aturan protokol di `sync-standards.md`. Komponen membaca dari
  penyimpanan lokal, bukan langsung dari API, untuk layar yang harus
  berjalan offline (cek harga, opname).

## 9. TypeScript & build

- `strict: true`, tanpa `any` (pakai `unknown` + narrowing). Union status
  domain diimpor dari `@shared/constants`, tidak ditulis ulang.
- `npm run typecheck`, `npm run lint`, `npm test` lulus sebelum commit;
  `npm run build` (electron-vite) harus bersih.
- Komponen berat yang jarang dipakai (laporan + chart, import Excel)
  di-`lazy()` per route.
