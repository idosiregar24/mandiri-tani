import { uuidv7 } from '@shared/uuid';
import type { BankAccountInput, CashAccount, PaymentMethod, PaymentMethodInput } from '@shared/schemas/master';
import type { Queryable } from '../../db/pool';

const ACCOUNT_SELECT = `SELECT a.id, a.code, a.name, a.kind, a.is_active AS "isActive" FROM cash_accounts a`;

export async function listAccounts(db: Queryable): Promise<CashAccount[]> {
  return (await db.query<CashAccount>(`${ACCOUNT_SELECT} WHERE a.deleted_at IS NULL ORDER BY a.kind DESC, a.code`))
    .rows;
}

export async function getAccount(db: Queryable, id: string): Promise<CashAccount | null> {
  return (
    (await db.query<CashAccount>(`${ACCOUNT_SELECT} WHERE a.id = $1 AND a.deleted_at IS NULL`, [id])).rows[0] ?? null
  );
}

export async function insertBankAccount(db: Queryable, input: BankAccountInput, id = uuidv7()): Promise<string> {
  await db.query(`INSERT INTO cash_accounts (id, code, name, kind, is_active) VALUES ($1, $2, $3, 'BANK', $4)`, [
    id,
    input.code,
    input.name,
    input.isActive,
  ]);
  return id;
}

export async function updateBankAccount(db: Queryable, id: string, input: BankAccountInput): Promise<void> {
  await db.query('UPDATE cash_accounts SET code = $2, name = $3, is_active = $4 WHERE id = $1', [
    id,
    input.code,
    input.name,
    input.isActive,
  ]);
}

export async function softDeleteAccount(db: Queryable, id: string): Promise<void> {
  await db.query('UPDATE cash_accounts SET deleted_at = now(), is_active = false WHERE id = $1', [id]);
}

export async function accountUsedByMethod(db: Queryable, id: string): Promise<boolean> {
  const r = await db.query('SELECT 1 FROM payment_methods WHERE cash_account_id = $1 AND deleted_at IS NULL LIMIT 1', [
    id,
  ]);
  return (r.rowCount ?? 0) > 0;
}

const METHOD_SELECT = `
  SELECT m.id, m.code, m.name, m.kind, m.cash_account_id AS "cashAccountId", a.name AS "cashAccountName",
         m.config->>'accountNumber' AS "accountNumber", m.config->>'accountHolder' AS "accountHolder",
         m.sort_order AS "sortOrder", m.is_active AS "isActive", m.kind IN ('CASH','CREDIT') AS "isBuiltIn"
  FROM payment_methods m
  LEFT JOIN cash_accounts a ON a.id = m.cash_account_id`;

export async function listMethods(db: Queryable): Promise<PaymentMethod[]> {
  return (await db.query<PaymentMethod>(`${METHOD_SELECT} WHERE m.deleted_at IS NULL ORDER BY m.sort_order, m.name`))
    .rows;
}

export async function getMethod(db: Queryable, id: string): Promise<PaymentMethod | null> {
  return (
    (await db.query<PaymentMethod>(`${METHOD_SELECT} WHERE m.id = $1 AND m.deleted_at IS NULL`, [id])).rows[0] ?? null
  );
}

const config = (input: PaymentMethodInput) =>
  JSON.stringify({ accountNumber: input.accountNumber ?? undefined, accountHolder: input.accountHolder ?? undefined });

export async function insertMethod(db: Queryable, input: PaymentMethodInput, id = uuidv7()): Promise<string> {
  await db.query(
    `INSERT INTO payment_methods (id, code, name, kind, cash_account_id, config, sort_order, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, input.code, input.name, input.kind, input.cashAccountId, config(input), input.sortOrder, input.isActive],
  );
  return id;
}

export async function updateMethod(db: Queryable, id: string, input: PaymentMethodInput): Promise<void> {
  await db.query(
    `UPDATE payment_methods SET code = $2, name = $3, kind = $4, cash_account_id = $5, config = $6, sort_order = $7, is_active = $8
     WHERE id = $1`,
    [id, input.code, input.name, input.kind, input.cashAccountId, config(input), input.sortOrder, input.isActive],
  );
}

export async function updateBuiltInMethod(db: Queryable, id: string, name: string, sortOrder: number): Promise<void> {
  await db.query('UPDATE payment_methods SET name = $2, sort_order = $3 WHERE id = $1', [id, name, sortOrder]);
}

export async function softDeleteMethod(db: Queryable, id: string): Promise<void> {
  await db.query('UPDATE payment_methods SET deleted_at = now(), is_active = false WHERE id = $1', [id]);
}
