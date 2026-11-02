// Daily in/out recap per fertilizer (FR-FIN-11, sprint-10 S10-12) — replaces the store's
// "DATA PENGELUARAN PUPUK" sheet. From the stock ledger (physical stock): goods that left are split
// by the unit they were sold in (ZAK vs KG ecer), purchases are "masuk", everything else (returns,
// adjustments, opname, opening stock) is "lain-lain". Valid from the opening-stock import on;
// iPOS history has no stock movements.
import { dec, trimDecimal } from '@shared/money';
import {
  DailyFertilizerQuery,
  type DailyFertilizerReport,
  type FertilizerCell,
  type FertilizerProduct,
} from '@shared/schemas/reports';
import type { Pool } from '../../db/pool';
import type { XlsxColumn, XlsxReport } from '../../lib/xlsx';
import { idDate, inPeriod, periodLabel, wibDate, withReport } from './common';

const SALE_KINDS = `('SALE','SALE_VOID','SALE_PICKUP','SALE_PICKUP_CANCEL')`;

export async function dailyFertilizer(pool: Pool, raw: unknown): Promise<DailyFertilizerReport> {
  const q = DailyFertilizerQuery.parse(raw);
  return withReport(pool, async (db) => {
    const cat = await db.query<{ id: string; name: string }>(
      q.categoryId
        ? `SELECT id, name FROM categories WHERE id = $1`
        : `SELECT id, name FROM categories WHERE deleted_at IS NULL AND upper(name) LIKE 'PUPUK%' ORDER BY name LIMIT 1`,
      q.categoryId ? [q.categoryId] : [],
    );
    const category = cat.rows[0] ?? null;
    if (!category) return { period: { from: q.from, to: q.to }, category: null, products: [], days: [] };

    const products = await db.query<Omit<FertilizerProduct, 'closing' | 'totals'> & { periodNet: string }>(
      `SELECT p.id, p.sku, p.name, u.code AS "baseUnit",
              (SELECT json_build_object('code', bu.code, 'conversion', trim_scale(pu.conversion_qty)::text)
               FROM product_units pu JOIN units bu ON bu.id = pu.unit_id
               WHERE pu.product_id = p.id AND pu.deleted_at IS NULL AND pu.conversion_qty > 1
               ORDER BY pu.conversion_qty DESC LIMIT 1) AS "bigUnit",
              trim_scale(coalesce((SELECT sum(m.qty) FROM stock_movements m WHERE m.product_id = p.id
                 AND m.moved_at < ($2::date::timestamp AT TIME ZONE 'Asia/Jakarta')), 0))::text AS opening,
              trim_scale(coalesce((SELECT sum(m.qty) FROM stock_movements m WHERE m.product_id = p.id
                 AND ${inPeriod('m.moved_at', '$2', '$3')}), 0))::text AS "periodNet"
       FROM products p JOIN units u ON u.id = p.base_unit_id
       WHERE p.category_id = $1 AND p.track_stock AND p.deleted_at IS NULL
         AND (p.is_active OR EXISTS (SELECT 1 FROM stock_movements m WHERE m.product_id = p.id))
       ORDER BY p.name`,
      [category.id, q.from, q.to],
    );

    const cells = await db.query<FertilizerCell & { date: string; productId: string }>(
      `WITH mv AS (
         SELECT ${wibDate('m.moved_at')} AS d, m.product_id, m.source_type, m.qty,
                coalesce(si.conversion_qty, psi.conversion_qty, 1) AS conv
         FROM stock_movements m JOIN products p ON p.id = m.product_id
         LEFT JOIN sale_items si ON m.source_type IN ('SALE','SALE_VOID') AND si.id = m.source_line_id
         LEFT JOIN sale_pickup_items pi ON m.source_type IN ('SALE_PICKUP','SALE_PICKUP_CANCEL') AND pi.id = m.source_line_id
         LEFT JOIN sale_items psi ON psi.id = pi.sale_item_id
         WHERE p.category_id = $1 AND ${inPeriod('m.moved_at', '$2', '$3')})
       SELECT d::text AS date, product_id AS "productId",
              trim_scale(coalesce(sum(-qty / conv) FILTER (WHERE source_type IN ${SALE_KINDS} AND conv > 1), 0))::text AS "outBig",
              trim_scale(coalesce(sum(-qty) FILTER (WHERE source_type IN ${SALE_KINDS} AND conv <= 1), 0))::text AS "outBase",
              trim_scale(coalesce(sum(qty) FILTER (WHERE source_type = 'PURCHASE_RECEIPT'), 0))::text AS "in",
              trim_scale(coalesce(sum(qty) FILTER (WHERE source_type NOT IN ${SALE_KINDS}
                                                        AND source_type <> 'PURCHASE_RECEIPT'), 0))::text AS other
       FROM mv GROUP BY d, product_id ORDER BY d`,
      [category.id, q.from, q.to],
    );

    const days = new Map<string, Record<string, FertilizerCell>>();
    const totals = new Map<string, FertilizerCell>();
    for (const c of cells.rows) {
      const { date, productId, ...cell } = c;
      if (!days.has(date)) days.set(date, {});
      days.get(date)![productId] = cell;
      const t = totals.get(productId) ?? { outBig: '0', outBase: '0', in: '0', other: '0' };
      totals.set(productId, {
        outBig: trimDecimal(dec(t.outBig).plus(cell.outBig)),
        outBase: trimDecimal(dec(t.outBase).plus(cell.outBase)),
        in: trimDecimal(dec(t.in).plus(cell.in)),
        other: trimDecimal(dec(t.other).plus(cell.other)),
      });
    }

    // Every calendar day of the period, so the sheet reads like the store's own matrix.
    const allDays: DailyFertilizerReport['days'] = [];
    for (let t = Date.parse(`${q.from}T00:00:00Z`); t <= Date.parse(`${q.to}T00:00:00Z`); t += 86_400_000) {
      const date = new Date(t).toISOString().slice(0, 10);
      allDays.push({ date, cells: days.get(date) ?? {} });
    }

    return {
      period: { from: q.from, to: q.to },
      category,
      products: products.rows.map(({ periodNet, ...p }) => ({
        ...p,
        closing: trimDecimal(dec(p.opening).plus(periodNet)),
        totals: totals.get(p.id) ?? { outBig: '0', outBase: '0', in: '0', other: '0' },
      })),
      days: allDays,
    };
  });
}

