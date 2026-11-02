// SQL for the 2-year history import (sprint-10 S10-10): lookups for the plan and bulk inserts.
// Thousands of rows go in per statement through unnest() — one round trip per 1.000 rows instead of
// one per row — still inside the single import transaction.
import type { Queryable } from '../../db/pool';
import type { HistoryLookups, HistoryProduct } from './ipos-history-plan';

const CHUNK = 1000;

/** INSERT … SELECT FROM unnest($1::type[], …): `rows` are arrays in column order. */
export async function insertMany(
  db: Queryable,
  table: string,
  columns: readonly (readonly [name: string, pgType: string])[],
  rows: unknown[][],
): Promise<void> {
  const names = columns.map(([n]) => n).join(', ');
  const params = columns.map(([, t], i) => `$${i + 1}::${t}[]`).join(', ');
  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK);
    await db.query(
      `INSERT INTO ${table} (${names}) SELECT * FROM unnest(${params})`,
      columns.map((_, j) => chunk.map((r) => r[j])),
    );
  }
}

/** Sequential on purpose: `db` may be the import transaction's single client. */
export async function historyLookups(db: Queryable): Promise<HistoryLookups> {
  const customers = await db.query<{ legacy_key: string; id: string; group_id: string | null }>(
    `SELECT r.legacy_key, c.id, c.customer_group_id AS group_id
     FROM legacy_refs r JOIN customers c ON c.id = r.entity_id
     WHERE r.source_system = 'IPOS5' AND r.entity = 'customer'`,
  );
  const walkIn = await db.query<{ id: string; group_id: string | null }>(
    `SELECT id, customer_group_id AS group_id FROM customers WHERE is_walk_in`,
  );
  const suppliers = await db.query<{ legacy_key: string; id: string }>(
    `SELECT r.legacy_key, s.id FROM legacy_refs r JOIN suppliers s ON s.id = r.entity_id
     WHERE r.source_system = 'IPOS5' AND r.entity = 'supplier'`,
  );
  const units = await db.query<{
    legacy_key: string;
    id: string;
    name: string;
    unit_id: string;
    code: string;
    conversion: string;
    is_base: boolean;
  }>(
    `SELECT r.legacy_key, p.id, p.name, pu.id AS unit_id, upper(u.code) AS code,
              pu.conversion_qty::text AS conversion, pu.is_base
       FROM legacy_refs r JOIN products p ON p.id = r.entity_id
       JOIN product_units pu ON pu.product_id = p.id AND pu.deleted_at IS NULL
       JOIN units u ON u.id = pu.unit_id
       WHERE r.source_system = 'IPOS5' AND r.entity = 'product'`,
  );
  const sales = await db.query<{ number: string }>(`SELECT number FROM sales WHERE number IS NOT NULL`);
  const purchases = await db.query<{ number: string }>(
    `SELECT number FROM purchase_invoices UNION SELECT number FROM goods_receipts`,
  );
  const cash = await db.query<{ number: string }>(`SELECT number FROM cash_transactions WHERE number IS NOT NULL`);
  if (!walkIn.rows[0]) throw new Error('walk-in customer missing');

  const products = new Map<string, HistoryProduct>();
  for (const u of units.rows) {
    let p = products.get(u.legacy_key);
    if (!p) {
      p = { id: u.id, name: u.name, baseUnitId: '', units: new Map() };
      products.set(u.legacy_key, p);
    }
    p.units.set(u.code, { id: u.unit_id, conversion: u.conversion });
    if (u.is_base) p.baseUnitId = u.unit_id;
  }
  return {
    customers: new Map(customers.rows.map((c) => [c.legacy_key, { id: c.id, groupId: c.group_id }])),
    walkIn: { id: walkIn.rows[0].id, groupId: walkIn.rows[0].group_id },
    suppliers: new Map(suppliers.rows.map((s) => [s.legacy_key, { id: s.id }])),
    products,
    taken: {
      sales: new Set(sales.rows.map((r) => r.number)),
      purchases: new Set(purchases.rows.map((r) => r.number)),
      cash: new Set(cash.rows.map((r) => r.number)),
    },
  };
}

/** What a history batch actually wrote, counted from the business tables. */
export async function historyImportedCounts(db: Queryable, batchId: string) {
  const r = await db.query<{
    ksr: number;
    ksrTotal: string;
    jl: number;
    jlTotal: string;
    saleCost: string;
    linesWithoutCost: number;
    purchases: number;
    purchasesTotal: string;
    cashOut: number;
    cashOutTotal: string;
  }>(
    `WITH s AS (SELECT x.* FROM legacy_refs l JOIN sales x ON x.id = l.entity_id
                WHERE l.import_batch_id = $1 AND l.entity = 'sale'),
          p AS (SELECT x.* FROM legacy_refs l JOIN purchase_invoices x ON x.id = l.entity_id
                WHERE l.import_batch_id = $1 AND l.entity = 'purchase_invoice'),
          c AS (SELECT split_part(l.legacy_key, '#', 1) AS doc, x.amount FROM legacy_refs l
                JOIN cash_transactions x ON x.id = l.entity_id
                WHERE l.import_batch_id = $1 AND l.entity = 'cash_transaction')
     SELECT (SELECT count(*) FROM s WHERE channel = 'KASIR')::int AS ksr,
            (SELECT coalesce(sum(total), 0)::numeric(18,2)::text FROM s WHERE channel = 'KASIR') AS "ksrTotal",
            (SELECT count(*) FROM s WHERE channel = 'FAKTUR')::int AS jl,
            (SELECT coalesce(sum(total), 0)::numeric(18,2)::text FROM s WHERE channel = 'FAKTUR') AS "jlTotal",
            (SELECT coalesce(sum(i.cost_total), 0)::numeric(18,2)::text FROM sale_items i JOIN s ON s.id = i.sale_id) AS "saleCost",
            (SELECT count(*) FROM sale_items i JOIN s ON s.id = i.sale_id WHERE i.cost_total IS NULL)::int AS "linesWithoutCost",
            (SELECT count(*) FROM p)::int AS purchases,
            (SELECT coalesce(sum(total), 0)::numeric(18,2)::text FROM p) AS "purchasesTotal",
            (SELECT count(DISTINCT doc) FROM c)::int AS "cashOut",
            (SELECT coalesce(sum(amount), 0)::numeric(18,2)::text FROM c) AS "cashOutTotal"`,
    [batchId],
  );
  const months = await db.query<{ month: string; tipe: string; count: number; total: string }>(
    `SELECT to_char(s.trx_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') AS month,
            CASE s.channel WHEN 'KASIR' THEN 'KSR' ELSE 'JL' END AS tipe,
            count(*)::int AS count, sum(s.total)::numeric(18,2)::text AS total
     FROM legacy_refs l JOIN sales s ON s.id = l.entity_id
     WHERE l.import_batch_id = $1 AND l.entity = 'sale' GROUP BY 1, 2`,
    [batchId],
  );
  return { ...r.rows[0]!, months: months.rows };
}
