# Design Standards — Mandiri Tani Design System

Tailwind CSS **v4** (CSS-first: token di `src/renderer/styles/app.css`
lewat `@theme`, **tanpa** `tailwind.config.js`) + shadcn/ui (Radix) +
lucide-react. Token warna final boleh disesuaikan setelah logo toko ada;
**nama token** di bawah adalah kontraknya.

## 0. Prinsip utama: sederhana, mudah dipakai, mudah dibaca

Permintaan owner (2026-10-24). Pengguna adalah kasir & owner toko tani —
bukan orang IT. Setiap layar diuji dengan pertanyaan: *"Bisakah kasir baru
memakainya tanpa diajari lebih dari 5 menit?"*

1. **Satu layar, satu tugas.** Layar kasir hanya untuk menjual; pengambilan
   barang di layarnya sendiri. Jangan menumpuk banyak fungsi di satu halaman.
2. **Satu tombol utama per layar**, besar dan berwarna primer (mis. "Bayar",
   "Simpan Pengambilan"). Aksi lain tombol biasa/outline; aksi berbahaya
   (void, hapus) disembunyikan di menu "Lainnya" + `ConfirmDialog`.
3. **Teks besar & kontras tinggi.** Teks isi minimal 15 px (lihat "modern simple" di bawah), angka uang
   penting (total, kembalian) ≥ 32 px; teks hitam/abu gelap di latar
   putih/krem. Tidak ada teks abu muda untuk informasi penting.
