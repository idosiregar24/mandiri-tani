// SQL for direct purchase invoices BL and purchase returns RB (sprint-8). No business rules here.
import type { PriceHistoryRow, Purchase, PurchaseListItem } from '@shared/schemas/purchases';
import type { Queryable } from '../../db/pool';
import { likePattern } from '../../lib/http';

export async function supplier(db: Queryable, id: string) {
  const r = await db.query<{ id: string; name: string; termDays: number; isActive: boolean }>(
    `SELECT id, name, payment_term_days AS "termDays", is_active AS "isActive" FROM suppliers WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return r.rows[0] ?? null;
}

/** Any live unit of an active product (a purchase unit need not be sellable). */
export async function purchaseUnits(db: Queryable, ids: string[]) {
  const r = await db.query<{
    productUnitId: string;
    productId: string;
    productName: string;
    conversionQty: string;
    trackStock: boolean;
    allowDecimalQty: boolean;
  }>(
    `SELECT pu.id AS "productUnitId", p.id AS "productId", p.name AS "productName",
            trim_scale(pu.conversion_qty)::text AS "conversionQty", p.track_stock AS "trackStock",
            p.allow_decimal_qty AS "allowDecimalQty"
     FROM product_units pu JOIN products p ON p.id = pu.product_id
     WHERE pu.id = ANY($1::uuid[]) AND pu.deleted_at IS NULL AND p.deleted_at IS NULL AND p.is_active`,
    [ids],
  );
  return new Map(r.rows.map((x) => [x.productUnitId, x]));
}

export async function idByClientOp(db: Queryable, table: 'purchase_invoices' | 'purchase_returns', key: string) {
  return (await db.query<{ id: string }>(`SELECT id FROM ${table} WHERE client_op_id = $1`, [key])).rows[0]?.id ?? null;
}

export async function insertReceipt(
  db: Queryable,
  g: {
    id: string;
    number: string;
    supplierId: string;
    warehouseId: string;
    receivedAt: Date;
    deliveryNo: string | null;
    note: string | null;
    userId: string;
  },
) {
  await db.query(
    `INSERT INTO goods_receipts (id, number, supplier_id, warehouse_id, received_at, supplier_delivery_no, status, note,
       created_by, posted_by, posted_at)
     VALUES ($1,$2,$3,$4,$5,$6,'INVOICED',$7,$8,$8,$5)`,
    [g.id, g.number, g.supplierId, g.warehouseId, g.receivedAt, g.deliveryNo, g.note, g.userId],
  );
}

export async function insertReceiptItem(
  db: Queryable,
  i: {
    id: string;
    receiptId: string;
    lineNo: number;
    productId: string;
    productUnitId: string;
    conversionQty: string;
    qty: string;
    baseQty: string;
    unitPrice: string;
    lineTotal: string;
    landedCostAlloc: string;
    costPerBase: string;
  },
) {
  await db.query(
    `INSERT INTO goods_receipt_items (id, goods_receipt_id, line_no, product_id, product_unit_id, conversion_qty, qty, base_qty,
       unit_price, line_total, landed_cost_alloc, cost_per_base)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      i.id,
      i.receiptId,
      i.lineNo,
      i.productId,
      i.productUnitId,
      i.conversionQty,
      i.qty,
      i.baseQty,
      i.unitPrice,
      i.lineTotal,
      i.landedCostAlloc,
      i.costPerBase,
    ],
  );
}

export async function insertInvoice(
  db: Queryable,
  p: {
    id: string;
    number: string;
    supplierInvoiceNo: string | null;
    supplierId: string;
    invoiceDate: string;
    dueDate: string;
    subtotal: string;
    discountAmount: string;
    otherCost: string;
    total: string;
    note: string | null;
    clientOpId: string | null;
    userId: string;
  },
) {
  await db.query(
    `INSERT INTO purchase_invoices (id, number, supplier_invoice_no, supplier_id, invoice_date, due_date, subtotal, discount_amount,
       other_cost, total, is_direct, note, client_op_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12,$13)`,
    [
      p.id,
      p.number,
      p.supplierInvoiceNo,
      p.supplierId,
      p.invoiceDate,
      p.dueDate,
      p.subtotal,
      p.discountAmount,
      p.otherCost,
      p.total,
      p.note,
      p.clientOpId,
      p.userId,
    ],
  );
}

export async function insertInvoiceItem(
  db: Queryable,
  i: { id: string; invoiceId: string; receiptItemId: string; lineTotal: string },
) {
  await db.query(
    `INSERT INTO purchase_invoice_items (id, purchase_invoice_id, goods_receipt_item_id, line_total) VALUES ($1,$2,$3,$4)`,
    [i.id, i.invoiceId, i.receiptItemId, i.lineTotal],
  );
}

