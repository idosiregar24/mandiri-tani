// Goods sold but not yet picked up (FR-PKP-13 — replaces the "DAFTAR PUPUK" sheet) and the pickup
// history AB (FR-PKP-08). Go-live opening notes (OPENING_PICKUP) are real waiting goods, so they
// count here even though they are not turnover.
import {
  PickupsReportQuery,
  UndeliveredQuery,
  type PickupsReport,
  type UndeliveredReport,
  type UndeliveredRow,
} from '@shared/schemas/reports';
import type { Pool } from '../../db/pool';
import type { XlsxReport } from '../../lib/xlsx';
import { today } from '../ar-ap/service';
import { idDate, inPeriod, periodLabel, wibDate, withReport } from './common';

/** Open lines: $1 = today (WIB). */
const OPEN = `o AS (
  SELECT s.id AS sale_id, s.customer_id, ${wibDate('s.trx_at')} AS sale_date, s.pickup_planned_date, i.product_id,
         (i.qty - i.picked_up_qty - i.cancelled_qty) * i.conversion_qty AS open_base,
         round(i.net_amount * (i.qty - i.picked_up_qty - i.cancelled_qty) / i.qty, 2) AS value
  FROM sales s JOIN sale_items i ON i.sale_id = s.id
  WHERE s.status = 'COMPLETED' AND s.fulfillment_status IN ('PENDING','PARTIAL')
    AND i.qty - i.picked_up_qty - i.cancelled_qty > 0)`;

export async function undelivered(pool: Pool, raw: unknown): Promise<UndeliveredReport> {
  const q = UndeliveredQuery.parse(raw);
  const day = today();
  const result = await withReport(pool, async (db) => {
    const common = `count(DISTINCT o.sale_id)::int AS sales, sum(o.value)::text AS value,
                    min(o.sale_date)::text AS "oldestDate", ($1::date - min(o.sale_date))::int AS "ageDays",
                    count(DISTINCT o.sale_id) FILTER (WHERE o.pickup_planned_date < $1::date)::int AS "overdueSales"`;
    const r = await db.query<UndeliveredRow>(
      q.groupBy === 'customer'
        ? `WITH ${OPEN}
           SELECT c.id::text AS key, c.name AS label, c.phone AS detail, NULL AS qty, ${common}
           FROM o JOIN customers c ON c.id = o.customer_id
           GROUP BY c.id ORDER BY min(o.sale_date), c.name`
        : `WITH ${OPEN}
           SELECT p.id::text AS key, p.name AS label, u.code AS detail, trim_scale(sum(o.open_base))::text AS qty, ${common}
           FROM o JOIN products p ON p.id = o.product_id JOIN units u ON u.id = p.base_unit_id
           GROUP BY p.id, u.code ORDER BY sum(o.value) DESC, p.name`,
      [day],
    );
    const t = await db.query<UndeliveredReport['totals']>(
      `WITH ${OPEN}, per_sale AS (
         SELECT sale_id, min(sale_date) AS d, bool_or(pickup_planned_date < $1::date) AS overdue, sum(value) AS value
         FROM o GROUP BY sale_id)
       SELECT count(*)::int AS sales, coalesce(sum(value), 0)::text AS value,
              count(*) FILTER (WHERE $1::date - d > $2)::int AS "olderThanAging",
              count(*) FILTER (WHERE overdue)::int AS "overdueSales"
       FROM per_sale`,
      [day, q.agingDays],
    );
    return { rows: r.rows, totals: t.rows[0]! };
  });
  return { groupBy: q.groupBy, agingDays: q.agingDays, ...result };
}

