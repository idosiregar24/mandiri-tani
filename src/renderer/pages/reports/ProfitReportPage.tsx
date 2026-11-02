// Laporan Laba (FR-FIN-04/05/06): profit & loss, gross profit per product, per note. Owner only.
// HPP of goods not picked up yet is an estimate (*); sales without HPP (iPOS history) are shown but
// never counted as profit (S10-4).
import type { ColumnDef } from '@tanstack/react-table';
import { TrendingUp } from 'lucide-react';
import { useState } from 'react';
import type {
  ProfitByInvoiceReport,
  ProfitByItemReport,
  ProfitInvoiceRow,
  ProfitItemRow,
  ProfitLossReport,
  ProfitTotals,
} from '@shared/schemas/reports';
import { HorizontalBarChart } from '@/components/shared/charts';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Notice } from '@/components/shared/Notice';
import { SegmentedControl } from '@/components/shared/SegmentedControl';
import { StatusPill } from '@/components/shared/StatusPill';
import { useReport } from '@/features/reports/api';
import { ReportSection, RowLimitNotice, Totals } from '@/features/reports/parts';
import { useReportPeriod, useRowLimit } from '@/features/reports/period';
import { ReportLayout } from '@/features/reports/ReportLayout';
import { formatDateTime, formatNumber, formatQty, formatRupiah } from '@/lib/format';
import { cn } from '@/lib/utils';

const VIEWS = [
  { value: 'loss', label: 'Laba rugi' },
  { value: 'item', label: 'Per barang' },
  { value: 'invoice', label: 'Per nota' },
] as const;
type View = (typeof VIEWS)[number]['value'];

const PATH: Record<View, string> = {
  loss: '/reports/profit-loss',
  item: '/reports/profit-by-item',
  invoice: '/reports/profit-by-invoice',
};
const FILE: Record<View, string> = { loss: 'laba-rugi', item: 'laba-per-barang', invoice: 'laba-per-nota' };
const right = { align: 'right' as const, className: 'whitespace-nowrap' };

const profitCell = (v: string | null) =>
  v === null ? (
    '—'
  ) : (
    <span className={cn('font-semibold', v.startsWith('-') && 'text-error-ink')}>{formatRupiah(v)}</span>
  );
const pct = (v: string | null) => (v === null ? '—' : `${formatNumber(v, 1)}%`);

/** Every sale of the product in the period lacks HPP (iPOS history DQ-3): there is no profit to show. */
const allUnknown = (r: ProfitItemRow) => r.unknownCostSales !== '0.00' && r.unknownCostSales === r.sales;

const itemColumns: ColumnDef<ProfitItemRow, unknown>[] = [
  {
    header: 'Barang',
    cell: ({ row }) => (
      <div>
        <p className="font-medium">{row.original.name}</p>
        <p className="text-muted-foreground text-sm">
          {row.original.sku}
          {row.original.category && ` · ${row.original.category}`}
        </p>
      </div>
    ),
    meta: { className: 'min-w-56' },
  },
  { header: 'Terjual', cell: ({ row }) => formatQty(row.original.qty, row.original.baseUnit), meta: right },
  { header: 'Penjualan', cell: ({ row }) => formatRupiah(row.original.sales), meta: right },
  {
    header: 'Retur',
    cell: ({ row }) => (row.original.returns === '0.00' ? '—' : formatRupiah(row.original.returns)),
    meta: right,
  },
  {
    header: 'HPP',
    cell: ({ row }) =>
      allUnknown(row.original) ? (
        <StatusPill tone="neutral">HPP tidak ada</StatusPill>
      ) : (
        <span>
          {formatRupiah(row.original.hpp)}
          {row.original.estimated && <span title="Termasuk perkiraan barang belum diambil"> *</span>}
        </span>
      ),
    meta: right,
  },
  {
    header: 'Laba',
    cell: ({ row }) => (allUnknown(row.original) ? '—' : profitCell(row.original.profit)),
    meta: right,
  },
  { header: 'Margin', cell: ({ row }) => pct(row.original.marginPct), meta: right },
];

