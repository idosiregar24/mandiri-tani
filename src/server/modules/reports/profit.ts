// Gross profit per product / per sale / per period (FR-FIN-04/05/06, sprint-10 S10-4, S10-5).
//
// HPP of a sale line = cost of what already left the warehouse (sale_items.cost_total, FIFO) +
// the CURRENT FIFO cost of what the customer has not picked up yet (estimate, flagged). A line
// without HPP (iPOS history DQ-3: cost_total NULL although the goods left) is "unknown": its sales
// are shown but never counted as profit. Returns reduce sales by their amount and HPP by the cost
// of what went back into stock (SALE_RETURN movements); goods returned damaged stay a cost.
import { dec, Decimal, toMoney } from '@shared/money';
import {
  ProfitByInvoiceQuery,
  ProfitByItemQuery,
  ReportPeriod,
  type ProfitByInvoiceReport,
  type ProfitByItemReport,
  type ProfitInvoiceRow,
  type ProfitLossReport,
  type ProfitTotals,
} from '@shared/schemas/reports';
import type { Pool } from '../../db/pool';
import type { XlsxReport } from '../../lib/xlsx';
import { COUNTED_SALE, inPeriod, marginPct, periodLabel, withReport } from './common';

/** Current FIFO cost per base unit of what is left in stock. */
const CUR_COST = `cur_cost AS (
  SELECT product_id, sum(qty_remaining * unit_cost) / nullif(sum(qty_remaining), 0) AS cost
  FROM stock_cost_layers WHERE qty_remaining > 0 GROUP BY product_id)`;

/** Lines of counted sales whose date is in $1…$2 (+ an extra condition). */
const saleLines = (extra = '') => `sale_lines AS (
  SELECT s.id AS sale_id, i.product_id, i.base_qty, i.net_amount,
         CASE WHEN NOT p.track_stock THEN coalesce(i.cost_total, 0)
              WHEN i.cost_total IS NULL AND i.picked_up_qty > 0 THEN NULL
              ELSE coalesce(i.cost_total, 0)
                   + (i.qty - i.picked_up_qty - i.cancelled_qty) * i.conversion_qty
                     * coalesce(cc.cost, p.last_purchase_cost, 0)
         END AS cost,
         (p.track_stock AND i.qty - i.picked_up_qty - i.cancelled_qty > 0) AS estimated
  FROM sales s JOIN sale_items i ON i.sale_id = s.id JOIN products p ON p.id = i.product_id
  LEFT JOIN cur_cost cc ON cc.product_id = i.product_id
  WHERE ${COUNTED_SALE} AND ${inPeriod('s.trx_at', '$1', '$2')} ${extra})`;

/** Return lines matching `where` (r = sale_returns, s = the original sale). */
const returnLines = (where: string) => `return_lines AS (
  SELECT r.sale_id, si.product_id, ri.base_qty, ri.amount,
         coalesce((SELECT sum(m.qty * m.unit_cost) FROM stock_movements m
                   WHERE m.source_type = 'SALE_RETURN' AND m.source_id = r.id AND m.source_line_id = ri.id), 0)
           AS cost_back,
         (p.track_stock AND si.cost_total IS NULL AND si.picked_up_qty > 0) AS unknown
  FROM sale_returns r JOIN sale_return_items ri ON ri.return_id = r.id
  JOIN sale_items si ON si.id = ri.sale_item_id JOIN products p ON p.id = si.product_id
  JOIN sales s ON s.id = r.sale_id
  WHERE s.source <> 'OPENING_PICKUP' AND ${where})`;

interface Sums {
  sales: string;
  unknown: string;
  hpp: string;
  returnsAll: string;
  returnsKnown: string;
  costBack: string;
  estimated: boolean;
}

/** Profit = (sales with known HPP − their returns) − (HPP − cost back from returns). */
function figures(s: Sums) {
  const base = dec(s.sales).minus(s.unknown).minus(s.returnsKnown);
  const hpp = dec(s.hpp).minus(s.costBack);
  const profit = base.minus(hpp);
  return {
    sales: toMoney(s.sales),
    returns: toMoney(s.returnsAll),
    hpp: toMoney(hpp),
    profit: toMoney(profit),
    marginPct: marginPct(profit.toString(), base.toString()),
    unknownCostSales: toMoney(s.unknown),
    estimated: s.estimated,
  };
}

