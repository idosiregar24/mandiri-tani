// Cash book (FR-FIN-01/02, sprint-10 S10-7). Manual cash in KSIN / out KASO and transfers TRF
// between accounts; every row is append-only (trigger forbid_mutation) — a mistake is undone by an
// entry the other way. The cashier works only with the drawer (LACI); the Owner with every account.
import { hasPermission } from '@shared/permissions';
import { toMoney } from '@shared/money';
import {
  CashCategoryInput,
  CashEntryInput,
  CashListQuery,
  CashTransferInput,
  type CashAccountBalance,
  type CashCategory,
  type CashTransaction,
} from '@shared/schemas/cash';
import { uuidv7 } from '@shared/uuid';
import type { Pool, Queryable } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { recordAudit } from '../../lib/audit';
import { clock } from '../../lib/clock';
import { AppError, notFoundError } from '../../lib/errors';
import { nextDocNumber } from '../../lib/numbering';
import type { RequestCtx } from '../../middleware/auth';
import { defaultWarehouse } from '../stock/read-repo';
import { today } from '../ar-ap/service';
import * as repo from './repo';

const invalid = (code: string, message: string) => new AppError(code, message, 422);

/** null = every account; the cashier only sees and uses the drawer. */
const accountKinds = (ctx: RequestCtx): string[] | null =>
  hasPermission(ctx.role, 'reports.cashflow') ? null : ['DRAWER'];

export async function balances(pool: Pool, ctx: RequestCtx): Promise<CashAccountBalance[]> {
  return repo.balances(pool, accountKinds(ctx));
}

export async function list(pool: Pool, ctx: RequestCtx, raw: unknown) {
  const q = CashListQuery.parse(raw);
  const r = await repo.listTransactions(pool, q, accountKinds(ctx));
  return { ...r, page: q.page, pageSize: q.pageSize };
}

export async function get(pool: Pool, id: string): Promise<CashTransaction> {
  const t = await repo.getTransaction(pool, id);
  if (!t) throw notFoundError('Transaksi kas');
  return t;
}

export const categories = (pool: Pool): Promise<CashCategory[]> => repo.listCategories(pool);

/** When the entry happened: now, or (Owner) noon WIB of a past day. */
function entryTime(ctx: RequestCtx, date: string | null): Date {
  if (!date || date === today()) return clock.now();
  if (accountKinds(ctx)) throw invalid('DATE_NOT_ALLOWED', 'Kasir hanya bisa mencatat kas hari ini.');
  if (date > today()) throw invalid('DATE_IN_FUTURE', 'Tanggal tidak boleh setelah hari ini.');
  return new Date(`${date}T12:00:00+07:00`);
}

async function usableAccount(tx: Queryable, ctx: RequestCtx, id: string) {
  const a = await repo.account(tx, id);
  if (!a || !a.isActive) throw notFoundError('Akun kas');
  const kinds = accountKinds(ctx);
  if (kinds && !kinds.includes(a.kind)) {
    throw new AppError('FORBIDDEN', 'Kasir hanya bisa mencatat kas di Laci Kasir.', 403);
  }
  return a;
}

/** KSIN (in) / KASO (out) — iPOS codes. */
export async function addEntry(pool: Pool, ctx: RequestCtx, raw: unknown): Promise<CashTransaction> {
  const input = CashEntryInput.parse(raw);
  const id = await withTransaction(pool, async (tx) => {
    const acc = await usableAccount(tx, ctx, input.cashAccountId);
    const cat = await repo.getCategory(tx, input.categoryId);
    if (!cat) throw notFoundError('Kategori kas');
    if (!cat.manual) {
      throw invalid(
        'CATEGORY_AUTOMATIC',
        `Kategori "${cat.name}" dicatat otomatis oleh aplikasi. Pilih kategori lain.`,
      );
    }
    if (cat.direction !== 'BOTH' && cat.direction !== input.direction) {
      throw invalid(
        'CATEGORY_DIRECTION',
        `Kategori "${cat.name}" hanya untuk kas ${cat.direction === 'IN' ? 'masuk' : 'keluar'}.`,
      );
    }
    const trxAt = entryTime(ctx, input.date);
    const wh = await defaultWarehouse(tx);
    const number = await nextDocNumber(tx, input.direction === 'IN' ? 'KSIN' : 'KASO', wh.code, trxAt);
    const entryId = uuidv7();
    const amount = toMoney(input.amount);
    await repo.insertEntry(tx, {
      id: entryId,
      number,
      cashAccountId: acc.id,
      categoryId: cat.id,
      trxAt,
      direction: input.direction,
      amount,
      sourceType: 'MANUAL',
      sourceId: null,
      note: input.note,
      createdBy: ctx.userId,
    });
    await recordAudit(tx, ctx, {
      action: input.direction === 'IN' ? 'cash.in' : 'cash.out',
      entity: 'cash_transaction',
      entityId: entryId,
      after: { number, account: acc.code, category: cat.code, amount, note: input.note },
    });
    return entryId;
  });
  return get(pool, id);
}

