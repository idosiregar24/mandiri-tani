// Beranda: the few numbers the owner looks at first + system status (Sprint 3 D1).
// Becomes the sales dashboard in Sprint 10.
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
        title="Selamat datang"
        description="Ringkasan data toko Mandiri Tani."
        actions={
          canImport &&
          totals.data?.products === 0 && (
            <Button asChild size="lg" className="h-11 text-base">
              <Link to="/impor-ipos">
                <FileInput /> Impor dari iPOS
              </Link>
            </Button>
          )
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Barang"
          icon={Boxes}
          value={n(totals.data?.products)}
          hint="Barang aktif & nonaktif"
          to="/barang"
        />
        <StatCard
          label="Pelanggan"
          icon={Users}
          value={n(totals.data?.customers)}
          hint="Termasuk pelanggan UMUM"
          to="/pelanggan"
        />
        <StatCard
          label="Supplier"
          icon={Truck}
          value={n(totals.data?.suppliers)}
          hint="Pemasok barang"
          to="/supplier"
        />
        <StatCard
          label="Database"
          icon={Database}
          value={health.data?.db.ok ? 'Baik' : health.isPending ? '…' : 'Bermasalah'}
          hint={
            health.data?.db.ok
              ? `PostgreSQL ${health.data.db.version} · ${health.data.db.latency_ms} ms`
              : health.data?.db.error
          }
        />
      </section>

      <section className="rounded-xl border">
        <h2 className="border-b px-5 py-3.5 text-lg font-semibold">Status sistem</h2>
        <div className="divide-y">
          <StatusRow
            icon={<Server className="size-5" />}
            label="Server toko"
            ok={health.isSuccess}
            text={
              health.isSuccess
                ? `Berjalan (versi ${health.data.version})`
                : health.isError
                  ? health.error.message
                  : 'Memeriksa…'
            }
          />
          <StatusRow
            icon={<Database className="size-5" />}
            label="Database"
            ok={health.data?.db.ok ?? false}
            text={health.data?.db.ok ? `PostgreSQL ${health.data.db.version}` : (health.data?.db.error ?? 'Memeriksa…')}
          />
        </div>
      </section>

      {bridge && (
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="outline" size="lg" className="h-11 text-base">
            <Link to="/uji-cetak">
              <Printer /> Uji Cetak Printer
            </Link>
          </Button>
          <Button variant="outline" size="lg" className="h-11 text-base" onClick={() => void bridge.openLogFolder()}>
            <FolderOpen /> Buka folder log
          </Button>
        </div>
      )}
    </div>
  );
}

function StatusRow({ icon, label, ok, text }: { icon: ReactNode; label: string; ok: boolean; text: string }) {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5 text-base">
      <span className="text-muted-foreground">{icon}</span>
      <span className="w-36 font-medium">{label}</span>
      {ok ? (
        <CheckCircle2 className="text-success-ink size-5" aria-label="baik" />
      ) : (
        <XCircle className="text-error-ink size-5" aria-label="bermasalah" />
      )}
      <span>{text}</span>
    </div>
  );
}
