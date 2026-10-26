import { uuidv7 } from '@shared/uuid';
import type { Customer } from '@shared/schemas/master';
import type { Queryable } from '../../db/pool';
import { likePattern } from '../../lib/http';

export interface CustomerRow {
  code: string;
  name: string;
  phone: string | null;
  address: string | null;
  village: string | null;
  customerGroupId: string | null;
  creditLimit: string | null;
  paymentTermDays: number;
  notes: string | null;
  isActive: boolean;
}

const SELECT = `
  SELECT c.id, c.code, c.name, c.phone, c.address, c.village,
         c.customer_group_id AS "customerGroupId", g.name AS "customerGroupName",
         c.credit_limit::text AS "creditLimit", c.payment_term_days AS "paymentTermDays",
         c.is_walk_in AS "isWalkIn", c.notes, c.is_active AS "isActive", c.updated_at AS "updatedAt"
  FROM customers c
  LEFT JOIN customer_groups g ON g.id = c.customer_group_id`;

export async function list(
  db: Queryable,
  opts: { q?: string; groupId?: string; includeInactive: boolean; limit: number; offset: number },
): Promise<{ rows: Customer[]; total: number }> {
  const where = ['c.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (!opts.includeInactive) where.push('c.is_active');
  if (opts.q) {
    params.push(likePattern(opts.q));
    where.push(
      `(c.name ILIKE $${params.length} OR c.code ILIKE $${params.length} OR c.phone LIKE $${params.length} OR c.village ILIKE $${params.length})`,
    );
  }
  if (opts.groupId) {
    params.push(opts.groupId);
    where.push(`c.customer_group_id = $${params.length}`);
  }
  const clause = where.join(' AND ');
  const total = Number(
    (await db.query<{ n: string }>(`SELECT count(*) AS n FROM customers c WHERE ${clause}`, params)).rows[0]!.n,
  );
  params.push(opts.limit, opts.offset);
  const rows = await db.query<Customer>(
    `${SELECT} WHERE ${clause} ORDER BY c.is_walk_in DESC, c.name, c.code LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows: rows.rows, total };
}

export async function get(db: Queryable, id: string): Promise<Customer | null> {
  return (await db.query<Customer>(`${SELECT} WHERE c.id = $1 AND c.deleted_at IS NULL`, [id])).rows[0] ?? null;
}

/** Next free PLxxxx, counting deleted rows too so a code is never reused. */
export async function nextCode(db: Queryable): Promise<string> {
  const r = await db.query<{ n: number }>(
    `SELECT coalesce(max(substring(code FROM 3)::bigint), 0)::int + 1 AS n FROM customers WHERE code ~ '^PL[0-9]{1,9}$'`,
  );
  return `PL${String(r.rows[0]!.n).padStart(4, '0')}`;
}

export async function insert(db: Queryable, row: CustomerRow, id = uuidv7()): Promise<string> {
  await db.query(
    `INSERT INTO customers (id, code, name, phone, address, village, customer_group_id, credit_limit, payment_term_days, notes, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      row.code,
      row.name,
      row.phone,
      row.address,
      row.village,
      row.customerGroupId,
      row.creditLimit,
      row.paymentTermDays,
      row.notes,
      row.isActive,
    ],
  );
  return id;
}

export async function update(db: Queryable, id: string, row: CustomerRow): Promise<boolean> {
  const r = await db.query(
    `UPDATE customers SET code = $2, name = $3, phone = $4, address = $5, village = $6, customer_group_id = $7,
            credit_limit = $8, payment_term_days = $9, notes = $10, is_active = $11
     WHERE id = $1 AND deleted_at IS NULL`,
    [
      id,
      row.code,
      row.name,
      row.phone,
      row.address,
      row.village,
      row.customerGroupId,
      row.creditLimit,
      row.paymentTermDays,
      row.notes,
      row.isActive,
    ],
  );
  return r.rowCount === 1;
}

export async function softDelete(db: Queryable, id: string): Promise<void> {
  await db.query('UPDATE customers SET deleted_at = now(), is_active = false WHERE id = $1', [id]);
}

export async function groupExists(db: Queryable, id: string): Promise<boolean> {
  const r = await db.query('SELECT 1 FROM customer_groups WHERE id = $1 AND deleted_at IS NULL', [id]);
  return (r.rowCount ?? 0) > 0;
}
