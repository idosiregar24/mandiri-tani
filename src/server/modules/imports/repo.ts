// SQL for the importer: bulk inserts of a MasterPlan, import batches, reconciliation counts
// and the preparation reset. Bulk inserts use unnest() over parameter arrays — still fully
// parameterized (database-standards §7), one statement per table.
import type { ImportBatch, ImportPurpose, ImportScope } from '@shared/schemas/imports';
import { uuidv7 } from '@shared/uuid';
import type { Queryable } from '../../db/pool';
import type { ExistingMasters, MasterPlan } from './ipos-plan';

export async function existingMasters(db: Queryable): Promise<ExistingMasters> {
  const units = (await db.query<{ id: string; code: string }>('SELECT id, code FROM units WHERE deleted_at IS NULL'))
    .rows;
  const one = async (sql: string, what: string) => {
    const id = (await db.query<{ id: string }>(sql)).rows[0]?.id;
    if (!id) throw new Error(`seed row missing: ${what}`);
    return id;
  };
  return {
    units,
    umumGroupId: await one(
      "SELECT id FROM customer_groups WHERE upper(code) = 'UMUM' AND deleted_at IS NULL",
      'UMUM group',
    ),
    walkInCustomerId: await one('SELECT id FROM customers WHERE is_walk_in AND deleted_at IS NULL', 'walk-in customer'),
    defaultWarehouseId: await one(
      'SELECT id FROM warehouses WHERE is_default AND deleted_at IS NULL',
      'default warehouse',
    ),
  };
}

/** sprint-14 §2: settings.system.go_live_at set = production, no more iPOS imports / resets. */
export async function goLiveAt(db: Queryable): Promise<string | null> {
  const r = await db.query<{ v: string | null }>("SELECT value->>'go_live_at' AS v FROM settings WHERE key = 'system'");
  return r.rows[0]?.v ?? null;
}

/** FR-MIG-03: master data already present (a committed import, or data typed in by hand). */
export async function masterDataPresent(
  db: Queryable,
): Promise<{ batch: boolean; products: number; customers: number; suppliers: number }> {
  const r = await db.query<{ batch: boolean; products: number; customers: number; suppliers: number }>(
    `SELECT EXISTS (SELECT 1 FROM import_batches WHERE status = 'COMMITTED' AND scope ? 'master') AS batch,
            (SELECT count(*) FROM products WHERE deleted_at IS NULL)::int AS products,
            (SELECT count(*) FROM customers WHERE deleted_at IS NULL AND NOT is_walk_in)::int AS customers,
            (SELECT count(*) FROM suppliers WHERE deleted_at IS NULL)::int AS suppliers`,
  );
  return r.rows[0]!;
}

// ------------------------------------------------------------------ batches
export async function insertBatch(
  db: Queryable,
  b: {
    id?: string;
    sourceFile: string;
    sha256: string;
    dumpAt: string | null;
    purpose: ImportPurpose;
    scope: ImportScope[];
    status: 'RUNNING' | 'FAILED';
    summary?: object;
  },
): Promise<string> {
  const id = b.id ?? uuidv7();
  await db.query(
    `INSERT INTO import_batches (id, source_system, source_file, source_sha256, source_dump_at, purpose, scope, status, summary, finished_at)
     VALUES ($1, 'IPOS5', $2, $3, $4::timestamp AT TIME ZONE 'Asia/Jakarta', $5, $6, $7, $8, CASE WHEN $7 = 'FAILED' THEN now() END)`,
    [
      id,
      b.sourceFile,
      b.sha256,
      b.dumpAt,
      b.purpose,
      JSON.stringify(b.scope),
      b.status,
      JSON.stringify(b.summary ?? {}),
    ],
  );
  return id;
}

export async function finishBatch(db: Queryable, id: string, summary: object): Promise<void> {
  await db.query(`UPDATE import_batches SET status = 'COMMITTED', summary = $2, finished_at = now() WHERE id = $1`, [
    id,
    JSON.stringify(summary),
  ]);
}

