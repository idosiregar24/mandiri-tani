// Home dashboard (FR-FIN-09, FR-PKP-12, sprint-10 S10-13). Owner: turnover & gross profit today /
// month vs the previous period, top products, low stock, receivables due, goods waiting for pickup.
// Cashier: their own sales only, without profit.
import { hasPermission } from '@shared/permissions';
import type { DashboardFigure, DashboardReport } from '@shared/schemas/reports';
import type { Pool, Queryable } from '../../db/pool';
import type { RequestCtx } from '../../middleware/auth';
import { today } from '../ar-ap/service';
import { defaultWarehouse, stockSummary } from '../stock/read-repo';
import { COUNTED_SALE, inPeriod, withReport } from './common';
import { undelivered } from './pickups';
import { profitLoss } from './profit';

/** YYYY-MM-DD ± days (pure calendar arithmetic). */
const shift = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Same day-of-month one month earlier, clamped to that month's length (31 Mar → 28/29 Feb). */
function monthBefore(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  return `${py}-${String(pm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

async function turnover(db: Queryable, from: string, to: string, cashierId: string | null): Promise<DashboardFigure> {
  const r = await db.query<{ sales: string; invoices: number }>(
    `SELECT coalesce(sum(s.total), 0)::text AS sales, count(*)::int AS invoices FROM sales s
     WHERE ${COUNTED_SALE} AND ${inPeriod('s.trx_at', '$1', '$2')} AND ($3::uuid IS NULL OR s.cashier_id = $3)`,
    [from, to, cashierId],
  );
  return r.rows[0]!;
}

export async function dashboard(pool: Pool, ctx: RequestCtx): Promise<DashboardReport> {
  const ownOnly = !hasPermission(ctx.role, 'reports.profit');
  const cashier = ownOnly ? ctx.userId : null;
  const day = today();
  const prevDay = monthBefore(day);
  const periods = {
    today: [day, day],
    yesterday: [shift(day, -1), shift(day, -1)],
    month: [`${day.slice(0, 8)}01`, day],
    lastMonth: [`${prevDay.slice(0, 8)}01`, prevDay],
  } as const;
  type Key = keyof typeof periods;
  const keys = Object.keys(periods) as Key[];

  const figures = await withReport(pool, async (db) => {
    const out = {} as Record<Key, DashboardFigure>;
    for (const k of keys) out[k] = await turnover(db, periods[k][0], periods[k][1], cashier);
    return out;
  });
  if (ownOnly) return { ownOnly, ...figures };
  for (const k of keys) {
    const [from, to] = periods[k];
    figures[k].profit = (await profitLoss(pool, { from, to })).grossProfit;
  }
  const base = figures;

  const extra = await withReport(pool, async (db) => {
    const top = await db.query<NonNullable<DashboardReport['topProducts']>[number]>(
      `SELECT p.id AS "productId", p.name, trim_scale(sum(i.base_qty))::text AS qty, u.code AS "baseUnit",
              sum(i.net_amount)::text AS sales
       FROM sales s JOIN sale_items i ON i.sale_id = s.id JOIN products p ON p.id = i.product_id
       JOIN units u ON u.id = p.base_unit_id
       WHERE ${COUNTED_SALE} AND ${inPeriod('s.trx_at', '$1', '$2')}
       GROUP BY p.id, p.name, u.code ORDER BY sum(i.net_amount) DESC LIMIT 10`,
      [shift(day, -29), day],
    );
    const rec = await db.query<NonNullable<DashboardReport['receivables']>>(
      `SELECT count(*) FILTER (WHERE due_date < $1::date)::int AS "overdueCount",
              coalesce(sum(amount - paid_amount) FILTER (WHERE due_date < $1::date), 0)::text AS "overdueAmount",
              count(*) FILTER (WHERE due_date BETWEEN $1::date AND $1::date + 7)::int AS "dueSoonCount"
       FROM receivables WHERE status IN ('OPEN','PARTIAL')`,
      [day],
    );
    const wh = await defaultWarehouse(db);
    const trend = await db.query<{ date: string; label: string; sales: string; count: number }>(
      `SELECT to_char(s.trx_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS date,
              to_char(s.trx_at AT TIME ZONE 'Asia/Jakarta', 'DD/MM') AS label,
              coalesce(sum(s.total), 0)::text AS sales,
              count(*)::int AS count
       FROM sales s
       WHERE ${COUNTED_SALE} AND ${inPeriod('s.trx_at', '$1', '$2')}
       GROUP BY 1, 2 ORDER BY 1`,
      [shift(day, -13), day],
    );
    const payments = await db.query<{ id: string; name: string; amount: string }>(
      `SELECT m.id, m.name, coalesce(sum(p.amount), 0)::text AS amount
       FROM sale_payments p
       JOIN payment_methods m ON m.id = p.payment_method_id
       JOIN sales s ON s.id = p.sale_id
       WHERE ${COUNTED_SALE} AND ${inPeriod('s.trx_at', '$1', '$2')}
       GROUP BY m.id, m.name ORDER BY sum(p.amount) DESC`,
      [periods.month[0], periods.month[1]],
    );
    return {
      topProducts: top.rows,
      receivables: rec.rows[0]!,
      lowStock: (await stockSummary(db, wh.id)).low,
      dailyTrend: trend.rows,
      paymentBreakdown: payments.rows,
    };
  });
  const waiting = await undelivered(pool, { groupBy: 'customer', agingDays: 30 });
  return {
    ownOnly,
    ...base,
    ...extra,
    undelivered: {
      customers: waiting.rows.length,
      value: waiting.totals.value,
      overduePromises: waiting.totals.overdueSales,
      olderThan30: waiting.totals.olderThanAging,
    },
  };
}
