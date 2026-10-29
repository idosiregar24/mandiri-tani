// SQL for pickup notes AB (sprint-7). No business rules here.
import type { OutstandingLine, Pickup, PickupListItem, PickupMethod } from '@shared/schemas/pickups';
import type { Queryable } from '../../db/pool';
import { likePattern } from '../../lib/http';

const REMAINING = '(i.qty - i.picked_up_qty - i.cancelled_qty)';

export async function outstanding(
  db: Queryable,
  opts: { customerId?: string; q?: string },
): Promise<OutstandingLine[]> {
  const where = [`s.status = 'COMPLETED'`, `s.fulfillment_status IN ('PENDING','PARTIAL')`, `${REMAINING} > 0`];
  const params: unknown[] = [];
  if (opts.customerId) {
    params.push(opts.customerId);
    where.push(`s.customer_id = $${params.length}`);
  }
  if (opts.q) {
    params.push(likePattern(opts.q));
    where.push(`(s.number ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
  }
  const r = await db.query<OutstandingLine>(
    `SELECT i.id AS "saleItemId", s.id AS "saleId", s.number AS "saleNumber", to_json(s.trx_at) #>> '{}' AS "saleDate",
            c.id AS "customerId", c.name AS "customerName", i.product_name AS "productName", p.sku, i.unit_code AS "unitCode",
            trim_scale(i.qty)::text AS qty, trim_scale(i.picked_up_qty)::text AS "pickedUpQty",
            trim_scale(${REMAINING})::text AS "remainingQty", p.allow_decimal_qty AS "allowDecimalQty",
            ((now() AT TIME ZONE 'Asia/Jakarta')::date - (s.trx_at AT TIME ZONE 'Asia/Jakarta')::date) AS "ageDays"
     FROM sale_items i JOIN sales s ON s.id = i.sale_id JOIN customers c ON c.id = s.customer_id
     JOIN products p ON p.id = i.product_id
     WHERE ${where.join(' AND ')}
     ORDER BY s.trx_at, s.number, i.line_no
     LIMIT 300`,
    params,
  );
  return r.rows;
}

export interface LockedItem {
  id: string;
  saleId: string;
  saleNumber: string;
  saleStatus: string;
  fulfillmentStatus: string;
  customerId: string;
  productId: string;
  productName: string;
  conversionQty: string;
  remaining: string;
  trackStock: boolean;
  allowDecimalQty: boolean;
}

/** Locks the sale lines in id order (consistent lock order between concurrent pickups). */
export async function lockItems(db: Queryable, ids: string[]): Promise<Map<string, LockedItem>> {
  const r = await db.query<LockedItem>(
    `SELECT i.id, s.id AS "saleId", s.number AS "saleNumber", s.status AS "saleStatus",
            s.fulfillment_status AS "fulfillmentStatus", s.customer_id AS "customerId", i.product_id AS "productId",
            i.product_name AS "productName", trim_scale(i.conversion_qty)::text AS "conversionQty",
            trim_scale(${REMAINING})::text AS remaining, p.track_stock AS "trackStock",
            p.allow_decimal_qty AS "allowDecimalQty"
     FROM sale_items i JOIN sales s ON s.id = i.sale_id JOIN products p ON p.id = i.product_id
     WHERE i.id = ANY($1::uuid[])
     ORDER BY i.id
     FOR UPDATE OF i`,
    [ids],
  );
  return new Map(r.rows.map((x) => [x.id, x]));
}

export async function idByClientOp(db: Queryable, clientOpId: string): Promise<string | null> {
  return (
    (await db.query<{ id: string }>(`SELECT id FROM sale_pickups WHERE client_op_id = $1`, [clientOpId])).rows[0]?.id ??
    null
  );
}

export async function insertPickup(
  db: Queryable,
  p: {
    id: string;
    number: string;
    customerId: string;
    warehouseId: string;
    method: PickupMethod;
    pickedUpAt: Date;
    receiverName: string;
    receiverPhone: string | null;
    vehicle: string | null;
    driverName: string | null;
    destination: string | null;
    note: string | null;
    createdBy: string;
    deviceId: string;
    clientOpId: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO sale_pickups (id, number, customer_id, warehouse_id, method, picked_up_at, receiver_name, receiver_phone,
       vehicle, driver_name, destination, note, created_by, device_id, client_op_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      p.id,
      p.number,
      p.customerId,
      p.warehouseId,
      p.method,
      p.pickedUpAt,
      p.receiverName,
      p.receiverPhone,
      p.vehicle,
      p.driverName,
      p.destination,
      p.note,
      p.createdBy,
      p.deviceId,
      p.clientOpId,
    ],
  );
}

export async function insertPickupItem(
  db: Queryable,
  i: { id: string; pickupId: string; saleItemId: string; qty: string; baseQty: string; unitCost: string },
): Promise<void> {
  await db.query(
    `INSERT INTO sale_pickup_items (id, pickup_id, sale_item_id, qty, base_qty, unit_cost) VALUES ($1,$2,$3,$4,$5,$6)`,
    [i.id, i.pickupId, i.saleItemId, i.qty, i.baseQty, i.unitCost],
  );
}

/**
 * Picked qty and the line's cost: cost_total = Σ cost of what left the warehouse, cost_per_base =
 * its weighted average (NULL while nothing is picked up yet). `sign` −1 reverses a cancelled pickup.
 */
export async function addPicked(
  db: Queryable,
  saleItemId: string,
  qty: string,
  cost: string,
  sign: 1 | -1,
): Promise<void> {
  await db.query(
    `UPDATE sale_items SET
       picked_up_qty = picked_up_qty + $4 * $2::numeric,
       cost_total = nullif(coalesce(cost_total, 0) + $4 * $3::numeric, 0),
       cost_per_base = CASE WHEN picked_up_qty + $4 * $2::numeric > 0
         THEN round((coalesce(cost_total, 0) + $4 * $3::numeric) / ((picked_up_qty + $4 * $2::numeric) * conversion_qty), 4)
         END
     WHERE id = $1`,
    [saleItemId, qty, cost, sign],
  );
}

/** PENDING / PARTIAL / COMPLETE from the lines' picked + cancelled quantities. */
export async function refreshFulfillment(db: Queryable, saleIds: string[]): Promise<void> {
  await db.query(
    `UPDATE sales s SET fulfillment_status = CASE
        WHEN NOT EXISTS (SELECT 1 FROM sale_items i WHERE i.sale_id = s.id AND i.picked_up_qty + i.cancelled_qty < i.qty)
             AND NOT EXISTS (SELECT 1 FROM sale_items i WHERE i.sale_id = s.id AND i.picked_up_qty > 0) THEN 'CANCELLED'
        WHEN NOT EXISTS (SELECT 1 FROM sale_items i WHERE i.sale_id = s.id AND i.picked_up_qty + i.cancelled_qty < i.qty) THEN 'COMPLETE'
        WHEN EXISTS (SELECT 1 FROM sale_items i WHERE i.sale_id = s.id AND i.picked_up_qty > 0) THEN 'PARTIAL'
        ELSE 'PENDING' END
     WHERE s.id = ANY($1::uuid[]) AND s.fulfillment_status IN ('PENDING','PARTIAL','COMPLETE')`,
    [saleIds],
  );
}

export async function lockPickup(db: Queryable, id: string) {
  const r = await db.query<{ id: string; number: string; status: Pickup['status']; pickedUpAt: Date }>(
    `SELECT id, number, status, picked_up_at AS "pickedUpAt" FROM sale_pickups WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function pickupItems(
  db: Queryable,
  pickupId: string,
): Promise<{ saleItemId: string; saleId: string; qty: string; baseQty: string; unitCost: string }[]> {
  const r = await db.query<{ saleItemId: string; saleId: string; qty: string; baseQty: string; unitCost: string }>(
    `SELECT pi.sale_item_id AS "saleItemId", i.sale_id AS "saleId", pi.qty::text, pi.base_qty::text AS "baseQty",
            pi.unit_cost::text AS "unitCost"
     FROM sale_pickup_items pi JOIN sale_items i ON i.id = pi.sale_item_id WHERE pi.pickup_id = $1 ORDER BY i.id`,
    [pickupId],
  );
  return r.rows;
}

/** FIFO layers a pickup consumed — recreated exactly when it is cancelled. */
export async function pickupConsumptions(db: Queryable, pickupId: string) {
  const r = await db.query<{
    productId: string;
    warehouseId: string;
    lineId: string | null;
    qty: string;
    unitCost: string;
    receivedAt: Date | null;
  }>(
    `SELECT m.product_id AS "productId", m.warehouse_id AS "warehouseId", m.source_line_id AS "lineId",
            c.qty::text, c.unit_cost::text AS "unitCost", l.received_at AS "receivedAt"
     FROM stock_movements m JOIN stock_layer_consumptions c ON c.movement_id = m.id
     LEFT JOIN stock_cost_layers l ON l.id = c.layer_id
     WHERE m.source_type = 'SALE_PICKUP' AND m.source_id = $1
     ORDER BY m.seq, c.created_at`,
    [pickupId],
  );
  return r.rows;
}

export async function markCancelled(db: Queryable, id: string, by: string, at: Date, reason: string): Promise<void> {
  await db.query(
    `UPDATE sale_pickups SET status = 'CANCELLED', cancelled_at = $3, cancelled_by = $2, cancel_reason = $4 WHERE id = $1`,
    [id, by, at, reason],
  );
}

export async function get(db: Queryable, id: string): Promise<Pickup | null> {
  const r = await db.query<Pickup>(
    `SELECT p.id, p.number, p.status, p.method, to_json(p.picked_up_at) #>> '{}' AS "pickedUpAt",
            json_build_object('id', c.id, 'name', c.name, 'address', c.address) AS customer,
            p.receiver_name AS "receiverName", p.receiver_phone AS "receiverPhone", p.vehicle, p.driver_name AS "driverName",
            p.destination, p.note, json_build_object('id', u.id, 'fullName', u.full_name) AS "createdBy",
            to_json(p.cancelled_at) #>> '{}' AS "cancelledAt", p.cancel_reason AS "cancelReason",
            coalesce((SELECT json_agg(json_build_object(
                'saleItemId', i.id, 'saleNumber', s.number, 'productName', i.product_name, 'sku', pr.sku,
                'unitCode', i.unit_code, 'qty', trim_scale(pi.qty)::text,
                'remainingQty', trim_scale(i.qty - i.picked_up_qty - i.cancelled_qty)::text) ORDER BY s.trx_at, i.line_no)
              FROM sale_pickup_items pi JOIN sale_items i ON i.id = pi.sale_item_id JOIN sales s ON s.id = i.sale_id
              JOIN products pr ON pr.id = i.product_id WHERE pi.pickup_id = p.id), '[]'::json) AS lines
     FROM sale_pickups p JOIN customers c ON c.id = p.customer_id JOIN users u ON u.id = p.created_by
     WHERE p.id = $1`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function list(
  db: Queryable,
  opts: { customerId?: string; limit: number; offset: number },
): Promise<{ rows: PickupListItem[]; total: number }> {
  const params: unknown[] = [];
  let where = 'TRUE';
  if (opts.customerId) {
    params.push(opts.customerId);
    where = `p.customer_id = $1`;
  }
  const total = Number(
    (await db.query<{ n: string }>(`SELECT count(*) AS n FROM sale_pickups p WHERE ${where}`, params)).rows[0]!.n,
  );
  params.push(opts.limit, opts.offset);
  const r = await db.query<PickupListItem>(
    `SELECT p.id, p.number, p.status, p.method, to_json(p.picked_up_at) #>> '{}' AS "pickedUpAt", c.name AS "customerName",
            p.receiver_name AS "receiverName", (SELECT count(*)::int FROM sale_pickup_items pi WHERE pi.pickup_id = p.id) AS "itemCount"
     FROM sale_pickups p JOIN customers c ON c.id = p.customer_id
     WHERE ${where}
     ORDER BY p.picked_up_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows: r.rows, total };
}