function sumTotals(rows: Sums[]): ProfitTotals {
  const z = new Decimal(0);
  const t = rows.reduce(
    (a, r) => ({
      sales: a.sales.plus(r.sales),
      unknown: a.unknown.plus(r.unknown),
      hpp: a.hpp.plus(r.hpp),
      returnsAll: a.returnsAll.plus(r.returnsAll),
      returnsKnown: a.returnsKnown.plus(r.returnsKnown),
      costBack: a.costBack.plus(r.costBack),
      estimated: a.estimated || r.estimated,
    }),
    { sales: z, unknown: z, hpp: z, returnsAll: z, returnsKnown: z, costBack: z, estimated: false },
  );
  return figures({
    ...t,
    sales: t.sales.toString(),
    unknown: t.unknown.toString(),
    hpp: t.hpp.toString(),
    returnsAll: t.returnsAll.toString(),
    returnsKnown: t.returnsKnown.toString(),
    costBack: t.costBack.toString(),
  });
}

export async function profitByItem(pool: Pool, raw: unknown): Promise<ProfitByItemReport> {
  const q = ProfitByItemQuery.parse(raw);
  const rows = await withReport(pool, async (db) => {
    const r = await db.query<
      Sums & { productId: string; sku: string; name: string; category: string | null; baseUnit: string; qty: string }
    >(
      `WITH ${CUR_COST}, ${saleLines()}, ${returnLines(inPeriod('r.trx_at', '$1', '$2'))},
       sa AS (SELECT product_id, sum(base_qty) AS qty, sum(net_amount) AS sales,
                     coalesce(sum(net_amount) FILTER (WHERE cost IS NULL), 0) AS unknown,
                     coalesce(sum(cost), 0) AS hpp, bool_or(estimated) AS estimated
              FROM sale_lines GROUP BY product_id),
       ra AS (SELECT product_id, sum(base_qty) AS qty, sum(amount) AS all_amount,
                     coalesce(sum(amount) FILTER (WHERE NOT unknown), 0) AS known_amount, sum(cost_back) AS cost_back
              FROM return_lines GROUP BY product_id),
       k AS (SELECT product_id FROM sa UNION SELECT product_id FROM ra)
       SELECT p.id AS "productId", p.sku, p.name, cat.name AS category, u.code AS "baseUnit",
              trim_scale(coalesce(sa.qty, 0) - coalesce(ra.qty, 0))::text AS qty,
              coalesce(sa.sales, 0)::text AS sales, coalesce(sa.unknown, 0)::text AS unknown,
              coalesce(sa.hpp, 0)::text AS hpp, coalesce(ra.all_amount, 0)::text AS "returnsAll",
              coalesce(ra.known_amount, 0)::text AS "returnsKnown", coalesce(ra.cost_back, 0)::text AS "costBack",
              coalesce(sa.estimated, false) AS estimated
       FROM k JOIN products p ON p.id = k.product_id JOIN units u ON u.id = p.base_unit_id
       LEFT JOIN categories cat ON cat.id = p.category_id
       LEFT JOIN sa ON sa.product_id = k.product_id LEFT JOIN ra ON ra.product_id = k.product_id
       WHERE ($3::uuid IS NULL OR p.category_id = $3)
       ORDER BY coalesce(sa.sales, 0) DESC, p.name`,
      [q.from, q.to, q.categoryId ?? null],
    );
    return r.rows;
  });
  return {
    period: { from: q.from, to: q.to },
    rows: rows.map((r) => ({
      productId: r.productId,
      sku: r.sku,
      name: r.name,
      category: r.category,
      baseUnit: r.baseUnit,
      qty: r.qty,
      ...figures(r),
    })),
    totals: sumTotals(rows),
  };
}

