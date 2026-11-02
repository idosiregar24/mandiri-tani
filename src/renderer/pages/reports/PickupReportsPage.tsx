// Barang belum diambil (FR-PKP-13 — replaces the "DAFTAR PUPUK" sheet) and the pickup history AB
// (FR-PKP-08). The waiting list is "as of today"; the history has a period.
import type { ColumnDef } from '@tanstack/react-table';
import { PackageCheck } from 'lucide-react';
import { useState } from 'react';
import type { PickupReportRow, PickupsReport, UndeliveredReport, UndeliveredRow } from '@shared/schemas/reports';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Notice } from '@/components/shared/Notice';
import { SegmentedControl } from '@/components/shared/SegmentedControl';
import { StatusPill } from '@/components/shared/StatusPill';
import { useReport } from '@/features/reports/api';
import { RowLimitNotice, Totals } from '@/features/reports/parts';
import { useReportPeriod, useRowLimit } from '@/features/reports/period';
import { ReportLayout } from '@/features/reports/ReportLayout';
import { formatDate, formatDateTime, formatNumber, formatQty, formatRupiah } from '@/lib/format';

const VIEWS = [
  { value: 'customer', label: 'Belum diambil · per pelanggan' },
  { value: 'product', label: 'Belum diambil · per barang' },
  { value: 'history', label: 'Riwayat pengambilan' },
] as const;
type View = (typeof VIEWS)[number]['value'];
const AGING_DAYS = 30;
const right = { align: 'right' as const, className: 'whitespace-nowrap' };

const waitingColumns = (byCustomer: boolean): ColumnDef<UndeliveredRow, unknown>[] => [
  {
    header: byCustomer ? 'Pelanggan' : 'Barang',
    cell: ({ row }) => (
      <div>
        <p className="font-medium">{row.original.label}</p>
        {byCustomer && row.original.detail && <p className="text-muted-foreground text-sm">{row.original.detail}</p>}
      </div>
    ),
  },
  { header: 'Nota', cell: ({ row }) => formatNumber(String(row.original.sales)), meta: right },
  ...(byCustomer
    ? []
    : ([
        {
          header: 'Belum diambil',
          cell: ({ row }) => formatQty(row.original.qty, row.original.detail ?? undefined),
          meta: right,
        },
      ] satisfies ColumnDef<UndeliveredRow, unknown>[])),
  { header: 'Nilai', cell: ({ row }) => formatRupiah(row.original.value), meta: right },
  { header: 'Nota tertua', cell: ({ row }) => formatDate(row.original.oldestDate), meta: right },
  {
    header: 'Umur',
    cell: ({ row }) => (
      <StatusPill tone={row.original.ageDays > AGING_DAYS ? 'warning' : 'neutral'}>
        {formatNumber(String(row.original.ageDays))} hari
      </StatusPill>
    ),
    meta: right,
  },
  {
    header: 'Lewat janji ambil',
    cell: ({ row }) =>
      row.original.overdueSales ? (
        <StatusPill tone="error">{formatNumber(String(row.original.overdueSales))} nota</StatusPill>
      ) : (
        '—'
      ),
    meta: right,
  },
];

const historyColumns: ColumnDef<PickupReportRow, unknown>[] = [
  {
    header: 'Bukti',
    cell: ({ row }) => (
      <div>
        <p className="font-medium whitespace-nowrap">{row.original.number}</p>
        <p className="text-muted-foreground text-sm">{formatDateTime(row.original.pickedUpAt)}</p>
      </div>
    ),
  },
  { header: 'Pelanggan', cell: ({ row }) => row.original.customer.name },
  {
    header: 'Penerima',
    cell: ({ row }) => `${row.original.receiverName}${row.original.method === 'DELIVERY' ? ' (diantar)' : ''}`,
  },
  {
    header: 'Barang',
    cell: ({ row }) => (
      <ul className="text-sm">
        {row.original.lines.map((l, i) => (
          <li key={i}>
            {l.productName} — {formatQty(l.qty, l.unitCode)}{' '}
            <span className="text-muted-foreground">({l.saleNumber})</span>
          </li>
        ))}
      </ul>
    ),
    meta: { className: 'min-w-64' },
  },
  {
    header: 'Status',
    cell: ({ row }) =>
      row.original.status === 'CANCELLED' ? (
        <StatusPill tone="error">Dibatalkan</StatusPill>
      ) : (
        <StatusPill tone="success">Selesai</StatusPill>
      ),
  },
];

export function PickupReportsPage() {
  const [view, setView] = useState<View>('customer');
  const [period, setPeriod] = useReportPeriod('month');
  const isHistory = view === 'history';
  const waitingParams = { groupBy: isHistory ? 'customer' : view, agingDays: AGING_DAYS };
  const waiting = useReport<UndeliveredReport>('/reports/undelivered', waitingParams, !isHistory);
  const history = useReport<PickupsReport>('/reports/pickups', period, isHistory);
  const rows = useRowLimit(history.data?.rows ?? []);
  const error = (isHistory ? history : waiting).error;

  return (
    <ReportLayout
      title={isHistory ? 'Riwayat Pengambilan Barang' : 'Barang Belum Diambil'}
      description={
        isHistory
          ? 'Setiap bukti pengambilan (AB), termasuk yang dibatalkan.'
          : 'Barang yang sudah dibayar pelanggan tapi masih di gudang — pengganti catatan DAFTAR PUPUK.'
      }
      period={isHistory ? { value: period, onChange: setPeriod } : undefined}
      filters={<SegmentedControl label="Tampilan" value={view} onChange={setView} options={VIEWS} />}
      exportPath={isHistory ? '/reports/pickups' : '/reports/undelivered'}
      exportParams={isHistory ? period : waitingParams}
      fileName={isHistory ? 'riwayat-pengambilan' : 'barang-belum-diambil'}
      landscape={isHistory}
    >
      {error && <Notice tone="error">{error.message}</Notice>}
      {isHistory ? (
        <>
          <DataTable
            columns={historyColumns}
            data={rows.rows}
            getRowId={(r) => r.id}
            isLoading={history.isFetching}
            isRowMuted={(r) => r.status === 'CANCELLED'}
            empty={<EmptyState icon={PackageCheck} title="Belum ada pengambilan pada periode ini" />}
          />
          <RowLimitNotice shown={rows.rows.length} total={rows.total} onShowAll={rows.showAll} />
        </>
      ) : (
        <>
          {waiting.data && (
            <Totals
              items={[
                { label: 'Nota menunggu diambil', value: formatNumber(String(waiting.data.totals.sales)) },
                { label: 'Nilai barang', value: formatRupiah(waiting.data.totals.value) },
                {
                  label: `Lebih dari ${AGING_DAYS} hari`,
                  value: `${formatNumber(String(waiting.data.totals.olderThanAging))} nota`,
                  tone: waiting.data.totals.olderThanAging ? 'error' : undefined,
                },
                {
                  label: 'Lewat janji ambil',
                  value: `${formatNumber(String(waiting.data.totals.overdueSales))} nota`,
                  tone: waiting.data.totals.overdueSales ? 'error' : undefined,
                },
              ]}
            />
          )}
          <DataTable
            columns={waitingColumns(view === 'customer')}
            data={waiting.data?.rows ?? []}
            getRowId={(r) => r.key}
            isLoading={waiting.isFetching}
            empty={<EmptyState icon={PackageCheck} title="Semua barang yang terjual sudah diambil" />}
          />
        </>
      )}
    </ReportLayout>
  );
}
