// Sales recap like iPOS "Penjualan Rekap" + groupings by day / customer / category / payment method
// (FR-FIN-07, FR-FIN-12). A cashier only gets their own sales of today (S10-6). No cost fields here.
import { hasPermission } from '@shared/permissions';
import {
  SalesReportQuery,
  type SalesGroupRow,
  type SalesRecapRow,
  type SalesReport,
  type SalesTotals,
} from '@shared/schemas/reports';
import type { Pool, Queryable } from '../../db/pool';
import type { XlsxReport } from '../../lib/xlsx';
import type { RequestCtx } from '../../middleware/auth';
import { today } from '../ar-ap/service';
import { COUNTED_SALE, idDate, inPeriod, periodLabel, wibDate, withReport } from './common';

/** $1 from, $2 to, $3 channel, $4 customer, $5 cashier. */
const FILTER = `${COUNTED_SALE} AND ${inPeriod('s.trx_at', '$1', '$2')}
  AND ($3::text IS NULL OR s.channel = $3) AND ($4::uuid IS NULL OR s.customer_id = $4)
  AND ($5::uuid IS NULL OR s.cashier_id = $5)`;

async function invoices(db: Queryable, params: unknown[]): Promise<SalesRecapRow[]> {
  const r = await db.query<SalesRecapRow>(
    `SELECT s.id, s.number, s.trx_at AS "trxAt", s.channel,
            json_build_object('code', c.code, 'name', c.name) AS customer,
            trim_scale((SELECT sum(i.qty) FROM sale_items i WHERE i.sale_id = s.id))::text AS "itemCount",
            s.subtotal::text, s.discount_amount::text AS discount, s.tax_amount::text AS tax,
            s.other_charges::text AS "otherCharges", s.total::text,
            (s.paid_amount - s.change_amount)::text AS "paidCash", s.credit_amount::text AS "paidCredit",
            s.source = 'IPOS_IMPORT' AS imported
     FROM sales s JOIN customers c ON c.id = s.customer_id
     WHERE ${FILTER}
     ORDER BY s.trx_at, s.number`,
    params,
  );
  return r.rows;
}

async function totals(db: Queryable, params: unknown[]): Promise<SalesTotals> {
  const r = await db.query<SalesTotals>(
    `SELECT count(*)::int AS count, coalesce(sum(s.subtotal), 0)::text AS subtotal,
            coalesce(sum(s.discount_amount), 0)::text AS discount, coalesce(sum(s.tax_amount), 0)::text AS tax,
            coalesce(sum(s.other_charges), 0)::text AS "otherCharges", coalesce(sum(s.total), 0)::text AS total,
            coalesce(sum(s.paid_amount - s.change_amount), 0)::text AS "paidCash",
            coalesce(sum(s.credit_amount), 0)::text AS "paidCredit"
     FROM sales s WHERE ${FILTER}`,
    params,
  );
  return r.rows[0]!;
}

async function groups(db: Queryable, groupBy: SalesReport['groupBy'], params: unknown[]): Promise<SalesGroupRow[]> {
  const money = `sum(s.total)::text AS amount, sum(s.paid_amount - s.change_amount)::text AS "paidCash",
                 sum(s.credit_amount)::text AS "paidCredit"`;
  let sql: string;
  switch (groupBy) {
    case 'day':
      sql = `SELECT ${wibDate('s.trx_at')}::text AS key, ${wibDate('s.trx_at')}::text AS label,
                    count(*)::int AS count, ${money}
             FROM sales s WHERE ${FILTER} GROUP BY 1 ORDER BY 1`;
      break;
    case 'customer':
      sql = `SELECT c.id::text AS key, c.name AS label, count(*)::int AS count, ${money}
             FROM sales s JOIN customers c ON c.id = s.customer_id WHERE ${FILTER}
             GROUP BY c.id ORDER BY sum(s.total) DESC, c.name`;
      break;
    case 'category':
      sql = `SELECT coalesce(cat.id::text, '-') AS key, coalesce(cat.name, 'Tanpa kategori') AS label,
                    count(DISTINCT s.id)::int AS count, sum(i.net_amount)::text AS amount
             FROM sales s JOIN sale_items i ON i.sale_id = s.id JOIN products p ON p.id = i.product_id
             LEFT JOIN categories cat ON cat.id = p.category_id
             WHERE ${FILTER} GROUP BY cat.id, cat.name ORDER BY sum(i.net_amount) DESC`;
      break;
    case 'payment_method':
      // Cash change is given back from the cash payment; credit comes from the sale's credit part.
      sql = `WITH f AS (SELECT s.* FROM sales s WHERE ${FILTER}),
             m AS (
               SELECT pm.id::text AS key, pm.name AS label, count(DISTINCT sp.sale_id)::int AS count,
                      sum(sp.amount) - CASE WHEN pm.kind = 'CASH'
                        THEN (SELECT coalesce(sum(change_amount), 0) FROM f) ELSE 0 END AS amount
               FROM sale_payments sp JOIN f ON f.id = sp.sale_id JOIN payment_methods pm ON pm.id = sp.payment_method_id
               WHERE pm.kind <> 'CREDIT' GROUP BY pm.id, pm.name, pm.kind
               UNION ALL
               SELECT 'CREDIT', 'Piutang (kredit)', count(*)::int, sum(credit_amount) FROM f
               WHERE credit_amount > 0 HAVING count(*) > 0)
             SELECT key, label, count, amount::text AS amount FROM m ORDER BY m.amount DESC`;
      break;
    default:
      return [];
  }
  const r = await db.query<SalesGroupRow>(sql, params);
  return groupBy === 'day' ? r.rows.map((g) => ({ ...g, label: idDate(g.label) })) : r.rows;
}