const BATCH_SELECT = `
  SELECT id, source_file AS "sourceFile", source_sha256 AS "sourceSha256", source_dump_at AS "sourceDumpAt", purpose, scope, status,
         started_at AS "startedAt", finished_at AS "finishedAt",
         summary->'counts' AS counts, coalesce(summary->'reconciliation', '[]') AS reconciliation,
         coalesce(summary->'issues', '[]') AS issues, summary->>'error' AS error
  FROM import_batches`;

export async function listBatches(db: Queryable): Promise<ImportBatch[]> {
  return (
    await db.query<ImportBatch>(`${BATCH_SELECT} WHERE source_system = 'IPOS5' ORDER BY started_at DESC LIMIT 50`)
  ).rows;
}

export async function getBatch(db: Queryable, id: string): Promise<ImportBatch | null> {
  return (await db.query<ImportBatch>(`${BATCH_SELECT} WHERE id = $1`, [id])).rows[0] ?? null;
}

// ------------------------------------------------------------------ writing a plan
export async function writeMasterPlan(db: Queryable, batchId: string, plan: MasterPlan): Promise<void> {
  const col = <T, K extends keyof T>(rows: T[], key: K) => rows.map((r) => r[key]);

  if (plan.units.length) {
    await db.query('INSERT INTO units (id, code, name) SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[])', [
      col(plan.units, 'id'),
      col(plan.units, 'code'),
      col(plan.units, 'name'),
    ]);
  }
  if (plan.categories.length) {
    await db.query('INSERT INTO categories (id, name) SELECT * FROM unnest($1::uuid[], $2::text[])', [
      col(plan.categories, 'id'),
      col(plan.categories, 'name'),
    ]);
  }
  if (plan.umumDiscountPercent !== null) {
    await db.query(
      "UPDATE customer_groups SET discount_percent = $1 WHERE upper(code) = 'UMUM' AND deleted_at IS NULL",
      [plan.umumDiscountPercent],
    );
  }
  if (plan.groups.length) {
    await db.query(
      'INSERT INTO customer_groups (id, code, name, discount_percent) SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[], $4::numeric[])',
      [col(plan.groups, 'id'), col(plan.groups, 'code'), col(plan.groups, 'name'), col(plan.groups, 'discountPercent')],
    );
  }
  if (plan.customers.length) {
    const c = plan.customers;
    await db.query(
      `INSERT INTO customers (id, code, name, phone, address, customer_group_id, credit_limit, payment_term_days, notes, is_active)
       SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::uuid[], $7::numeric[], $8::int[], $9::text[], $10::bool[])`,
      [
        col(c, 'id'),
        col(c, 'code'),
        col(c, 'name'),
        col(c, 'phone'),
        col(c, 'address'),
        col(c, 'customerGroupId'),
        col(c, 'creditLimit'),
        col(c, 'paymentTermDays'),
        col(c, 'notes'),
        col(c, 'isActive'),
      ],
    );
  }
  if (plan.suppliers.length) {
    const s = plan.suppliers;
    await db.query(
      `INSERT INTO suppliers (id, code, name, contact_name, phone, address, payment_term_days, notes, is_active)
       SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::int[], $8::text[], $9::bool[])`,
      [
        col(s, 'id'),
        col(s, 'code'),
        col(s, 'name'),
        col(s, 'contactName'),
        col(s, 'phone'),
        col(s, 'address'),
        col(s, 'paymentTermDays'),
        col(s, 'notes'),
        col(s, 'isActive'),
      ],
    );
  }
  if (plan.bankAccounts.length) {
    await db.query(
      "INSERT INTO cash_accounts (id, code, name, kind) SELECT id, code, name, 'BANK' FROM unnest($1::uuid[], $2::text[], $3::text[]) AS t(id, code, name)",
      [col(plan.bankAccounts, 'id'), col(plan.bankAccounts, 'code'), col(plan.bankAccounts, 'name')],
    );
  }
  if (plan.paymentMethods.length) {
    const m = plan.paymentMethods;
    await db.query(
      `INSERT INTO payment_methods (id, code, name, kind, cash_account_id, sort_order)
       SELECT id, code, name, 'TRANSFER', account, sort FROM unnest($1::uuid[], $2::text[], $3::text[], $4::uuid[], $5::int[]) AS t(id, code, name, account, sort)`,
      [col(m, 'id'), col(m, 'code'), col(m, 'name'), col(m, 'cashAccountId'), col(m, 'sortOrder')],
    );
  }
  if (plan.products.length) {
    const p = plan.products;
    await db.query(
      `INSERT INTO products (id, sku, name, category_id, base_unit_id, item_type, track_stock, min_stock, is_active)
       SELECT id, sku, name, cat, base, 'STANDARD', true, minstock, active
       FROM unnest($1::uuid[], $2::text[], $3::text[], $4::uuid[], $5::uuid[], $6::numeric[], $7::bool[]) AS t(id, sku, name, cat, base, minstock, active)`,
      [
        col(p, 'id'),
        col(p, 'sku'),
        col(p, 'name'),
        col(p, 'categoryId'),
        col(p, 'baseUnitId'),
        col(p, 'minStock'),
        col(p, 'isActive'),
      ],
    );
    const units = p.flatMap((x) => x.units.map((u) => ({ ...u, productId: x.id })));
    await db.query(
      `INSERT INTO product_units (id, product_id, unit_id, conversion_qty, is_base, is_default_sale, is_default_purchase)
       SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::numeric[], $5::bool[], $6::bool[], $7::bool[])`,
      [
        col(units, 'id'),
        col(units, 'productId'),
        col(units, 'unitId'),
        col(units, 'conversionQty'),
        col(units, 'isBase'),
        col(units, 'isDefaultSale'),
        col(units, 'isDefaultPurchase'),
      ],
    );
    const withBarcode = units.filter((u) => u.barcode);
    if (withBarcode.length) {
      await db.query(
        'INSERT INTO product_barcodes (id, product_unit_id, barcode) SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[])',
        [withBarcode.map(() => uuidv7()), col(withBarcode, 'id'), col(withBarcode, 'barcode')],
      );
    }
    const priced = units.filter((u) => u.price !== null);
    if (priced.length) {
      await db.query(
        'INSERT INTO product_prices (id, product_unit_id, price) SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::numeric[])',
        [priced.map(() => uuidv7()), col(priced, 'id'), col(priced, 'price')],
      );
    }
  }
  if (plan.legacyRefs.length) {
    const r = plan.legacyRefs;
    await db.query(
      `INSERT INTO legacy_refs (id, import_batch_id, source_system, entity, legacy_key, entity_id)
       SELECT id, $1, 'IPOS5', entity, legacy_key, entity_id FROM unnest($2::uuid[], $3::text[], $4::text[], $5::uuid[]) AS t(id, entity, legacy_key, entity_id)`,
      [batchId, r.map(() => uuidv7()), col(r, 'entity'), col(r, 'legacyKey'), col(r, 'entityId')],
    );
  }
}