export async function insertPayable(
  db: Queryable,
  p: {
    id: string;
    supplierId: string;
    invoiceId: string;
    number: string;
    docDate: string;
    dueDate: string;
    amount: string;
  },
) {
  await db.query(
    `INSERT INTO payables (id, supplier_id, source_type, source_id, doc_number, doc_date, due_date, amount)
     VALUES ($1,$2,'PURCHASE_INVOICE',$3,$4,$5,$6,$7)`,
    [p.id, p.supplierId, p.invoiceId, p.number, p.docDate, p.dueDate, p.amount],
  );
}

/** Locks the invoice and returns its receipt lines with what was already returned. */
export async function lockInvoice(db: Queryable, id: string) {
  const inv = await db.query<{ id: string; number: string; supplierId: string; status: string }>(
    `SELECT id, number, supplier_id AS "supplierId", status FROM purchase_invoices WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!inv.rows[0]) return null;
  const lines = await db.query<{
    id: string;
    productId: string;
    productUnitId: string;
    productName: string;
    conversionQty: string;
    qty: string;
    unitPrice: string;
    returnedQty: string;
    trackStock: boolean;
  }>(
    `SELECT gri.id, gri.product_id AS "productId", gri.product_unit_id AS "productUnitId", p.name AS "productName",
            trim_scale(gri.conversion_qty)::text AS "conversionQty", trim_scale(gri.qty)::text AS qty,
            gri.unit_price::text AS "unitPrice", p.track_stock AS "trackStock",
            trim_scale(coalesce((SELECT sum(pri.qty) FROM purchase_return_items pri JOIN purchase_returns pr ON pr.id = pri.purchase_return_id
                                 WHERE pr.purchase_invoice_id = $1 AND pri.product_unit_id = gri.product_unit_id), 0))::text AS "returnedQty"
     FROM purchase_invoice_items pii JOIN goods_receipt_items gri ON gri.id = pii.goods_receipt_item_id
     JOIN products p ON p.id = gri.product_id
     WHERE pii.purchase_invoice_id = $1 ORDER BY gri.line_no`,
    [id],
  );
  return { ...inv.rows[0], lines: lines.rows };
}

export async function lockPayable(db: Queryable, invoiceId: string) {
  const r = await db.query<{ id: string; open: string }>(
    `SELECT id, (amount - paid_amount)::text AS open FROM payables
     WHERE source_type = 'PURCHASE_INVOICE' AND source_id = $1 AND status IN ('OPEN','PARTIAL') FOR UPDATE`,
    [invoiceId],
  );
  return r.rows[0] ?? null;
}

export async function insertReturn(
  db: Queryable,
  r: {
    id: string;
    number: string;
    supplierId: string;
    invoiceId: string;
    warehouseId: string;
    trxAt: Date;
    settlement: string;
    total: string;
    reason: string;
    clientOpId: string | null;
    userId: string;
  },
) {
  await db.query(
    `INSERT INTO purchase_returns (id, number, supplier_id, purchase_invoice_id, warehouse_id, trx_at, settlement, total, reason, client_op_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      r.id,
      r.number,
      r.supplierId,
      r.invoiceId,
      r.warehouseId,
      r.trxAt,
      r.settlement,
      r.total,
      r.reason,
      r.clientOpId,
      r.userId,
    ],
  );
}