export async function salesReport(pool: Pool, ctx: RequestCtx, raw: unknown): Promise<SalesReport> {
  const ownOnly = !hasPermission(ctx.role, 'reports.all');
  const q = SalesReportQuery.parse(ownOnly ? { ...(raw as object), from: today(), to: today() } : raw);
  const period = { from: q.from, to: q.to };
  const params = [q.from, q.to, q.channel ?? null, q.customerId ?? null, ownOnly ? ctx.userId : null];
  return withReport(pool, async (db) => {
    const ret = await db.query<{ count: number; amount: string }>(
      `SELECT count(*)::int AS count, coalesce(sum(r.total), 0)::text AS amount
       FROM sale_returns r JOIN sales s ON s.id = r.sale_id
       WHERE ${inPeriod('r.trx_at', '$1', '$2')} AND ($3::text IS NULL OR s.channel = $3)
         AND ($4::uuid IS NULL OR r.customer_id = $4) AND ($5::uuid IS NULL OR r.created_by = $5)`,
      params,
    );
    return {
      period,
      groupBy: q.groupBy,
      ownOnly,
      invoices: q.groupBy === 'invoice' ? await invoices(db, params) : [],
      groups: q.groupBy === 'invoice' ? [] : await groups(db, q.groupBy, params),
      totals: await totals(db, params),
      returns: ret.rows[0]!,
    };
  });
}

const GROUP_TITLE: Record<SalesReport['groupBy'], string> = {
  invoice: 'Penjualan Rekap',
  day: 'Penjualan per Hari',
  customer: 'Penjualan per Pelanggan',
  category: 'Penjualan per Kategori',
  payment_method: 'Penjualan per Cara Bayar',
};

const wibIso = (d: string | Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(typeof d === 'string' ? new Date(d) : d);

export function salesXlsx(r: SalesReport): XlsxReport {
  const notes = [`Retur penjualan pada periode ini: ${r.returns.count} nota, Rp ${r.returns.amount}`];
  if (r.groupBy === 'invoice') {
    return {
      title: GROUP_TITLE.invoice,
      subtitle: periodLabel(r.period),
      columns: [
        { key: 'number', header: 'No Transaksi', width: 22 },
        { key: 'date', header: 'Tanggal', type: 'date' },
        { key: 'code', header: 'Kode Pel.', width: 12 },
        { key: 'customer', header: 'Pelanggan', width: 28 },
        { key: 'itemCount', header: 'Jml Item', type: 'qty' },
        { key: 'subtotal', header: 'Sub Total', type: 'money' },
        { key: 'discount', header: 'Pot.', type: 'money' },
        { key: 'tax', header: 'Pajak', type: 'money' },
        { key: 'otherCharges', header: 'Biaya Lain', type: 'money' },
        { key: 'total', header: 'Total Akhir', type: 'money' },
        { key: 'paidCash', header: 'Bayar Tunai', type: 'money' },
        { key: 'paidCredit', header: 'Bayar Kredit', type: 'money' },
      ],
      rows: r.invoices.map((i) => ({
        ...i,
        date: wibIso(i.trxAt),
        code: i.customer.code,
        customer: i.customer.name,
      })),
      totals: { number: `Total (${r.totals.count} nota)`, ...r.totals },
      notes,
    };
  }
  const withCash = r.groupBy === 'day' || r.groupBy === 'customer';
  return {
    title: GROUP_TITLE[r.groupBy],
    subtitle: periodLabel(r.period),
    columns: [
      {
        key: 'label',
        header:
          r.groupBy === 'day'
            ? 'Tanggal'
            : r.groupBy === 'customer'
              ? 'Pelanggan'
              : r.groupBy === 'category'
                ? 'Kategori'
                : 'Cara Bayar',
        width: 30,
      },
      { key: 'count', header: 'Jumlah Nota', type: 'int' },
      { key: 'amount', header: r.groupBy === 'category' ? 'Penjualan Bersih' : 'Jumlah', type: 'money' },
      ...(withCash
        ? [
            { key: 'paidCash', header: 'Bayar Tunai', type: 'money' as const },
            { key: 'paidCredit', header: 'Bayar Kredit', type: 'money' as const },
          ]
        : []),
    ],
    rows: r.groups.map((g) => ({ ...g })),
    totals: withCash
      ? {
          label: 'Total',
          count: r.totals.count,
          amount: r.totals.total,
          paidCash: r.totals.paidCash,
          paidCredit: r.totals.paidCredit,
        }
      : undefined,
    notes,
  };
}
