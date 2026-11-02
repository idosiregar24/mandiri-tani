import { useState } from 'react';
import { BarChart3, ChevronDown, ChevronUp, CreditCard, Info, MapPin, Phone, ShieldCheck, Users } from 'lucide-react';
import type { CustomerSummary } from '@shared/schemas/master';
import { DonutChart } from '@/components/shared/charts/DonutChart';
import { HorizontalBarChart } from '@/components/shared/charts/HorizontalBarChart';
import { Button } from '@/components/ui/button';
import { formatNumber, formatRupiah } from '@/lib/format';
import { cn } from '@/lib/utils';

interface CustomerVisualAnalyticsProps {
  summary: CustomerSummary;
  isLoading?: boolean;
}

export function CustomerVisualAnalytics({ summary, isLoading }: CustomerVisualAnalyticsProps) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('mandiri-tani.customer-analytics-collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('mandiri-tani.customer-analytics-collapsed', String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const total = summary.total || 0;
  const activePct = total > 0 ? Math.round((summary.active / total) * 100) : 0;
  const phonePct = total > 0 ? Math.round((summary.withPhone / total) * 100) : 0;

  const cashPct = total > 0 ? Math.round((summary.cashOnly / total) * 100) : 0;
  const creditPct = total > 0 ? Math.round((summary.withCreditLimit / total) * 100) : 0;
  const unlimitedPct = total > 0 ? Math.round((summary.unlimitedCredit / total) * 100) : 0;

  const totalLimitNum = Number(summary.totalCreditLimit) || 0;
  const totalDebtNum = Number(summary.totalDebtAmount) || 0;
  const utilizationPct = totalLimitNum > 0 ? Math.min(100, Math.round((totalDebtNum / totalLimitNum) * 100)) : 0;

  const insights = generateCustomerInsights(summary);

  return (
    <div className="space-y-4">
      {/* Header bar with toggle */}
      <div className="flex items-center justify-between border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
            <BarChart3 className="size-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-foreground tracking-tight">Visualisasi & Ringkasan Pelanggan</h2>
            <p className="text-xs text-muted-foreground">
              Analisis segmentasi petani, komitmen fasilitas kredit, dan sebaran wilayah mitra
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={toggleCollapsed}
          className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {collapsed ? (
            <>
              <ChevronDown className="size-3.5" />
              <span>Tampilkan Visualisasi</span>
            </>
          ) : (
            <>
              <ChevronUp className="size-3.5" />
              <span>Sembunyikan</span>
            </>
          )}
        </Button>
      </div>

      {!collapsed && (
        <div className={cn('space-y-4 transition-opacity duration-200', isLoading && 'opacity-60 pointer-events-none')}>
          {/* Top Row: 3 Modern Metric Cards (styled after the reference UMKM Insight dashboard) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Card 1: Keaktifan & Kontak Basis Mitra */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Users className="size-3.5 text-primary" />
                    Keaktifan Basis Pelanggan
                  </span>
                  <Info className="size-3.5 text-muted-foreground/60" />
                </div>
                <div className="flex items-baseline gap-2.5 mt-1 mb-4">
                  <span className="text-3xl font-bold tracking-tight text-foreground tabular-nums">
                    {activePct}%
                  </span>
                  <span className="inline-flex items-center rounded-full border border-border/70 bg-surface-muted px-2 py-0.5 text-xs font-medium text-foreground/80">
                    {formatNumber(String(summary.active))} dari {formatNumber(String(total))} mitra
                  </span>
                </div>
              </div>

              <div className="space-y-2.5 pt-2 border-t border-border/50 text-xs">
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-muted-foreground">
                    <span className="flex items-center gap-1.5 font-medium text-foreground/90">
                      <ShieldCheck className="size-3 text-emerald-600" />
                      Pelanggan Aktif
                    </span>
                    <span className="font-bold text-foreground tabular-nums">{activePct}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-surface-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-600 transition-all duration-500"
                      style={{ width: `${activePct}%` }}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center text-muted-foreground">
                    <span className="flex items-center gap-1.5 font-medium text-foreground/90">
                      <Phone className="size-3 text-blue-600" />
                      No. HP Terdata
                    </span>
                    <span className="font-bold text-foreground tabular-nums">{phonePct}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-surface-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-600 transition-all duration-500"
                      style={{ width: `${phonePct}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Card 2: Profil Fasilitas Kredit */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <CreditCard className="size-3.5 text-amber-600" />
                    Fasilitas Plafon Kredit
                  </span>
                  <Info className="size-3.5 text-muted-foreground/60" />
                </div>
                <div className="flex items-baseline gap-2.5 mt-1 mb-4">
                  <span className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
                    {formatRupiah(summary.totalCreditLimit)}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-border/70 bg-surface-muted px-2 py-0.5 text-xs font-medium text-foreground/80">
                    Plafon Disetujui
                  </span>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-border/50 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Tunai Saja (Limit Rp 0)</span>
                  <span className="font-bold text-foreground tabular-nums">
                    {summary.cashOnly} ({cashPct}%)
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Plafon Terukur</span>
                  <span className="font-bold text-foreground tabular-nums">
                    {summary.withCreditLimit} ({creditPct}%)
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Bebas Limit / Khusus</span>
                  <span className="font-bold text-foreground tabular-nums">
                    {summary.unlimitedCredit} ({unlimitedPct}%)
                  </span>
                </div>
              </div>
            </div>

            {/* Card 3: Pengawasan Piutang Berjalan */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <ShieldCheck className="size-3.5 text-primary" />
                    Piutang Berjalan Toko
                  </span>
                  <Info className="size-3.5 text-muted-foreground/60" />
                </div>
                <div className="flex items-baseline gap-2.5 mt-1 mb-4">
                  <span className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
                    {formatRupiah(summary.totalDebtAmount)}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-border/70 bg-surface-muted px-2 py-0.5 text-xs font-medium text-foreground/80">
                    {summary.customersWithDebt} mitra aktif kredit
                  </span>
                </div>
              </div>

              <div className="space-y-2.5 pt-2 border-t border-border/50 text-xs">
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-muted-foreground">
                    <span>Rasio Pemakaian Plafon</span>
                    <span className="font-bold text-foreground tabular-nums">{utilizationPct}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-surface-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-amber-500 transition-all duration-500"
                      style={{ width: `${utilizationPct}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-muted-foreground">Rata-rata Tempo Pembayaran</span>
                  <span className="font-bold text-foreground tabular-nums">
                    {summary.avgPaymentTermDays} hari kalender
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Middle Row: Left = "Kesimpulan & Insight Pelanggan", Right = "Segmen Pelanggan" (Donut Chart) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Left Card (7 cols): Kesimpulan utama (like reference dashboard) */}
            <div className="lg:col-span-7 rounded-2xl border border-border bg-card p-6 shadow-xs flex flex-col justify-between">
              <div>
                <div className="mb-4">
                  <h3 className="font-bold text-base text-foreground tracking-tight flex items-center gap-1.5">
                    Kesimpulan & Insight Basis Pelanggan
                    <Info className="size-3.5 text-muted-foreground/60" />
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Ringkasan kondisi kemitraan, kepatuhan tempo, dan sebaran basis petani
                  </p>
                </div>

                <div className="space-y-3.5">
                  {insights.map((item) => (
                    <div key={item.id} className="flex items-start gap-3 text-xs sm:text-sm">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-amber-50 border border-amber-300/50 font-bold text-amber-900 text-xs mt-0.5 select-none">
                        {item.id}
                      </span>
                      <div className="leading-relaxed">
                        <span className="font-semibold text-foreground mr-1">{item.title}:</span>
                        <span className="text-muted-foreground">{item.desc}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-5 pt-3 border-t border-border/50 text-[11px] text-muted-foreground flex items-center justify-between">
                <span>Data dihitung otomatis dari riwayat master pelanggan dan buku piutang.</span>
                <span className="font-medium text-foreground/80">Mandiri Tani Insights</span>
              </div>
            </div>

            {/* Right Card (5 cols): Segmen Pelanggan (Donut Chart with count in the center hole) */}
            <div className="lg:col-span-5 flex flex-col">
              <DonutChart
                title="Segmen & Kelompok Tani"
                subtitle="Distribusi mitra per kategori grup harga"
                centerLabel="TOTAL MITRA"
                centerValue={`${formatNumber(String(total))} Mitra`}
                className="h-full"
                formatValue={(v) => `${formatNumber(String(v))} mitra`}
                segments={summary.groups.map((g) => ({
                  id: g.id,
                  label: g.label,
                  value: g.count,
                  desc: Number(g.discountPercent) > 0 ? `Diskon grup ${g.discountPercent}%` : 'Harga normal',
                  formattedValue: `${formatNumber(String(g.count))} mitra`,
                }))}
              />
            </div>
          </div>

          {/* Lower Row: Sebaran Wilayah / Desa Pelanggan & Distribusi Fasilitas Pembayaran */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top Villages / Desa */}
            <HorizontalBarChart
              title="Sebaran Wilayah / Desa Pelanggan"
              subtitle="Konsentrasi domisili petani dan pelanggan terdaftar"
              maxItems={6}
              barColor="#1565c0"
              formatValue={(val) => `${val} mitra`}
              items={summary.villages.map((v) => ({
                id: v.village,
                name: v.village,
                amount: v.count,
                qty: v.count,
                unit: 'mitra',
              }))}
            />

            {/* Credit Facility Distribution */}
            <DonutChart
              title="Distribusi Model Fasilitas Pembayaran"
              subtitle="Komposisi hak akses kredit dan batas termin nota"
              centerLabel="PELANGGAN"
              centerValue={`${formatNumber(String(total))} Mitra`}
              formatValue={(v) => `${formatNumber(String(v))} mitra`}
              segments={[
                {
                  id: 'cash-only',
                  label: 'Tunai Saja (Limit Rp 0)',
                  value: summary.cashOnly,
                  desc: 'Pelanggan umum & non-tempo',
                  color: '#2e7d32',
                },
                {
                  id: 'credit-limit',
                  label: 'Fasilitas Plafon Terukur',
                  value: summary.withCreditLimit,
                  desc: `Total plafon ${formatRupiah(summary.totalCreditLimit)}`,
                  color: '#1565c0',
                },
                {
                  id: 'unlimited',
                  label: 'Bebas Limit / Khusus',
                  value: summary.unlimitedCredit,
                  desc: 'Mitra khusus tanpa batasan nominal',
                  color: '#f9a825',
                },
              ]}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function generateCustomerInsights(summary: CustomerSummary) {
  const insights: { id: number; title: string; desc: string }[] = [];
  const total = summary.total || 0;

  // 1. Dominasi Segmen
  const sortedGroups = [...summary.groups].sort((a, b) => b.count - a.count);
  const topGroup = sortedGroups[0];
  if (topGroup && total > 0) {
    const pct = Math.round((topGroup.count / total) * 100);
    const disc =
      Number(topGroup.discountPercent) > 0
        ? `dengan diskon harga khusus ${topGroup.discountPercent}%`
        : 'dengan skema harga standar';
    insights.push({
      id: 1,
      title: `Dominasi Segmen ${topGroup.label}`,
      desc: `${topGroup.label} mendominasi dengan ${pct}% dari seluruh basis mitra (${topGroup.count} pelanggan), ${disc} yang terhubung otomatis di kasir.`,
    });
  } else {
    insights.push({
      id: 1,
      title: 'Segmentasi Pelanggan Merata',
      desc: 'Pelanggan terdistribusi secara seimbang di berbagai kategori belanja dan kelompok tani.',
    });
  }

  // 2. Kebijakan & Komitmen Kredit
  const creditHolders = summary.withCreditLimit + summary.unlimitedCredit;
  const creditPct = total > 0 ? Math.round((creditHolders / total) * 100) : 0;
  if (creditHolders > 0) {
    insights.push({
      id: 2,
      title: 'Kebijakan Tempo & Pengawasan Plafon',
      desc: `${creditHolders} pelanggan (${creditPct}%) dipercaya menerima fasilitas tempo dengan total plafon ${formatRupiah(summary.totalCreditLimit)} dan rata-rata termin ${summary.avgPaymentTermDays} hari. Saat ini ${summary.customersWithDebt} mitra aktif berstatus kredit dengan piutang ${formatRupiah(summary.totalDebtAmount)}.`,
    });
  } else {
    insights.push({
      id: 2,
      title: 'Disiplin Transaksi Tunai',
      desc: 'Mayoritas transaksi mitra diselesaikan secara tunai/lunas seketika, menekan risiko gagal bayar piutang toko.',
    });
  }

  // 3. Konsentrasi Geografis Petani
  const validVillages = summary.villages.filter(
    (v) => v.village && !v.village.includes('Belum Terdata') && !v.village.includes('Lainnya'),
  );
  if (validVillages.length > 0) {
    const topV = validVillages[0]!;
    const topPct = total > 0 ? Math.round((topV.count / total) * 100) : 0;
    const others = validVillages
      .slice(1, 3)
      .map((v) => `${v.village} (${v.count} mitra)`)
      .join(', ');
    insights.push({
      id: 3,
      title: `Sentra Wilayah Utama: Desa ${topV.village}`,
      desc: `Wilayah ${topV.village} merupakan sentra pertanian penyumbang mitra terbanyak (${topV.count} pelanggan, ${topPct}%), disusul oleh wilayah ${others || 'desa sekitarnya'}.`,
    });
  } else {
    insights.push({
      id: 3,
      title: 'Sebaran Wilayah Petani',
      desc: 'Mitra tani tersebar merata di berbagai pelosok desa binaan dan sentra perkebunan sekitar gerai.',
    });
  }

  // 4. Integritas Data Kontak
  const phonePct = total > 0 ? Math.round((summary.withPhone / total) * 100) : 0;
  if (phonePct >= 70) {
    insights.push({
      id: 4,
      title: 'Integritas Kontak & Kemudahan Notifikasi',
      desc: `${phonePct}% mitra (${summary.withPhone} pelanggan) telah melengkapi nomor HP/WhatsApp aktif, memudahkan koordinasi pengambilan pupuk subsidi serta konfirmasi nota jatuh tempo.`,
    });
  } else {
    insights.push({
      id: 4,
      title: 'Optimalisasi Pencatatan Nomor Kontak',
      desc: `Baru ${phonePct}% mitra yang memiliki nomor HP terdaftar. Disarankan staf kasir melengkapi data kontak saat transaksi guna kelancaran koordinasi barang.`,
    });
  }

  return insights;
}
