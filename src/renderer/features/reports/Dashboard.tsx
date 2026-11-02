// Sales dashboard on Beranda: Owner turnover & gross profit today / this month against previous period.
import {
  AlarmClock,
  ArrowRight,
  Boxes,
  CalendarRange,
  CheckCircle2,
  FolderOpen,
  PackageCheck,
  PackageMinus,
  Printer,
  Receipt,
  Server,
  ShoppingBag,
  TrendingUp,
  Truck,
  Users,
} from 'lucide-react';
import { Link } from 'react-router';
import type { PosBridge } from '@shared/bridge';
import { dec } from '@shared/money';
import type { DashboardFigure } from '@shared/schemas/reports';
import { AreaTrendChart, DonutChart, HorizontalBarChart } from '@/components/shared/charts';
import { Notice } from '@/components/shared/Notice';
import { StatCard } from '@/components/shared/StatCard';
import { Button } from '@/components/ui/button';
import type { Health, MasterTotals } from '@/features/home/api';
import { formatNumber, formatQty, formatRupiah, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDashboard } from './api';

interface DashboardProps {
  totals?: MasterTotals;
  health?: Health;
  bridge?: PosBridge | null;
}

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

export function Dashboard({ totals, health, bridge }: DashboardProps) {
  const q = useDashboard();
  if (q.isError) return <Notice tone="error">{q.error.message}</Notice>;
  const d = q.data;
  if (!d) return null;

  // CASHIER DASHBOARD (Role KASIR)
  if (d.ownOnly) {
    const avgTicket =
      d.today.invoices > 0 ? formatRupiah(dec(d.today.sales).div(d.today.invoices).toFixed(0)) : 'Rp 0';

    return (
      <div className="space-y-6">
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Penjualan Saya Hari Ini"
            icon={ShoppingBag}
            value={formatRupiah(d.today.sales)}
            hint={sales(d.today)}
            to="/laporan/penjualan"
            showInfo
            infoTooltip="Total omzet transaksi yang Anda selesaikan hari ini"
          />
          <StatCard
            label="Rata-rata Nota Hari Ini"
            icon={TrendingUp}
            value={avgTicket}
            hint="Ukuran rata-rata belanja per nota kasir"
            showInfo
            infoTooltip="Total penjualan hari ini dibagi jumlah nota transaksi"
          />
          <StatCard
            label="Penjualan Saya Bulan Ini"
            icon={CalendarRange}
            value={formatRupiah(d.month.sales)}
            hint={sales(d.month)}
            to="/laporan/penjualan"
            showInfo
            infoTooltip="Akumulasi omzet transaksi Anda bulan berjalan"
          />
          <StatCard
            label="Status Sesi Kasir"
            icon={CheckCircle2}
            value="Aktif Melayani"
            badge="Shift Kasir"
            badgeTone="success"
            hint="Terminal kasir siap melayani transaksi"
            showInfo
            infoTooltip="Status kesiapan register kasir saat ini"
          />
        </section>

        {/* Operational Split for Cashier */}
        <div className="grid gap-4 lg:grid-cols-12">
          {/* Left: Recent Sales Feed */}
          <div className="lg:col-span-7">
            <RecentSalesCard recentSales={d.recentSales} />
          </div>

          {/* Right: Master Data & System Health */}
          <div className="lg:col-span-5 space-y-4">
            <MasterEcosystemCard totals={totals} />
            <SystemHealthCard health={health} bridge={bridge} />
          </div>
        </div>
      </div>
    );
  }

  // OWNER DASHBOARD (Role OWNER)
  const todaySalesMeta = versusBadge(d.today.sales, d.yesterday.sales);
  const todayProfitMeta = versusBadge(d.today.profit ?? '0', d.yesterday.profit ?? '0');
  const monthSalesMeta = versusBadge(d.month.sales, d.lastMonth.sales);
  const monthProfitMeta = versusBadge(d.month.profit ?? '0', d.lastMonth.profit ?? '0');

  const hasAlerts =
    (d.receivables?.overdueCount ?? 0) > 0 ||
    (d.lowStock ?? 0) > 0 ||
    (d.undelivered?.customers ?? 0) > 0;

  return (
    <div className="space-y-6">
      {/* Actionable Alerts Center (Perhatian Khusus Operasional) */}
      {hasAlerts ? (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <AlarmClock className="size-3.5 text-amber-600" />
              Perhatian Operasional Hari Ini
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <AttentionCard
              icon={AlarmClock}
              to="/piutang"
              label="Piutang Lewat Jatuh Tempo"
              value={`${formatNumber(String(d.receivables?.overdueCount ?? 0))} nota · ${formatRupiah(d.receivables?.overdueAmount)}`}
              detail={`${formatNumber(String(d.receivables?.dueSoonCount ?? 0))} nota jatuh tempo dalam 7 hari`}
              alert={(d.receivables?.overdueCount ?? 0) > 0}
              actionText="Tangani Piutang"
            />
            <AttentionCard
              icon={PackageMinus}
              to="/stok"
              label="Stok Menipis / Kritis"
              value={`${formatNumber(String(d.lowStock ?? 0))} barang pertanian`}
              detail="Barang berada di bawah batas minimum stok aman"
              alert={(d.lowStock ?? 0) > 0}
              actionText="Periksa Stok"
            />
            <AttentionCard
              icon={PackageCheck}
              to="/laporan/pengambilan"
              label="Barang Belum Diambil"
              value={`${formatNumber(String(d.undelivered?.customers ?? 0))} pelanggan · ${formatRupiah(d.undelivered?.value)}`}
              detail={`${formatNumber(String(d.undelivered?.overduePromises ?? 0))} lewat tanggal janji ambil barang`}
              alert={(d.undelivered?.overduePromises ?? 0) > 0 || (d.undelivered?.olderThan30 ?? 0) > 0}
              actionText="Cek Antrean Ambil"
            />
          </div>
        </section>
      ) : (
        <div className="flex items-center gap-2.5 rounded-2xl border border-border/80 bg-surface-muted/40 px-5 py-3 text-xs text-muted-foreground">
          <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
          <span>Seluruh operasional toko berjalan lancar. Tidak ada piutang lewat jatuh tempo atau stok kritis saat ini.</span>
        </div>
      )}

      {/* Financial KPIs */}
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

      {/* 2-Column Operational Grid */}
      <div className="grid gap-4 xl:grid-cols-12">
        {/* Left Column (7 cols): Top Products & 10 Barang Terlaris */}
        <div className="xl:col-span-7 space-y-4">
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
            <div className="border-b border-border/70 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-foreground tracking-tight">
                  10 Barang Terlaris · 30 Hari
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Produk pupuk, obat, dan benih dengan omzet penjualan tertinggi
                </p>
              </div>
              <Button asChild variant="ghost" size="xs" className="h-7 text-xs text-muted-foreground hover:text-foreground">
                <Link to="/laporan/penjualan">Laporan Lengkap →</Link>
              </Button>
            </div>
            {d.topProducts && d.topProducts.length > 0 ? (
              <ol className="divide-y divide-border/60">
                {d.topProducts.map((p, i) => (
                  <li
                    key={p.productId}
                    className="flex items-center gap-3 px-6 py-3 text-sm hover:bg-surface-muted/50 transition-colors"
                  >
                    <span className="text-muted-foreground font-mono font-bold w-6 tabular-nums">{i + 1}.</span>
                    <span className="flex-1 font-semibold text-foreground">{p.name}</span>
                    <span className="text-muted-foreground text-xs tabular-nums">{formatQty(p.qty, p.baseUnit)}</span>
                    <span className="w-36 text-right font-bold text-foreground tabular-nums">
                      {formatRupiah(p.sales)}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-muted-foreground px-6 py-8 text-xs">Belum ada penjualan 30 hari terakhir.</p>
            )}
          </section>
        </div>

        {/* Right Column (5 cols): Recent Transactions & Ecosystem & System */}
        <div className="xl:col-span-5 space-y-4">
          <RecentSalesCard recentSales={d.recentSales} />
          <MasterEcosystemCard totals={totals} />
          <SystemHealthCard health={health} bridge={bridge} />
        </div>
      </div>
    </div>
  );
}

function AttentionCard({
  icon: Icon,
  to,
  label,
  value,
  detail,
  alert,
  actionText,
}: {
  icon: typeof AlarmClock;
  to: string;
  label: string;
  value: string;
  detail?: string;
  alert: boolean;
  actionText: string;
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
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary mt-2 group-hover:underline">
            {actionText} <ArrowRight className="size-3" />
          </span>
        </div>
      </div>
    </Link>
  );
}

function RecentSalesCard({ recentSales }: { recentSales?: DashboardProps['totals'] extends undefined ? unknown : unknown }) {
  const sales = recentSales as
    | {
        id: string;
        number: string;
        trxAt: string;
        customerName: string;
        itemCount: number;
        total: string;
        paidCash: string;
        paidCredit: string;
      }[]
    | undefined;

  return (
    <section className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
      <div className="border-b border-border/70 px-5 py-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-foreground tracking-tight flex items-center gap-2">
            <Receipt className="size-4 text-primary" />
            Transaksi Kasir Terkini
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">5 nota penjualan terakhir yang selesai dicatat kasir</p>
        </div>
        <Button asChild variant="ghost" size="xs" className="h-7 text-xs text-muted-foreground hover:text-foreground">
          <Link to="/laporan/penjualan">Lihat Semua →</Link>
        </Button>
      </div>

      <div className="p-4 space-y-2.5">
        {sales && sales.length > 0 ? (
          sales.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between p-3 rounded-xl border border-border/60 hover:bg-surface-muted/50 transition-colors"
            >
              <div className="min-w-0 pr-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-foreground">{s.number}</span>
                  <span className="text-[11px] text-muted-foreground">{formatTime(s.trxAt)} WIB</span>
                  {Number(s.paidCredit) > 0 ? (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-border bg-amber-50 text-amber-800">
                      Piutang
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-border bg-emerald-50 text-emerald-800">
                      Tunai
                    </span>
                  )}
                </div>
                <div className="text-xs text-foreground/90 font-medium truncate mt-0.5">
                  {s.customerName} · <span className="text-muted-foreground">{s.itemCount} item barang</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <span className="font-bold text-sm text-foreground tabular-nums">{formatRupiah(s.total)}</span>
              </div>
            </div>
          ))
        ) : (
          <div className="py-8 text-center text-xs text-muted-foreground">
            Belum ada transaksi penjualan hari ini.
          </div>
        )}
      </div>
    </section>
  );
}

function MasterEcosystemCard({ totals }: { totals?: MasterTotals }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-xs">
      <div className="mb-3.5">
        <h3 className="text-sm font-bold text-foreground tracking-tight flex items-center gap-2">
          <Boxes className="size-4 text-primary" />
          Ekosistem Master Data Toko
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">Status entitas barang, pelanggan, dan jaringan pemasok</p>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        <Link
          to="/barang"
          className="p-3 rounded-xl border border-border/70 hover:bg-surface-muted/60 transition-colors text-center block group"
        >
          <span className="text-xs font-semibold text-muted-foreground group-hover:text-foreground block truncate">
            Barang
          </span>
          <span className="text-xl font-bold text-foreground tabular-nums block mt-1">
            {formatNumber(String(totals?.products ?? 0))}
          </span>
          <span className="text-[10px] text-muted-foreground block truncate">Katalog Produk</span>
        </Link>
        <Link
          to="/pelanggan"
          className="p-3 rounded-xl border border-border/70 hover:bg-surface-muted/60 transition-colors text-center block group"
        >
          <span className="text-xs font-semibold text-muted-foreground group-hover:text-foreground block truncate">
            Pelanggan
          </span>
          <span className="text-xl font-bold text-foreground tabular-nums block mt-1">
            {formatNumber(String(totals?.customers ?? 0))}
          </span>
          <span className="text-[10px] text-muted-foreground block truncate">Petani & Mitra</span>
        </Link>
        <Link
          to="/supplier"
          className="p-3 rounded-xl border border-border/70 hover:bg-surface-muted/60 transition-colors text-center block group"
        >
          <span className="text-xs font-semibold text-muted-foreground group-hover:text-foreground block truncate">
            Supplier
          </span>
          <span className="text-xl font-bold text-foreground tabular-nums block mt-1">
            {formatNumber(String(totals?.suppliers ?? 0))}
          </span>
          <span className="text-[10px] text-muted-foreground block truncate">Distributor</span>
        </Link>
      </div>
    </section>
  );
}

