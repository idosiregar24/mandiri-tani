// Stock adjustments (FR-INV-06): one document = one transaction — number (PS), lines, ledger,
// FIFO layers and audit commit together (golden rule 1). Created POSTED; corrections are new adjustments.
import { hasPermission } from '@shared/permissions';
import { AdjustmentInput, type Adjustment } from '@shared/schemas/stock';
import { uuidv7 } from '@shared/uuid';
import type { Pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { recordAudit } from '../../lib/audit';
import { clock } from '../../lib/clock';
import { notFoundError } from '../../lib/errors';
import { nextDocNumber } from '../../lib/numbering';
import type { RequestCtx } from '../../middleware/auth';
import * as docs from './documents-repo';
import { toBaseQty } from './inventory';
import * as read from './read-repo';
import * as stock from './service';

function serialize(a: Required<Adjustment> | Required<Omit<Adjustment, 'lines'>>, ctx: RequestCtx): Adjustment {
  if (hasPermission(ctx.role, 'cost.read')) return a;
  const { value: _v, ...rest } = a;
  if ('lines' in rest) return { ...rest, lines: rest.lines.map(({ unitCost: _u, ...l }) => l) };
  return rest;
}

export async function create(
  pool: Pool,
  ctx: RequestCtx,
  raw: unknown,
  idempotencyKey: string | null,
): Promise<Adjustment> {
  const input = AdjustmentInput.parse(raw);
  const id = await withTransaction(pool, async (tx) => {
    // Idempotency-Key (backend-standards §3): a retried request returns the same document.
    if (idempotencyKey) {
      const existing = await docs.adjustmentIdByClientOp(tx, idempotencyKey);
      if (existing) return existing;
    }
    const wh = await read.defaultWarehouse(tx);
    const now = clock.now();
    const adjustmentId = uuidv7();
    const lines = [];
    for (const l of input.lines) {
      const { base } = await toBaseQty(tx, l.productId, l.productUnitId, l.qty);
      lines.push({ id: uuidv7(), productId: l.productId, qty: base });
    }
    const number = await nextDocNumber(tx, 'PS', wh.code, now);
    await docs.insertAdjustment(tx, {
      id: adjustmentId,
      number,
      warehouseId: wh.id,
      reasonCode: input.reasonCode,
      note: input.note,
      trxAt: now,
      clientOpId: idempotencyKey,
      createdBy: ctx.userId,
    });
    const applied = await stock.apply(
      tx,
      lines.map((l) => ({
        productId: l.productId,
        warehouseId: wh.id,
        qty: l.qty,
        sourceType: 'ADJUSTMENT' as const,
        sourceId: adjustmentId,
        sourceLineId: l.id,
        movedAt: now,
        note: input.note,
      })),
      { createdBy: ctx.userId },
    );
    await docs.insertAdjustmentLines(
      tx,
      adjustmentId,
      lines.map((l, i) => ({ ...l, unitCost: applied[i]!.unitCost })),
    );
    await recordAudit(tx, ctx, {
      action: 'stock.adjust',
      entity: 'stock_adjustment',
      entityId: adjustmentId,
      after: {
        number,
        reasonCode: input.reasonCode,
        note: input.note,
        lines: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
      },
    });
    return adjustmentId;
  });
  return get(pool, ctx, id);
}

export async function get(pool: Pool, ctx: RequestCtx, id: string): Promise<Adjustment> {
  const a = await docs.getAdjustment(pool, id);
  if (!a) throw notFoundError('Penyesuaian stok');
  return serialize(a, ctx);
}

export async function list(pool: Pool, ctx: RequestCtx, page: number, pageSize: number) {
  const r = await docs.listAdjustments(pool, pageSize, (page - 1) * pageSize);
  return { rows: r.rows.map((a) => serialize(a, ctx)), total: r.total, page, pageSize };
}