/** Stock change of one cell in base units: in + other − outBase − outBig × conversion. */
export function cellNet(cell: FertilizerCell, p: Pick<FertilizerProduct, 'bigUnit'>): string {
  const big = dec(cell.outBig).times(p.bigUnit?.conversion ?? '1');
  return trimDecimal(dec(cell.in).plus(cell.other).minus(cell.outBase).minus(big));
}

export function dailyFertilizerXlsx(r: DailyFertilizerReport): XlsxReport {
  const columns: XlsxColumn[] = [{ key: 'date', header: 'Tanggal', type: 'text', width: 14 }];
  for (const p of r.products) {
    const big = p.bigUnit?.code ?? p.baseUnit;
    columns.push(
      ...(p.bigUnit ? [{ key: `${p.id}:big`, header: `${p.name} keluar ${big}`, type: 'qty' as const }] : []),
      { key: `${p.id}:base`, header: `${p.name} keluar ${p.baseUnit}`, type: 'qty' },
      { key: `${p.id}:in`, header: `${p.name} masuk ${p.baseUnit}`, type: 'qty' },
      { key: `${p.id}:bal`, header: `${p.name} sisa ${p.baseUnit}`, type: 'qty' },
    );
  }
  const balance = new Map(r.products.map((p) => [p.id, dec(p.opening)]));
  const opening: Record<string, string> = { date: 'Saldo awal' };
  for (const p of r.products) opening[`${p.id}:bal`] = p.opening;
  const rows: Record<string, string>[] = [opening];
  for (const d of r.days) {
    const row: Record<string, string> = { date: idDate(d.date) };
    for (const p of r.products) {
      const c = d.cells[p.id];
      if (c) {
        balance.set(p.id, balance.get(p.id)!.plus(cellNet(c, p)));
        if (p.bigUnit && !dec(c.outBig).isZero()) row[`${p.id}:big`] = c.outBig;
        if (!dec(c.outBase).isZero()) row[`${p.id}:base`] = c.outBase;
        if (!dec(c.in).isZero()) row[`${p.id}:in`] = c.in;
      }
      row[`${p.id}:bal`] = trimDecimal(balance.get(p.id)!);
    }
    rows.push(row);
  }
  const totals: Record<string, string> = { date: 'Jumlah' };
  for (const p of r.products) {
    if (p.bigUnit) totals[`${p.id}:big`] = p.totals.outBig;
    totals[`${p.id}:base`] = p.totals.outBase;
    totals[`${p.id}:in`] = p.totals.in;
    totals[`${p.id}:bal`] = p.closing;
  }
  return {
    title: `Rekap Harian ${r.category?.name ?? 'Pupuk'}`,
    subtitle: periodLabel(r.period),
    columns,
    rows,
    totals,
    notes: ['Sisa = stok fisik di gudang (barang terjual yang belum diambil masih dihitung di gudang).'],
  };
}
