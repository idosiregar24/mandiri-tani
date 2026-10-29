// SQL for sales documents (sprint-6). No business rules here.
import type { PriceRow } from '@shared/pricing';
import type { HeldSaleItem, Sale, SaleLine, SaleListItem, SalePayment } from '@shared/schemas/sales';
import type { Queryable } from '../../db/pool';
import { likePattern } from '../../lib/http';

export interface SaleCustomer {
  id: string;
  name: string;
  isWalkIn: boolean;
  isActive: boolean;
  groupId: string | null;
  creditLimit: string | null;
  termDays: number;
}

const CUSTOMER_SELECT = `SELECT id, name, is_walk_in AS "isWalkIn", is_active AS "isActive",
  customer_group_id AS "groupId", credit_limit::text AS "creditLimit", payment_term_days AS "termDays"
  FROM customers WHERE deleted_at IS NULL`;

export async function customer(db: Queryable, id: string): Promise<SaleCustomer | null> {
  return (await db.query<SaleCustomer>(`${CUSTOMER_SELECT} AND id = $1`, [id])).rows[0] ?? null;
}

export async function walkInCustomer(db: Queryable): Promise<SaleCustomer> {
  const r = await db.query<SaleCustomer>(`${CUSTOMER_SELECT} AND is_walk_in`);
  if (!r.rows[0]) throw new Error('walk-in customer missing (seed_master_defaults)');
  return r.rows[0];
}

/** Open credit of a customer (for the credit limit check). */
export async function openReceivables(db: Queryable, customerId: string): Promise<string> {
  const r = await db.query<{ open: string }>(
    `SELECT coalesce(sum(amount - paid_amount), 0)::text AS open FROM receivables
     WHERE customer_id = $1 AND status IN ('OPEN','PARTIAL')`,
    [customerId],
  );
  return r.rows[0]!.open;
}

export interface SaleUnit {
  productUnitId: string;
  productId: string;
  productName: string;
  sku: string;
  unitCode: string;
  conversionQty: string;
  trackStock: boolean;
  allowDecimalQty: boolean;
  usable: boolean;
  prices: PriceRow[];
}

export async function saleUnits(db: Queryable, unitIds: string[]): Promise<Map<string, SaleUnit>> {
  const r = await db.query<SaleUnit>(
    `SELECT pu.id AS "productUnitId", p.id AS "productId", p.name AS "productName", p.sku, u.code AS "unitCode",
            trim_scale(pu.conversion_qty)::text AS "conversionQty", p.track_stock AS "trackStock",
            p.allow_decimal_qty AS "allowDecimalQty",
            (p.is_active AND p.deleted_at IS NULL AND pu.deleted_at IS NULL AND pu.is_sellable) AS usable,
            coalesce((SELECT json_agg(json_build_object('customerGroupId', pp.customer_group_id,
                       'minQty', trim_scale(pp.min_qty)::text, 'price', pp.price::text))
                      FROM product_prices pp WHERE pp.product_unit_id = pu.id AND pp.deleted_at IS NULL), '[]'::json) AS prices
     FROM product_units pu JOIN products p ON p.id = pu.product_id JOIN units u ON u.id = pu.unit_id
     WHERE pu.id = ANY($1::uuid[])`,
    [unitIds],
  );
  return new Map(r.rows.map((x) => [x.productUnitId, x]));
}

export interface PaymentMethodRow {
  id: string;
  name: string;
  kind: SalePayment['kind'];
  cashAccountId: string | null;
  isActive: boolean;
}