/** Per sale dated in the period; its returns are counted whenever they happened ("profit of this note"). */
export async function profitByInvoice(pool: Pool, raw: unknown): Promise<ProfitByInvoiceReport> {
  const q = ProfitByInvoiceQuery.parse(raw);
  const rows = await withReport(pool, async (db) => {
    const r = await db.query<
      Sums & { saleId: string; number: string; trxAt: string; customer: { code: string; name: string } }
    >(
      `WITH ${CUR_COST}, ${saleLines('AND ($3::text IS NULL OR s.channel = $3)')},
       ${returnLines('r.sale_id IN (SELECT sale_id FROM sale_lines)')},
       sa AS (SELECT sale_id, sum(net_amount) AS sales,
                     coalesce(sum(net_amount) FILTER (WHERE cost IS NULL), 0) AS unknown,
                     coalesce(sum(cost), 0) AS hpp, bool_or(estimated) AS estimated
              FROM sale_lines GROUP BY sale_id),
       ra AS (SELECT sale_id, sum(amount) AS all_amount,
                     coalesce(sum(amount) FILTER (WHERE NOT unknown), 0) AS known_amount, sum(cost_back) AS cost_back
              FROM return_lines GROUP BY sale_id)
       SELECT s.id AS "saleId", s.number, s.trx_at AS "trxAt",
              json_build_object('code', c.code, 'name', c.name) AS customer,
              sa.sales::text AS sales, sa.unknown::text AS unknown, sa.hpp::text AS hpp,
              coalesce(ra.all_amount, 0)::text AS "returnsAll", coalesce(ra.known_amount, 0)::text AS "returnsKnown",
              coalesce(ra.cost_back, 0)::text AS "costBack", sa.estimated
       FROM sa JOIN sales s ON s.id = sa.sale_id JOIN customers c ON c.id = s.customer_id
       LEFT JOIN ra ON ra.sale_id = sa.sale_id
       ORDER BY s.trx_at, s.number`,
      [q.from, q.to, q.channel ?? null],
    );
    return r.rows;
  });
  return {
    period: { from: q.from, to: q.to },
    rows: rows.map((r): ProfitInvoiceRow => {
      const f = figures(r);
      const costUnknown = !dec(r.unknown).isZero();
      return {
        saleId: r.saleId,
        number: r.number,
        trxAt: r.trxAt,
        customer: r.customer,
        sales: f.sales,
        returns: f.returns,
        hpp: costUnknown ? null : f.hpp,
        profit: costUnknown ? null : f.profit,
        marginPct: costUnknown ? null : f.marginPct,
        estimated: f.estimated,
        costUnknown,
      };
    }),
    totals: sumTotals(rows),
  };
}

export async function profitLoss(pool: Pool, raw: unknown): Promise<ProfitLossReport> {
  const q = ReportPeriod.parse(raw);
  return withReport(pool, async (db) => {
    const s = await db.query<Sums & { otherCharges: string }>(
      `WITH ${CUR_COST}, ${saleLines()}, ${returnLines(inPeriod('r.trx_at', '$1', '$2'))}
       SELECT (SELECT coalesce(sum(net_amount), 0) FROM sale_lines)::text AS sales,
              (SELECT coalesce(sum(net_amount), 0) FROM sale_lines WHERE cost IS NULL)::text AS unknown,
              (SELECT coalesce(sum(cost), 0) FROM sale_lines)::text AS hpp,
              (SELECT coalesce(bool_or(estimated), false) FROM sale_lines) AS estimated,
              (SELECT coalesce(sum(amount), 0) FROM return_lines)::text AS "returnsAll",
              (SELECT coalesce(sum(amount), 0) FROM return_lines WHERE NOT unknown)::text AS "returnsKnown",
              (SELECT coalesce(sum(cost_back), 0) FROM return_lines)::text AS "costBack",
              (SELECT coalesce(sum(s.other_charges), 0) FROM sales s
               WHERE ${COUNTED_SALE} AND ${inPeriod('s.trx_at', '$1', '$2')})::text AS "otherCharges"`,
      [q.from, q.to],
    );
    const opex = await db.query<{ code: string; name: string; amount: string }>(
      `SELECT c.code, c.name, sum(CASE t.direction WHEN 'OUT' THEN t.amount ELSE -t.amount END)::text AS amount
       FROM cash_transactions t JOIN cash_categories c ON c.id = t.cash_category_id
       WHERE c.is_operating_expense AND ${inPeriod('t.trx_at', '$1', '$2')}
       GROUP BY c.code, c.name ORDER BY sum(t.amount) DESC`,
      [q.from, q.to],
    );
    const sums = s.rows[0]!;
    const f = figures(sums);
    const opexTotal = opex.rows.reduce((a, o) => a.plus(o.amount), new Decimal(0));
    return {
      period: { from: q.from, to: q.to },
      netSales: f.sales,
      returns: f.returns,
      unknownCostSales: f.unknownCostSales,
      hpp: f.hpp,
      grossProfit: f.profit,
      otherCharges: toMoney(sums.otherCharges),
      opex: opex.rows.map((o) => ({ ...o, amount: toMoney(o.amount) })),
      opexTotal: toMoney(opexTotal),
      operatingProfit: toMoney(dec(f.profit).plus(sums.otherCharges).minus(opexTotal)),
      estimated: f.estimated,
    };
  });
}

