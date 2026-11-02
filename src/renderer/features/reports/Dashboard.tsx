// Sales dashboard on Beranda (sprint-10 S10-13, FR-FIN-09, FR-PKP-12). Owner: turnover & gross
// profit today and this month against the previous period, top 10 products of 30 days, and what needs
// attention (low stock, overdue receivables, goods waiting for pickup). Cashier: own sales only.
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
      <span className={cn('font-medium', up ? 'text-success-ink' : 'text-error-ink')}>
        {up ? '▲' : '▼'} {formatNumber(change.abs().toFixed(0))}%
      </span>{' '}
      dari {what} ({formatRupiah(before)})
    </span>
  );
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
          label="Penjualan saya hari ini"
          icon={ShoppingBag}
          value={formatRupiah(d.today.sales)}
          hint={sales(d.today)}
          to="/laporan/penjualan"
        />
        <StatCard
          label="Penjualan saya bulan ini"
          icon={CalendarRange}
          value={formatRupiah(d.month.sales)}
          hint={sales(d.month)}
        />
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Omzet hari ini"
          icon={ShoppingBag}
          value={formatRupiah(d.today.sales)}
          hint={versus(d.today.sales, d.yesterday.sales, 'kemarin')}
          to="/laporan/penjualan"
        />
        <StatCard
          label="Laba kotor hari ini"
          icon={TrendingUp}
          value={formatRupiah(d.today.profit)}
          hint={versus(d.today.profit ?? '0', d.yesterday.profit ?? '0', 'kemarin')}
          to="/laporan/laba"
        />
        <StatCard
          label="Omzet bulan ini"
          icon={CalendarRange}
          value={formatRupiah(d.month.sales)}
          hint={versus(d.month.sales, d.lastMonth.sales, 'bulan lalu s/d tanggal yang sama')}
          to="/laporan/penjualan"
        />
        <StatCard
          label="Laba kotor bulan ini"
          icon={TrendingUp}
          value={formatRupiah(d.month.profit)}
          hint={versus(d.month.profit ?? '0', d.lastMonth.profit ?? '0', 'bulan lalu')}
          to="/laporan/laba"
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
            <div className="rounded-xl border bg-card p-5 flex items-center justify-center text-muted-foreground text-sm">
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

          <section className="rounded-xl border">
            <h2 className="border-b px-5 py-3.5 text-lg font-semibold">10 barang terlaris · 30 hari</h2>
            {d.topProducts && d.topProducts.length > 0 ? (
              <ol className="divide-y">
                {d.topProducts.map((p, i) => (
                  <li key={p.productId} className="flex items-center gap-3 px-5 py-2.5 text-base">
                    <span className="text-muted-foreground w-6 tabular-nums">{i + 1}.</span>
                    <span className="flex-1 font-medium">{p.name}</span>
                    <span className="text-muted-foreground tabular-nums">{formatQty(p.qty, p.baseUnit)}</span>
                    <span className="w-40 text-right font-semibold tabular-nums">{formatRupiah(p.sales)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-muted-foreground px-5 py-6">Belum ada penjualan 30 hari terakhir.</p>
            )}
          </section>
        </div>

        <section className="space-y-3">
          <AttentionRow
            icon={PackageMinus}
            to="/stok"
            label="Stok menipis"
            value={`${formatNumber(String(d.lowStock ?? 0))} barang`}
            alert={(d.lowStock ?? 0) > 0}
          />
          <AttentionRow
            icon={AlarmClock}
            to="/piutang"
            label="Piutang lewat jatuh tempo"
            value={`${formatNumber(String(d.receivables?.overdueCount ?? 0))} nota · ${formatRupiah(d.receivables?.overdueAmount)}`}
            detail={`${formatNumber(String(d.receivables?.dueSoonCount ?? 0))} nota jatuh tempo 7 hari ke depan`}
            alert={(d.receivables?.overdueCount ?? 0) > 0}
          />
          <AttentionRow
            icon={PackageCheck}
            to="/laporan/pengambilan"
            label="Barang belum diambil"
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
      className="hover:border-foreground/20 focus-visible:ring-ring flex items-start gap-3 rounded-xl border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-lg',
          alert ? 'bg-warning/10 text-warning-ink' : 'bg-surface-muted text-muted-foreground',
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="text-muted-foreground block text-sm">{label}</span>
        <span className="block font-semibold tabular-nums">{value}</span>
        {detail && <span className="text-muted-foreground block text-sm">{detail}</span>}
      </span>
    </Link>
  );
}
