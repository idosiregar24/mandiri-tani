// Pembelian Detail (FR-FIN-12): supplier invoices with their lines, columns like iPOS.
import type { ColumnDef } from '@tanstack/react-table';
import { Truck } from 'lucide-react';
import type { PurchaseReportRow, PurchasesReport } from '@shared/schemas/reports';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Notice } from '@/components/shared/Notice';
import { StatusPill } from '@/components/shared/StatusPill';
import { useReport } from '@/features/reports/api';
import { RowLimitNotice, Totals } from '@/features/reports/parts';
import { useReportPeriod, useRowLimit } from '@/features/reports/period';
import { ReportLayout } from '@/features/reports/ReportLayout';
import { formatDate, formatNumber, formatQty, formatRupiah } from '@/lib/format';

const right = { align: 'right' as const, className: 'whitespace-nowrap' };
const money = (v: string) => (v === '0.00' ? '—' : formatRupiah(v));

const columns: ColumnDef<PurchaseReportRow, unknown>[] = [
  {
    header: 'Faktur',
    cell: ({ row }) => (
      <div>
        <p className="font-medium whitespace-nowrap">{row.original.number}</p>
        <p className="text-muted-foreground text-sm">
          {formatDate(row.original.date)}
          {row.original.supplierInvoiceNo && ` · ${row.original.supplierInvoiceNo}`}
        </p>
        {row.original.status === 'VOIDED' && <StatusPill tone="error">Batal</StatusPill>}
      </div>
    ),
  },
  {
    header: 'Supplier & barang',
    cell: ({ row }) => (
      <div>
        <p className="font-medium">{row.original.supplier.name}</p>
        <ul className="text-muted-foreground text-sm">
          {row.original.lines.map((l, i) => (
            <li key={i}>
              {l.productName} — {formatQty(l.qty, l.unitCode)} × {formatRupiah(l.unitPrice)}
            </li>
          ))}
        </ul>
      </div>
    ),
    meta: { className: 'min-w-72' },
  },
  { header: 'Sub Total', cell: ({ row }) => formatRupiah(row.original.subtotal), meta: right },
  { header: 'Pot.', cell: ({ row }) => money(row.original.discount), meta: right },
  { header: 'Biaya Lain', cell: ({ row }) => money(row.original.otherCost), meta: right },
  {
    header: 'Total Akhir',
    cell: ({ row }) => <span className="font-semibold">{formatRupiah(row.original.total)}</span>,
    meta: right,
  },
  { header: 'Tunai', cell: ({ row }) => money(row.original.paidCash), meta: right },
  { header: 'Kredit', cell: ({ row }) => money(row.original.paidCredit), meta: right },
];

export function PurchasesReportPage() {
  const [period, setPeriod] = useReportPeriod('month');
  const report = useReport<PurchasesReport>('/reports/purchases', period);
  const d = report.data;
  const rows = useRowLimit(d?.rows ?? []);
  return (
    <ReportLayout
      title="Pembelian Detail"
      description="Faktur pembelian beserta barangnya — kolom sama dengan laporan iPOS."
      period={{ value: period, onChange: setPeriod }}
      exportPath="/reports/purchases"
      exportParams={period}
      fileName="pembelian-detail"
      landscape
    >
      {report.isError && <Notice tone="error">{report.error.message}</Notice>}
      <DataTable
        columns={columns}
        data={rows.rows}
        getRowId={(r) => r.id}
        isLoading={report.isFetching}
        isRowMuted={(r) => r.status === 'VOIDED'}
        empty={<EmptyState icon={Truck} title="Belum ada pembelian pada periode ini" />}
      />
      <RowLimitNotice shown={rows.rows.length} total={rows.total} onShowAll={rows.showAll} />
      {d && (
        <Totals
          items={[
            { label: 'Jumlah faktur', value: formatNumber(String(d.totals.count)) },
            { label: 'Total pembelian', value: formatRupiah(d.totals.total) },
            { label: 'Dibayar tunai/transfer', value: formatRupiah(d.totals.paidCash) },
            { label: 'Kredit (hutang)', value: formatRupiah(d.totals.paidCredit) },
          ]}
        />
      )}
      <p className="text-muted-foreground text-sm">
        Faktur dari histori iPOS tercatat tanpa pembagian tunai/kredit, jadi kolom Kredit-nya kosong.
      </p>
    </ReportLayout>
  );
}
