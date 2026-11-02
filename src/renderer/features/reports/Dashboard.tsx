// Sales dashboard on Beranda: Owner turnover & gross profit today / this month against previous period.
import { AlarmClock, CalendarRange, PackageCheck, PackageMinus, ShoppingBag, TrendingUp } from 'lucide-react';
import { Link } from 'react-router';
import { dec } from '@shared/money';
import type { DashboardFigure } from '@shared/schemas/reports';
import { AreaTrendChart, DonutChart, HorizontalBarChart } from '@/components/shared/charts';
import { Notice } from '@/components/shared/Notice';
import { StatCard } from '@/components/shared/StatCard';
import { formatNumber, formatQty, formatRupiah } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDashboard } from './api';

/** "▲ 12% dari kemarin (Rp 1.200.000)" — the change against the previous period. */
function versus(now: string, before: string, what: string) {
  if (dec(before).isZero()) return `${what}: ${formatRupiah(before)}`;
  const change = dec(now).minus(before).div(before).times(100);
  const up = change.gte(0);
  return (
    <span>
      <span className={cn('font-semibold', up ? 'text-emerald-700' : 'text-rose-700')}>
        {up ? '▲' : '▼'} {formatNumber(change.abs().toFixed(0))}%
      </span>{' '}
      dari {what} ({formatRupiah(before)})
    </span>
  );
}

function versusBadge(now: string, before: string) {
  if (dec(before).isZero()) return undefined;
  const change = dec(now).minus(before).div(before).times(100);
  const up = change.gte(0);
  return {
    badge: `${up ? '▲' : '▼'} ${formatNumber(change.abs().toFixed(0))}%`,
    badgeTone: (up ? 'success' : 'error') as 'success' | 'error',
  };
}

const sales = (f: DashboardFigure) => `${formatNumber(String(f.invoices))} nota`;

