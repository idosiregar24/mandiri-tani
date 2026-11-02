// /laporan (sprint-10 E1): the reports the role may open, grouped like the store thinks of them.
import {
  BarChart3,
  Boxes,
  ChevronRight,
  Landmark,
  PackageCheck,
  ReceiptText,
  Sprout,
  TrendingUp,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router';
import { hasPermission, type Permission } from '@shared/permissions';
import { PageHeader } from '@/components/shared/PageHeader';
import { useCan, useRole } from '@/lib/session';

interface ReportLink {
  to: string;
  title: string;
  text: string;
  icon: LucideIcon;
  permission: Permission;
}

const GROUPS: { title: string; items: ReportLink[] }[] = [
  {
    title: 'Penjualan',
    items: [
      {
        to: '/laporan/penjualan',
        title: 'Penjualan',
        text: 'Rekap per nota seperti iPOS, per hari, pelanggan, kategori, cara bayar',
        icon: ReceiptText,
        permission: 'reports.sales',
      },
      {
        to: '/laporan/laba',
        title: 'Laba',
        text: 'Laba rugi, laba kotor per barang dan per nota',
        icon: TrendingUp,
        permission: 'reports.profit',
      },
    ],
  },
  {
    title: 'Uang',
    items: [
      {
        to: '/laporan/arus-kas',
        title: 'Arus kas',
        text: 'Saldo awal, uang masuk & keluar per kategori, saldo akhir',
        icon: Landmark,
        permission: 'reports.cashflow',
      },
      {
        to: '/laporan/pembelian',
        title: 'Pembelian detail',
        text: 'Faktur pembelian beserta barangnya, seperti iPOS',
        icon: Truck,
        permission: 'reports.all',
      },
    ],
  },
  {
    title: 'Barang',
    items: [
      {
        to: '/laporan/pupuk',
        title: 'Rekap harian pupuk',
        text: 'Keluar per zak & per kg, masuk, dan sisa setiap hari',
        icon: Sprout,
        permission: 'reports.all',
      },
      {
        to: '/laporan/pengambilan',
        title: 'Barang belum diambil',
        text: 'Per pelanggan & per barang, plus riwayat pengambilan',
        icon: PackageCheck,
        permission: 'reports.all',
      },
      {
        to: '/laporan/persediaan',
        title: 'Persediaan',
        text: 'Nilai stok per kategori dan barang yang lama tidak laku',
        icon: Boxes,
        permission: 'reports.all',
      },
    ],
  },
];

function ReportCard({ r }: { r: ReportLink }) {
  return (
    <Link
      to={r.to}
      className="bg-background hover:border-foreground/20 focus-visible:ring-ring flex min-h-20 items-center gap-4 rounded-xl border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <span className="bg-tani-green-light text-tani-green-dark flex size-11 shrink-0 items-center justify-center rounded-lg">
        <r.icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold">{r.title}</span>
        <span className="text-muted-foreground block text-sm">{r.text}</span>
      </span>
      <ChevronRight className="text-muted-foreground size-5" aria-hidden />
    </Link>
  );
}

export function ReportsIndex() {
  const owner = useCan('reports.all');
  const role = useRole();
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => hasPermission(role, i.permission)) })).filter(
    (g) => g.items.length > 0,
  );
  return (
    <div className="space-y-7">
      <PageHeader
        title="Laporan"
        description={
          owner
            ? 'Semua laporan bisa dicetak, disimpan sebagai PDF, atau dibuka di Excel.'
            : 'Laporan penjualan Anda hari ini.'
        }
      />
      {groups.map((g) => (
        <section key={g.title} className="space-y-3">
          <h2 className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
            <BarChart3 className="size-4" aria-hidden /> {g.title}
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {g.items.map((r) => (
              <ReportCard key={r.to} r={r} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
