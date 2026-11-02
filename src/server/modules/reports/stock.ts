// Stock report (FR-FIN-08): inventory value per category (FIFO layers), low/negative counts (same
// rules as the Stok page, S4) and products that have not sold for N days. Owner only (value = cost).
import { StockReportQuery, type StockReport } from '@shared/schemas/reports';
import type { Pool } from '../../db/pool';
import type { XlsxReport } from '../../lib/xlsx';
import { today } from '../ar-ap/service';
import { defaultWarehouse, stockSummary } from '../stock/read-repo';
import { COUNTED_SALE, idDate, wibDate, withReport } from './common';

/** FIFO value per product in warehouse $1. MATERIALIZED: computed once even when the planner misjudges the row count (e.g. right after an import). */
const VALUES = `v AS MATERIALIZED (SELECT product_id, sum(qty_remaining * unit_cost) AS value FROM stock_cost_layers
                 WHERE warehouse_id = $1 AND qty_remaining > 0 GROUP BY product_id)`;

export async function stockReport(pool: Pool, raw: unknown): Promise<StockReport> {
  const q = StockReportQuery.parse(raw);
  return withReport(pool, async (db) => {
    const wh = await defaultWarehouse(db);
    const summary = await stockSummary(db, wh.id);
    const categories = await db.query<StockReport['categories'][number]>(
      `WITH ${VALUES}
       SELECT c.id, coalesce(c.name, 'Tanpa kategori') AS name, count(*)::int AS products,
              coalesce(sum(v.value), 0)::numeric(18,2)::text AS value
       FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN v ON v.product_id = p.id
       LEFT JOIN stock_balances b ON b.product_id = p.id AND b.warehouse_id = $1
       WHERE p.deleted_at IS NULL AND p.track_stock AND (p.is_active OR coalesce(b.qty, 0) <> 0)
       GROUP BY c.id, c.name ORDER BY coalesce(sum(v.value), 0) DESC, c.name`,
      [wh.id],
    );
    const idle = await db.query<StockReport['idle'][number]>(
      `WITH ${VALUES}, last_sale AS MATERIALIZED (
         SELECT i.product_id, max(${wibDate('s.trx_at')}) AS d
         FROM sales s JOIN sale_items i ON i.sale_id = s.id WHERE ${COUNTED_SALE} GROUP BY i.product_id)
       SELECT p.id AS "productId", p.sku, p.name, trim_scale(b.qty)::text AS qty, u.code AS "baseUnit",
              coalesce(v.value, 0)::numeric(18,2)::text AS value, ls.d::text AS "lastSaleDate"
       FROM products p JOIN units u ON u.id = p.base_unit_id
       JOIN stock_balances b ON b.product_id = p.id AND b.warehouse_id = $1
       LEFT JOIN last_sale ls ON ls.product_id = p.id LEFT JOIN v ON v.product_id = p.id
       WHERE p.deleted_at IS NULL AND p.track_stock AND b.qty > 0
         AND (ls.d IS NULL OR ls.d < $2::date - $3::int)
       ORDER BY coalesce(v.value, 0) DESC, p.name`,
      [wh.id, today(), q.idleDays],
    );
    return {
      idleDays: q.idleDays,
      categories: categories.rows,
      totals: { products: summary.products, value: summary.totalValue, low: summary.low, minus: summary.minus },
      idle: idle.rows,
    };
  });
}

export function stockXlsx(r: StockReport): XlsxReport {
  return {
    title: 'Nilai Persediaan & Barang Tidak Laku',
    subtitle: `Per ${idDate(today())}`,
    columns: [
      { key: 'name', header: 'Kategori / Barang', width: 34 },
      { key: 'sku', header: 'Kode', width: 14 },
      { key: 'qty', header: 'Stok', type: 'qty' },
      { key: 'baseUnit', header: 'Satuan', width: 8 },
      { key: 'products', header: 'Jumlah Barang', type: 'int' },
      { key: 'value', header: 'Nilai (HPP FIFO)', type: 'money' },
      { key: 'lastSaleDate', header: 'Terakhir Laku', type: 'date' },
    ],
    rows: [
      ...r.categories.map((c) => ({ name: c.name, products: c.products, value: c.value })),
      { name: `Tidak laku ${r.idleDays} hari terakhir:` },
      ...r.idle.map((i) => ({ ...i, name: `  ${i.name}` })),
    ],
    totals: { name: 'Total persediaan', products: r.totals.products, value: r.totals.value },
    notes: [`Stok menipis: ${r.totals.low} barang · Stok minus: ${r.totals.minus} barang.`],
  };
}