export function undeliveredXlsx(r: UndeliveredReport): XlsxReport {
  const byCustomer = r.groupBy === 'customer';
  return {
    title: byCustomer ? 'Barang Belum Diambil per Pelanggan' : 'Barang Belum Diambil per Barang',
    subtitle: `Per ${idDate(today())}`,
    columns: [
      { key: 'label', header: byCustomer ? 'Pelanggan' : 'Barang', width: 30 },
      { key: 'detail', header: byCustomer ? 'HP' : 'Satuan', width: 14 },
      { key: 'sales', header: 'Jumlah Nota', type: 'int' },
      ...(byCustomer ? [] : [{ key: 'qty', header: 'Qty Belum Diambil', type: 'qty' as const }]),
      { key: 'value', header: 'Nilai', type: 'money' },
      { key: 'oldestDate', header: 'Nota Tertua', type: 'date' },
      { key: 'ageDays', header: 'Umur (hari)', type: 'int' },
      { key: 'overdueSales', header: 'Lewat Janji Ambil', type: 'int' },
    ],
    rows: r.rows.map((x) => ({ ...x })),
    totals: { label: 'Total', sales: r.totals.sales, value: r.totals.value, overdueSales: r.totals.overdueSales },
    notes: [`${r.totals.olderThanAging} nota sudah lebih dari ${r.agingDays} hari belum diambil.`],
  };
}

export async function pickupsReport(pool: Pool, raw: unknown): Promise<PickupsReport> {
  const q = PickupsReportQuery.parse(raw);
  const rows = await withReport(pool, async (db) => {
    const r = await db.query<PickupsReport['rows'][number]>(
      `SELECT sp.id, sp.number, sp.picked_up_at AS "pickedUpAt",
              json_build_object('code', c.code, 'name', c.name) AS customer,
              sp.method, sp.receiver_name AS "receiverName", sp.status, u.full_name AS "createdBy",
              (SELECT json_agg(json_build_object('saleNumber', s.number, 'productName', si.product_name,
                        'qty', trim_scale(spi.qty)::text, 'unitCode', si.unit_code) ORDER BY s.number, si.line_no)
               FROM sale_pickup_items spi JOIN sale_items si ON si.id = spi.sale_item_id JOIN sales s ON s.id = si.sale_id
               WHERE spi.pickup_id = sp.id) AS lines
       FROM sale_pickups sp JOIN customers c ON c.id = sp.customer_id LEFT JOIN users u ON u.id = sp.created_by
       WHERE ${inPeriod('sp.picked_up_at', '$1', '$2')} AND ($3::uuid IS NULL OR sp.customer_id = $3)
         AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM sale_pickup_items x JOIN sale_items xi ON xi.id = x.sale_item_id
                                         WHERE x.pickup_id = sp.id AND xi.product_id = $4))
       ORDER BY sp.picked_up_at, sp.number`,
      [q.from, q.to, q.customerId ?? null, q.productId ?? null],
    );
    return r.rows;
  });
  return { period: { from: q.from, to: q.to }, rows };
}

export function pickupsXlsx(r: PickupsReport): XlsxReport {
  const wib = (d: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(d));
  const rows: Record<string, string | null>[] = [];
  for (const p of r.rows) {
    for (const [i, l] of p.lines.entries()) {
      rows.push({
        number: i === 0 ? p.number : null,
        date: i === 0 ? wib(p.pickedUpAt) : null,
        customer: i === 0 ? p.customer.name : null,
        receiver: i === 0 ? `${p.receiverName}${p.method === 'DELIVERY' ? ' (diantar)' : ''}` : null,
        saleNumber: l.saleNumber,
        product: l.productName,
        qty: l.qty,
        unit: l.unitCode,
        status: i === 0 ? (p.status === 'CANCELLED' ? 'Dibatalkan' : 'Selesai') : null,
      });
    }
  }
  const pieces = r.rows.filter((p) => p.status === 'POSTED').length;
  return {
    title: 'Riwayat Pengambilan Barang',
    subtitle: periodLabel(r.period),
    columns: [
      { key: 'number', header: 'No Bukti', width: 18 },
      { key: 'date', header: 'Tanggal', type: 'date' },
      { key: 'customer', header: 'Pelanggan', width: 24 },
      { key: 'receiver', header: 'Penerima', width: 20 },
      { key: 'saleNumber', header: 'No Nota', width: 22 },
      { key: 'product', header: 'Barang', width: 28 },
      { key: 'qty', header: 'Qty', type: 'qty' },
      { key: 'unit', header: 'Satuan', width: 8 },
      { key: 'status', header: 'Status', width: 12 },
    ],
    rows,
    notes: [`${pieces} pengambilan selesai, ${r.rows.length - pieces} dibatalkan.`],
  };
}
