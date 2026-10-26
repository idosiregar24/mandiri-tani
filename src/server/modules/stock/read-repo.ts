// Read-only stock queries: list with the three stock numbers (FR-INV-13), stock card with a
// computed running balance (PRD §6.4), FIFO layers, and the daily consistency check (G-4).
// Reports are computed in SQL, not in JS loops (database-standards §7).
import type { ConsistencyProblem, CostLayer, StockCardLine, StockRow, StockSummary } from '@shared/schemas/stock';
import type { Queryable } from '../../db/pool';
import { likePattern } from '../../lib/http';

export async function defaultWarehouse(db: Queryable): Promise<{ id: string; code: string }> {
  const r = await db.query<{ id: string; code: string }>(
    'SELECT id, code FROM warehouses WHERE is_default AND deleted_at IS NULL',
  );
  if (!r.rows[0]) throw new Error('no default warehouse');
  return r.rows[0];
}

/** Stocked products (not services/bundles) with their balance in warehouse $1; `extra` adds joins. */
const stockFrom = (extra = '') => `
  FROM products p
  JOIN units bu ON bu.id = p.base_unit_id
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN LATERAL (
    SELECT u.code, pu.conversion_qty FROM product_units pu JOIN units u ON u.id = pu.unit_id
    WHERE pu.product_id = p.id AND pu.is_default_sale AND pu.deleted_at IS NULL LIMIT 1) su ON true
  LEFT JOIN stock_balances b ON b.product_id = p.id AND b.warehouse_id = $1
  ${extra}
  WHERE p.deleted_at IS NULL AND p.track_stock`;
/** FIFO value of the open layers of each product (cost.read callers only see it). */
const VALUE_JOIN = `LEFT JOIN LATERAL (
    SELECT coalesce(sum(l.qty_remaining * l.unit_cost), 0)::numeric(18,2) AS value, coalesce(sum(l.qty_remaining), 0) AS qty
    FROM stock_cost_layers l WHERE l.product_id = p.id AND l.warehouse_id = $1 AND l.qty_remaining > 0) v ON true`;
const AVAILABLE = '(coalesce(b.qty, 0) - coalesce(b.reserved_qty, 0))';
/** FR-INV-07: at or below the minimum (when one is set), or nothing left to sell. */
const IS_LOW = `(${AVAILABLE} <= 0 OR (p.min_stock > 0 AND ${AVAILABLE} <= p.min_stock))`;

export interface StockFilter {
  q?: string;
  categoryId?: string;
  filter: 'all' | 'low' | 'minus';
}

function where(f: StockFilter, params: unknown[]): string {
  const parts: string[] = [];
  if (f.q) {
    params.push(likePattern(f.q));
    parts.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`);
  }
  if (f.categoryId) {
    params.push(f.categoryId);
    parts.push(`p.category_id = $${params.length}`);
  }
  if (f.filter === 'low') parts.push(`p.is_active AND ${IS_LOW}`);
  if (f.filter === 'minus') parts.push('coalesce(b.qty, 0) < 0');
  if (f.filter === 'all') parts.push('(p.is_active OR coalesce(b.qty, 0) <> 0)');
  return parts.length ? ` AND ${parts.join(' AND ')}` : '';
}

export async function listStock(
  db: Queryable,
  warehouseId: string,
  f: StockFilter & { limit: number; offset: number },
): Promise<{ rows: Required<StockRow>[]; total: number }> {
  const params: unknown[] = [warehouseId];
  const clause = where(f, params);
  const total = Number(
    (await db.query<{ n: string }>(`SELECT count(*) AS n ${stockFrom()}${clause}`, params)).rows[0]!.n,
  );
  params.push(f.limit, f.offset);
  const rows = await db.query<Required<StockRow>>(
    `SELECT p.id AS "productId", p.sku, p.name, c.name AS "categoryName", bu.code AS "baseUnitCode",
            coalesce(su.code, bu.code) AS "saleUnitCode", trim_scale(coalesce(su.conversion_qty, 1))::text AS "saleConversion",
            coalesce(b.qty, 0)::numeric(18,4)::text AS qty, coalesce(b.reserved_qty, 0)::numeric(18,4)::text AS "reservedQty",
            ${AVAILABLE}::numeric(18,4)::text AS "availableQty", trim_scale(p.min_stock)::text AS "minStock",
            ${IS_LOW} AS "isLow", v.value::text AS value,
            CASE WHEN v.qty > 0 THEN round(v.value / v.qty, 4)::text END AS "avgCost"
     ${stockFrom(VALUE_JOIN)}${clause}
     ORDER BY ${IS_LOW} DESC, p.name, p.sku
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows: rows.rows, total };
}

