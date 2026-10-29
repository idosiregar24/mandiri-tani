// Held notes (FR-POS-08, sprint-7 S7-1): a HELD sales row — no number, no stock, no cash.
// Recall moves it back into the cart and deletes the row in one transaction; it is then saved
// through the normal POST /sales.
import { dec, Decimal, toMoney, toQty } from '@shared/money';
import { lineTotal } from '@shared/pos';
import { resolvePrice, type PriceSource } from '@shared/pricing';
import { HoldSaleInput, type HeldSaleItem, type RecalledSale } from '@shared/schemas/sales';
import { uuidv7 } from '@shared/uuid';
import type { Pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { clock } from '../../lib/clock';
import { AppError, notFoundError } from '../../lib/errors';
import type { RequestCtx } from '../../middleware/auth';
import { productsByIds } from '../pos/repo';
import { defaultWarehouse } from '../stock/read-repo';
import * as repo from './repo';

export async function hold(pool: Pool, ctx: RequestCtx, raw: unknown): Promise<HeldSaleItem> {
  const input = HoldSaleInput.parse(raw);
  const id = await withTransaction(pool, async (tx) => {
    const customer = input.customerId ? await repo.customer(tx, input.customerId) : await repo.walkInCustomer(tx);
    if (!customer) throw new AppError('CUSTOMER_NOT_FOUND', 'Pelanggan tidak ditemukan.', 422);
    const units = await repo.saleUnits(
      tx,
      input.lines.map((l) => l.productUnitId),
    );
    const saleId = uuidv7();
    const items = input.lines.map((l, i) => {
      const u = units.get(l.productUnitId);
      if (!u || !u.usable) throw new AppError('PRODUCT_NOT_FOUND', `Barang di baris ${i + 1} tidak ditemukan.`, 422);
      const list = resolvePrice(u.prices, { groupId: customer.groupId, qty: l.qty });
      const total = lineTotal(l);
      return {
        id: uuidv7(),
        saleId,
        lineNo: i + 1,
        productId: u.productId,
        productUnitId: u.productUnitId,
        productName: u.productName,
        unitCode: u.unitCode,
        conversionQty: u.conversionQty,
        qty: dec(l.qty).toFixed(),
        baseQty: toQty(dec(l.qty).times(u.conversionQty)),
        unitPrice: toMoney(l.unitPrice),
        listPrice: list?.price ?? null,
        priceSource: (list && dec(list.price).eq(l.unitPrice) ? list.source : 'MANUAL') as PriceSource,
        allocatedDiscount: '0.00',
        lineTotal: total,
        netAmount: total,
        costPerBase: null,
        costTotal: null,
        pickedUpQty: '0',
      };
    });
    const subtotal = toMoney(items.reduce((s, l) => s.plus(l.lineTotal), new Decimal(0)));
    const discount = toMoney(Decimal.min(input.discountAmount ?? '0', subtotal));
    const otherCharges = input.channel === 'FAKTUR' ? toMoney(input.otherCharges ?? '0') : '0.00';
    const wh = await defaultWarehouse(tx);
    await repo.insertHeld(tx, {
      id: saleId,
      channel: input.channel ?? 'KASIR',
      deviceId: ctx.deviceId,
      cashierId: ctx.userId,
      customerId: customer.id,
      customerGroupId: customer.groupId,
      warehouseId: wh.id,
      trxAt: clock.now(),
      holdLabel: input.holdLabel,
      subtotal,
      discountAmount: discount,
      otherCharges,
      otherChargesNote: input.channel === 'FAKTUR' ? (input.otherChargesNote ?? null) : null,
      total: toMoney(dec(subtotal).minus(discount).plus(otherCharges)),
      note: input.note ?? null,
    });
    await repo.insertItems(tx, items);
    return saleId;
  });
  const row = (await repo.listHeld(pool)).find((h) => h.id === id);
  return row!;
}

export const listHeld = (pool: Pool) => repo.listHeld(pool);

export async function recall(pool: Pool, id: string): Promise<RecalledSale> {
  return withTransaction(pool, async (tx) => {
    const held = await repo.lockHeld(tx, id);
    if (!held) throw notFoundError('Nota tertahan');
    const products = await productsByIds(tx, [...new Set(held.lines.map((l) => l.productId))]);
    await repo.deleteHeld(tx, id);
    return {
      channel: held.channel,
      customer: held.customer,
      discountAmount: held.discountAmount,
      otherCharges: held.otherCharges,
      otherChargesNote: held.otherChargesNote,
      lines: held.lines.map(({ productId: _p, ...l }) => l),
      products,
    };
  });
}
