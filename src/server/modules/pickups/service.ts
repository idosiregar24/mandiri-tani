// Pickup notes AB (PRD §5.3b, sprint-7 S7-5): one note = one transaction — number, lines,
// SALE_PICKUP stock (physical − and reserved −, FIFO cost at pickup time), sale line cost,
// sale fulfilment status and audit commit together. Corrections = cancel (never edit).
import { dec, toMoney, toQty } from '@shared/money';
import {
  CancelPickupInput,
  OutstandingQuery,
  PickupInput,
  PickupListQuery,
  type Pickup,
} from '@shared/schemas/pickups';
import { uuidv7 } from '@shared/uuid';
import type { Pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { recordAudit } from '../../lib/audit';
import { clock } from '../../lib/clock';
import { AppError, notFoundError } from '../../lib/errors';
import { nextDocNumber } from '../../lib/numbering';
import type { RequestCtx } from '../../middleware/auth';
import { customer as findCustomer } from '../sales/repo';
import { defaultWarehouse } from '../stock/read-repo';
import * as stock from '../stock/service';
import * as repo from './repo';

const invalid = (code: string, message: string) => new AppError(code, message, 422);

export async function outstanding(pool: Pool, raw: unknown) {
  return repo.outstanding(pool, OutstandingQuery.parse(raw));
}

export async function get(pool: Pool, id: string): Promise<Pickup> {
  const p = await repo.get(pool, id);
  if (!p) throw notFoundError('Bukti pengambilan');
  return p;
}

export async function list(pool: Pool, raw: unknown) {
  const q = PickupListQuery.parse(raw);
  const r = await repo.list(pool, { customerId: q.customerId, limit: q.pageSize, offset: (q.page - 1) * q.pageSize });
  return { ...r, page: q.page, pageSize: q.pageSize };
}

export async function create(
  pool: Pool,
  ctx: RequestCtx,
  raw: unknown,
  idempotencyKey: string | null,
): Promise<Pickup> {
  const input = PickupInput.parse(raw);
  const id = await withTransaction(pool, async (tx) => {
    if (idempotencyKey) {
      const existing = await repo.idByClientOp(tx, idempotencyKey);
      if (existing) return existing;
    }
    const customer = await findCustomer(tx, input.customerId);
    if (!customer) throw invalid('CUSTOMER_NOT_FOUND', 'Pelanggan tidak ditemukan.');
    const items = await repo.lockItems(
      tx,
      input.lines.map((l) => l.saleItemId),
    );
    const lines = input.lines.map((l) => {
      const it = items.get(l.saleItemId);
      if (!it || it.customerId !== input.customerId || it.saleStatus !== 'COMPLETED') {
        throw invalid('PICKUP_LINE_INVALID', 'Ada barang yang bukan milik pelanggan ini atau notanya sudah batal.');
      }
      if (dec(l.qty).gt(it.remaining)) {
        throw invalid(
          'PICKUP_TOO_MUCH',
          `${it.productName} (nota ${it.saleNumber}) tinggal ${it.remaining.replace('.', ',')} yang belum diambil.`,
        );
      }
      if (!it.allowDecimalQty && !dec(l.qty).isInteger()) {
        throw invalid('QTY_NOT_WHOLE', `${it.productName} diambil dalam bilangan bulat.`);
      }
      return { id: uuidv7(), item: it, qty: dec(l.qty).toFixed(), baseQty: toQty(dec(l.qty).times(it.conversionQty)) };
    });

    const now = clock.now();
    const wh = await defaultWarehouse(tx);
    const pickupId = uuidv7();
    const number = await nextDocNumber(tx, 'AB', wh.code, now);
    await repo.insertPickup(tx, {
      id: pickupId,
      number,
      customerId: input.customerId,
      warehouseId: wh.id,
      method: input.method,
      pickedUpAt: now,
      receiverName: input.receiverName,
      receiverPhone: input.receiverPhone,
      vehicle: input.vehicle,
      driverName: input.driverName,
      destination: input.method === 'DELIVERY' ? input.destination : null,
      note: input.note,
      createdBy: ctx.userId,
      deviceId: ctx.deviceId,
      clientOpId: idempotencyKey,
    });

    // Physical stock leaves now; the reservation made at sale time is released by the same movement.
    const tracked = lines.filter((l) => l.item.trackStock);
    const applied = await stock.apply(
      tx,
      tracked.map((l) => ({
        productId: l.item.productId,
        warehouseId: wh.id,
        qty: dec(l.baseQty).neg(),
        sourceType: 'SALE_PICKUP' as const,
        sourceId: pickupId,
        sourceLineId: l.id,
        movedAt: now,
      })),
      { createdBy: ctx.userId },
    );
    const costOf = new Map(tracked.map((l, i) => [l.id, applied[i]!.unitCost]));
    for (const l of lines) {
      const unitCost = costOf.get(l.id) ?? '0';
      await repo.insertPickupItem(tx, {
        id: l.id,
        pickupId,
        saleItemId: l.item.id,
        qty: l.qty,
        baseQty: l.baseQty,
        unitCost,
      });
      await repo.addPicked(tx, l.item.id, l.qty, toMoney(dec(unitCost).times(l.baseQty)), 1);
    }
    await repo.refreshFulfillment(tx, [...new Set(lines.map((l) => l.item.saleId))]);
    await recordAudit(tx, ctx, {
      action: 'pickup.create',
      entity: 'sale_pickup',
      entityId: pickupId,
      after: {
        number,
        lines: lines.map((l) => ({ sale: l.item.saleNumber, product: l.item.productName, qty: l.qty })),
      },
    });
    return pickupId;
  });
  return get(pool, id);
}

/** Cancel (pickups.cancel — Owner PIN for a cashier): stock back on its original layers, remainder restored. */
export async function cancel(pool: Pool, ctx: RequestCtx, id: string, raw: unknown): Promise<Pickup> {
  const { reason } = CancelPickupInput.parse(raw);
  await withTransaction(pool, async (tx) => {
    const p = await repo.lockPickup(tx, id);
    if (!p) throw notFoundError('Bukti pengambilan');
    if (p.status === 'CANCELLED')
      throw new AppError('ALREADY_CANCELLED', `Pengambilan ${p.number} sudah dibatalkan.`, 409);
    const items = await repo.pickupItems(tx, id);
    await repo.lockItems(
      tx,
      items.map((i) => i.saleItemId),
    );
    const now = clock.now();
    const used = await repo.pickupConsumptions(tx, id);
    if (used.length) {
      await stock.apply(
        tx,
        used.map((c) => ({
          productId: c.productId,
          warehouseId: c.warehouseId,
          qty: c.qty,
          unitCost: c.unitCost,
          layerReceivedAt: c.receivedAt ?? p.pickedUpAt,
          sourceType: 'SALE_PICKUP_CANCEL' as const,
          sourceId: id,
          sourceLineId: c.lineId,
          movedAt: now,
        })),
        { createdBy: ctx.userId },
      );
    }
    for (const i of items) {
      await repo.addPicked(tx, i.saleItemId, i.qty, toMoney(dec(i.unitCost).times(i.baseQty)), -1);
    }
    await repo.refreshFulfillment(tx, [...new Set(items.map((i) => i.saleId))]);
    await repo.markCancelled(tx, id, ctx.userId, now, reason);
    await recordAudit(tx, ctx, {
      action: 'pickup.cancel',
      entity: 'sale_pickup',
      entityId: id,
      after: { number: p.number, reason },
    });
  });
  return get(pool, id);
}
