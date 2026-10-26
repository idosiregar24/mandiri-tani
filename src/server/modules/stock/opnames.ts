// Stock opname (FR-INV-05): a COUNTING session collects physical counts; posting takes the
// system qty AT POSTING TIME (sales during the session still count) and books the difference
// as OPNAME movements — all in one transaction. Posted/cancelled sessions are never changed.
import { dec, toMoney, toQty } from '@shared/money';
import { hasPermission } from '@shared/permissions';
import { OpnameCountInput, OpnameCreateInput, type Opname, type OpnameLine } from '@shared/schemas/stock';
import { uuidv7 } from '@shared/uuid';
import type { Pool, Queryable } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { recordAudit } from '../../lib/audit';
import { clock } from '../../lib/clock';
import { AppError, notFoundError } from '../../lib/errors';
import { nextDocNumber } from '../../lib/numbering';
import type { RequestCtx } from '../../middleware/auth';
import * as docs from './documents-repo';
import { toBaseQty } from './inventory';
import * as read from './read-repo';
import * as stock from './service';

const STATUS_LABEL: Record<Opname['status'], string> = {
  COUNTING: 'masih dihitung',
  POSTED: 'sudah diposting',
  CANCELLED: 'sudah dibatalkan',
};

async function headOrThrow(db: Queryable, id: string, forUpdate = false): Promise<docs.OpnameHead> {
  const h = await docs.getOpnameHead(db, id, forUpdate);
  if (!h) throw notFoundError('Stok opname');
  return h;
}

function mustBeCounting(h: docs.OpnameHead): void {
  if (h.status !== 'COUNTING')
    throw new AppError(
      'OPNAME_CLOSED',
      `Stok opname ${h.number} ${STATUS_LABEL[h.status]} dan tidak bisa diubah.`,
      409,
    );
}

export async function get(db: Queryable, ctx: RequestCtx, id: string): Promise<Opname> {
  const h = await headOrThrow(db, id);
  const rows = await docs.opnameLines(db, id);
  const cost = hasPermission(ctx.role, 'cost.read');
  let total = dec(0);
  const lines: OpnameLine[] = rows.map(({ status: _s, unitCost, ...l }) => {
    if (!cost) return l;
    const diffValue = toMoney(dec(l.diffQty).times(unitCost ?? 0));
    total = total.plus(diffValue);
    return { ...l, unitCost, diffValue };
  });
  const { warehouseId: _w, ...head } = h;
  return { ...head, lines, ...(cost ? { diffValue: toMoney(total) } : {}) };
}

export async function list(pool: Pool, page: number, pageSize: number) {
  const r = await docs.listOpnames(pool, pageSize, (page - 1) * pageSize);
  return { rows: r.rows.map(({ warehouseId: _w, ...h }) => h), total: r.total, page, pageSize };
}

export async function create(pool: Pool, ctx: RequestCtx, raw: unknown): Promise<Opname> {
  const input = OpnameCreateInput.parse(raw);
  const id = await withTransaction(pool, async (tx) => {
    const wh = await read.defaultWarehouse(tx);
    const opnameId = uuidv7();
    const number = await nextDocNumber(tx, 'OP', wh.code, clock.now());
    await docs.insertOpname(tx, { id: opnameId, number, warehouseId: wh.id, note: input.note, createdBy: ctx.userId });
    return opnameId;
  });
  return get(pool, ctx, id);
}

/** Records (or corrects) one product's count. Typed in any of its units; stored in base units. */
export async function count(pool: Pool, ctx: RequestCtx, id: string, raw: unknown): Promise<Opname> {
  const input = OpnameCountInput.parse(raw);
  await withTransaction(pool, async (tx) => {
    mustBeCounting(await headOrThrow(tx, id, true));
    const { base } = await toBaseQty(tx, input.productId, input.productUnitId, input.countedQty);
    await docs.upsertOpnameLine(tx, {
      id: uuidv7(),
      opnameId: id,
      productId: input.productId,
      countedQty: base,
      countedBy: ctx.userId,
      deviceId: ctx.deviceId,
    });
  });
  return get(pool, ctx, id);
}

export async function removeLine(pool: Pool, ctx: RequestCtx, id: string, lineId: string): Promise<Opname> {
  await withTransaction(pool, async (tx) => {
    mustBeCounting(await headOrThrow(tx, id, true));
    if (!(await docs.deleteOpnameLine(tx, id, lineId))) throw notFoundError('Baris hitungan');
  });
  return get(pool, ctx, id);
}

export async function post(pool: Pool, ctx: RequestCtx, id: string): Promise<Opname> {
  await withTransaction(pool, async (tx) => {
    const h = await headOrThrow(tx, id, true);
    mustBeCounting(h);
    const lines = await docs.rawOpnameLines(tx, id);
    if (lines.length === 0) throw new AppError('OPNAME_EMPTY', 'Belum ada barang yang dihitung.', 422);
    // System qty is read under the stock locks, so a sale cannot slip in between reading and posting.
    const system = await stock.lockForCount(
      tx,
      lines.map((l) => ({ productId: l.productId, warehouseId: h.warehouseId })),
    );
    const now = clock.now();
    const withDiff = lines.map((l) => {
      const systemQty = system.get(`${l.productId}|${h.warehouseId}`) ?? '0';
      return { ...l, systemQty, diff: dec(l.countedQty).minus(systemQty) };
    });
    const changed = withDiff.filter((l) => !l.diff.isZero());
    const applied = await stock.apply(
      tx,
      changed.map((l) => ({
        productId: l.productId,
        warehouseId: h.warehouseId,
        qty: l.diff,
        sourceType: 'OPNAME' as const,
        sourceId: id,
        sourceLineId: l.id,
        movedAt: now,
        note: h.note,
      })),
      { createdBy: ctx.userId },
    );
    const costByLine = new Map(changed.map((l, i) => [l.id, applied[i]!.unitCost]));
    await docs.setOpnameLineResults(
      tx,
      withDiff.map((l) => ({
        id: l.id,
        systemQty: toQty(l.systemQty),
        diffQty: toQty(l.diff),
        unitCost: costByLine.get(l.id) ?? null,
      })),
    );
    await docs.setOpnameStatus(tx, id, 'POSTED', ctx.userId);
    await recordAudit(tx, ctx, {
      action: 'stock.opname.post',
      entity: 'stock_opname',
      entityId: id,
      after: {
        number: h.number,
        counted: lines.length,
        changed: changed.map((l) => ({ productId: l.productId, diff: toQty(l.diff) })),
      },
    });
  });
  return get(pool, ctx, id);
}

export async function cancel(pool: Pool, ctx: RequestCtx, id: string): Promise<Opname> {
  await withTransaction(pool, async (tx) => {
    const h = await headOrThrow(tx, id, true);
    mustBeCounting(h);
    await docs.setOpnameStatus(tx, id, 'CANCELLED', null);
    await recordAudit(tx, ctx, {
      action: 'stock.opname.cancel',
      entity: 'stock_opname',
      entityId: id,
      before: { number: h.number },
    });
  });
  return get(pool, ctx, id);
}
