// Rekap Harian Pupuk (FR-FIN-11, S10-12) — replaces the "DATA PENGELUARAN PUPUK" sheet: per product
// the stock at the start, what left in ZAK and in KG ecer, what came in, and what is left; then the
// day-by-day matrix like the store's own sheet.
import type { ColumnDef } from '@tanstack/react-table';
import { Sprout } from 'lucide-react';
import { useMemo } from 'react';
import { dec } from '@shared/money';
import type { DailyFertilizerReport, FertilizerCell, FertilizerProduct } from '@shared/schemas/reports';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Notice } from '@/components/shared/Notice';
import { useReport } from '@/features/reports/api';
import { ReportSection } from '@/features/reports/parts';
import { useReportPeriod } from '@/features/reports/period';
import { ReportLayout } from '@/features/reports/ReportLayout';
import { formatDate, formatQty, formatStockQty } from '@/lib/format';

const right = { align: 'right' as const, className: 'whitespace-nowrap' };
const qty = (v: string, unit: string) => (dec(v).isZero() ? '—' : formatQty(v, unit));

/** Stock as people say it: "80 zak 20 kg". */
const stock = (v: string, p: FertilizerProduct) =>
  formatStockQty(v, p.baseUnit, p.bigUnit?.code ?? p.baseUnit, p.bigUnit?.conversion ?? '1').main;

/** Stock change of a cell in base units. */
const net = (c: FertilizerCell, p: FertilizerProduct) =>
  dec(c.in)
    .plus(c.other)
    .minus(c.outBase)
    .minus(dec(c.outBig).times(p.bigUnit?.conversion ?? '1'));

const summaryColumns: ColumnDef<FertilizerProduct, unknown>[] = [
  { header: 'Pupuk', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
  { header: 'Stok awal', cell: ({ row }) => stock(row.original.opening, row.original), meta: right },
  {
    header: 'Keluar (zak)',
    cell: ({ row }) => (row.original.bigUnit ? qty(row.original.totals.outBig, row.original.bigUnit.code) : '—'),
    meta: right,
  },
  { header: 'Keluar ecer', cell: ({ row }) => qty(row.original.totals.outBase, row.original.baseUnit), meta: right },
  { header: 'Masuk', cell: ({ row }) => qty(row.original.totals.in, row.original.baseUnit), meta: right },
  { header: 'Lain-lain', cell: ({ row }) => qty(row.original.totals.other, row.original.baseUnit), meta: right },
  {
    header: 'Sisa',
    cell: ({ row }) => <span className="font-semibold">{stock(row.original.closing, row.original)}</span>,
    meta: right,
  },
];

export function FertilizerReportPage() {
  const [period, setPeriod] = useReportPeriod('month');
  const report = useReport<DailyFertilizerReport>('/reports/daily-fertilizer', period);
  const d = report.data;

  // Running physical balance per product for every day of the period.
  const matrix = useMemo(() => {
    if (!d) return [];
    const balance = new Map(d.products.map((p) => [p.id, dec(p.opening)]));
    return d.days.map((day) => ({
      date: day.date,
      cells: d.products.map((p) => {
        const c = day.cells[p.id];
        if (c) balance.set(p.id, balance.get(p.id)!.plus(net(c, p)));
        return { product: p, cell: c, balance: balance.get(p.id)!.toFixed() };
      }),
    }));
  }, [d]);

  return (
    <ReportLayout
      title={`Rekap Harian ${d?.category?.name ?? 'Pupuk'}`}
      description="Keluar-masuk stok gudang per hari: dijual per zak dan per kg dipisah, pembelian masuk, dan sisa."
      period={{ value: period, onChange: setPeriod }}
      exportPath="/reports/daily-fertilizer"
      exportParams={period}
      fileName="rekap-harian-pupuk"
      landscape
    >
      {report.isError && <Notice tone="error">{report.error.message}</Notice>}
      {d && !d.category && (
        <Notice tone="warning">Belum ada kategori berawalan "PUPUK". Atur kategori barang di menu Data Lain.</Notice>
      )}
      <DataTable
        columns={summaryColumns}
        data={d?.products ?? []}
        getRowId={(r) => r.id}
        isLoading={report.isFetching}
        empty={<EmptyState icon={Sprout} title="Tidak ada barang di kategori ini" />}
      />
      {d && d.products.length > 0 && (
        <ReportSection title="Per hari">
          <div className="overflow-x-auto rounded-xl border print:overflow-visible">
            <table className="w-full text-sm tabular-nums">
              <thead className="bg-surface-muted text-muted-foreground">
                <tr>
                  <th className="sticky left-0 bg-surface-muted px-3 py-2 text-left font-medium">Tanggal</th>
                  {d.products.map((p) => (
                    <th key={p.id} className="min-w-36 px-3 py-2 text-right font-medium">
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {matrix.map((row) => (
                  <tr key={row.date}>
                    <td className="sticky left-0 bg-background px-3 py-2 whitespace-nowrap">{formatDate(row.date)}</td>
                    {row.cells.map(({ product: p, cell, balance }) => (
                      <td key={p.id} className="px-3 py-2 text-right align-top">
                        {cell && p.bigUnit && !dec(cell.outBig).isZero() && (
                          <p>{formatQty(cell.outBig, p.bigUnit.code)}</p>
                        )}
                        {cell && !dec(cell.outBase).isZero() && <p>{formatQty(cell.outBase, p.baseUnit)}</p>}
                        {cell && !dec(cell.in).isZero() && (
                          <p className="text-success-ink">+{formatQty(cell.in, p.baseUnit)}</p>
                        )}
                        <p className="text-muted-foreground text-xs">sisa {stock(balance, p)}</p>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-muted-foreground text-sm">
            Sisa = stok fisik di gudang; barang terjual yang belum diambil pelanggan masih dihitung di gudang.
          </p>
        </ReportSection>
      )}
    </ReportLayout>
  );
}
