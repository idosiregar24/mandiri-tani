// Laporan Penjualan (FR-FIN-07/12): iPOS-style recap per note, or grouped per day / customer /
// category / payment method. A cashier sees only their own sales of today (S10-6).
import type { ColumnDef } from '@tanstack/react-table';
import { ReceiptText } from 'lucide-react';
import { useState } from 'react';
import type { SalesGroup, SalesGroupRow, SalesRecapRow, SalesReport } from '@shared/schemas/reports';
import { BarChart, DonutChart, HorizontalBarChart } from '@/components/shared/charts';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Notice } from '@/components/shared/Notice';
import { SegmentedControl } from '@/components/shared/SegmentedControl';
import { useReport } from '@/features/reports/api';
import { RowLimitNotice, Totals } from '@/features/reports/parts';
import { useReportPeriod, useRowLimit } from '@/features/reports/period';
import { ReportLayout } from '@/features/reports/ReportLayout';
import { formatDateTime, formatNumber, formatRupiah } from '@/lib/format';
import { useCan } from '@/lib/session';

const GROUPS = [
  { value: 'invoice', label: 'Per nota' },
  { value: 'day', label: 'Per hari' },
  { value: 'customer', label: 'Per pelanggan' },
  { value: 'category', label: 'Per kategori' },
  { value: 'payment_method', label: 'Per cara bayar' },
] as const;
const CHANNELS = [
  { value: 'all', label: 'Semua' },
  { value: 'KASIR', label: 'Kasir' },
  { value: 'FAKTUR', label: 'Faktur' },
] as const;

const money = (v: string) => (v === '0.00' ? '—' : formatRupiah(v));
const right = { align: 'right' as const, className: 'whitespace-nowrap' };

const invoiceColumns: ColumnDef<SalesRecapRow, unknown>[] = [
  {
    header: 'No Transaksi',
    cell: ({ row }) => (
      <div>
        <p className="font-medium whitespace-nowrap">{row.original.number}</p>
        <p className="text-muted-foreground text-sm">
          {formatDateTime(row.original.trxAt)}
          {row.original.imported && ' · dari iPOS'}
        </p>
      </div>
    ),
  },
  {
    header: 'Pelanggan',
    cell: ({ row }) => (
      <div>
        <p>{row.original.customer.name}</p>
        <p className="text-muted-foreground text-sm">{row.original.customer.code}</p>
      </div>
    ),
    meta: { className: 'min-w-44' },
  },
  {
    header: 'Jml Item',
    cell: ({ row }) => formatNumber(row.original.itemCount),
    meta: right,
  },
  {
    header: 'Sub Total',
    cell: ({ row }) => money(row.original.subtotal),
    meta: right,
  },
  { header: 'Pot.', cell: ({ row }) => money(row.original.discount), meta: right },
  { header: 'Biaya Lain', cell: ({ row }) => money(row.original.otherCharges), meta: right },
  {
    header: 'Total Akhir',
    cell: ({ row }) => <span className="font-semibold">{formatRupiah(row.original.total)}</span>,
    meta: right,
  },
  { header: 'Tunai', cell: ({ row }) => money(row.original.paidCash), meta: right },
  {
    header: 'Kredit',
    cell: ({ row }) =>
      row.original.paidCredit === '0.00' ? (
        '—'
      ) : (
        <span className="text-warning-ink font-medium">{formatRupiah(row.original.paidCredit)}</span>
      ),
    meta: right,
  },
];

const groupColumns = (groupBy: SalesGroup): ColumnDef<SalesGroupRow, unknown>[] => [
  { header: GROUPS.find((g) => g.value === groupBy)!.label.replace('Per ', ''), accessorKey: 'label' },
  { header: 'Nota', cell: ({ row }) => formatNumber(String(row.original.count)), meta: right },
  {
    header: groupBy === 'category' ? 'Penjualan bersih' : 'Jumlah',
    cell: ({ row }) => <span className="font-semibold">{formatRupiah(row.original.amount)}</span>,
    meta: right,
  },
  ...(groupBy === 'day' || groupBy === 'customer'
    ? ([
        { header: 'Tunai', cell: ({ row }) => money(row.original.paidCash ?? '0.00'), meta: right },
        { header: 'Kredit', cell: ({ row }) => money(row.original.paidCredit ?? '0.00'), meta: right },
      ] satisfies ColumnDef<SalesGroupRow, unknown>[])
    : []),
];

