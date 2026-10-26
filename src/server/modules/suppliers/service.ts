// Suppliers (FR-MD-09): generated SPxxxx codes, soft delete only.
import { SupplierInput, type Supplier } from '@shared/schemas/master';
import type { Pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { recordAudit } from '../../lib/audit';
import { AppError, isUniqueViolation, notFoundError } from '../../lib/errors';
import type { RequestCtx } from '../../middleware/auth';
import * as repo from './repo';

export async function list(
  pool: Pool,
  q: { q?: string; includeInactive: boolean; page: number; pageSize: number },
): Promise<{ rows: Supplier[]; total: number; page: number; pageSize: number }> {
  const r = await repo.list(pool, { ...q, limit: q.pageSize, offset: (q.page - 1) * q.pageSize });
  return { ...r, page: q.page, pageSize: q.pageSize };
}

export async function get(pool: Pool, id: string): Promise<Supplier> {
  const s = await repo.get(pool, id);
  if (!s) throw notFoundError('Supplier');
  return s;
}

function duplicate(err: unknown, code: string): never {
  if (isUniqueViolation(err)) throw new AppError('DUPLICATE', `Kode supplier ${code} sudah dipakai.`, 409);
  throw err;
}

export async function create(pool: Pool, raw: unknown): Promise<Supplier> {
  const input = SupplierInput.parse(raw);
  return withTransaction(pool, async (tx) => {
    const code = input.code ?? (await repo.nextCode(tx));
    const id = await repo.insert(tx, { ...input, code }).catch((err) => duplicate(err, code));
    return (await repo.get(tx, id))!;
  });
}

export async function update(pool: Pool, id: string, raw: unknown): Promise<Supplier> {
  const input = SupplierInput.parse(raw);
  return withTransaction(pool, async (tx) => {
    const current = await repo.get(tx, id);
    if (!current) throw notFoundError('Supplier');
    const code = input.code ?? current.code;
    await repo.update(tx, id, { ...input, code }).catch((err) => duplicate(err, code));
    return (await repo.get(tx, id))!;
  });
}

export async function remove(pool: Pool, ctx: RequestCtx, id: string): Promise<void> {
  await withTransaction(pool, async (tx) => {
    const current = await repo.get(tx, id);
    if (!current) throw notFoundError('Supplier');
    // Sprint 8/9: refuse while the supplier has open payables.
    await repo.softDelete(tx, id);
    await recordAudit(tx, ctx, {
      action: 'supplier.delete',
      entity: 'supplier',
      entityId: id,
      before: { code: current.code },
    });
  });
}
