// Shared plumbing for the reports module (sprint-10 S10-1, S10-2, S10-9).
import type { Request, Response } from 'express';
import { dec } from '@shared/money';
import { ReportFormat, type ReportPeriod } from '@shared/schemas/reports';
import type { Pool, Queryable } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { buildReportXlsx, type XlsxReport } from '../../lib/xlsx';

/** Read-only transaction with the longer report timeout (database-standards §1). */
export function withReport<T>(pool: Pool, fn: (db: Queryable) => Promise<T>): Promise<T> {
  return withTransaction(pool, async (tx) => {
    await tx.query('SET TRANSACTION READ ONLY');
    await tx.query("SET LOCAL statement_timeout = '60s'");
    return fn(tx);
  });
}

/**
 * `col` falls on the WIB business dates $a…$b (inclusive). Written as a timestamptz range so the
 * planner can use the index on the column.
 */
export const inPeriod = (col: string, a: string, b: string) =>
  `${col} >= (${a}::date::timestamp AT TIME ZONE 'Asia/Jakarta') AND ${col} < ((${b}::date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta')`;

/** WIB business date of a timestamptz column. */
export const wibDate = (col: string) => `(${col} AT TIME ZONE 'Asia/Jakarta')::date`;

/**
 * Sales that count as turnover (S10-3): completed, and not the go-live "not yet picked up"
 * opening notes whose turnover was already booked in iPOS.
 */
export const COUNTED_SALE = `s.status = 'COMPLETED' AND s.source <> 'OPENING_PICKUP'`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** "2026-10-24" → "24 Okt 2026". */
export function idDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

export function periodLabel(p: ReportPeriod): string {
  return p.from === p.to ? `Tanggal ${idDate(p.from)}` : `Periode ${idDate(p.from)} – ${idDate(p.to)}`;
}

/** Margin in percent with one decimal ("12.5"), null when there is nothing to divide by. */
export function marginPct(profit: string, sales: string): string | null {
  const s = dec(sales);
  return s.isZero() ? null : dec(profit).div(s).times(100).toFixed(1);
}

/** JSON `{ data }`, or the same report as an .xlsx download when ?format=xlsx. */
export async function sendReport<T>(
  req: Request,
  res: Response,
  report: T,
  toXlsx: (report: T) => XlsxReport,
  fileName: string,
): Promise<void> {
  const format = ReportFormat.parse(req.query.format ?? undefined);
  if (format === 'json') {
    res.json({ data: report });
    return;
  }
  const buf = await buildReportXlsx(toXlsx(report));
  res
    .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .set('Content-Disposition', `attachment; filename="${fileName}.xlsx"`)
    .send(buf);
}
