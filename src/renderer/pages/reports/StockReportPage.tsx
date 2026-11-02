// Persediaan (FR-FIN-08): inventory value per category (FIFO layers) and products that have not sold
// for N days. Owner only — the value is cost.
import type { ColumnDef } from '@tanstack/react-table';
import { PackageX } from 'lucide-react';
import { useState } from 'react';
import type { StockReport } from '@shared/schemas/reports';
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
  const params = { idleDays };
  const report = useReport<StockReport>('/reports/stock', params);
  const d = report.data;
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
      <DataTable
        columns={categoryColumns}
        data={d?.categories ?? []}
        getRowId={(r) => r.id ?? '-'}
        isLoading={report.isFetching}
      />
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
