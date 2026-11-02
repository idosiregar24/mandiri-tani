// Beranda: Owner overview — turnover & gross profit today / this
// month vs the previous period, top products, what needs attention — then the system status.
// A cashier sees only their own sales.
import {
  Boxes,
  CheckCircle2,
  Database,
  FileInput,
  FolderOpen,
  Printer,
  Server,
  Truck,
  Users,
  XCircle,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { Button } from '@/components/ui/button';
import { useHealth, useMasterTotals } from '@/features/home/api';
import { Dashboard } from '@/features/reports/Dashboard';
import { desktopBridge } from '@/lib/desktop';
import { formatNumber } from '@/lib/format';
import { useCan } from '@/lib/session';

export function HomePage() {
  const health = useHealth();
  const totals = useMasterTotals();
  const bridge = desktopBridge();
  const canImport = useCan('imports.ipos');
  const n = (v: number | undefined) => (v === undefined ? '—' : formatNumber(String(v)));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Beranda"
        description="Ringkasan penjualan dan operasional toko Mandiri Tani."
        actions={
          canImport &&
          totals.data?.products === 0 && (
            <Button asChild size="lg" className="h-10 text-sm">
              <Link to="/impor-ipos">
                <FileInput className="size-4" /> Impor dari iPOS
              </Link>
            </Button>
          )
        }
      />

      <Dashboard />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Barang"
          icon={Boxes}
          value={n(totals.data?.products)}
          hint="Barang aktif & nonaktif"
          to="/barang"
          showInfo
          infoTooltip="Total master data produk pertanian"
        />
        <StatCard
          label="Pelanggan"
          icon={Users}
          value={n(totals.data?.customers)}
          hint="Termasuk pelanggan UMUM"
          to="/pelanggan"
          showInfo
          infoTooltip="Total kontak pelanggan terdaftar"
        />
        <StatCard
          label="Supplier"
          icon={Truck}
          value={n(totals.data?.suppliers)}
          hint="Pemasok barang"
          to="/supplier"
          showInfo
          infoTooltip="Total pemasok & pabrik pupuk/pestisida"
        />
        <StatCard
          label="Database"
          icon={Database}
          value={health.data?.db.ok ? 'Baik' : health.isPending ? '…' : 'Bermasalah'}
          badge={health.data?.db.ok ? 'Normal' : 'Periksa'}
          badgeTone={health.data?.db.ok ? 'success' : 'error'}
          showInfo
          infoTooltip="Status koneksi PostgreSQL lokal"
          hint={
            health.data?.db.ok
              ? `PostgreSQL ${health.data.db.version} · ${health.data.db.latency_ms} ms`
              : health.data?.db.error
          }
        />
      </section>

      <section className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="border-b border-border/80 px-6 py-4">
          <h2 className="text-base font-bold text-foreground tracking-tight">Status Sistem</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Kondisi kesehatan service desktop dan pangkalan data lokal</p>
        </div>
        <div className="divide-y divide-border/60">
          <StatusRow
            icon={<Server className="size-4" />}
            label="Server Toko"
            ok={health.isSuccess}
            text={
              health.isSuccess
                ? `Berjalan normal (versi ${health.data.version})`
                : health.isError
                  ? health.error.message
                  : 'Memeriksa…'
            }
          />
          <StatusRow
            icon={<Database className="size-4" />}
            label="Database PostgreSQL"
            ok={health.data?.db.ok ?? false}
            text={health.data?.db.ok ? `PostgreSQL ${health.data.db.version} (Port 5432 / internal)` : (health.data?.db.error ?? 'Memeriksa…')}
          />
        </div>
      </section>

      {bridge && (
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="outline" size="sm" className="h-9 text-xs">
            <Link to="/uji-cetak">
              <Printer className="size-3.5" /> Uji Cetak Printer
            </Link>
          </Button>
          <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => void bridge.openLogFolder()}>
            <FolderOpen className="size-3.5" /> Buka Folder Log
          </Button>
        </div>
      )}
    </div>
  );
}

function StatusRow({ icon, label, ok, text }: { icon: ReactNode; label: string; ok: boolean; text: string }) {
  return (
    <div className="flex items-center gap-3 px-6 py-3.5 text-xs sm:text-sm hover:bg-surface-muted/50 transition-colors">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted-foreground border border-border/50">
        {icon}
      </span>
      <span className="w-40 font-semibold text-foreground">{label}</span>
      {ok ? (
        <CheckCircle2 className="text-emerald-700 size-4 shrink-0" aria-label="baik" />
      ) : (
        <XCircle className="text-rose-700 size-4 shrink-0" aria-label="bermasalah" />
      )}
      <span className="text-muted-foreground text-xs sm:text-sm">{text}</span>
    </div>
  );
}
