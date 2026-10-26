// SQL behind stockService. Only stockService may call the write functions in this file
// (golden rule 2: stock has one door) — other modules read stock through the read functions.
import type { Queryable } from '../../db/pool';

export interface LockedProduct {
  id: string;
  name: string;
  lastPurchaseCost: string | null;
  baseUnitCode: string;
  saleUnitCode: string | null;
  saleConversion: string | null;
}

export interface LockedBalance {
  productId: string;
  warehouseId: string;
  qty: string;
  reservedQty: string;
}

export interface Layer {
  id: string;
  receivedAt: Date;
  qtyRemaining: string;
  unitCost: string;
}

/** Missing balance rows first (sorted), so the FOR UPDATE below always finds a row to lock. */
export async function ensureBalances(db: Queryable, keys: { productId: string; warehouseId: string }[]): Promise<void> {
  if (keys.length === 0) return;
  await db.query(
    `INSERT INTO stock_balances (product_id, warehouse_id)
     SELECT * FROM unnest($1::uuid[], $2::uuid[]) ORDER BY 1, 2
     ON CONFLICT DO NOTHING`,
    [keys.map((k) => k.productId), keys.map((k) => k.warehouseId)],
  );
}

/**
 * Locks every affected product (ORDER BY id) — this serialises access to its FIFO layers.
 * FOR NO KEY UPDATE: same mutual exclusion between stock writers as FOR UPDATE, but it does not
 * block foreign-key checks (FOR KEY SHARE) of other documents that merely reference the product.
 */
export async function lockProducts(db: Queryable, ids: string[]): Promise<Map<string, LockedProduct>> {
  const r = await db.query<LockedProduct>(
    `SELECT p.id, p.name, p.last_purchase_cost::text AS "lastPurchaseCost", bu.code AS "baseUnitCode",
            su.code AS "saleUnitCode", trim_scale(spu.conversion_qty)::text AS "saleConversion"
     FROM products p
     JOIN units bu ON bu.id = p.base_unit_id
     LEFT JOIN product_units spu ON spu.product_id = p.id AND spu.is_default_sale AND spu.deleted_at IS NULL
     LEFT JOIN units su ON su.id = spu.unit_id
     WHERE p.id = ANY($1::uuid[])
     ORDER BY p.id
     FOR NO KEY UPDATE OF p`,
    [ids],
  );
  return new Map(r.rows.map((p) => [p.id, p]));
}

export async function lockBalances(
  db: Queryable,
  keys: { productId: string; warehouseId: string }[],
): Promise<Map<string, LockedBalance>> {
  const r = await db.query<LockedBalance>(
    `SELECT b.product_id AS "productId", b.warehouse_id AS "warehouseId", b.qty::text AS qty, b.reserved_qty::text AS "reservedQty"
     FROM stock_balances b
     JOIN unnest($1::uuid[], $2::uuid[]) AS k(product_id, warehouse_id)
       ON k.product_id = b.product_id AND k.warehouse_id = b.warehouse_id
     ORDER BY b.product_id, b.warehouse_id
     FOR UPDATE OF b`,
    [keys.map((k) => k.productId), keys.map((k) => k.warehouseId)],
  );
  return new Map(r.rows.map((b) => [`${b.productId}|${b.warehouseId}`, b]));
}

/** Open layers, oldest first; a purchase return's own receipt layer comes first. */
export async function openLayers(
  db: Queryable,
  productId: string,
  warehouseId: string,
  preferSourceLineId?: string,
): Promise<Layer[]> {
  const r = await db.query<Layer>(
    `SELECT id, received_at AS "receivedAt", qty_remaining::text AS "qtyRemaining", unit_cost::text AS "unitCost"
     FROM stock_cost_layers
     WHERE product_id = $1 AND warehouse_id = $2 AND qty_remaining > 0
     ORDER BY (source_line_id IS NOT DISTINCT FROM $3::uuid AND $3::uuid IS NOT NULL) DESC, received_at, id
     FOR UPDATE`,
    [productId, warehouseId, preferSourceLineId ?? null],
  );
  return r.rows;
}

export async function insertMovement(
  db: Queryable,
  m: {
    id: string;
    productId: string;
    warehouseId: string;
    movedAt: Date;
    qty: string;
    unitCost: string;
    costEstimated: boolean;
    sourceType: string;
    sourceId: string;
    sourceLineId: string | null;
    note: string | null;
    createdBy: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO stock_movements (id, product_id, warehouse_id, moved_at, qty, unit_cost, cost_estimated, source_type, source_id,
                                  source_line_id, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      m.id,
      m.productId,
      m.warehouseId,
      m.movedAt,
      m.qty,
      m.unitCost,
      m.costEstimated,
      m.sourceType,
      m.sourceId,
      m.sourceLineId,
      m.note,
      m.createdBy,
    ],
  );
}

export async function insertLayer(
  db: Queryable,
  l: {
    id: string;
    productId: string;
    warehouseId: string;
    receivedAt: Date;
    qty: string;
    unitCost: string;
    movementId: string;
    sourceType: string;
    sourceLineId: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO stock_cost_layers (id, product_id, warehouse_id, received_at, qty_in, qty_remaining, unit_cost, source_movement_id,
                                    source_type, source_line_id)
     VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9)`,
    [l.id, l.productId, l.warehouseId, l.receivedAt, l.qty, l.unitCost, l.movementId, l.sourceType, l.sourceLineId],
  );
}

export async function insertConsumptions(
  db: Queryable,
  rows: {
    id: string;
    movementId: string;
    layerId: string | null;
    qty: string;
    unitCost: string;
    isEstimated: boolean;
  }[],
): Promise<void> {
  if (rows.length === 0) return;
  await db.query(
    `INSERT INTO stock_layer_consumptions (id, movement_id, layer_id, qty, unit_cost, is_estimated)
     SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::numeric[], $5::numeric[], $6::bool[])`,
    [
      rows.map((r) => r.id),
      rows.map((r) => r.movementId),
      rows.map((r) => r.layerId),
      rows.map((r) => r.qty),
      rows.map((r) => r.unitCost),
      rows.map((r) => r.isEstimated),
    ],
  );
}

export async function setLayerRemaining(db: Queryable, updates: { id: string; qtyRemaining: string }[]): Promise<void> {
  if (updates.length === 0) return;
  await db.query(
    `UPDATE stock_cost_layers l SET qty_remaining = u.q
     FROM unnest($1::uuid[], $2::numeric[]) AS u(id, q) WHERE l.id = u.id`,
    [updates.map((u) => u.id), updates.map((u) => u.qtyRemaining)],
  );
}

export async function setBalance(
  db: Queryable,
  productId: string,
  warehouseId: string,
  qty: string,
  reservedQty: string,
): Promise<void> {
  await db.query('UPDATE stock_balances SET qty = $3, reserved_qty = $4 WHERE product_id = $1 AND warehouse_id = $2', [
    productId,
    warehouseId,
    qty,
    reservedQty,
  ]);
}

export async function setLastPurchaseCost(db: Queryable, productId: string, cost: string): Promise<void> {
  await db.query('UPDATE products SET last_purchase_cost = $2 WHERE id = $1', [productId, cost]);
}
