// Sale return RJ (FR-POS-17, sprint-8 S8-5) — `sales.return`, Owner PIN for a cashier (route guard).
// Per line: the not-yet-picked-up remainder is cancelled first (reservation released, no physical
// movement — the goods never left); the rest came out of the warehouse and goes back in
// (SALE_RETURN at the line's HPP) when "kembali ke stok". Refund in cash (LACI) or off the receivable.
import { dec, Decimal, toMoney, toQty } from '@shared/money';
import { SaleReturnInput, type SaleReturnResult } from '@shared/schemas/purchases';
import { uuidv7 } from '@shared/uuid';
import type { Pool, Queryable } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { recordAudit } from '../../lib/audit';
import { clock } from '../../lib/clock';
import { AppError, notFoundError } from '../../lib/errors';
import { nextDocNumber } from '../../lib/numbering';
import type { RequestCtx } from '../../middleware/auth';
import * as arAp from '../ar-ap/repo';
import { refreshFulfillment } from '../pickups/repo';
import { defaultWarehouse } from '../stock/read-repo';
import * as stock from '../stock/service';
import * as repo from './repo';

const invalid = (code: string, message: string) => new AppError(code, message, 422);

interface ReturnableItem {
  id: string;
  productId: string;
  productName: string;
  conversionQty: string;
  qty: string;
  pickedUpQty: string;
  cancelledQty: string;
  returnedQty: string;
  netAmount: string;
  costPerBase: string | null;
  trackStock: boolean;
}

async function lockItems(db: Queryable, saleId: string): Promise<Map<string, ReturnableItem>> {
  const r = await db.query<ReturnableItem>(
    `SELECT i.id, i.product_id AS "productId", i.product_name AS "productName", trim_scale(i.conversion_qty)::text AS "conversionQty",
            trim_scale(i.qty)::text AS qty, trim_scale(i.picked_up_qty)::text AS "pickedUpQty",
            trim_scale(i.cancelled_qty)::text AS "cancelledQty",
            trim_scale(coalesce((SELECT sum(ri.qty) FROM sale_return_items ri WHERE ri.sale_item_id = i.id), 0))::text AS "returnedQty",
            i.net_amount::text AS "netAmount", i.cost_per_base::text AS "costPerBase", p.track_stock AS "trackStock"
     FROM sale_items i JOIN products p ON p.id = i.product_id
     WHERE i.sale_id = $1 ORDER BY i.id FOR UPDATE OF i`,
    [saleId],
  );
  return new Map(r.rows.map((x) => [x.id, x]));
}

