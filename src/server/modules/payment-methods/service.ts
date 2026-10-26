// Bank accounts + payment methods (FR-MD-11, D-6): Transfer/QRIS land in a BANK account
// so a transfer is no longer booked as cash (DQ-10). CASH and CREDIT are built in.
import { BankAccountInput, PaymentMethodInput, type CashAccount, type PaymentMethod } from '@shared/schemas/master';
import type { Pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { recordAudit } from '../../lib/audit';
import { AppError, isUniqueViolation, notFoundError } from '../../lib/errors';
import type { RequestCtx } from '../../middleware/auth';
import * as repo from './repo';

function duplicate(err: unknown, message: string): never {
  if (isUniqueViolation(err)) throw new AppError('DUPLICATE', message, 409);
  throw err;
}

export const listAccounts = (pool: Pool) => repo.listAccounts(pool);
export const listMethods = (pool: Pool) => repo.listMethods(pool);

export async function createBankAccount(pool: Pool, raw: unknown): Promise<CashAccount> {
  const input = BankAccountInput.parse(raw);
  const id = await repo
    .insertBankAccount(pool, input)
    .catch((err) => duplicate(err, `Kode rekening ${input.code} sudah ada.`));
  return (await repo.getAccount(pool, id))!;
}

export async function updateBankAccount(pool: Pool, id: string, raw: unknown): Promise<CashAccount> {
  const input = BankAccountInput.parse(raw);
  const current = await repo.getAccount(pool, id);
  if (!current) throw notFoundError('Rekening');
  if (current.kind !== 'BANK') throw new AppError('BUILT_IN', 'Laci kasir dan kas toko bawaan tidak bisa diubah.', 422);
  await repo
    .updateBankAccount(pool, id, input)
    .catch((err) => duplicate(err, `Kode rekening ${input.code} sudah ada.`));
  return (await repo.getAccount(pool, id))!;
}

export async function deleteBankAccount(pool: Pool, ctx: RequestCtx, id: string): Promise<void> {
  await withTransaction(pool, async (tx) => {
    const current = await repo.getAccount(tx, id);
    if (!current) throw notFoundError('Rekening');
    if (current.kind !== 'BANK')
      throw new AppError('BUILT_IN', 'Laci kasir dan kas toko bawaan tidak bisa dihapus.', 422);
    if (await repo.accountUsedByMethod(tx, id)) {
      throw new AppError(
        'REFERENCE_IN_USE',
        `Rekening ${current.name} masih dipakai metode bayar. Hapus metodenya dulu.`,
        409,
      );
    }
    await repo.softDeleteAccount(tx, id);
    await recordAudit(tx, ctx, {
      action: 'cash_account.delete',
      entity: 'cash_account',
      entityId: id,
      before: current,
    });
  });
}

async function checkBankAccount(pool: Pool, id: string): Promise<void> {
  const account = await repo.getAccount(pool, id);
  if (!account) throw notFoundError('Rekening');
  if (account.kind !== 'BANK')
    throw new AppError('INVALID_ACCOUNT', 'Transfer dan QRIS harus masuk ke rekening bank.', 422);
}

export async function createMethod(pool: Pool, raw: unknown): Promise<PaymentMethod> {
  const input = PaymentMethodInput.parse(raw);
  await checkBankAccount(pool, input.cashAccountId);
  const id = await repo
    .insertMethod(pool, input)
    .catch((err) => duplicate(err, `Kode metode ${input.code} sudah ada.`));
  return (await repo.getMethod(pool, id))!;
}

export async function updateMethod(pool: Pool, id: string, raw: unknown): Promise<PaymentMethod> {
  const current = await repo.getMethod(pool, id);
  if (!current) throw notFoundError('Metode bayar');
  if (current.isBuiltIn) {
    // Tunai & Piutang: only the label and order can change.
    const r = raw as { name?: unknown; sortOrder?: unknown };
    const input = PaymentMethodInput.pick({ name: true, sortOrder: true }).parse({
      name: r.name,
      sortOrder: r.sortOrder,
    });
    await repo.updateBuiltInMethod(pool, id, input.name, input.sortOrder);
  } else {
    const input = PaymentMethodInput.parse(raw);
    await checkBankAccount(pool, input.cashAccountId);
    await repo.updateMethod(pool, id, input).catch((err) => duplicate(err, `Kode metode ${input.code} sudah ada.`));
  }
  return (await repo.getMethod(pool, id))!;
}

export async function deleteMethod(pool: Pool, ctx: RequestCtx, id: string): Promise<void> {
  await withTransaction(pool, async (tx) => {
    const current = await repo.getMethod(tx, id);
    if (!current) throw notFoundError('Metode bayar');
    if (current.isBuiltIn)
      throw new AppError('BUILT_IN', `${current.name} adalah metode bawaan dan tidak bisa dihapus.`, 422);
    await repo.softDeleteMethod(tx, id);
    await recordAudit(tx, ctx, {
      action: 'payment_method.delete',
      entity: 'payment_method',
      entityId: id,
      before: current,
    });
  });
}