export function Dashboard() {
  const q = useDashboard();
  if (q.isError) return <Notice tone="error">{q.error.message}</Notice>;
  const d = q.data;
  if (!d) return null;

  if (d.ownOnly) {
    return (
      <section className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Penjualan Saya Hari Ini"
          icon={ShoppingBag}
          value={formatRupiah(d.today.sales)}
          hint={sales(d.today)}
          to="/laporan/penjualan"
          showInfo
        />
        <StatCard
          label="Penjualan Saya Bulan Ini"
          icon={CalendarRange}
          value={formatRupiah(d.month.sales)}
          hint={sales(d.month)}
          showInfo
        />
      </section>
    );
  }

  const todaySalesMeta = versusBadge(d.today.sales, d.yesterday.sales);
  const todayProfitMeta = versusBadge(d.today.profit ?? '0', d.yesterday.profit ?? '0');
  const monthSalesMeta = versusBadge(d.month.sales, d.lastMonth.sales);
  const monthProfitMeta = versusBadge(d.month.profit ?? '0', d.lastMonth.profit ?? '0');

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Omzet Hari Ini"
          icon={ShoppingBag}
          value={formatRupiah(d.today.sales)}
          hint={versus(d.today.sales, d.yesterday.sales, 'kemarin')}
          badge={todaySalesMeta?.badge}
          badgeTone={todaySalesMeta?.badgeTone}
          to="/laporan/penjualan"
          showInfo
          infoTooltip="Total bruto penjualan hari ini vs kemarin"
        />
        <StatCard
          label="Laba Kotor Hari Ini"
          icon={TrendingUp}
          value={formatRupiah(d.today.profit)}
          hint={versus(d.today.profit ?? '0', d.yesterday.profit ?? '0', 'kemarin')}
          badge={todayProfitMeta?.badge}
          badgeTone={todayProfitMeta?.badgeTone}
          to="/laporan/laba"
          showInfo
          infoTooltip="Omzet dikurangi HPP (harga pokok penjualan)"
        />
        <StatCard
          label="Omzet Bulan Ini"
          icon={CalendarRange}
          value={formatRupiah(d.month.sales)}
          hint={versus(d.month.sales, d.lastMonth.sales, 'bulan lalu s/d tanggal yang sama')}
          badge={monthSalesMeta?.badge}
          badgeTone={monthSalesMeta?.badgeTone}
          to="/laporan/penjualan"
          showInfo
          infoTooltip="Akumulasi omzet bulan berjalan"
        />
        <StatCard
          label="Laba Kotor Bulan Ini"
          icon={TrendingUp}
          value={formatRupiah(d.month.profit)}
          hint={versus(d.month.profit ?? '0', d.lastMonth.profit ?? '0', 'bulan lalu')}
          badge={monthProfitMeta?.badge}
          badgeTone={monthProfitMeta?.badgeTone}
          to="/laporan/laba"
          showInfo
          infoTooltip="Akumulasi laba kotor bulan berjalan"
        />
      </section>

      {/* Visual Analytics Charts */}
      {d.dailyTrend && d.dailyTrend.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
          <AreaTrendChart
            title="Tren Penjualan 14 Hari Terakhir"
            primaryLabel="Penjualan"
            data={d.dailyTrend.map((t) => ({
              label: t.label,
              date: t.date,
              value: Number(t.sales),
            }))}
          />
          {d.paymentBreakdown && d.paymentBreakdown.length > 0 ? (
            <DonutChart
              title="Komposisi Pembayaran Bulan Ini"
              centerLabel="Total Bayar"
              segments={d.paymentBreakdown.map((p) => ({
                id: p.id,
                label: p.name,
                value: Number(p.amount),
              }))}
            />
          ) : (
            <div className="rounded-2xl border border-border bg-card p-6 flex items-center justify-center text-muted-foreground text-xs shadow-xs">
              Belum ada data pembayaran bulan ini.
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          {d.topProducts && d.topProducts.length > 0 && (
            <HorizontalBarChart
              title="Kontribusi 5 Produk Terlaris · 30 Hari"
              subtitle="Berdasarkan nilai rupiah omzet penjualan"
              items={d.topProducts.map((p) => ({
                id: p.productId,
                name: p.name,
                amount: Number(p.sales),
                qty: p.qty,
                unit: p.baseUnit,
              }))}
            />
          )}

          <section className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
            <h2 className="border-b border-border/70 px-6 py-4 text-base font-bold text-foreground tracking-tight">
              10 Barang Terlaris · 30 Hari
            </h2>
            {d.topProducts && d.topProducts.length > 0 ? (
              <ol className="divide-y divide-border/60">
                {d.topProducts.map((p, i) => (
                  <li key={p.productId} className="flex items-center gap-3 px-6 py-3 text-sm hover:bg-surface-muted/50 transition-colors">
                    <span className="text-muted-foreground font-mono font-bold w-6 tabular-nums">{i + 1}.</span>
                    <span className="flex-1 font-semibold text-foreground">{p.name}</span>
                    <span className="text-muted-foreground text-xs tabular-nums">{formatQty(p.qty, p.baseUnit)}</span>
                    <span className="w-36 text-right font-bold text-foreground tabular-nums">{formatRupiah(p.sales)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-muted-foreground px-6 py-8 text-xs">Belum ada penjualan 30 hari terakhir.</p>
            )}
          </section>
        </div>

        <section className="space-y-3">
          <AttentionRow
            icon={PackageMinus}
            to="/stok"
            label="Stok Menipis"
            value={`${formatNumber(String(d.lowStock ?? 0))} barang`}
            alert={(d.lowStock ?? 0) > 0}
          />
          <AttentionRow
            icon={AlarmClock}
            to="/piutang"
            label="Piutang Lewat Jatuh Tempo"
            value={`${formatNumber(String(d.receivables?.overdueCount ?? 0))} nota · ${formatRupiah(d.receivables?.overdueAmount)}`}
            detail={`${formatNumber(String(d.receivables?.dueSoonCount ?? 0))} nota jatuh tempo 7 hari ke depan`}
            alert={(d.receivables?.overdueCount ?? 0) > 0}
          />
          <AttentionRow
            icon={PackageCheck}
            to="/laporan/pengambilan"
            label="Barang Belum Diambil"
            value={`${formatNumber(String(d.undelivered?.customers ?? 0))} pelanggan · ${formatRupiah(d.undelivered?.value)}`}
            detail={`${formatNumber(String(d.undelivered?.overduePromises ?? 0))} lewat janji ambil · ${formatNumber(
              String(d.undelivered?.olderThan30 ?? 0),
            )} lebih dari 30 hari`}
            alert={(d.undelivered?.overduePromises ?? 0) > 0 || (d.undelivered?.olderThan30 ?? 0) > 0}
          />
        </section>
      </div>
    </div>
  );
}

function AttentionRow({
  icon: Icon,
  to,
  label,
  value,
  detail,
  alert,
}: {
  icon: typeof AlarmClock;
  to: string;
  label: string;
  value: string;
  detail?: string;
  alert: boolean;
}) {
  return (
    <Link
      to={to}
      className="group block rounded-2xl border border-border bg-card p-4 shadow-xs transition-all duration-150 hover:border-border/90 hover:shadow-sm focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none"
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-xl border',
            alert
              ? 'bg-amber-50 text-amber-800 border-border/60'
              : 'bg-surface-muted text-foreground border-border/60',
          )}
        >
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <span className="text-muted-foreground block text-xs font-semibold uppercase tracking-wider">{label}</span>
          <span className="block font-bold text-foreground tabular-nums text-sm mt-0.5">{value}</span>
          {detail && <span className="text-muted-foreground block text-xs mt-1 leading-snug">{detail}</span>}
        </div>
      </div>
    </Link>
  );
}