// ------------------------------------------------------------------ reconciliation (FR-MIG-04)
export interface ImportedCounts {
  units: number;
  categories: number;
  customerGroups: number;
  customers: number;
  suppliers: number;
  bankAccounts: number;
  products: number;
  multiUnitProducts: number;
  derivedUnits: number;
  pricedUnits: number;
  customersPerGroup: Record<string, number>;
}

/** What actually landed in the app for one batch, counted from the tables (not from the plan). */
export async function importedCounts(db: Queryable, batchId: string): Promise<ImportedCounts> {
  const r = await db.query<Omit<ImportedCounts, 'customersPerGroup'>>(
    `WITH refs AS (SELECT entity, entity_id FROM legacy_refs WHERE import_batch_id = $1),
          prod AS (SELECT p.id FROM products p JOIN refs ON refs.entity = 'product' AND refs.entity_id = p.id WHERE p.deleted_at IS NULL)
     SELECT (SELECT count(*) FROM refs WHERE entity = 'unit')::int AS units,
            (SELECT count(*) FROM refs WHERE entity = 'category')::int AS categories,
            (SELECT count(*) FROM refs WHERE entity = 'customer_group')::int AS "customerGroups",
            (SELECT count(*) FROM refs JOIN customers c ON c.id = refs.entity_id WHERE refs.entity = 'customer')::int AS customers,
            (SELECT count(*) FROM refs JOIN suppliers s ON s.id = refs.entity_id WHERE refs.entity = 'supplier')::int AS suppliers,
            (SELECT count(*) FROM refs JOIN cash_accounts a ON a.id = refs.entity_id WHERE refs.entity = 'cash_account')::int AS "bankAccounts",
            (SELECT count(*) FROM prod)::int AS products,
            (SELECT count(*) FROM prod WHERE (SELECT count(*) FROM product_units pu WHERE pu.product_id = prod.id AND pu.deleted_at IS NULL) > 1)::int AS "multiUnitProducts",
            (SELECT count(*) FROM product_units pu JOIN prod ON prod.id = pu.product_id WHERE NOT pu.is_base AND pu.deleted_at IS NULL)::int AS "derivedUnits",
            (SELECT count(*) FROM product_prices pp JOIN product_units pu ON pu.id = pp.product_unit_id JOIN prod ON prod.id = pu.product_id
              WHERE pp.deleted_at IS NULL)::int AS "pricedUnits"`,
    [batchId],
  );
  const perGroup = await db.query<{ code: string; n: number }>(
    `SELECT g.code, count(*)::int AS n
     FROM legacy_refs r JOIN customers c ON c.id = r.entity_id JOIN customer_groups g ON g.id = c.customer_group_id
     WHERE r.import_batch_id = $1 AND r.entity = 'customer' AND NOT c.is_walk_in
     GROUP BY g.code`,
    [batchId],
  );
  return { ...r.rows[0]!, customersPerGroup: Object.fromEntries(perGroup.rows.map((x) => [x.code, x.n])) };
}