export async function stockSummary(db: Queryable, warehouseId: string): Promise<Required<StockSummary>> {
  const r = await db.query<Required<StockSummary>>(
    `SELECT count(*) FILTER (WHERE p.is_active)::int AS products,
            count(*) FILTER (WHERE p.is_active AND ${IS_LOW})::int AS low,
            count(*) FILTER (WHERE coalesce(b.qty, 0) < 0)::int AS minus,
            (SELECT coalesce(sum(qty_remaining * unit_cost), 0)::numeric(18,2)::text FROM stock_cost_layers
              WHERE warehouse_id = $1 AND qty_remaining > 0) AS "totalValue"
     ${stockFrom()}`,
    [warehouseId],
  );
  return r.rows[0]!;
}

export interface CardHead {
  productId: string;
  sku: string;
  name: string;
  baseUnitCode: string;
  saleUnitCode: string;
  saleConversion: string;
  qty: string;
  reservedQty: string;
  availableQty: string;
}

export async function cardHead(db: Queryable, warehouseId: string, productId: string): Promise<CardHead | null> {
  const r = await db.query<CardHead>(
    `SELECT p.id AS "productId", p.sku, p.name, bu.code AS "baseUnitCode",
            coalesce(su.code, bu.code) AS "saleUnitCode", trim_scale(coalesce(su.conversion_qty, 1))::text AS "saleConversion",
            coalesce(b.qty, 0)::numeric(18,4)::text AS qty, coalesce(b.reserved_qty, 0)::numeric(18,4)::text AS "reservedQty",
            ${AVAILABLE}::numeric(18,4)::text AS "availableQty"
     ${stockFrom()} AND p.id = $2`,
    [warehouseId, productId],
  );
  return r.rows[0] ?? null;
}

/** Period bounds are Asia/Jakarta calendar days: [from 00:00 WIB, to + 1 day 00:00 WIB). */
const FROM_TS = `($3::date::timestamp AT TIME ZONE 'Asia/Jakarta')`;
const TO_TS = `(($4::date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta')`;

export async function cardLines(
  db: Queryable,
  warehouseId: string,
  productId: string,
  from: string,
  to: string,
): Promise<{ opening: string; lines: Required<StockCardLine>[] }> {
  const opening = await db.query<{ q: string }>(
    `SELECT coalesce(sum(qty), 0)::numeric(18,4)::text AS q FROM stock_movements
     WHERE warehouse_id = $1 AND product_id = $2 AND moved_at < ${FROM_TS}`,
    [warehouseId, productId, from],
  );
  const open = opening.rows[0]!.q;
  const lines = await db.query<Required<StockCardLine>>(
    `SELECT m.moved_at AS "movedAt", m.source_type AS "sourceType", m.source_id AS "sourceId",
            CASE m.source_type
              WHEN 'OPENING' THEN 'Saldo awal'
              WHEN 'ADJUSTMENT' THEN coalesce(a.number, 'Penyesuaian')
              WHEN 'OPNAME' THEN coalesce(o.number, 'Stok opname')
              ELSE m.source_type END AS document,
            m.note,
            CASE WHEN m.qty > 0 THEN m.qty ELSE 0 END::numeric(18,4)::text AS "qtyIn",
            CASE WHEN m.qty < 0 THEN -m.qty ELSE 0 END::numeric(18,4)::text AS "qtyOut",
            ($5::numeric + sum(m.qty) OVER (ORDER BY m.moved_at, m.seq))::numeric(18,4)::text AS balance,
            m.unit_cost::text AS "unitCost", m.cost_estimated AS "costEstimated"
     FROM stock_movements m
     LEFT JOIN stock_adjustments a ON m.source_type = 'ADJUSTMENT' AND a.id = m.source_id
     LEFT JOIN stock_opnames o ON m.source_type = 'OPNAME' AND o.id = m.source_id
     WHERE m.warehouse_id = $1 AND m.product_id = $2 AND m.moved_at >= ${FROM_TS} AND m.moved_at < ${TO_TS}
     ORDER BY m.moved_at, m.seq`,
    [warehouseId, productId, from, to, open],
  );
  return { opening: open, lines: lines.rows };
}

