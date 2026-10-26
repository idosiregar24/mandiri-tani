import { uuidv7 } from '@shared/uuid';
import type { Supplier } from '@shared/schemas/master';
import type { Queryable } from '../../db/pool';
import { likePattern } from '../../lib/http';

export interface SupplierRow {
  code: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  address: string | null;
  paymentTermDays: number;
  notes: string | null;
  isActive: boolean;
}

const SELECT = `
  SELECT s.id, s.code, s.name, s.contact_name AS "contactName", s.phone, s.address,
         s.payment_term_days AS "paymentTermDays", s.notes, s.is_active AS "isActive", s.updated_at AS "updatedAt"
  FROM suppliers s`;

export async function list(
  db: Queryable,
  opts: { q?: string; includeInactive: boolean; limit: number; offset: number },
): Promise<{ rows: Supplier[]; total: number }> {
  const where = ['s.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (!opts.includeInactive) where.push('s.is_active');
  if (opts.q) {
    params.push(likePattern(opts.q));
    where.push(`(s.name ILIKE $${params.length} OR s.code ILIKE $${params.length} OR s.phone LIKE $${params.length})`);
  }
  const clause = where.join(' AND ');
  const total = Number(
    (await db.query<{ n: string }>(`SELECT count(*) AS n FROM suppliers s WHERE ${clause}`, params)).rows[0]!.n,
  );
  params.push(opts.limit, opts.offset);
  const rows = await db.query<Supplier>(
    `${SELECT} WHERE ${clause} ORDER BY s.name, s.code LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows: rows.rows, total };
}

export async function get(db: Queryable, id: string): Promise<Supplier | null> {
  return (await db.query<Supplier>(`${SELECT} WHERE s.id = $1 AND s.deleted_at IS NULL`, [id])).rows[0] ?? null;
}

/** Next free SPxxxx (iPOS uses SP0001…), counting deleted rows too. */
export async function nextCode(db: Queryable): Promise<string> {
  const r = await db.query<{ n: number }>(
    `SELECT coalesce(max(substring(code FROM 3)::bigint), 0)::int + 1 AS n FROM suppliers WHERE code ~ '^SP[0-9]{1,9}$'`,
  );
  return `SP${String(r.rows[0]!.n).padStart(4, '0')}`;
}

export async function insert(db: Queryable, row: SupplierRow, id = uuidv7()): Promise<string> {
  await db.query(
    `INSERT INTO suppliers (id, code, name, contact_name, phone, address, payment_term_days, notes, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, row.code, row.name, row.contactName, row.phone, row.address, row.paymentTermDays, row.notes, row.isActive],
  );
  return id;
}

export async function update(db: Queryable, id: string, row: SupplierRow): Promise<boolean> {
  const r = await db.query(
    `UPDATE suppliers SET code = $2, name = $3, contact_name = $4, phone = $5, address = $6, payment_term_days = $7,
            notes = $8, is_active = $9
     WHERE id = $1 AND deleted_at IS NULL`,
    [id, row.code, row.name, row.contactName, row.phone, row.address, row.paymentTermDays, row.notes, row.isActive],
  );
  return r.rowCount === 1;
}

export async function softDelete(db: Queryable, id: string): Promise<void> {
  await db.query('UPDATE suppliers SET deleted_at = now(), is_active = false WHERE id = $1', [id]);
}