// ------------------------------------------------------------------ preparation reset (FR-MIG-08)
/**
 * Wipes the business data that exists up to this sprint (masters + import traces) and seeds the
 * defaults again. Users, devices, settings and the audit log stay. Extend this list as later
 * sprints add business tables (stock, sales, …) — sprint-14 §2.
 */
export async function wipePreparationData(db: Queryable): Promise<number> {
  await db.query(
    // TRUNCATE does not fire the row-level append-only triggers, so the stock ledger can be cleared here
    // — the only place that may, and only before go-live (checked by the caller). Sprint 4: stock tables;
    // doc_sequences restart too (go-live seeds them from iPOS).
    `TRUNCATE receivable_payment_allocations, receivable_payments, payable_payment_allocations, payable_payments,
              sale_return_items, sale_returns, payables, purchase_return_items, purchase_returns, purchase_invoice_items,
              purchase_invoices, goods_receipt_items, goods_receipts, purchase_order_items, purchase_orders,
              cash_transactions, receivables, sale_pickup_items, sale_pickups, sale_payments, sale_items, sales, shifts,
              stock_layer_consumptions, stock_cost_layers, stock_movements, stock_balances,
              stock_opname_lines, stock_opnames, stock_adjustment_lines, stock_adjustments, doc_sequences,
              product_prices, product_barcodes, product_components, product_units, products,
              customers, customer_groups, suppliers, payment_methods, cash_accounts, cash_categories,
              categories, brands, units, warehouses, legacy_refs`,
  );
  const discarded = await db.query(`UPDATE import_batches SET status = 'DISCARDED' WHERE status = 'COMMITTED'`);
  await db.query('SELECT seed_master_defaults()');
  return discarded.rowCount ?? 0;
}

// ------------------------------------------------------------------ opening stock (Sprint 4)
export async function scopeState(
  db: Queryable,
): Promise<{ master: boolean; stock: boolean; receivables: boolean; movements: number }> {
  const r = await db.query<{ master: boolean; stock: boolean; receivables: boolean; movements: number }>(
    `SELECT EXISTS (SELECT 1 FROM import_batches WHERE status = 'COMMITTED' AND scope ? 'master') AS master,
            EXISTS (SELECT 1 FROM import_batches WHERE status = 'COMMITTED' AND scope ? 'stock') AS stock,
            EXISTS (SELECT 1 FROM import_batches WHERE status = 'COMMITTED' AND scope ? 'receivables') AS receivables,
            (SELECT count(*) FROM stock_movements)::int AS movements`,
  );
  return r.rows[0]!;
}

