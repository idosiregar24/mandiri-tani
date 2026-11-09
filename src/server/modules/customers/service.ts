// Customers (FR-MD-08): generated PLxxxx codes, the built-in walk-in customer UMUM
// cannot be removed or given credit, credit-limit changes are audited.
import { CustomerInput, QuickCustomerInput, type Customer, type CustomerSummary } from '@shared/schemas/master';
import type { z } from 'zod';
import type { Pool, Queryable } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { recordAudit } from '../../lib/audit';
import { AppError, isUniqueViolation, notFoundError } from '../../lib/errors';
import type { RequestCtx } from '../../middleware/auth';
import * as repo from './repo';

type Parsed = z.output<typeof CustomerInput>;

export async function list(
  pool: Pool,
  q: {
    q?: string;
    groupId?: string;
    includeInactive: boolean;
    sort?: 'name' | 'recent';
    page: number;
    pageSize: number;
  },
): Promise<{ rows: Customer[]; total: number; page: number; pageSize: number }> {
  const r = await repo.list(pool, { ...q, limit: q.pageSize, offset: (q.page - 1) * q.pageSize });
  return { ...r, page: q.page, pageSize: q.pageSize };
}

export async function summary(pool: Pool): Promise<CustomerSummary> {
  return repo.summary(pool);
}

export async function get(pool: Pool, id: string): Promise<Customer> {
  const c = await repo.get(pool, id);
  if (!c) throw notFoundError('Pelanggan');
  return c;
}

async function toRow(db: Queryable, input: Parsed, code: string): Promise<repo.CustomerRow> {
  if (input.customerGroupId && !(await repo.groupExists(db, input.customerGroupId)))
    throw notFoundError('Grup pelanggan');
  return { ...input, code };
}

function duplicate(err: unknown, code: string): never {
  if (isUniqueViolation(err)) throw new AppError('DUPLICATE', `Kode pelanggan ${code} sudah dipakai.`, 409);
  throw err;
}

export async function create(pool: Pool, ctx: RequestCtx, raw: unknown): Promise<Customer> {
  const input = CustomerInput.parse(raw);
  return withTransaction(pool, async (tx) => {
    const code = input.code ?? (await repo.nextCode(tx));
    const id = await repo.insert(tx, await toRow(tx, input, code)).catch((err) => duplicate(err, code));
    if (input.creditLimit !== null) {
      await recordAudit(tx, ctx, {
        action: 'customer.credit_limit',
        entity: 'customer',
        entityId: id,
        after: { creditLimit: input.creditLimit },
      });
    }
    return (await repo.get(tx, id))!;
  });
}

/**
 * Cashier's quick add (name, HP, village) — everything else takes the normal defaults
 * (no group, term 10 days, credit limit empty = D-7). The Owner completes the rest later.
 */
export async function quickCreate(pool: Pool, ctx: RequestCtx, raw: unknown): Promise<Customer> {
  const quick = QuickCustomerInput.parse(raw);
  const input = CustomerInput.parse(quick);
  return withTransaction(pool, async (tx) => {
    const code = await repo.nextCode(tx);
    const id = await repo.insert(tx, await toRow(tx, input, code)).catch((err) => duplicate(err, code));
    await recordAudit(tx, ctx, {
      action: 'customer.quick_create',
      entity: 'customer',
      entityId: id,
      after: { code, name: input.name },
    });
    return (await repo.get(tx, id))!;
  });
}

export async function update(pool: Pool, ctx: RequestCtx, id: string, raw: unknown): Promise<Customer> {
  const input = CustomerInput.parse(raw);
  return withTransaction(pool, async (tx) => {
    const current = await repo.get(tx, id);
    if (!current) throw notFoundError('Pelanggan');
    const code = input.code ?? current.code;
    const row = await toRow(tx, input, code);
    if (current.isWalkIn) {
      // The walk-in customer stays UMUM, active and cash-only (KSR quick sales use it).
      Object.assign(row, { code: current.code, isActive: true, creditLimit: '0.00' });
    }
    await repo.update(tx, id, row).catch((err) => duplicate(err, code));
    const after = (await repo.get(tx, id))!;
    if (after.creditLimit !== current.creditLimit) {
      await recordAudit(tx, ctx, {
        action: 'customer.credit_limit',
        entity: 'customer',
        entityId: id,
        before: { creditLimit: current.creditLimit },
        after: { creditLimit: after.creditLimit },
      });
    }
    return after;
  });
}

export async function remove(pool: Pool, ctx: RequestCtx, id: string): Promise<void> {
  await withTransaction(pool, async (tx) => {
    const current = await repo.get(tx, id);
    if (!current) throw notFoundError('Pelanggan');
    if (current.isWalkIn) throw new AppError('BUILT_IN', 'Pelanggan UMUM bawaan tidak bisa dihapus.', 422);
    // Sprint 7/9: refuse while the customer has open receivables or unpicked goods.
    await repo.softDelete(tx, id);
    await recordAudit(tx, ctx, {
      action: 'customer.delete',
      entity: 'customer',
      entityId: id,
      before: { code: current.code },
    });
  });
}
