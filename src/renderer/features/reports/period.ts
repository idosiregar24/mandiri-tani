// Report periods (sprint-10 S10-2): WIB business dates YYYY-MM-DD, from/to inclusive. Pure calendar
// arithmetic on the date strings — no time zone can shift them.
import { useState } from 'react';
import type { ReportPeriod } from '@shared/schemas/reports';
import { todayJakarta } from '@/features/pos/api';
import { formatDate } from '@/lib/format';

export const QUICK_PERIODS = [
  { value: 'today', label: 'Hari ini' },
  { value: 'month', label: 'Bulan ini' },
  { value: 'lastMonth', label: 'Bulan lalu' },
  { value: 'year', label: 'Tahun ini' },
  { value: 'custom', label: 'Pilih tanggal' },
] as const;
export type QuickPeriod = (typeof QUICK_PERIODS)[number]['value'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Last day of a month: lastDay(2026, 2) → 28. */
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

export function quickPeriod(kind: Exclude<QuickPeriod, 'custom'>, today: string): ReportPeriod {
  const [y, m] = today.split('-').map(Number) as [number, number];
  switch (kind) {
    case 'today':
      return { from: today, to: today };
    case 'month':
      return { from: `${y}-${pad(m)}-01`, to: today };
    case 'lastMonth': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(lastDay(py, pm))}` };
    }
    case 'year':
      return { from: `${y}-01-01`, to: today };
  }
}

/** Which quick choice a period matches (else "custom"). */
export function matchQuick(p: ReportPeriod, today: string): QuickPeriod {
  for (const q of QUICK_PERIODS) {
    if (q.value === 'custom') continue;
    const x = quickPeriod(q.value, today);
    if (x.from === p.from && x.to === p.to) return q.value;
  }
  return 'custom';
}

/** "24 Okt 2026" or "1 Okt 2026 – 31 Okt 2026". */
export function periodText(p: ReportPeriod): string {
  return p.from === p.to ? formatDate(p.from) : `${formatDate(p.from)} – ${formatDate(p.to)}`;
}

/** For file names: "2026-10-24" or "2026-10-01_2026-10-31". */
export function periodSlug(p: ReportPeriod): string {
  return p.from === p.to ? p.from : `${p.from}_${p.to}`;
}

/** Period state for a report page, starting at "Bulan ini". */
export function useReportPeriod(initial: Exclude<QuickPeriod, 'custom'> = 'month') {
  return useState<ReportPeriod>(() => quickPeriod(initial, todayJakarta()));
}

/** Long reports show the first rows on screen until "Tampilkan semua" (thousands of DOM rows are slow). */
export function useRowLimit<T>(rows: T[], limit = 500) {
  const [all, setAll] = useState(false);
  return { rows: all ? rows : rows.slice(0, limit), total: rows.length, showAll: () => setAll(true) };
}