/** TRF: OUT from one account + IN to another, one number (on the OUT row), one transaction. */
export async function transfer(pool: Pool, ctx: RequestCtx, raw: unknown): Promise<CashTransaction> {
  const input = CashTransferInput.parse(raw);
  const id = await withTransaction(pool, async (tx) => {
    const from = await usableAccount(tx, ctx, input.fromAccountId);
    const to = await repo.account(tx, input.toAccountId);
    if (!to || !to.isActive) throw notFoundError('Akun kas tujuan');
    const cats = await repo.listCategories(tx);
    const category = cats.find((c) => c.code.toUpperCase() === 'TRANSFER');
    if (!category) throw new AppError('CATEGORY_MISSING', 'Kategori "Setoran / Transfer Kas" tidak ditemukan.', 500);

    const trxAt = entryTime(ctx, input.date);
    const wh = await defaultWarehouse(tx);
    const number = await nextDocNumber(tx, 'TRF', wh.code, trxAt);
    const transferId = uuidv7();
    const outId = uuidv7();
    const amount = toMoney(input.amount);
    const note = [`${from.name} → ${to.name}`, input.note].filter(Boolean).join(' · ');
    const row = { categoryId: category.id, trxAt, amount, sourceType: 'TRANSFER' as const, sourceId: transferId };
    await repo.insertEntry(tx, {
      ...row,
      id: outId,
      number,
      cashAccountId: from.id,
      direction: 'OUT',
      note,
      createdBy: ctx.userId,
    });
    await repo.insertEntry(tx, {
      ...row,
      id: uuidv7(),
      number: null,
      cashAccountId: to.id,
      direction: 'IN',
      note: `${number} · ${note}`,
      createdBy: ctx.userId,
    });
    await recordAudit(tx, ctx, {
      action: 'cash.transfer',
      entity: 'cash_transaction',
      entityId: outId,
      after: { number, from: from.code, to: to.code, amount },
    });
    return outId;
  });
  return get(pool, id);
}

/** Internal code for a new category: OPEX_PARKIR, MASUK_SEWA_GUDANG … (unique). */
async function newCategoryCode(tx: Queryable, input: CashCategoryInput): Promise<string> {
  const prefix = input.direction === 'IN' ? 'MASUK' : input.isOperatingExpense ? 'OPEX' : 'KELUAR';
  const slug =
    input.name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 30) || 'LAIN';
  const existing = new Set((await repo.listCategories(tx)).map((c) => c.code.toUpperCase()));
  let code = `${prefix}_${slug}`;
  for (let n = 2; existing.has(code); n++) code = `${prefix}_${slug}_${n}`;
  return code;
}

export async function addCategory(pool: Pool, ctx: RequestCtx, raw: unknown): Promise<CashCategory> {
  const input = CashCategoryInput.parse(raw);
  const id = await withTransaction(pool, async (tx) => {
    if (await repo.categoryNameTaken(tx, input.name, null)) {
      throw new AppError('DUPLICATE', `Kategori "${input.name}" sudah ada.`, 409);
    }
    const catId = uuidv7();
    const code = await newCategoryCode(tx, input);
    await repo.insertCategory(tx, catId, code, input);
    await recordAudit(tx, ctx, {
      action: 'cash_category.create',
      entity: 'cash_category',
      entityId: catId,
      after: input,
    });
    return catId;
  });
  return (await repo.getCategory(pool, id))!;
}

export async function updateCategory(pool: Pool, ctx: RequestCtx, id: string, raw: unknown): Promise<CashCategory> {
  const input = CashCategoryInput.parse(raw);
  await withTransaction(pool, async (tx) => {
    const before = await repo.getCategory(tx, id);
    if (!before) throw notFoundError('Kategori kas');
    if (before.isSystem) throw invalid('CATEGORY_SYSTEM', `Kategori bawaan "${before.name}" tidak bisa diubah.`);
    if (await repo.categoryNameTaken(tx, input.name, id)) {
      throw new AppError('DUPLICATE', `Kategori "${input.name}" sudah ada.`, 409);
    }
    await repo.updateCategory(tx, id, input);
    await recordAudit(tx, ctx, {
      action: 'cash_category.update',
      entity: 'cash_category',
      entityId: id,
      before,
      after: input,
    });
  });
  return (await repo.getCategory(pool, id))!;
}