export async function layers(db: Queryable, warehouseId: string, productId: string): Promise<CostLayer[]> {
  return (
    await db.query<CostLayer>(
      `SELECT id, received_at AS "receivedAt", source_type AS "sourceType", qty_in::text AS "qtyIn",
              qty_remaining::text AS "qtyRemaining", unit_cost::text AS "unitCost",
              (qty_remaining * unit_cost)::numeric(18,2)::text AS value
       FROM stock_cost_layers WHERE warehouse_id = $1 AND product_id = $2 AND qty_remaining > 0
       ORDER BY received_at, id`,
      [warehouseId, productId],
    )
  ).rows;
}

/** G-4: balance ≠ Σ ledger, or (stock ≥ 0 and) Σ open layers ≠ balance. Should always be empty. */
export async function consistency(db: Queryable): Promise<ConsistencyProblem[]> {
  return (
    await db.query<ConsistencyProblem>(
      `WITH k AS (
         SELECT product_id, warehouse_id FROM stock_balances
         UNION SELECT product_id, warehouse_id FROM stock_movements
         UNION SELECT product_id, warehouse_id FROM stock_cost_layers WHERE qty_remaining > 0),
       x AS (
         SELECT k.product_id, k.warehouse_id,
                coalesce((SELECT qty FROM stock_balances b WHERE b.product_id = k.product_id AND b.warehouse_id = k.warehouse_id), 0) AS balance,
                coalesce((SELECT sum(qty) FROM stock_movements m WHERE m.product_id = k.product_id AND m.warehouse_id = k.warehouse_id), 0) AS ledger,
                coalesce((SELECT sum(qty_remaining) FROM stock_cost_layers l WHERE l.product_id = k.product_id AND l.warehouse_id = k.warehouse_id), 0) AS layers
         FROM k)
       SELECT x.product_id AS "productId", p.sku, p.name, x.balance::numeric(18,4)::text AS balance,
              x.ledger::numeric(18,4)::text AS ledger, x.layers::numeric(18,4)::text AS layers
       FROM x JOIN products p ON p.id = x.product_id
       WHERE x.balance <> x.ledger OR (x.balance >= 0 AND x.layers <> x.balance) OR (x.balance < 0 AND x.layers <> 0)
       ORDER BY p.name`,
    )
  ).rows;
}

/** A product unit for converting typed quantities to base units. */
export async function productUnit(
  db: Queryable,
  productId: string,
  productUnitId: string,
): Promise<{ name: string; trackStock: boolean; allowDecimal: boolean; conversion: string; unitCode: string } | null> {
  const r = await db.query<{
    name: string;
    trackStock: boolean;
    allowDecimal: boolean;
    conversion: string;
    unitCode: string;
  }>(
    `SELECT p.name, p.track_stock AS "trackStock", p.allow_decimal_qty AS "allowDecimal",
            pu.conversion_qty::text AS conversion, u.code AS "unitCode"
     FROM product_units pu JOIN products p ON p.id = pu.product_id JOIN units u ON u.id = pu.unit_id
     WHERE pu.id = $2 AND pu.product_id = $1 AND pu.deleted_at IS NULL AND p.deleted_at IS NULL`,
    [productId, productUnitId],
  );
  return r.rows[0] ?? null;
}
