// Arus Kas (FR-FIN-03, S10-8): per account opening balance, in & out per category, closing balance.
import type { CashflowAccount, CashflowReport } from '@shared/schemas/reports';
import { BarChart } from '@/components/shared/charts';
import { Notice } from '@/components/shared/Notice';
import { useReport } from '@/features/reports/api';
import { Totals } from '@/features/reports/parts';
import { useReportPeriod } from '@/features/reports/period';
import { ReportLayout } from '@/features/reports/ReportLayout';
import { formatRupiah } from '@/lib/format';
import { cn } from '@/lib/utils';

const KIND = { DRAWER: 'Laci kasir', CASH: 'Kas', BANK: 'Rekening bank' } as const;

function Row({ label, value, tone, strong }: { label: string; value: string; tone?: 'in' | 'out'; strong?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-4 px-4 py-2.5', strong && 'bg-surface-muted font-semibold')}>
      <span className={cn(!strong && 'pl-3')}>{label}</span>
      <span className={cn('tabular-nums', tone === 'out' && 'text-error-ink', tone === 'in' && 'text-success-ink')}>
        {tone === 'out' ? `− ${formatRupiah(value)}` : tone === 'in' ? `+ ${formatRupiah(value)}` : formatRupiah(value)}
      </span>
    </div>
  );
}

function AccountCard({ a }: { a: CashflowAccount }) {
  return (
    <section className="divide-y rounded-xl border text-base print:break-inside-avoid">
      <div className="flex items-baseline justify-between px-4 py-3">
        <h2 className="text-lg font-semibold">{a.name}</h2>
        <span className="text-muted-foreground text-sm">{KIND[a.kind]}</span>
      </div>
      <Row label="Saldo awal" value={a.opening} strong />
      {a.in.map((l) => (
        <Row key={`in-${l.code}`} label={l.name} value={l.amount} tone="in" />
      ))}
      {a.out.map((l) => (
        <Row key={`out-${l.code}`} label={l.name} value={l.amount} tone="out" />
      ))}
      {a.in.length === 0 && a.out.length === 0 && (
        <p className="text-muted-foreground px-7 py-2.5">Tidak ada uang masuk atau keluar.</p>
      )}
      <Row label="Saldo akhir" value={a.closing} strong />
    </section>
  );
}

export function CashflowReportPage() {
  const [period, setPeriod] = useReportPeriod('month');
  const report = useReport<CashflowReport>('/reports/cashflow', period);
  const d = report.data;
  return (
    <ReportLayout
      title="Arus Kas"
      description="Uang masuk dan keluar per akun kas, dari Buku Kas."
      period={{ value: period, onChange: setPeriod }}
      exportPath="/reports/cashflow"
      exportParams={period}
      fileName="arus-kas"
    >
      {report.isError && <Notice tone="error">{report.error.message}</Notice>}
      {d?.beforeGoLive && (
        <Notice tone="warning">
          Periode ini sebelum toko memakai aplikasi ini. Yang tercatat hanya kas keluar (biaya) dari iPOS — uang masuk
          penjualan iPOS tidak ikut diimpor, jadi saldo di sini belum menggambarkan uang sebenarnya.
        </Notice>
      )}
      {d && (
        <>
          {d.accounts.length > 0 && !report.isFetching && (
            <div className="print:hidden">
              <BarChart
                title="Perbandingan Uang Masuk vs Uang Keluar per Akun Kas"
                primaryLabel="Uang Masuk"
                secondaryLabel="Uang Keluar"
                primaryColor="#2e7d32"
                secondaryColor="#c62828"
                stacked={false}
                data={d.accounts.map((a) => ({
                  label: a.name,
                  value: a.in.reduce((sum, item) => sum + Number(item.amount), 0),
                  secondary: a.out.reduce((sum, item) => sum + Number(item.amount), 0),
                }))}
              />
            </div>
          )}
          <Totals
            items={[
              { label: 'Saldo awal semua akun', value: formatRupiah(d.totals.opening) },
              { label: 'Uang masuk', value: formatRupiah(d.totals.totalIn), tone: 'success' },
              { label: 'Uang keluar', value: formatRupiah(d.totals.totalOut), tone: 'error' },
              { label: 'Saldo akhir', value: formatRupiah(d.totals.closing) },
            ]}
          />
          <div className="grid gap-4 xl:grid-cols-2 print:grid-cols-1">
            {d.accounts.map((a) => (
              <AccountCard key={a.id} a={a} />
            ))}
          </div>
        </>
      )}
    </ReportLayout>
  );
}