// ---------------------------------------------------------------- Excel

const NOTE_ESTIMATE = 'Tanda * = HPP termasuk perkiraan untuk barang yang belum diambil (HPP FIFO saat ini).';
const unknownNote = (amount: string) =>
  dec(amount).isZero() ? [] : [`Penjualan tanpa HPP (histori iPOS) Rp ${amount} tidak dihitung dalam laba.`];

export function profitByItemXlsx(r: ProfitByItemReport): XlsxReport {
  return {
    title: 'Laba Kotor per Barang',
    subtitle: periodLabel(r.period),
    columns: [
      { key: 'sku', header: 'Kode', width: 14 },
      { key: 'name', header: 'Barang', width: 30 },
      { key: 'category', header: 'Kategori', width: 16 },
      { key: 'qty', header: 'Qty', type: 'qty' },
      { key: 'baseUnit', header: 'Satuan', width: 8 },
      { key: 'sales', header: 'Penjualan', type: 'money' },
      { key: 'returns', header: 'Retur', type: 'money' },
      { key: 'hpp', header: 'HPP', type: 'money' },
      { key: 'profit', header: 'Laba', type: 'money' },
      { key: 'marginPct', header: 'Margin', type: 'percent' },
      { key: 'flag', header: '', width: 4 },
    ],
    rows: r.rows.map((x) => ({ ...x, flag: x.estimated ? '*' : '' })),
    totals: { name: 'Total', ...r.totals, flag: r.totals.estimated ? '*' : '' },
    notes: [NOTE_ESTIMATE, ...unknownNote(r.totals.unknownCostSales)],
  };
}

export function profitByInvoiceXlsx(r: ProfitByInvoiceReport): XlsxReport {
  return {
    title: 'Laba Kotor per Nota',
    subtitle: periodLabel(r.period),
    columns: [
      { key: 'number', header: 'No Transaksi', width: 22 },
      { key: 'date', header: 'Tanggal', type: 'date' },
      { key: 'customer', header: 'Pelanggan', width: 28 },
      { key: 'sales', header: 'Penjualan', type: 'money' },
      { key: 'returns', header: 'Retur', type: 'money' },
      { key: 'hpp', header: 'HPP', type: 'money' },
      { key: 'profit', header: 'Laba', type: 'money' },
      { key: 'marginPct', header: 'Margin', type: 'percent' },
      { key: 'flag', header: '', width: 14 },
    ],
    rows: r.rows.map((x) => ({
      ...x,
      date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(x.trxAt)),
      customer: x.customer.name,
      flag: x.costUnknown ? 'HPP tidak ada' : x.estimated ? '*' : '',
    })),
    totals: { number: `Total (${r.rows.length} nota)`, ...r.totals },
    notes: [NOTE_ESTIMATE, ...unknownNote(r.totals.unknownCostSales)],
  };
}

const neg = (v: string) => dec(v).neg().toFixed(2);

export function profitLossXlsx(r: ProfitLossReport): XlsxReport {
  const row = (label: string, amount: string | null) => ({ label, amount });
  return {
    title: 'Laba Rugi',
    subtitle: periodLabel(r.period),
    columns: [
      { key: 'label', header: 'Keterangan', width: 40 },
      { key: 'amount', header: 'Jumlah', type: 'money' },
    ],
    rows: [
      row('Penjualan bersih', r.netSales),
      ...(dec(r.unknownCostSales).isZero() ? [] : [row('  dikurangi: penjualan tanpa HPP', neg(r.unknownCostSales))]),
      row('Retur penjualan', neg(r.returns)),
      row('Harga pokok penjualan (HPP)', neg(r.hpp)),
      row('Laba kotor', r.grossProfit),
      row('Pendapatan ongkos angkut', r.otherCharges),
      ...r.opex.map((o) => row(`Biaya: ${o.name}`, neg(o.amount))),
      row('Total biaya operasional', neg(r.opexTotal)),
    ],
    totals: { label: 'Laba bersih operasional (perkiraan)', amount: r.operatingProfit },
    notes: r.estimated ? [NOTE_ESTIMATE] : [],
  };
}
