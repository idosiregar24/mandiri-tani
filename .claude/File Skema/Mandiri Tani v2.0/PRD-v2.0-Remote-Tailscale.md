# PRD v2.0 — Akses Remote via Tailscale (DRAF RUANG LINGKUP)

| | |
|---|---|
| **Status** | Draf awal — **belum dieksekusi**. Dikerjakan setelah v1.0 rilis & stabil di toko |
| **Prasyarat** | [PRD v1.0](../Mandiri%20Tani%20v1.0/PRD-Mandiri-Tani-POS.md) rilis; protokol sync v1 (`rules/sync-standards.md`) terbukti di LAN |
| **Tanggal** | 2026-10-24 |

> Dokumen ini hanya mengunci **arah** agar keputusan v1 tidak menutup
> jalan ke v2. Detail FR/NFR ditulis saat v2.0 dimulai.

## 1. Tujuan

Owner (dan staf tertentu) bisa mengakses hub toko **dari luar jaringan
toko** — melihat dashboard, laporan, stok, piutang; staf lapangan
menyinkronkan HP dari mana saja — **tanpa** IP publik, port forwarding,
atau membuka API POS ke internet.

## 2. Keputusan: Tailscale, bukan Cloudflare Tunnel (ADR-05)

| Aspek | Tailscale | Cloudflare Tunnel |
|---|---|---|
| Paparan | Hanya perangkat di tailnet (WireGuard, privat) | Domain publik; perlu Cloudflare Access agar tidak terbuka |
| Klien mobile | App Tailscale Android/iOS; app kita memanggil MagicDNS/100.x | Browser/HTTP publik |
| HTTPS | `tailscale serve` → `https://<host>.<tailnet>.ts.net` (sertifikat otomatis) | Otomatis di domain |
| Ketergantungan | Akun Tailscale; koordinasi butuh internet saat koneksi dibuat, data P2P/DERP | Akun Cloudflare + domain |
| Cocok untuk | Akses internal owner & staf | Halaman publik (bukan kebutuhan kita) |

## 3. Ruang lingkup awal (kandidat)

- **R-01** Panduan & otomasi pemasangan Tailscale di PC hub (Windows
  service, berjalan tanpa login user, `--unattended`).
- **R-02** Halaman "Koneksi" menampilkan status tailnet (terhubung/tidak,
  nama MagicDNS, IP 100.x) — dibaca dari `tailscale status --json`
  (CLI lokal), tanpa menyimpan auth key di aplikasi.
- **R-03** HTTPS via `tailscale serve --bg --https=443 http://127.0.0.1:3000`
  → klien remote memakai `https://`; PWA/klien browser jadi *secure
  context* (service worker bisa jalan).
- **R-04** Pairing perangkat remote memakai alamat MagicDNS; app mobile
  menyimpan dua alamat hub (LAN & tailnet) dan memilih yang terjangkau.
- **R-05** Kebijakan akses: ACL tailnet (tag `tag:pos-hub`, hanya grup
  owner/staf), plus RBAC aplikasi tetap berlaku — tailnet **bukan**
  pengganti login.
- **R-06** Rate limit & audit membedakan asal request (LAN / tailnet /
  lokal) untuk observasi — **bukan** untuk melonggarkan auth.
- **R-07** Uji ketahanan sync pada koneksi seluler (latensi tinggi,
  putus-sambung) — batch lebih kecil, kompresi gzip.

## 4. Yang sudah dijamin oleh v1 (jangan dirusak)

1. Server bind `0.0.0.0:3000` — antarmuka Tailscale ikut terlayani.
2. **Tidak ada** bypass auth untuk `127.0.0.1` (`tailscale serve`
   meneruskan request dari localhost).
3. Semua endpoint ber-token; token perangkat bisa dicabut.
4. Protokol sync idempoten & tahan putus (op_id, `?since=` dengan
   overlap) — sama untuk LAN maupun remote.
5. Tidak ada asumsi "klien = satu subnet" (mis. CORS/IP allowlist LAN).

## 5. Di luar ruang lingkup (masih)

Multi-cabang, replikasi PostgreSQL antar-lokasi, server cloud pusat.
Bila nanti dibutuhkan, itu PRD tersendiri (v3).

## 6. Pertanyaan terbuka

- Akun Tailscale milik siapa (owner pribadi / akun toko)? Paket gratis
  cukup (≤ 3 user, 100 perangkat) atau perlu berbayar?
- Siapa saja yang boleh remote: owner saja, atau juga kasir (mis. cek stok dari rumah)? (v1 hanya punya role Kasir & Owner.)
- Perlu notifikasi push ke HP owner (mis. stok menipis, selisih shift)?