export function SalesReportPage() {
  const ownOnly = !useCan('reports.all');
  const [period, setPeriod] = useReportPeriod(ownOnly ? 'today' : 'month');
  const [groupBy, setGroupBy] = useState<SalesGroup>('invoice');
  const [channel, setChannel] = useState<'all' | 'KASIR' | 'FAKTUR'>('all');
  const params = { ...period, groupBy, channel: channel === 'all' ? undefined : channel };
  const report = useReport<SalesReport>('/reports/sales', params);
  const d = report.data;
  const invoices = useRowLimit(d?.invoices ?? []);

  return (
    <ReportLayout
      title={ownOnly ? 'Penjualan saya hari ini' : 'Laporan Penjualan'}
      description={ownOnly ? 'Nota yang Anda buat hari ini.' : 'Kolom sama dengan laporan Penjualan Rekap di iPOS.'}
      period={ownOnly ? undefined : { value: period, onChange: setPeriod }}
      filters={
        <>
          <SegmentedControl label="Kelompok" value={groupBy} onChange={setGroupBy} options={GROUPS} />
          <SegmentedControl label="Jenis nota" value={channel} onChange={setChannel} options={CHANNELS} />
        </>
      }
      exportPath="/reports/sales"
      exportParams={params}
      fileName="penjualan"
      landscape={groupBy === 'invoice'}
    >
      {report.isError && <Notice tone="error">{report.error.message}</Notice>}

      {/* Visual Analytics */}
      {d?.groups && d.groups.length > 0 && !report.isFetching && (
        <div className="print:hidden">
          {groupBy === 'day' && (
            <BarChart
              title="Grafik Penjualan Harian (Tunai vs Kredit)"
              primaryLabel="Tunai"
              secondaryLabel="Kredit"
              data={d.groups.map((g) => ({
                label: g.label.length >= 10 ? `${g.label.slice(8, 10)}/${g.label.slice(5, 7)}` : g.label,
                date: g.label,
                value: Number(g.paidCash ?? g.amount),
                secondary: Number(g.paidCredit ?? 0),
                count: g.count,
              }))}
            />
          )}
          {groupBy === 'category' && (
            <div className="grid gap-4 md:grid-cols-2">
              <HorizontalBarChart
                title="Peringkat Omzet per Kategori"
                subtitle="Kontribusi omzet per kategori barang"
                maxItems={8}
                items={d.groups.map((g) => ({
                  id: g.key,
                  name: g.label,
                  amount: Number(g.amount),
                  qty: g.count,
                  unit: 'nota',
                }))}
              />
              <DonutChart
                title="Proporsi Penjualan per Kategori"
                segments={d.groups.map((g) => ({
                  id: g.key,
                  label: g.label,
                  value: Number(g.amount),
                }))}
              />
            </div>
          )}
          {groupBy === 'payment_method' && (
            <div className="max-w-xl">
              <DonutChart
                title="Distribusi Cara Pembayaran"
                segments={d.groups.map((g) => ({
                  id: g.key,
                  label: g.label,
                  value: Number(g.amount),
                }))}
              />
            </div>
          )}
        </div>
      )}

      {groupBy === 'invoice' ? (
        <>
          <DataTable
            columns={invoiceColumns}
            data={invoices.rows}
            getRowId={(r) => r.id}
            isLoading={report.isFetching}
            empty={<EmptyState icon={ReceiptText} title="Belum ada penjualan pada periode ini" />}
          />
          <RowLimitNotice shown={invoices.rows.length} total={invoices.total} onShowAll={invoices.showAll} />
        </>
      ) : (
        <DataTable
          columns={groupColumns(groupBy)}
          data={d?.groups ?? []}
          getRowId={(r) => r.key}
          isLoading={report.isFetching}
          empty={<EmptyState icon={ReceiptText} title="Belum ada penjualan pada periode ini" />}
        />
      )}
      {d && (
        <Totals
          items={[
            { label: 'Jumlah nota', value: formatNumber(String(d.totals.count)) },
            { label: 'Total penjualan', value: formatRupiah(d.totals.total) },
            { label: 'Dibayar tunai/transfer', value: formatRupiah(d.totals.paidCash) },
            { label: 'Kredit (piutang)', value: formatRupiah(d.totals.paidCredit) },
            { label: 'Ongkos angkut', value: formatRupiah(d.totals.otherCharges) },
            { label: 'Potongan nota', value: formatRupiah(d.totals.discount) },
            {
              label: `Retur (${formatNumber(String(d.returns.count))} nota)`,
              value: formatRupiah(d.returns.amount),
              tone: d.returns.count ? 'error' : undefined,
            },
          ]}
        />
      )}
    </ReportLayout>
  );
}
