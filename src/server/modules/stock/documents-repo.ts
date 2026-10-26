// SQL for stock documents: adjustments (PS) and stock opname sessions (OP).
import type { Adjustment, AdjustmentLine, AdjustmentReason, Opname, OpnameLine } from '@shared/schemas/stock';
import type { Queryable } from '../../db/pool';

// ------------------------------------------------------------------ adjustments
export async function insertAdjustment(
  db: Queryable,
  a: {
    id: string;
    number: string;
    warehouseId: string;
    reasonCode: AdjustmentReason;
    note: string | null;
    trxAt: Date;
    clientOpId: string | null;
    createdBy: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO stock_adjustments (id, number, warehouse_id, reason_code, note, trx_at, client_op_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [a.id, a.number, a.warehouseId, a.reasonCode, a.note, a.trxAt, a.clientOpId, a.createdBy],
  );
}

export async function insertAdjustmentLines(
  db: Queryable,
  adjustmentId: string,
  lines: { id: string; productId: string; qty: string; unitCost: string }[],
): Promise<void> {
  await db.query(
    `INSERT INTO stock_adjustment_lines (id, adjustment_id, product_id, qty, unit_cost)
     SELECT id, $1, product_id, qty, unit_cost FROM unnest($2::uuid[], $3::uuid[], $4::numeric[], $5::numeric[]) AS t(id, product_id, qty, unit_cost)`,
    [
      adjustmentId,
      lines.map((l) => l.id),
      lines.map((l) => l.productId),
      lines.map((l) => l.qty),
      lines.map((l) => l.unitCost),
    ],
  );
}

export async function adjustmentIdByClientOp(db: Queryable, clientOpId: string): Promise<string | null> {
  return (
    (await db.query<{ id: string }>('SELECT id FROM stock_adjustments WHERE client_op_id = $1', [clientOpId])).rows[0]
      ?.id ?? null
  );
}

const ADJ_SELECT = `
  SELECT a.id, a.number, a.reason_code AS "reasonCode", a.note, a.trx_at AS "trxAt", w.code AS "warehouseCode",
         (SELECT count(*) FROM stock_adjustment_lines l WHERE l.adjustment_id = a.id)::int AS "lineCount",
         (SELECT coalesce(sum(l.qty * l.unit_cost), 0)::numeric(18,2)::text FROM stock_adjustment_lines l WHERE l.adjustment_id = a.id) AS value
  FROM stock_adjustments a JOIN warehouses w ON w.id = a.warehouse_id`;

export async function listAdjustments(
  db: Queryable,
  limit: number,
  offset: number,
): Promise<{ rows: Required<Omit<Adjustment, 'lines'>>[]; total: number }> {
  const total = Number((await db.query<{ n: string }>('SELECT count(*) AS n FROM stock_adjustments')).rows[0]!.n);
  const rows = await db.query<Required<Omit<Adjustment, 'lines'>>>(
    `${ADJ_SELECT} ORDER BY a.trx_at DESC, a.number DESC LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return { rows: rows.rows, total };
}

export async function getAdjustment(db: Queryable, id: string): Promise<Required<Adjustment> | null> {
  const head = (await db.query<Required<Omit<Adjustment, 'lines'>>>(`${ADJ_SELECT} WHERE a.id = $1`, [id])).rows[0];
  if (!head) return null;
  const lines = await db.query<Required<AdjustmentLine>>(
    `SELECT l.id, l.product_id AS "productId", p.sku, p.name, u.code AS "baseUnitCode", l.qty::text AS qty, l.unit_cost::text AS "unitCost"
     FROM stock_adjustment_lines l JOIN products p ON p.id = l.product_id JOIN units u ON u.id = p.base_unit_id
     WHERE l.adjustment_id = $1 ORDER BY l.id`,
    [id],
  );
  return { ...head, lines: lines.rows };
}

// ------------------------------------------------------------------ stock opname
export async function insertOpname(
  db: Queryable,
  o: { id: string; number: string; warehouseId: string; note: string | null; createdBy: string | null },
): Promise<void> {
  await db.query('INSERT INTO stock_opnames (id, number, warehouse_id, note, created_by) VALUES ($1, $2, $3, $4, $5)', [
    o.id,
    o.number,
    o.warehouseId,
    o.note,
    o.createdBy,
  ]);
}

export interface OpnameHead {
  id: string;
  number: string;
  status: Opname['status'];
  note: string | null;
  warehouseId: string;
  warehouseCode: string;
  startedAt: string;
  postedAt: string | null;
  lineCount: number;
}

const OPNAME_SELECT = `
  SELECT o.id, o.number, o.status, o.note, o.warehouse_id AS "warehouseId", w.code AS "warehouseCode",
         o.started_at AS "startedAt", o.posted_at AS "postedAt",
         (SELECT count(*) FROM stock_opname_lines l WHERE l.opname_id = o.id)::int AS "lineCount"
  FROM stock_opnames o JOIN warehouses w ON w.id = o.warehouse_id`;

export async function getOpnameHead(db: Queryable, id: string, forUpdate = false): Promise<OpnameHead | null> {
  return (
    (await db.query<OpnameHead>(`${OPNAME_SELECT} WHERE o.id = $1${forUpdate ? ' FOR UPDATE OF o' : ''}`, [id]))
      .rows[0] ?? null
  );
}

export async function listOpnames(
  db: Queryable,
  limit: number,
  offset: number,
): Promise<{ rows: OpnameHead[]; total: number }> {
  const total = Number((await db.query<{ n: string }>('SELECT count(*) AS n FROM stock_opnames')).rows[0]!.n);
  const rows = await db.query<OpnameHead>(`${OPNAME_SELECT} ORDER BY o.started_at DESC LIMIT $1 OFFSET $2`, [
    limit,
    offset,
  ]);
  return { rows: rows.rows, total };
}

/**
 * Lines with the system qty: live physical stock while COUNTING, the posting snapshot afterwards.
 * cost = posted unit_cost, else the FIFO average of the open layers, else the last purchase cost.
 */
export async function opnameLines(
  db: Queryable,
  id: string,
): Promise<(Required<Omit<OpnameLine, 'diffValue'>> & { status: string })[]> {
  return (
    await db.query<Required<Omit<OpnameLine, 'diffValue'>> & { status: string }>(
      `SELECT l.id, l.product_id AS "productId", p.sku, p.name, bu.code AS "baseUnitCode",
              coalesce(su.code, bu.code) AS "saleUnitCode", trim_scale(coalesce(su.conversion_qty, 1))::text AS "saleConversion",
              l.counted_qty::text AS "countedQty",
              CASE WHEN o.status = 'POSTED' THEN l.system_qty ELSE coalesce(b.qty, 0) END::numeric(18,4)::text AS "systemQty",
              CASE WHEN o.status = 'POSTED' THEN l.diff_qty ELSE l.counted_qty - coalesce(b.qty, 0) END::numeric(18,4)::text AS "diffQty",
              l.counted_at AS "countedAt", o.status,
              coalesce(l.unit_cost,
                       (SELECT round(sum(c.qty_remaining * c.unit_cost) / nullif(sum(c.qty_remaining), 0), 4)
                        FROM stock_cost_layers c WHERE c.product_id = l.product_id AND c.warehouse_id = o.warehouse_id AND c.qty_remaining > 0),
                       p.last_purchase_cost)::text AS "unitCost"
       FROM stock_opname_lines l
       JOIN stock_opnames o ON o.id = l.opname_id
       JOIN products p ON p.id = l.product_id
       JOIN units bu ON bu.id = p.base_unit_id
       LEFT JOIN LATERAL (
         SELECT u.code, pu.conversion_qty FROM product_units pu JOIN units u ON u.id = pu.unit_id
         WHERE pu.product_id = p.id AND pu.is_default_sale AND pu.deleted_at IS NULL LIMIT 1) su ON true
       LEFT JOIN stock_balances b ON b.product_id = l.product_id AND b.warehouse_id = o.warehouse_id
       WHERE l.opname_id = $1
       ORDER BY p.name, p.sku`,
      [id],
    )
  ).rows;
}

export async function upsertOpnameLine(
  db: Queryable,
  l: {
    id: string;
    opnameId: string;
    productId: string;
    countedQty: string;
    countedBy: string | null;
    deviceId: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO stock_opname_lines (id, opname_id, product_id, counted_qty, counted_by, device_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (opname_id, product_id) DO UPDATE
       SET counted_qty = EXCLUDED.counted_qty, counted_by = EXCLUDED.counted_by, device_id = EXCLUDED.device_id, counted_at = now()`,
    [l.id, l.opnameId, l.productId, l.countedQty, l.countedBy, l.deviceId],
  );
}

export async function deleteOpnameLine(db: Queryable, opnameId: string, lineId: string): Promise<boolean> {
  const r = await db.query('DELETE FROM stock_opname_lines WHERE id = $1 AND opname_id = $2', [lineId, opnameId]);
  return r.rowCount === 1;
}

export async function rawOpnameLines(
  db: Queryable,
  opnameId: string,
): Promise<{ id: string; productId: string; countedQty: string }[]> {
  return (
    await db.query<{ id: string; productId: string; countedQty: string }>(
      'SELECT id, product_id AS "productId", counted_qty::text AS "countedQty" FROM stock_opname_lines WHERE opname_id = $1 ORDER BY product_id',
      [opnameId],
    )
  ).rows;
}

export async function setOpnameLineResults(
  db: Queryable,
  rows: { id: string; systemQty: string; diffQty: string; unitCost: string | null }[],
): Promise<void> {
  if (rows.length === 0) return;
  await db.query(
    `UPDATE stock_opname_lines l SET system_qty = r.sys, diff_qty = r.diff, unit_cost = r.cost
     FROM unnest($1::uuid[], $2::numeric[], $3::numeric[], $4::numeric[]) AS r(id, sys, diff, cost) WHERE l.id = r.id`,
    [rows.map((r) => r.id), rows.map((r) => r.systemQty), rows.map((r) => r.diffQty), rows.map((r) => r.unitCost)],
  );
}

export async function setOpnameStatus(
  db: Queryable,
  id: string,
  status: 'POSTED' | 'CANCELLED',
  postedBy: string | null,
): Promise<void> {
  await db.query(
    `UPDATE stock_opnames SET status = $2, posted_at = CASE WHEN $2 = 'POSTED' THEN now() END, posted_by = CASE WHEN $2 = 'POSTED' THEN $3::uuid END WHERE id = $1`,
    [id, status, postedBy],
  );
}
