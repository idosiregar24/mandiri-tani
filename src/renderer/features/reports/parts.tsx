// Small presentational pieces shared by the report pages.
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The totals strip under a report table ("Total 412 nota · Rp 1.250.000.000"). */
export function Totals({
  items,
  className,
}: {
  items: { label: string; value: ReactNode; tone?: 'error' | 'success' }[];
  className?: string;
}) {
  return (
    <dl
      className={cn(
        'bg-surface-muted grid gap-x-8 gap-y-3 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-4 print:border-0 print:bg-transparent',
        className,
      )}
    >
      {items.map((i) => (
        <div key={i.label}>
          <dt className="text-muted-foreground text-sm">{i.label}</dt>
          <dd
            className={cn(
              'text-lg font-semibold tabular-nums',
              i.tone === 'error' && 'text-error-ink',
              i.tone === 'success' && 'text-success-ink',
            )}
          >
            {i.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Shown when a long report is cut on screen (Excel and print still have every row). */
export function RowLimitNotice({ shown, total, onShowAll }: { shown: number; total: number; onShowAll: () => void }) {
  if (shown >= total) return null;
  return (
    <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-base print:hidden">
      <span>
        Menampilkan {formatNumber(String(shown))} dari {formatNumber(String(total))} baris. File Excel selalu berisi
        semua baris.
      </span>
      <Button variant="outline" className="h-11" onClick={onShowAll}>
        Tampilkan semua
      </Button>
    </div>
  );
}

/** A labelled block inside a report page (e.g. "Biaya operasional"). */
export function ReportSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 print:break-inside-avoid">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