/** iPOS kodesupel → customer / supplier id, from the master import's legacy_refs. */
export async function partyIdsByCode(
  db: Queryable,
  entity: 'customer' | 'supplier',
): Promise<Map<string, { id: string; name: string }>> {
  const table = entity === 'customer' ? 'customers' : 'suppliers';
  const r = await db.query<{ legacy_key: string; id: string; name: string }>(
    `SELECT r.legacy_key, c.id, c.name FROM legacy_refs r JOIN ${table} c ON c.id = r.entity_id AND c.deleted_at IS NULL
     WHERE r.source_system = 'IPOS5' AND r.entity = $1`,
    [entity],
  );
  return new Map(r.rows.map((x) => [x.legacy_key, { id: x.id, name: x.name }]));
}

/** iPOS kodeitem → product id, from the master import's legacy_refs. */
export async function productIdsByCode(db: Queryable): Promise<Map<string, string>> {
  const r = await db.query<{ legacy_key: string; entity_id: string }>(
    `SELECT r.legacy_key, r.entity_id FROM legacy_refs r JOIN products p ON p.id = r.entity_id AND p.deleted_at IS NULL
     WHERE r.source_system = 'IPOS5' AND r.entity = 'product'`,
  );
  return new Map(r.rows.map((x) => [x.legacy_key, x.entity_id]));
}

export async function setLastPurchaseCosts(db: Queryable, costs: Map<string, string>): Promise<void> {
  if (costs.size === 0) return;
  await db.query(
    `UPDATE products p SET last_purchase_cost = c.cost FROM unnest($1::uuid[], $2::numeric[]) AS c(id, cost) WHERE p.id = c.id`,
    [[...costs.keys()], [...costs.values()]],
  );
}

export async function insertLegacyRefs(
  db: Queryable,
  batchId: string,
  refs: { entity: string; legacyKey: string; entityId: string }[],
): Promise<void> {
  if (refs.length === 0) return;
  await db.query(
    `INSERT INTO legacy_refs (id, import_batch_id, source_system, entity, legacy_key, entity_id)
     SELECT id, $1, 'IPOS5', entity, legacy_key, entity_id FROM unnest($2::uuid[], $3::text[], $4::text[], $5::uuid[]) AS t(id, entity, legacy_key, entity_id)`,
    [
      batchId,
      refs.map(() => uuidv7()),
      refs.map((r) => r.entity),
      refs.map((r) => r.legacyKey),
      refs.map((r) => r.entityId),
    ],
  );
}

/** What the opening-stock batch actually wrote, counted from the stock tables. */
export async function stockImportedCounts(
  db: Queryable,
  batchId: string,
): Promise<{ products: number; layers: number; qty: string; value: string; minusProducts: number }> {
  const r = await db.query<{ products: number; layers: number; qty: string; value: string; minusProducts: number }>(
    `WITH m AS (SELECT id, product_id, warehouse_id, qty FROM stock_movements WHERE source_type = 'OPENING' AND source_id = $1),
          per AS (SELECT product_id, warehouse_id, sum(qty) AS qty FROM m GROUP BY 1, 2)
     SELECT (SELECT count(*) FROM per WHERE qty <> 0)::int AS products,
            (SELECT count(*) FROM legacy_refs r JOIN stock_cost_layers l ON l.source_movement_id = r.entity_id
              WHERE r.import_batch_id = $1 AND r.entity = 'stock_layer')::int AS layers,
            (SELECT coalesce(sum(qty), 0)::numeric(18,4)::text FROM m) AS qty,
            (SELECT round(coalesce(sum(l.qty_remaining * l.unit_cost), 0), 2)::text
               FROM stock_cost_layers l JOIN per ON per.product_id = l.product_id AND per.warehouse_id = l.warehouse_id) AS value,
            (SELECT count(*) FROM per WHERE qty < 0)::int AS "minusProducts"`,
    [batchId],
  );
  return r.rows[0]!;
}
