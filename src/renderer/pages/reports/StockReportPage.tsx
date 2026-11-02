// Persediaan (FR-FIN-08): inventory value per category (FIFO layers) and products that have not sold
// for N days. Owner only — the value is cost.
import type { ColumnDef } from '@tanstack/react-table';
import { PackageX } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { StockReport } from '@shared/schemas/reports';
import { DonutChart, HorizontalBarChart } from '@/components/shared/charts';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Notice } from '@/components/shared/Notice';
import { SegmentedControl } from '@/components/shared/SegmentedControl';
import { useReport } from '@/features/reports/api';
import { ReportSection, Totals } from '@/features/reports/parts';
import { ReportLayout } from '@/features/reports/ReportLayout';
import { formatDate, formatNumber, formatQty, formatRupiah } from '@/lib/format';

const IDLE = [
  { value: '30', label: '30 hari' },
  { value: '60', label: '60 hari' },
  { value: '90', label: '90 hari' },
  { value: '180', label: '180 hari' },
] as const;
const right = { align: 'right' as const, className: 'whitespace-nowrap' };

type Category = StockReport['categories'][number];
type Idle = StockReport['idle'][number];

const categoryColumns: ColumnDef<Category, unknown>[] = [
  { header: 'Kategori', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
  { header: 'Jumlah barang', cell: ({ row }) => formatNumber(String(row.original.products)), meta: right },
  {
    header: 'Nilai persediaan (HPP)',
    cell: ({ row }) => <span className="font-semibold">{formatRupiah(row.original.value)}</span>,
    meta: right,
  },
];

const idleColumns: ColumnDef<Idle, unknown>[] = [
  {
    header: 'Barang',
    cell: ({ row }) => (
      <div>
        <p className="font-medium">{row.original.name}</p>
        <p className="text-muted-foreground text-sm">{row.original.sku}</p>
      </div>
    ),
  },
  { header: 'Stok', cell: ({ row }) => formatQty(row.original.qty, row.original.baseUnit), meta: right },
  { header: 'Nilai (HPP)', cell: ({ row }) => formatRupiah(row.original.value), meta: right },
  {
    header: 'Terakhir laku',
    cell: ({ row }) => (row.original.lastSaleDate ? formatDate(row.original.lastSaleDate) : 'Belum pernah'),
    meta: right,
  },
];

export function StockReportPage() {
  const [idleDays, setIdleDays] = useState<(typeof IDLE)[number]['value']>('60');
  const [chartMetric, setChartMetric] = useState<'value' | 'products'>('value');
  const params = { idleDays };
  const report = useReport<StockReport>('/reports/stock', params);
  const d = report.data;

  // Categories sorted by value descending
  const sortedCategories = useMemo(() => {
    if (!d?.categories) return [];
    return [...d.categories].sort((a, b) => Number(b.value) - Number(a.value));
  }, [d?.categories]);

  // Pie / Donut chart segments per category (Pupuk, Pestisida, Benih, dll.)
  const categorySegments = useMemo(() => {
    if (!d?.categories) return [];
    return d.categories
      .filter((c) => (chartMetric === 'value' ? Number(c.value) > 0 : c.products > 0))
      .map((c) => ({
        id: c.id ?? c.name,
        label: c.name,
        value: chartMetric === 'value' ? Number(c.value) : c.products,
        desc: `${c.products} barang`,
      }));
  }, [d?.categories, chartMetric]);

  return (
    <ReportLayout
      title="Persediaan"
      description="Nilai stok per kategori (HPP FIFO, sama seperti iPOS) dan barang yang lama tidak laku."
      filters={<SegmentedControl label="Tidak laku selama" value={idleDays} onChange={setIdleDays} options={IDLE} />}
      exportPath="/reports/stock"
      exportParams={params}
      fileName="persediaan"
    >
      {report.isError && <Notice tone="error">{report.error.message}</Notice>}
      {d && (
        <Totals
          items={[
            { label: 'Nilai persediaan', value: formatRupiah(d.totals.value) },
            { label: 'Barang aktif', value: formatNumber(String(d.totals.products)) },
            {
              label: 'Stok menipis',
              value: formatNumber(String(d.totals.low)),
              tone: d.totals.low ? 'error' : undefined,
            },
            {
              label: 'Stok minus',
              value: formatNumber(String(d.totals.minus)),
              tone: d.totals.minus ? 'error' : undefined,
            },
          ]}
        />
      )}

      {/* Visual Analytics: Pie / Donut Chart per Kategori Barang (Pupuk, Pestisida, Benih, dll.) */}
      {d && d.categories.length > 0 && !report.isFetching && (
        <div className="space-y-3.5 print:hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <div>
              <h3 className="text-base font-bold text-foreground tracking-tight">
                Distribusi Kategori Barang
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Proporsi stok persediaan toko tani (Pupuk, Pestisida, Benih, Obat, dll.)
              </p>
            </div>
            <SegmentedControl
              label="Dasar perhitungan"
              value={chartMetric}
              onChange={(val) => setChartMetric(val as 'value' | 'products')}
              options={[
                { value: 'value', label: 'Nilai HPP (Rp)' },
                { value: 'products', label: 'Jumlah Barang' },
              ]}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <DonutChart
              title="Komposisi Kategori Barang"
              subtitle={
                chartMetric === 'value'
                  ? 'Berdasarkan modal persediaan (HPP FIFO)'
                  : 'Berdasarkan variasi jenis produk terdaftar'
              }
              segments={categorySegments}
              centerLabel={chartMetric === 'value' ? 'Total Nilai' : 'Total Item'}
              centerValue={
                chartMetric === 'value'
                  ? formatRupiah(d.totals.value)
                  : `${formatNumber(String(d.totals.products))} Item`
              }
              formatValue={(v) =>
                chartMetric === 'value' ? formatRupiah(String(v)) : `${formatNumber(String(v))} barang`
              }
            />

            <HorizontalBarChart
              title="Peringkat Nilai Stok per Kategori"
              subtitle="Urutan kategori dari nilai persediaan modal tertinggi"
              maxItems={8}
              items={sortedCategories.map((c) => ({
                id: c.id ?? c.name,
                name: c.name,
                amount: Number(c.value),
                qty: c.products,
                unit: 'barang',
              }))}
            />
          </div>
        </div>
      )}

      <ReportSection title="Tabel Nilai Persediaan per Kategori">
        <DataTable
          columns={categoryColumns}
          data={d?.categories ?? []}
          getRowId={(r) => r.id ?? '-'}
          isLoading={report.isFetching}
        />
      </ReportSection>

      <ReportSection title={`Tidak laku ${idleDays} hari terakhir`}>
        <DataTable
          columns={idleColumns}
          data={d?.idle ?? []}
          getRowId={(r) => r.productId}
          isLoading={report.isFetching}
          empty={<EmptyState icon={PackageX} title="Semua barang yang ada stoknya masih laku" />}
        />
      </ReportSection>
    </ReportLayout>
  );
}