4. **Bahasa sehari-hari, bukan istilah teknis.** "Simpan", "Batal", "Barang
   belum diambil", "Stok tersedia" — bukan "Submit", "Commit", "Reserved qty".
   Pesan error menjelaskan **apa yang harus dilakukan** ("Stok Urea tinggal 3
   zak. Kurangi jumlah atau minta PIN Owner.").
5. **Sedikit warna, bermakna.** Hijau = aksi utama/berhasil, merah =
   bahaya/kurang, kuning = perlu perhatian. Selebihnya netral. Tidak ada
   gradien, bayangan tebal, atau animasi dekoratif.
6. **Menu pendek.** Sidebar maksimal ±7 grup; menu yang tidak boleh diakses
   peran itu **disembunyikan** (kasir melihat menu jauh lebih sedikit dari
   owner).
7. **Formulir pendek.** Hanya kolom yang wajib di depan; kolom jarang dipakai
   di bagian "Detail lain" yang terlipat. Isi default otomatis bila bisa
   ditebak (tanggal hari ini, gudang UTM, termin 10 hari).
8. **Keyboard dan mouse sama-sama mudah.** Shortcut ditampilkan di tombolnya
   (`Bayar F9`), tapi semua bisa juga diklik dengan target ≥ 44 px.
9. **Pakai komponen shadcn/ui apa adanya** (Button, Input, Dialog, Table,
   Select, Card) dengan token di bawah — jangan membuat komponen "kreatif"
   sendiri bila shadcn sudah punya.

### Gaya visual: "modern simple" (keputusan owner 2026-10-26)

Owner memberi 5 referensi dashboard (FlowAI, Brillance, Tasks, User Management,
Kirridesk). Polanya — dipakai di semua layar backoffice:

- **Kanvas netral** abu-abu sangat terang (`bg-canvas`); sidebar langsung di atas
  kanvas; konten di **satu panel putih** berbingkai tipis + bar breadcrumb di atasnya.
- **Sidebar**: label grup kecil abu-abu, item aktif = **kartu putih** berbingkai
  (`bg-nav-active border shadow-xs`), jumlah data sebagai badge kecil di kanan,
  kartu status server/DB di bawah.
- **Judul halaman** hitam tegas + angka jumlah di sebelahnya (`PageHeader count`),
  deskripsi abu-abu; **satu** tombol utama hijau di kanan.
- **Filter** berbentuk `SegmentedControl` ("Aktif · Semua"), lalu pilihan lain,
  kotak cari di kanan.
- **Tabel**: header netral (`bg-surface-muted`, teks abu kecil), baris lega, kolom
  pertama = nama tebal + kode/HP kecil di bawahnya, **status = `StatusPill`
  bertitik**, aksi per baris lewat menu **⋯** (`RowActions`; aksi berbahaya
  terakhir, merah), pager ringkas `‹ 1/25 ›`.
- **Angka ringkas** di `StatCard` (kartu dalam kartu, ikon kecil, keterangan di bawah).
- Hijau Tani hanya untuk aksi utama, fokus, dan status berhasil — bukan untuk judul
  atau header tabel. Ukuran teks satu tingkat di bawah bawaan Tailwind (owner 2026-10-26: "kecilkan sedikit"): teks isi **15 px**, label kecil 13 px, judul halaman 24 px — diatur di `@theme` (`--text-*`), tinggi tombol/baris tetap (target ≥ 44 px).

## 1. Token — jangan tulis hex literal

```css
@theme {
  --color-tani-green:       #2E7D32;  /* primer: tombol utama, fokus, aktif */
  --color-tani-green-dark:  #1B5E20;  /* hover/teks di atas terang */
  --color-tani-green-light: #E8F5E9;  /* latar aksen kecil (nomor langkah, pilihan terpilih) */
  --color-tani-soil:        #6D4C41;  /* aksen sekunder (kategori, ilustrasi) */
  --color-tani-harvest:     #F9A825;  /* sorotan (promo, harga grosir) — tidak untuk teks di atas putih */
  --color-tani-cream:       #FAF8F3;  /* (lama) — kanvas kini --color-canvas */
  --color-canvas:           #F4F4F2;  /* kanvas aplikasi (netral) */
  --color-surface-muted:    #F9F9F8;  /* header tabel, isi kartu angka, jalur segmented */
  --color-nav-active:       #FFFFFF;  /* item sidebar aktif */
  --color-tani-border:      #E7E7E4;
  --color-tani-muted:       #6B6B6B;
  /* status: */ --color-success / --color-warning / --color-error / --color-info
  /* teks status (kontras ≥ 4.5:1): */ --color-success-ink / --color-warning-ink / --color-error-ink / --color-info-ink
}
```

`--primary`, `--ring`, `--sidebar-primary` shadcn di-set ke tani-green
sehingga `<Button>` default, focus ring, dsb. otomatis sesuai brand.

| Kebutuhan | Pakai | Jangan |
|---|---|---|
| Kanvas | `bg-canvas` | `bg-gray-50`, `bg-tani-cream` |
| Panel/kartu | `bg-background` + `<Card>` | `bg-white` |
| Teks utama/sekunder | `text-foreground` / `text-muted-foreground` | `text-[#333]`, `text-gray-500` |
| Aksen primer | `bg-primary`, `text-tani-green-dark` | `bg-green-600` |
| Header tabel | `bg-surface-muted` + `text-muted-foreground` (via `DataTable`) | `bg-green-50`, `bg-tani-green-light` |
| Status data | `StatusPill` / `ActivePill` | `Badge` dengan warna bebas |
| Status | `bg-success/10 text-success-ink` dst. | `text-green-500` |
| Angka uang negatif / selisih | `text-error-ink` | `text-red-500` |

## 2. Komponen — shadcn dulu

- Primitive di `components/ui/` ditambah lewat CLI:
  `npx shadcn@latest add <komponen>` — jangan ditulis manual, jangan ubah
  logic-nya (gaya boleh lewat token).
- Building block `components/shared/` — pakai sebelum menulis markup baru:

| Kebutuhan | Komponen |
|---|---|
| Judul halaman + aksi | `PageHeader` (`title`, `description`, `icon`, `actions`) |
| Tabel data | `DataTable` (toolbar, paginasi server) |
| Input uang | `MoneyInput` — tampil `1.500.000`, nilai string desimal |
| Input qty | `QtyInput` — koma desimal, satuan di sisi kanan |
| Pilih produk / pelanggan / supplier | `ProductPicker`, `CustomerPicker`, `SupplierPicker` (cari + keyboard) — jangan `<Select>` berisi ribuan opsi |
| Status dokumen | `StatusChip domain="sale"\|"purchase-order"\|…` — label & warna dari satu peta `lib/status.ts` |
| Konfirmasi | `ConfirmDialog` (`tone="danger"` untuk void/hapus) — jangan `window.confirm` (memblok scanner & IPC) |
| Otorisasi PIN Owner | `AuthorizeDialog` (username + PIN Owner → token sekali pakai) |
| Kosong / peringatan | `EmptyState`, `Notice tone="info|success|warning|error"` |
| Angka KPI | `StatCard` |
| Filter status (Aktif · Semua) | `SegmentedControl` — bukan checkbox |
| Aksi per baris tabel | `RowActions` (menu ⋯) |
| Status data master | `StatusPill` / `ActivePill` |

## 3. Layar kasir (POS)

- **Kepadatan & ukuran:** baris keranjang tinggi ≥ 44 px, font baris ≥ 16 px;
  **total** di panel kanan ≥ 48 px tebal (`tabular-nums`), terbaca dari 1,5 m.
- Semua angka uang & qty `tabular-nums` dan rata kanan.
- Baris terpilih jelas (`bg-tani-green-light` + garis kiri primer), fokus
  keyboard selalu terlihat (`ring-2 ring-ring`).
- Tombol aksi menampilkan shortcut-nya (`Bayar  F9`).
- Feedback scan: baris baru disorot singkat (≤ 600 ms); barang tidak
  ditemukan → bunyi error + `Notice` merah, bukan toast yang hilang
  sendiri.
- Status bar bawah: shift aktif, kasir, perangkat, status printer, status
  DB/server (titik hijau/merah).
- Tidak ada animasi yang memperlambat alur (> 150 ms) di layar kasir.

## 4. Layout backoffice

- `AppShell`: sidebar kiri (grup: Penjualan, Persediaan, Pembelian,
  Hutang/Piutang, Keuangan & Laporan, Pengaturan), konten di panel
  `bg-background rounded-xl` di atas kanvas `bg-tani-cream`.
- Menu disaring oleh permission (`@shared/permissions`) — item yang tidak
  boleh diakses **disembunyikan**; menu modul yang belum dibangun tampil
  nonaktif berlabel "Segera".
- Layar kasir (`/pos`) **tanpa** sidebar (layar penuh); masuk/keluar lewat
  tombol & shortcut.
- Resolusi minimum 1366×768 tanpa scroll horizontal.

## 5. Tipografi & ikon

- Font **Inter Variable** self-hosted (`@fontsource-variable/inter`) —
  aplikasi offline, **tidak** boleh memuat font/aset dari CDN.
- Ikon `lucide-react`: `size-4` inline, `size-5` toolbar, `size-6` tombol
  kasir besar.

## 6. Format & bahasa

- Semua teks UI Bahasa Indonesia, kalimat jelas untuk kasir non-teknis
  ("Stok tidak cukup", bukan "Insufficient stock").
- Format dari `lib/format.ts` saja: `formatRupiah('1500000')` → `Rp 1.500.000`,
  `formatQty('2.5', 'KG')` → `2,5 kg`, tanggal `24 Okt 2026 09.15`.
- Kontras teks ≥ 4.5:1; jangan teks `tani-harvest` di atas putih.