export async function paymentMethods(db: Queryable, ids: string[]): Promise<Map<string, PaymentMethodRow>> {
  const r = await db.query<PaymentMethodRow>(
    `SELECT id, name, kind, cash_account_id AS "cashAccountId", (is_active AND deleted_at IS NULL) AS "isActive"
     FROM payment_methods WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  return new Map(r.rows.map((x) => [x.id, x]));
}

export async function cashAccountId(db: Queryable, code: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `SELECT id FROM cash_accounts WHERE upper(code) = $1 AND deleted_at IS NULL`,
    [code],
  );
  if (!r.rows[0]) throw new Error(`cash account ${code} missing`);
  return r.rows[0].id;
}

export async function cashCategoryId(db: Queryable, code: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `SELECT id FROM cash_categories WHERE upper(code) = $1 AND deleted_at IS NULL`,
    [code],
  );
  if (!r.rows[0]) throw new Error(`cash category ${code} missing`);
  return r.rows[0].id;
}

export async function saleIdByClientOp(db: Queryable, clientOpId: string): Promise<string | null> {
  return (
    (await db.query<{ id: string }>(`SELECT id FROM sales WHERE client_op_id = $1`, [clientOpId])).rows[0]?.id ?? null
  );
}

export interface SaleRow {
  id: string;
  number: string;
  channel: Sale['channel'];
  deviceId: string;
  cashierId: string;
  customerId: string;
  customerGroupId: string | null;
  warehouseId: string;
  trxAt: Date;
  subtotal: string;
  discountAmount: string;
  otherCharges: string;
  otherChargesNote: string | null;
  total: string;
  fulfillmentStatus: Sale['fulfillmentStatus'];
  pickupNote: string | null;
  paidAmount: string;
  creditAmount: string;
  changeAmount: string;
  dueDate: string | null;
  note: string | null;
  approvedBy: string | null;
  clientOpId: string | null;
}

export async function insertSale(db: Queryable, s: SaleRow): Promise<void> {
  await db.query(
    `INSERT INTO sales (id, number, status, channel, device_id, cashier_id, customer_id, customer_group_id, warehouse_id,
       trx_at, subtotal, discount_amount, other_charges, other_charges_note, total, fulfillment_status, pickup_note,
       paid_amount, credit_amount, change_amount, due_date, note, approved_by, client_op_id)
     VALUES ($1,$2,'COMPLETED',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
    [
      s.id,
      s.number,
      s.channel,
      s.deviceId,
      s.cashierId,
      s.customerId,
      s.customerGroupId,
      s.warehouseId,
      s.trxAt,
      s.subtotal,
      s.discountAmount,
      s.otherCharges,
      s.otherChargesNote,
      s.total,
      s.fulfillmentStatus,
      s.pickupNote,
      s.paidAmount,
      s.creditAmount,
      s.changeAmount,
      s.dueDate,
      s.note,
      s.approvedBy,
      s.clientOpId,
    ],
  );
}

export interface SaleItemRow {
  id: string;
  saleId: string;
  lineNo: number;
  productId: string;
  productUnitId: string;
  productName: string;
  unitCode: string;
  conversionQty: string;
  qty: string;
  baseQty: string;
  unitPrice: string;
  listPrice: string | null;
  priceSource: SaleLine['priceSource'];
  allocatedDiscount: string;
  lineTotal: string;
  netAmount: string;
  costPerBase: string | null;
  costTotal: string | null;
  pickedUpQty: string;
}

export async function insertItems(db: Queryable, items: SaleItemRow[]): Promise<void> {
  for (const i of items) {
    await db.query(
      `INSERT INTO sale_items (id, sale_id, line_no, product_id, product_unit_id, product_name, unit_code, conversion_qty,
         qty, base_qty, unit_price, list_price, price_source, discount_amount, allocated_discount, line_total, net_amount,
         cost_per_base, cost_total, picked_up_qty)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,$14,$15,$16,$17,$18,$19)`,
      [
        i.id,
        i.saleId,
        i.lineNo,
        i.productId,
        i.productUnitId,
        i.productName,
        i.unitCode,
        i.conversionQty,
        i.qty,
        i.baseQty,
        i.unitPrice,
        i.listPrice,
        i.priceSource,
        i.allocatedDiscount,
        i.lineTotal,
        i.netAmount,
        i.costPerBase,
        i.costTotal,
        i.pickedUpQty,
      ],
    );
  }
}

export async function insertPayment(
  db: Queryable,
  p: { id: string; saleId: string; paymentMethodId: string; amount: string; reference: string | null },
): Promise<void> {
  await db.query(
    `INSERT INTO sale_payments (id, sale_id, payment_method_id, amount, reference) VALUES ($1,$2,$3,$4,$5)`,
    [p.id, p.saleId, p.paymentMethodId, p.amount, p.reference],
  );
}

export async function insertReceivable(
  db: Queryable,
  r: {
    id: string;
    customerId: string;
    saleId: string;
    number: string;
    docDate: string;
    dueDate: string;
    amount: string;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO receivables (id, customer_id, source_type, source_id, doc_number, doc_date, due_date, amount)
     VALUES ($1,$2,'SALE',$3,$4,$5,$6,$7)`,
    [r.id, r.customerId, r.saleId, r.number, r.docDate, r.dueDate, r.amount],
  );
}

export async function insertCash(
  db: Queryable,
  c: {
    id: string;
    cashAccountId: string;
    categoryId: string;
    trxAt: Date;
    direction: 'IN' | 'OUT';
    amount: string;
    sourceType: 'SALE' | 'SALE_VOID' | 'SALE_RETURN' | 'PURCHASE_INVOICE' | 'PURCHASE_RETURN' | 'AR_PAYMENT' | 'AP_PAYMENT';
    sourceId: string;
    note: string | null;
    createdBy: string;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO cash_transactions (id, cash_account_id, cash_category_id, trx_at, direction, amount, source_type, source_id, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      c.id,
      c.cashAccountId,
      c.categoryId,
      c.trxAt,
      c.direction,
      c.amount,
      c.sourceType,
      c.sourceId,
      c.note,
      c.createdBy,
    ],
  );
}

/** Cash rows of a sale (to reverse them on void). */
export async function cashOfSale(
  db: Queryable,
  saleId: string,
): Promise<{ cashAccountId: string; direction: 'IN' | 'OUT'; amount: string }[]> {
  const r = await db.query<{ cashAccountId: string; direction: 'IN' | 'OUT'; amount: string }>(
    `SELECT cash_account_id AS "cashAccountId", direction, amount::text FROM cash_transactions
     WHERE source_type = 'SALE' AND source_id = $1`,
    [saleId],
  );
  return r.rows;
}

/** Every FIFO layer a sale's SALE movements consumed — to recreate them exactly on void. */
export async function saleConsumptions(
  db: Queryable,
  saleId: string,
): Promise<
  {
    productId: string;
    warehouseId: string;
    lineId: string | null;
    qty: string;
    unitCost: string;
    receivedAt: Date | null;
  }[]
> {
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
     WHERE m.source_type = 'SALE' AND m.source_id = $1
     ORDER BY m.seq, c.created_at`,
    [saleId],
  );
  return r.rows;
}

export async function lockSale(
  db: Queryable,
  id: string,
): Promise<{
  id: string;
  number: string;
  status: Sale['status'];
  trxAt: Date;
  customerId: string;
  fulfillmentStatus: Sale['fulfillmentStatus'];
} | null> {
  const r = await db.query<{
    id: string;
    number: string;
    status: Sale['status'];
    trxAt: Date;
    customerId: string;
    fulfillmentStatus: Sale['fulfillmentStatus'];
  }>(
    `SELECT id, number, status, trx_at AS "trxAt", customer_id AS "customerId", fulfillment_status AS "fulfillmentStatus"
     FROM sales WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function markVoided(db: Queryable, id: string, by: string, at: Date, reason: string): Promise<void> {
  await db.query(
    `UPDATE sales SET status = 'VOIDED', voided_at = $3, voided_by = $2, void_reason = $4,
       fulfillment_status = CASE WHEN fulfillment_status IN ('PENDING','PARTIAL') THEN 'CANCELLED' ELSE fulfillment_status END
     WHERE id = $1`,
    [id, by, at, reason],
  );
}

/** Receivable of a sale; refuses to void a credit sale that already received payments. */
export async function voidReceivable(db: Queryable, saleId: string): Promise<'none' | 'voided' | 'has_payments'> {
  const r = await db.query<{ id: string; paid: boolean }>(
    `SELECT id, paid_amount > 0 AS paid FROM receivables WHERE source_type = 'SALE' AND source_id = $1 FOR UPDATE`,
    [saleId],
  );
  const rec = r.rows[0];
  if (!rec) return 'none';
  if (rec.paid) return 'has_payments';
  await db.query(`UPDATE receivables SET status = 'VOIDED' WHERE id = $1`, [rec.id]);
  return 'voided';
}

// ------------------------------------------------------------------ reading

export async function get(db: Queryable, id: string): Promise<Sale | null> {
  const r = await db.query<Sale & { costTotal: string | null }>(
    `SELECT s.id, s.number, s.status, s.channel, to_json(s.trx_at) #>> '{}' AS "trxAt",
            json_build_object('id', c.id, 'code', c.code, 'name', c.name, 'address', c.address, 'isWalkIn', c.is_walk_in, 'groupName', g.name) AS customer,
            json_build_object('id', u.id, 'fullName', u.full_name) AS cashier,
            s.subtotal::text, s.discount_amount::text AS "discountAmount", s.other_charges::text AS "otherCharges",
            s.other_charges_note AS "otherChargesNote", s.total::text, s.paid_amount::text AS "paidAmount",
            s.credit_amount::text AS "creditAmount", s.change_amount::text AS "changeAmount", s.due_date AS "dueDate",
            s.fulfillment_status AS "fulfillmentStatus", s.pickup_note AS "pickupNote", s.note,
            s.approved_by AS "approvedBy", to_json(s.voided_at) #>> '{}' AS "voidedAt", s.void_reason AS "voidReason",
            (SELECT sum(i.cost_total)::text FROM sale_items i WHERE i.sale_id = s.id) AS "costTotal",
            coalesce((SELECT json_agg(json_build_object(
                'id', i.id, 'lineNo', i.line_no, 'productId', i.product_id, 'productUnitId', i.product_unit_id,
                'productName', i.product_name, 'sku', p.sku, 'unitCode', i.unit_code,
                'conversionQty', trim_scale(i.conversion_qty)::text, 'qty', trim_scale(i.qty)::text,
                'unitPrice', i.unit_price::text, 'listPrice', i.list_price::text, 'priceSource', i.price_source,
                'discountAmount', i.discount_amount::text, 'allocatedDiscount', i.allocated_discount::text,
                'lineTotal', i.line_total::text, 'pickedUpQty', trim_scale(i.picked_up_qty)::text,
                'returnedQty', trim_scale(coalesce((SELECT sum(ri.qty) FROM sale_return_items ri WHERE ri.sale_item_id = i.id), 0))::text,
                'costPerBase', i.cost_per_base::text, 'costTotal', i.cost_total::text) ORDER BY i.line_no)
              FROM sale_items i JOIN products p ON p.id = i.product_id WHERE i.sale_id = s.id), '[]'::json) AS lines,
            coalesce((SELECT json_agg(json_build_object(
                'paymentMethodId', pm.id, 'methodName', pm.name, 'kind', pm.kind,
                'amount', sp.amount::text, 'reference', sp.reference) ORDER BY sp.created_at, sp.id)
              FROM sale_payments sp JOIN payment_methods pm ON pm.id = sp.payment_method_id WHERE sp.sale_id = s.id), '[]'::json) AS payments
     FROM sales s
     JOIN customers c ON c.id = s.customer_id
     LEFT JOIN customer_groups g ON g.id = s.customer_group_id
     JOIN users u ON u.id = s.cashier_id
     WHERE s.id = $1`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function list(
  db: Queryable,
  opts: { date?: string; q?: string; status?: Sale['status']; cashierId?: string; limit: number; offset: number },
): Promise<{ rows: SaleListItem[]; total: number }> {
  const where = [`s.status <> 'HELD'`];
  const params: unknown[] = [];
  if (opts.date) {
    params.push(opts.date);
    where.push(`(s.trx_at AT TIME ZONE 'Asia/Jakarta')::date = $${params.length}::date`);
  }
  if (opts.status) {
    params.push(opts.status);
    where.push(`s.status = $${params.length}`);
  }
  if (opts.cashierId) {
    params.push(opts.cashierId);
    where.push(`s.cashier_id = $${params.length}`);
  }
  if (opts.q) {
    params.push(likePattern(opts.q));
    where.push(`(s.number ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
  }
  const clause = where.join(' AND ');
  const total = Number(
    (
      await db.query<{ n: string }>(
        `SELECT count(*) AS n FROM sales s JOIN customers c ON c.id = s.customer_id WHERE ${clause}`,
        params,
      )
    ).rows[0]!.n,
  );
  params.push(opts.limit, opts.offset);
  const r = await db.query<SaleListItem>(
    `SELECT s.id, s.number, s.status, s.channel, to_json(s.trx_at) #>> '{}' AS "trxAt", c.name AS "customerName",
            (SELECT count(*)::int FROM sale_items i WHERE i.sale_id = s.id) AS "itemCount",
            s.total::text, s.credit_amount::text AS "creditAmount", s.fulfillment_status AS "fulfillmentStatus"
     FROM sales s JOIN customers c ON c.id = s.customer_id
     WHERE ${clause}
     ORDER BY s.trx_at DESC, s.number DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows: r.rows, total };
}

// ------------------------------------------------------------------ held notes (sprint-7 S7-1)

export async function insertHeld(
  db: Queryable,
  h: {
    id: string;
    channel: Sale['channel'];
    deviceId: string;
    cashierId: string;
    customerId: string;
    customerGroupId: string | null;
    warehouseId: string;
    trxAt: Date;
    holdLabel: string;
    subtotal: string;
    discountAmount: string;
    otherCharges: string;
    otherChargesNote: string | null;
    total: string;
    note: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO sales (id, number, status, channel, device_id, cashier_id, customer_id, customer_group_id, warehouse_id,
       trx_at, hold_label, subtotal, discount_amount, other_charges, other_charges_note, total, note)
     VALUES ($1, NULL, 'HELD', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      h.id,
      h.channel,
      h.deviceId,
      h.cashierId,
      h.customerId,
      h.customerGroupId,
      h.warehouseId,
      h.trxAt,
      h.holdLabel,
      h.subtotal,
      h.discountAmount,
      h.otherCharges,
      h.otherChargesNote,
      h.total,
      h.note,
    ],
  );
}

export async function listHeld(db: Queryable): Promise<HeldSaleItem[]> {
  const r = await db.query<HeldSaleItem>(
    `SELECT s.id, s.hold_label AS "holdLabel", s.channel, c.name AS "customerName",
            (SELECT count(*)::int FROM sale_items i WHERE i.sale_id = s.id) AS "itemCount",
            s.total::text, to_json(s.trx_at) #>> '{}' AS "trxAt", u.full_name AS "cashierName"
     FROM sales s JOIN customers c ON c.id = s.customer_id JOIN users u ON u.id = s.cashier_id
     WHERE s.status = 'HELD' ORDER BY s.trx_at`,
  );
  return r.rows;
}

export async function lockHeld(db: Queryable, id: string) {
  const r = await db.query<{
    channel: Sale['channel'];
    customer: { id: string; name: string; isWalkIn: boolean; groupId: string | null; groupName: string | null };
    discountAmount: string;
    otherCharges: string;
    otherChargesNote: string | null;
    lines: {
      productId: string;
      productUnitId: string;
      qty: string;
      unitPrice: string;
      priceSource: SaleLine['priceSource'];
    }[];
  }>(
    `SELECT s.channel,
            json_build_object('id', c.id, 'name', c.name, 'isWalkIn', c.is_walk_in, 'groupId', c.customer_group_id, 'groupName', g.name) AS customer,
            s.discount_amount::text AS "discountAmount", s.other_charges::text AS "otherCharges",
            s.other_charges_note AS "otherChargesNote",
            coalesce((SELECT json_agg(json_build_object('productId', i.product_id, 'productUnitId', i.product_unit_id,
                        'qty', trim_scale(i.qty)::text, 'unitPrice', i.unit_price::text, 'priceSource', i.price_source)
                        ORDER BY i.line_no) FROM sale_items i WHERE i.sale_id = s.id), '[]'::json) AS lines
     FROM sales s JOIN customers c ON c.id = s.customer_id LEFT JOIN customer_groups g ON g.id = c.customer_group_id
     WHERE s.id = $1 AND s.status = 'HELD'
     FOR UPDATE OF s`,
    [id],
  );
  return r.rows[0] ?? null;
}

/** HELD notes are drafts: deleting them is allowed (sale_items cascade). */
export async function deleteHeld(db: Queryable, id: string): Promise<void> {
  await db.query(`DELETE FROM sales WHERE id = $1 AND status = 'HELD'`, [id]);
}