function SystemHealthCard({ health, bridge }: { health?: Health; bridge?: PosBridge | null }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-xs">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Server className="size-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground tracking-tight">Kesehatan Sistem & Desktop</h3>
        </div>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-border text-xs font-medium bg-emerald-50 text-emerald-800">
          {health?.db.ok ? 'Normal' : 'Periksa'}
        </span>
      </div>

      <div className="space-y-1.5 text-xs text-muted-foreground border-b border-border/60 pb-3 mb-3">
        <div className="flex justify-between items-center">
          <span>Versi Aplikasi:</span>
          <span className="font-mono font-medium text-foreground">v{health?.version ?? '0.1.0'}</span>
        </div>
        <div className="flex justify-between items-center">
          <span>PostgreSQL Database:</span>
          <span className="font-medium text-foreground">
            {health?.db.ok ? `Terhubung (${health.db.latency_ms ?? 0} ms)` : 'Koneksi Terputus'}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm" className="h-8 text-xs flex-1">
          <Link to="/uji-cetak">
            <Printer className="size-3.5 mr-1" /> Uji Cetak
          </Link>
        </Button>
        {bridge && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs flex-1"
            onClick={() => void bridge.openLogFolder()}
          >
            <FolderOpen className="size-3.5 mr-1" /> Buka Log
          </Button>
        )}
      </div>
    </section>
  );
}