export async function createReturn(
  pool: Pool,
  ctx: RequestCtx,
  saleId: string,
  raw: unknown,
  idempotencyKey: string | null,
): Promise<SaleReturnResult> {
  const input = SaleReturnInput.parse(raw);
  return withTransaction(pool, async (tx) => {
    if (idempotencyKey) {
      const r = await tx.query<SaleReturnResult>(
        `SELECT r.id, r.number, s.number AS "saleNumber", r.total::text, r.settlement FROM sale_returns r JOIN sales s ON s.id = r.sale_id
         WHERE r.client_op_id = $1`,
        [idempotencyKey],
      );
      if (r.rows[0]) return r.rows[0];
    }
    const sale = await repo.lockSale(tx, saleId);
    if (!sale || sale.status !== 'COMPLETED') throw notFoundError('Nota');
    const items = await lockItems(tx, saleId);
    const now = clock.now();
    const wh = await defaultWarehouse(tx);
    const returnId = uuidv7();

    const lines = input.lines.map((l) => {
      const it = items.get(l.saleItemId);
      if (!it) throw invalid('RETURN_LINE_INVALID', 'Barang tidak ada di nota ini.');
      const left = dec(it.qty).minus(it.returnedQty);
      if (dec(l.qty).gt(left)) {
        throw invalid(
          'RETURN_TOO_MUCH',
          `${it.productName}: sisa yang bisa diretur ${left.toFixed().replace('.', ',')}.`,
        );
      }
      const unpicked = dec(it.qty).minus(it.pickedUpQty).minus(it.cancelledQty);
      const fromUnpicked = Decimal.min(l.qty, Decimal.max(0, unpicked));
      const fromTaken = dec(l.qty).minus(fromUnpicked);
      return {
        id: uuidv7(),
        it,
        qty: dec(l.qty).toFixed(),
        baseQty: toQty(dec(l.qty).times(it.conversionQty)),
        unpickedBase: toQty(fromUnpicked.times(it.conversionQty)),
        takenBase: toQty(fromTaken.times(it.conversionQty)),
        fromUnpicked: fromUnpicked.toFixed(),
        restock: l.restock,
        // The customer's money back = this line's share of what was paid for it (after note discount).
        amount: toMoney(dec(it.netAmount).times(l.qty).div(it.qty)),
      };
    });
    const total = toMoney(lines.reduce((s, l) => s.plus(l.amount), new Decimal(0)));

    // Remainder still in the warehouse for this customer: release the reservation.
    const release = lines.filter((l) => l.it.trackStock && dec(l.unpickedBase).gt(0));
    await stock.release(
      tx,
      release.map((l) => ({ productId: l.it.productId, warehouseId: wh.id, qty: l.unpickedBase })),
    );
    for (const l of lines.filter((x) => dec(x.fromUnpicked).gt(0))) {
      await tx.query(`UPDATE sale_items SET cancelled_qty = cancelled_qty + $2::numeric WHERE id = $1`, [
        l.it.id,
        l.fromUnpicked,
      ]);
    }
    // Goods that had left come back on a new layer at the line's HPP (PRD §6.6).
    const back = lines.filter((l) => l.it.trackStock && l.restock && dec(l.takenBase).gt(0));
    await stock.apply(
      tx,
      back.map((l) => ({
        productId: l.it.productId,
        warehouseId: wh.id,
        qty: l.takenBase,
        unitCost: l.it.costPerBase ?? '0',
        sourceType: 'SALE_RETURN' as const,
        sourceId: returnId,
        sourceLineId: l.id,
        movedAt: now,
      })),
      { createdBy: ctx.userId },
    );

    let receivableId: string | null = null;
    if (input.settlement === 'REDUCE_RECEIVABLE') {
      const rec = await tx.query<{ id: string; open: string }>(
        `SELECT id, (amount - paid_amount)::text AS open FROM receivables
         WHERE source_type = 'SALE' AND source_id = $1 AND status IN ('OPEN','PARTIAL') FOR UPDATE`,
        [saleId],
      );
      if (!rec.rows[0] || dec(rec.rows[0].open).lt(total)) {
        throw invalid(
          'RECEIVABLE_TOO_SMALL',
          'Sisa piutang nota ini lebih kecil dari nilai retur. Pilih "uang kembali".',
        );
      }
      receivableId = rec.rows[0].id;
    }
    const number = await nextDocNumber(tx, 'RJ', wh.code, now);
    await tx.query(
      `INSERT INTO sale_returns (id, number, sale_id, customer_id, device_id, warehouse_id, trx_at, settlement, total, reason,
         created_by, approved_by, client_op_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        returnId,
        number,
        saleId,
        sale.customerId,
        ctx.deviceId,
        wh.id,
        now,
        input.settlement,
        total,
        input.reason,
        ctx.userId,
        ctx.approvedBy,
        idempotencyKey,
      ],
    );
    for (const l of lines) {
      await tx.query(
        `INSERT INTO sale_return_items (id, return_id, sale_item_id, qty, base_qty, amount, cost_per_base, restock)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [l.id, returnId, l.it.id, l.qty, l.baseQty, l.amount, l.it.costPerBase ?? '0', l.restock],
      );
    }
    // The deduction is an allocation row like a payment (S9-4): paid_amount = Σ allocations.
    if (receivableId && dec(total).gt(0)) {
      await arAp.allocate(tx, 'AR', { id: uuidv7(), returnId, documentId: receivableId, amount: total });
    }
    if (input.settlement === 'CASH_REFUND' && dec(total).gt(0)) {
      await repo.insertCash(tx, {
        id: uuidv7(),
        cashAccountId: await repo.cashAccountId(tx, 'LACI'),
        categoryId: await repo.cashCategoryId(tx, 'SALE_REFUND'),
        trxAt: now,
        direction: 'OUT',
        amount: total,
        sourceType: 'SALE_RETURN',
        sourceId: returnId,
        note: `${number} · retur ${sale.number}`,
        createdBy: ctx.userId,
      });
    }
    await refreshFulfillment(tx, [saleId]);
    await recordAudit(tx, ctx, {
      action: 'sale.return',
      entity: 'sale_return',
      entityId: returnId,
      after: { number, sale: sale.number, total, settlement: input.settlement, reason: input.reason },
    });
    return { id: returnId, number, saleNumber: sale.number, total, settlement: input.settlement };
  });
}
