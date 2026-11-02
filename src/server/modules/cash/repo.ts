import type {
  CashAccountBalance,
  CashCategory,
  CashCategoryInput,
  CashListQuery,
  CashTransaction,
} from '@shared/schemas/cash';
import type { Queryable } from '../../db/pool';

/** System categories the Owner may still pick by hand; every other system one is written automatically. */
export const MANUAL_SYSTEM_CATEGORIES = ['CAPITAL', 'DRAWING'];

const CATEGORY_SELECT = `
  SELECT c.id, c.code, c.name, c.direction, c.is_system AS "isSystem",
         c.is_operating_expense AS "isOperatingExpense",
         (NOT c.is_system OR upper(c.code) = ANY($1::text[])) AS manual
  FROM cash_categories c`;

export async function listCategories(db: Queryable): Promise<CashCategory[]> {
  const r = await db.query<CashCategory>(
    `${CATEGORY_SELECT} WHERE c.deleted_at IS NULL ORDER BY c.is_system DESC, c.direction, c.name`,
    [MANUAL_SYSTEM_CATEGORIES],
  );
  return r.rows;
}

export async function getCategory(db: Queryable, id: string): Promise<CashCategory | null> {
  const r = await db.query<CashCategory>(`${CATEGORY_SELECT} WHERE c.id = $2 AND c.deleted_at IS NULL`, [
    MANUAL_SYSTEM_CATEGORIES,
    id,
  ]);
  return r.rows[0] ?? null;
}

export async function insertCategory(db: Queryable, id: string, code: string, input: CashCategoryInput): Promise<void> {
  await db.query(
    `INSERT INTO cash_categories (id, code, name, direction, is_system, is_operating_expense)
     VALUES ($1, $2, $3, $4, false, $5)`,
    [id, code, input.name, input.direction, input.direction === 'OUT' && input.isOperatingExpense],
  );
}

export async function updateCategory(db: Queryable, id: string, input: CashCategoryInput): Promise<void> {
  await db.query(`UPDATE cash_categories SET name = $2, direction = $3, is_operating_expense = $4 WHERE id = $1`, [
    id,
    input.name,
    input.direction,
    input.direction === 'OUT' && input.isOperatingExpense,
  ]);
}

export async function categoryNameTaken(db: Queryable, name: string, exceptId: string | null): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM cash_categories WHERE upper(name) = upper($1) AND deleted_at IS NULL AND id IS DISTINCT FROM $2`,
    [name, exceptId],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Active accounts with their book balance (Σ IN − Σ OUT). `kinds` narrows the list (KASIR: DRAWER only). */
export async function balances(db: Queryable, kinds: string[] | null): Promise<CashAccountBalance[]> {
  const r = await db.query<CashAccountBalance>(
    `SELECT a.id, a.code, a.name, a.kind,
            coalesce((SELECT sum(CASE t.direction WHEN 'IN' THEN t.amount ELSE -t.amount END)
                      FROM cash_transactions t WHERE t.cash_account_id = a.id), 0)::numeric(18,2)::text AS balance
     FROM cash_accounts a
     WHERE a.deleted_at IS NULL AND a.is_active AND ($1::text[] IS NULL OR a.kind = ANY($1::text[]))
     ORDER BY CASE a.kind WHEN 'DRAWER' THEN 0 WHEN 'CASH' THEN 1 ELSE 2 END, a.code`,
    [kinds],
  );
  return r.rows;
}

export async function account(
  db: Queryable,
  id: string,
): Promise<{ id: string; code: string; name: string; kind: string; isActive: boolean } | null> {
  const r = await db.query(
    `SELECT id, code, name, kind, is_active AS "isActive" FROM cash_accounts WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function insertEntry(
  db: Queryable,
  e: {
    id: string;
    number: string | null;
    cashAccountId: string;
    categoryId: string;
    trxAt: Date;
    direction: 'IN' | 'OUT';
    amount: string;
    sourceType: 'MANUAL' | 'TRANSFER';
    sourceId: string | null;
    note: string | null;
    createdBy: string;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO cash_transactions (id, number, cash_account_id, cash_category_id, trx_at, direction, amount,
                                    source_type, source_id, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      e.id,
      e.number,
      e.cashAccountId,
      e.categoryId,
      e.trxAt,
      e.direction,
      e.amount,
      e.sourceType,
      e.sourceId,
      e.note,
      e.createdBy,
    ],
  );
}

const TRX_SELECT = `
  SELECT t.id, t.number, t.trx_at AS "trxAt", t.direction, t.amount::text, t.source_type AS "sourceType", t.note,
         json_build_object('id', a.id, 'code', a.code, 'name', a.name) AS account,
         json_build_object('id', c.id, 'code', c.code, 'name', c.name) AS category,
         u.full_name AS "createdBy"
  FROM cash_transactions t
  JOIN cash_accounts a ON a.id = t.cash_account_id
  JOIN cash_categories c ON c.id = t.cash_category_id
  LEFT JOIN users u ON u.id = t.created_by`;

export async function getTransaction(db: Queryable, id: string): Promise<CashTransaction | null> {
  return (await db.query<CashTransaction>(`${TRX_SELECT} WHERE t.id = $1`, [id])).rows[0] ?? null;
}

/** Newest first. `from`/`to` are WIB business dates; `kinds` limits the accounts (KASIR: DRAWER). */
export async function listTransactions(
  db: Queryable,
  q: CashListQuery,
  kinds: string[] | null,
): Promise<{ rows: CashTransaction[]; total: number }> {
  const where = `
    WHERE ($1::uuid IS NULL OR t.cash_account_id = $1)
      AND ($2::date IS NULL OR (t.trx_at AT TIME ZONE 'Asia/Jakarta')::date >= $2::date)
      AND ($3::date IS NULL OR (t.trx_at AT TIME ZONE 'Asia/Jakarta')::date <= $3::date)
      AND ($4::text[] IS NULL OR a.kind = ANY($4::text[]))`;
  const params = [q.accountId ?? null, q.from ?? null, q.to ?? null, kinds];
  const [rows, count] = await Promise.all([
    db.query<CashTransaction>(`${TRX_SELECT} ${where} ORDER BY t.trx_at DESC, t.id DESC LIMIT $5 OFFSET $6`, [
      ...params,
      q.pageSize,
      (q.page - 1) * q.pageSize,
    ]),
    db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM cash_transactions t JOIN cash_accounts a ON a.id = t.cash_account_id ${where}`,
      params,
    ),
  ]);
  return { rows: rows.rows, total: count.rows[0]!.n };
}