const invoiceColumns: ColumnDef<ProfitInvoiceRow, unknown>[] = [
  {
    header: 'Nota',
    cell: ({ row }) => (
      <div>
        <p className="font-medium whitespace-nowrap">{row.original.number}</p>
        <p className="text-muted-foreground text-sm">{formatDateTime(row.original.trxAt)}</p>
      </div>
    ),
  },
  { header: 'Pelanggan', cell: ({ row }) => row.original.customer.name },
  { header: 'Penjualan', cell: ({ row }) => formatRupiah(row.original.sales), meta: right },
  {
    header: 'Retur',
    cell: ({ row }) => (row.original.returns === '0.00' ? '—' : formatRupiah(row.original.returns)),
    meta: right,
  },
  {
    header: 'HPP',
    cell: ({ row }) =>
      row.original.costUnknown ? (
        <StatusPill tone="neutral">HPP tidak ada</StatusPill>
      ) : (
        <span>
          {formatRupiah(row.original.hpp)}
          {row.original.estimated && ' *'}
        </span>
      ),
    meta: right,
  },
  { header: 'Laba', cell: ({ row }) => profitCell(row.original.profit), meta: right },
  { header: 'Margin', cell: ({ row }) => pct(row.original.marginPct), meta: right },
];

function ProfitTotalsBar({ t }: { t: ProfitTotals }) {
  return (
    <Totals
      items={[
        { label: 'Penjualan', value: formatRupiah(t.sales) },
        { label: 'Retur', value: formatRupiah(t.returns) },
        { label: `HPP${t.estimated ? ' *' : ''}`, value: formatRupiah(t.hpp) },
        { label: 'Laba kotor', value: formatRupiah(t.profit), tone: t.profit.startsWith('-') ? 'error' : 'success' },
      ]}
    />
  );
}

function Footnotes({ estimated, unknown }: { estimated: boolean; unknown: string }) {
  return (
    <div className="text-muted-foreground space-y-1 text-sm">
      {estimated && <p>* HPP termasuk perkiraan untuk barang yang belum diambil pelanggan (HPP FIFO saat ini).</p>}
      {unknown !== '0.00' && (
        <p>
          Penjualan {formatRupiah(unknown)} tidak punya HPP (histori iPOS, barang keluar sebelum stok tercatat) — tidak
          dihitung dalam laba.
        </p>
      )}
    </div>
  );
}

export function ProfitReportPage() {
  const [period, setPeriod] = useReportPeriod('month');
  const [view, setView] = useState<View>('loss');
  const loss = useReport<ProfitLossReport>(PATH.loss, period, view === 'loss');
  const item = useReport<ProfitByItemReport>(PATH.item, period, view === 'item');
  const invoice = useReport<ProfitByInvoiceReport>(PATH.invoice, period, view === 'invoice');
  const invoiceRows = useRowLimit(invoice.data?.rows ?? []);
  const error = [loss, item, invoice].find((q) => q.isError)?.error;

  return (
    <ReportLayout
      title="Laporan Laba"
      description="Laba kotor dihitung dari HPP FIFO, sama seperti iPOS."
      period={{ value: period, onChange: setPeriod }}
      filters={<SegmentedControl label="Tampilan" value={view} onChange={setView} options={VIEWS} />}
      exportPath={PATH[view]}
      exportParams={period}
      fileName={FILE[view]}
      landscape={view !== 'loss'}
    >
      {error && <Notice tone="error">{error.message}</Notice>}

      {view === 'loss' && loss.data && <ProfitLoss r={loss.data} />}

      {view === 'item' && (
        <>
          {item.data?.rows && item.data.rows.length > 0 && !item.isFetching && (
            <div className="print:hidden mb-4">
              <HorizontalBarChart
                title="5 Barang dengan Laba Kotor Tertinggi"
                subtitle="Diurutkan berdasarkan nominal laba kotor tertinggi"
                maxItems={5}
                items={item.data.rows
                  .filter((r) => r.profit !== null && Number(r.profit) > 0)
                  .map((r) => ({
                    id: r.productId,
                    name: r.name,
                    amount: Number(r.profit),
                    qty: r.qty,
                    unit: r.baseUnit,
                  }))}
              />
            </div>
          )}
          <DataTable
            columns={itemColumns}
            data={item.data?.rows ?? []}
            getRowId={(r) => r.productId}
            isLoading={item.isFetching}
            empty={<EmptyState icon={TrendingUp} title="Belum ada penjualan pada periode ini" />}
          />
          {item.data && (
            <>
              <ProfitTotalsBar t={item.data.totals} />
              <Footnotes estimated={item.data.totals.estimated} unknown={item.data.totals.unknownCostSales} />
            </>
          )}
        </>
      )}

      {view === 'invoice' && (
        <>
          <DataTable
            columns={invoiceColumns}
            data={invoiceRows.rows}
            getRowId={(r) => r.saleId}
            isLoading={invoice.isFetching}
            empty={<EmptyState icon={TrendingUp} title="Belum ada penjualan pada periode ini" />}
          />
          <RowLimitNotice shown={invoiceRows.rows.length} total={invoiceRows.total} onShowAll={invoiceRows.showAll} />
          {invoice.data && (
            <>
              <ProfitTotalsBar t={invoice.data.totals} />
              <Footnotes estimated={invoice.data.totals.estimated} unknown={invoice.data.totals.unknownCostSales} />
            </>
          )}
        </>
      )}
    </ReportLayout>
  );
}