export async function insertReturnItem(
  db: Queryable,
  i: {
    id: string;
    returnId: string;
    productId: string;
    productUnitId: string;
    conversionQty: string;
    qty: string;
    baseQty: string;
    unitPrice: string;
    lineTotal: string;
    unitCost: string;
  },
) {
  await db.query(
    `INSERT INTO purchase_return_items (id, purchase_return_id, product_id, product_unit_id, conversion_qty, qty, base_qty, unit_price, line_total, unit_cost)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      i.id,
      i.returnId,
      i.productId,
      i.productUnitId,
      i.conversionQty,
      i.qty,
      i.baseQty,
      i.unitPrice,
      i.lineTotal,
      i.unitCost,
    ],
  );
}

// ------------------------------------------------------------------ reading

const PAY_KIND = `CASE WHEN EXISTS (SELECT 1 FROM payables py WHERE py.source_type = 'PURCHASE_INVOICE' AND py.source_id = pi.id) THEN 'CREDIT'
  WHEN EXISTS (SELECT 1 FROM cash_transactions ct JOIN cash_accounts ca ON ca.id = ct.cash_account_id
               WHERE ct.source_type = 'PURCHASE_INVOICE' AND ct.source_id = pi.id AND ca.kind = 'BANK') THEN 'TRANSFER'
  ELSE 'CASH' END`;

export async function get(db: Queryable, id: string): Promise<Purchase | null> {
  const r = await db.query<Purchase>(
    `SELECT pi.id, pi.number, pi.invoice_date AS "invoiceDate", pi.supplier_invoice_no AS "supplierInvoiceNo",
            json_build_object('id', s.id, 'code', s.code, 'name', s.name) AS supplier,
            pi.subtotal::text, pi.discount_amount::text AS "discountAmount", pi.other_cost::text AS "otherCost", pi.total::text,
            ${PAY_KIND} AS "payKind", pi.note, u.full_name AS "createdBy", to_json(pi.created_at) #>> '{}' AS "createdAt",
            (SELECT json_build_object('amount', py.amount::text, 'paidAmount', py.paid_amount::text, 'dueDate', py.due_date, 'status', py.status)
               FROM payables py WHERE py.source_type = 'PURCHASE_INVOICE' AND py.source_id = pi.id) AS payable,
            coalesce((SELECT json_agg(json_build_object(
                'id', gri.id, 'lineNo', gri.line_no, 'productId', gri.product_id, 'productUnitId', gri.product_unit_id,
                'productName', p.name, 'sku', p.sku, 'unitCode', un.code, 'conversionQty', trim_scale(gri.conversion_qty)::text,
                'qty', trim_scale(gri.qty)::text, 'unitPrice', gri.unit_price::text, 'lineTotal', gri.line_total::text,
                'landedCostAlloc', gri.landed_cost_alloc::text, 'costPerBase', gri.cost_per_base::text,
                'returnedQty', trim_scale(coalesce((SELECT sum(pri.qty) FROM purchase_return_items pri
                    JOIN purchase_returns pr ON pr.id = pri.purchase_return_id
                    WHERE pr.purchase_invoice_id = pi.id AND pri.product_unit_id = gri.product_unit_id), 0))::text)
                ORDER BY gri.line_no)
              FROM purchase_invoice_items pii JOIN goods_receipt_items gri ON gri.id = pii.goods_receipt_item_id
              JOIN products p ON p.id = gri.product_id JOIN product_units pu ON pu.id = gri.product_unit_id
              JOIN units un ON un.id = pu.unit_id
              WHERE pii.purchase_invoice_id = pi.id), '[]'::json) AS lines,
            coalesce((SELECT json_agg(json_build_object('id', pr.id, 'number', pr.number, 'trxAt', to_json(pr.trx_at) #>> '{}',
                'total', pr.total::text, 'settlement', pr.settlement) ORDER BY pr.trx_at)
              FROM purchase_returns pr WHERE pr.purchase_invoice_id = pi.id), '[]'::json) AS returns
     FROM purchase_invoices pi JOIN suppliers s ON s.id = pi.supplier_id JOIN users u ON u.id = pi.created_by
     WHERE pi.id = $1`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function list(
  db: Queryable,
  opts: { q?: string; supplierId?: string; limit: number; offset: number },
): Promise<{ rows: PurchaseListItem[]; total: number }> {
  const where = ['TRUE'];
  const params: unknown[] = [];
  if (opts.supplierId) {
    params.push(opts.supplierId);
    where.push(`pi.supplier_id = $${params.length}`);
  }
  if (opts.q) {
    params.push(likePattern(opts.q));
    where.push(
      `(pi.number ILIKE $${params.length} OR pi.supplier_invoice_no ILIKE $${params.length} OR s.name ILIKE $${params.length})`,
    );
  }
  const clause = where.join(' AND ');
  const total = Number(
    (
      await db.query<{ n: string }>(
        `SELECT count(*) AS n FROM purchase_invoices pi JOIN suppliers s ON s.id = pi.supplier_id WHERE ${clause}`,
        params,
      )
    ).rows[0]!.n,
  );
  params.push(opts.limit, opts.offset);
  const r = await db.query<PurchaseListItem>(
    `SELECT pi.id, pi.number, pi.invoice_date AS "invoiceDate", pi.supplier_invoice_no AS "supplierInvoiceNo", s.name AS "supplierName",
            (SELECT count(*)::int FROM purchase_invoice_items pii WHERE pii.purchase_invoice_id = pi.id) AS "itemCount",
            pi.total::text, ${PAY_KIND} AS "payKind",
            (SELECT (py.amount - py.paid_amount)::text FROM payables py
              WHERE py.source_type = 'PURCHASE_INVOICE' AND py.source_id = pi.id AND py.status IN ('OPEN','PARTIAL')) AS "payableOpen"
     FROM purchase_invoices pi JOIN suppliers s ON s.id = pi.supplier_id
     WHERE ${clause}
     ORDER BY pi.invoice_date DESC, pi.number DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows: r.rows, total };
}

export async function priceHistory(db: Queryable, productId: string): Promise<PriceHistoryRow[]> {
  const r = await db.query<PriceHistoryRow>(
    `SELECT pi.id AS "invoiceId", pi.number, pi.invoice_date AS "invoiceDate", s.name AS "supplierName", un.code AS "unitCode",
            trim_scale(gri.qty)::text AS qty, gri.unit_price::text AS "unitPrice"
     FROM goods_receipt_items gri JOIN purchase_invoice_items pii ON pii.goods_receipt_item_id = gri.id
     JOIN purchase_invoices pi ON pi.id = pii.purchase_invoice_id JOIN suppliers s ON s.id = pi.supplier_id
     JOIN product_units pu ON pu.id = gri.product_unit_id JOIN units un ON un.id = pu.unit_id
     WHERE gri.product_id = $1 AND pi.status = 'POSTED'
     ORDER BY pi.invoice_date DESC, pi.number DESC
     LIMIT 20`,
    [productId],
  );
  return r.rows;
}