function Line({ label, value, strong, minus }: { label: string; value: string; strong?: boolean; minus?: boolean }) {
  return (
    <div
      className={cn('flex items-center justify-between gap-4 px-5 py-3', strong && 'bg-surface-muted font-semibold')}
    >
      <span>{label}</span>
      <span className={cn('tabular-nums', strong && 'text-lg', value.startsWith('-') && 'text-error-ink')}>
        {minus && value !== '0.00' ? `(${formatRupiah(value)})` : formatRupiah(value)}
      </span>
    </div>
  );
}

function ProfitLoss({ r }: { r: ProfitLossReport }) {
  const chartItems = [
    { id: '1', name: 'Penjualan Bersih', amount: Math.max(0, Number(r.netSales)) },
    { id: '2', name: 'Harga Pokok Penjualan (HPP)', amount: Math.max(0, Number(r.hpp)) },
    { id: '3', name: 'Laba Kotor', amount: Math.max(0, Number(r.grossProfit)) },
    { id: '4', name: 'Biaya Operasional', amount: Math.max(0, Number(r.opexTotal)) },
    { id: '5', name: 'Laba Bersih', amount: Math.max(0, Number(r.operatingProfit)) },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="divide-y rounded-xl border text-base">
          <Line label="Penjualan bersih" value={r.netSales} />
          {r.unknownCostSales !== '0.00' && (
            <Line label="Dikurangi: penjualan tanpa HPP (histori iPOS)" value={r.unknownCostSales} minus />
          )}
          <Line label="Retur penjualan" value={r.returns} minus />
          <Line label={`Harga pokok penjualan (HPP)${r.estimated ? ' *' : ''}`} value={r.hpp} minus />
          <Line label="Laba kotor" value={r.grossProfit} strong />
          <Line label="Pendapatan ongkos angkut" value={r.otherCharges} />
          {r.opex.map((o) => (
            <Line key={o.code} label={`Biaya: ${o.name}`} value={o.amount} minus />
          ))}
          <Line label="Total biaya operasional" value={r.opexTotal} minus />
          <Line label="Laba bersih operasional (perkiraan)" value={r.operatingProfit} strong />
        </div>

        <div className="print:hidden">
          <HorizontalBarChart
            title="Ringkasan Finansial Periode Ini"
            subtitle="Perbandingan omzet, HPP, beban dan laba"
            items={chartItems}
            maxItems={5}
            barColor="#2e7d32"
          />
        </div>
      </div>
      <ReportSection title="Catatan">
        <Footnotes estimated={r.estimated} unknown="0.00" />
        <p className="text-muted-foreground text-sm">
          Biaya operasional diambil dari Kas Keluar berkategori biaya (ekspedisi, bongkar muat, BBM, upah, dll.).
        </p>
      </ReportSection>
    </div>
  );
}
