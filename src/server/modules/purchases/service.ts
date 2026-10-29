// Direct purchase invoice BL (FR-PUR-04, sprint-8 S8-1…S8-3) and purchase return RB (FR-PUR-06,
// S8-4). One document = one transaction: number, receipt + invoice, FIFO layers, cash / payable, audit.
import { dec, Decimal, toMoney, toQty } from '@shared/money';
import { allocateDiscount, lineTotal } from '@shared/pos';
import { PurchaseInput, PurchaseListQuery, PurchaseReturnInput, type Purchase } from '@shared/schemas/purchases';
import { uuidv7 } from '@shared/uuid';
import type { Pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { recordAudit } from '../../lib/audit';
import { clock, jakartaDate } from '../../lib/clock';
import { AppError, isUniqueViolation, notFoundError } from '../../lib/errors';
import { nextDocNumber } from '../../lib/numbering';
import type { RequestCtx } from '../../middleware/auth';
import * as arAp from '../ar-ap/repo';
import { addDays } from '../sales/service';
import * as salesRepo from '../sales/repo';
import { defaultWarehouse } from '../stock/read-repo';
import * as stock from '../stock/service';
import * as repo from './repo';

const invalid = (code: string, message: string) => new AppError(code, message, 422);
const isoToday = () => {
  const j = jakartaDate(clock.now());
  return `${j.year}-${String(j.month).padStart(2, '0')}-${String(j.day).padStart(2, '0')}`;
};

/**
 * Business time of a purchase: now for today's invoice; noon (WIB) of the invoice date for an
 * invoice typed in later — so its FIFO layers sit at the right place in time.
 */
function businessTime(invoiceDate: string): Date {
  return invoiceDate === isoToday() ? clock.now() : new Date(`${invoiceDate}T12:00:00+07:00`);
}

export async function get(pool: Pool, id: string): Promise<Purchase> {
  const p = await repo.get(pool, id);
  if (!p) throw notFoundError('Faktur pembelian');
  return p;
}

export async function list(pool: Pool, raw: unknown) {
  const q = PurchaseListQuery.parse(raw);
  const r = await repo.list(pool, {
    q: q.q,
    supplierId: q.supplierId,
    limit: q.pageSize,
    offset: (q.page - 1) * q.pageSize,
  });
  return { ...r, page: q.page, pageSize: q.pageSize };
}

export const priceHistory = (pool: Pool, productId: string) => repo.priceHistory(pool, productId);

export async function create(
  pool: Pool,
  ctx: RequestCtx,
  raw: unknown,
  idempotencyKey: string | null,
): Promise<Purchase> {
  const input = PurchaseInput.parse(raw);
  let id: string;
  try {
    id = await withTransaction(pool, async (tx) => {
      if (idempotencyKey) {
        const existing = await repo.idByClientOp(tx, 'purchase_invoices', idempotencyKey);
        if (existing) return existing;
      }
      const supplier = await repo.supplier(tx, input.supplierId);
      if (!supplier || !supplier.isActive)
        throw invalid('SUPPLIER_NOT_FOUND', 'Supplier tidak ditemukan atau nonaktif.');
      const invoiceDate = input.invoiceDate ?? isoToday();
      if (invoiceDate > isoToday()) throw invalid('DATE_IN_FUTURE', 'Tanggal faktur tidak boleh setelah hari ini.');
      const at = businessTime(invoiceDate);

      const units = await repo.purchaseUnits(
        tx,
        input.lines.map((l) => l.productUnitId),
      );
      const lines = input.lines.map((l, i) => {
        const u = units.get(l.productUnitId);
        if (!u) throw invalid('PRODUCT_NOT_FOUND', `Barang di baris ${i + 1} tidak ditemukan atau nonaktif.`);
        if (!u.allowDecimalQty && !dec(l.qty).isInteger())
          throw invalid('QTY_NOT_WHOLE', `${u.productName} dibeli dalam bilangan bulat.`);
        return {
          id: uuidv7(),
          unit: u,
          qty: dec(l.qty).toFixed(),
          baseQty: toQty(dec(l.qty).times(u.conversionQty)),
          unitPrice: toMoney(l.unitPrice),
          lineTotal: lineTotal(l),
        };
      });
      const subtotal = toMoney(lines.reduce((s, l) => s.plus(l.lineTotal), new Decimal(0)));
      const discount = toMoney(input.discountAmount);
      if (dec(discount).gt(subtotal)) throw invalid('DISCOUNT_TOO_LARGE', 'Potongan tidak boleh lebih dari subtotal.');
      const otherCost = toMoney(input.otherCost);
      const total = toMoney(dec(subtotal).minus(discount).plus(otherCost));
      // S8-2: shipping into HPP only when ticked; the note discount never lowers HPP (iPOS default).
      const landed = input.otherCostToHpp
        ? allocateDiscount(
            lines.map((l) => l.lineTotal),
            otherCost,
          )
        : lines.map(() => '0.00');

      let paidFrom: string | null = null;
      if (input.payKind === 'TRANSFER') {
        const m = (await salesRepo.paymentMethods(tx, [input.paymentMethodId!])).get(input.paymentMethodId!);
        if (!m || !m.isActive || !m.cashAccountId || (m.kind !== 'TRANSFER' && m.kind !== 'QRIS')) {
          throw invalid('PAYMENT_METHOD_NOT_FOUND', 'Rekening transfer tidak ditemukan.');
        }
        paidFrom = m.cashAccountId;
      } else if (input.payKind === 'CASH') {
        paidFrom = await salesRepo.cashAccountId(tx, 'KAS_TOKO');
      }
      const dueDate =
        input.payKind === 'CREDIT' ? (input.dueDate ?? addDays(at, supplier.termDays || 10)) : invoiceDate;
      if (dueDate < invoiceDate) throw invalid('DUE_DATE_PAST', 'Jatuh tempo tidak boleh sebelum tanggal faktur.');

      const wh = await defaultWarehouse(tx);
      const number = await nextDocNumber(tx, 'BL', wh.code, at);
      const receiptId = uuidv7();
      const invoiceId = uuidv7();
      await repo.insertReceipt(tx, {
        id: receiptId,
        number,
        supplierId: supplier.id,
        warehouseId: wh.id,
        receivedAt: at,
        deliveryNo: input.supplierInvoiceNo,
        note: input.note,
        userId: ctx.userId,
      });
      await repo.insertInvoice(tx, {
        id: invoiceId,
        number,
        supplierInvoiceNo: input.supplierInvoiceNo,
        supplierId: supplier.id,
        invoiceDate,
        dueDate,
        subtotal,
        discountAmount: discount,
        otherCost,
        total,
        note: input.note,
        clientOpId: idempotencyKey,
        userId: ctx.userId,
      });
      const costed = lines.map((l, i) => ({
        ...l,
        landed: landed[i]!,
        costPerBase: dec(l.lineTotal).plus(landed[i]!).div(l.baseQty).toFixed(4),
      }));
      for (const [i, l] of costed.entries()) {
        await repo.insertReceiptItem(tx, {
          id: l.id,
          receiptId,
          lineNo: i + 1,
          productId: l.unit.productId,
          productUnitId: l.unit.productUnitId,
          conversionQty: l.unit.conversionQty,
          qty: l.qty,
          baseQty: l.baseQty,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
          landedCostAlloc: l.landed,
          costPerBase: l.costPerBase,
        });
        await repo.insertInvoiceItem(tx, { id: uuidv7(), invoiceId, receiptItemId: l.id, lineTotal: l.lineTotal });
      }
      // New FIFO layers at the purchase cost; also refreshes products.last_purchase_cost.
      const tracked = costed.filter((l) => l.unit.trackStock);
      await stock.apply(
        tx,
        tracked.map((l) => ({
          productId: l.unit.productId,
          warehouseId: wh.id,
          qty: l.baseQty,
          unitCost: l.costPerBase,
          sourceType: 'PURCHASE_RECEIPT' as const,
          sourceId: invoiceId,
          sourceLineId: l.id,
          movedAt: at,
        })),
        { createdBy: ctx.userId },
      );

      if (input.payKind === 'CREDIT') {
        await repo.insertPayable(tx, {
          id: uuidv7(),
          supplierId: supplier.id,
          invoiceId,
          number,
          docDate: invoiceDate,
          dueDate,
          amount: total,
        });
      } else if (dec(total).gt(0)) {
        await salesRepo.insertCash(tx, {
          id: uuidv7(),
          cashAccountId: paidFrom!,
          categoryId: await salesRepo.cashCategoryId(tx, 'PURCHASE'),
          trxAt: at,
          direction: 'OUT',
          amount: total,
          sourceType: 'PURCHASE_INVOICE',
          sourceId: invoiceId,
          note: [number, supplier.name, input.supplierInvoiceNo].filter(Boolean).join(' · '),
          createdBy: ctx.userId,
        });
      }
      await recordAudit(tx, ctx, {
        action: 'purchase.create',
        entity: 'purchase_invoice',
        entityId: invoiceId,
        after: { number, supplier: supplier.name, total, payKind: input.payKind },
      });
      return invoiceId;
    });
  } catch (err) {
    if (isUniqueViolation(err, 'purchase_invoices_supplier_no_uq')) {
      throw new AppError(
        'DUPLICATE_SUPPLIER_INVOICE',
        'No. faktur supplier ini sudah pernah dicatat untuk supplier yang sama.',
        409,
      );
    }
    throw err;
  }
  return get(pool, id);
}

/** Purchase return RB (S8-4): stock leaves from the receipt's own layers first, then FIFO. */
export async function createReturn(
  pool: Pool,
  ctx: RequestCtx,
  invoiceId: string,
  raw: unknown,
  idempotencyKey: string | null,
): Promise<Purchase> {
  const input = PurchaseReturnInput.parse(raw);
  await withTransaction(pool, async (tx) => {
    if (idempotencyKey && (await repo.idByClientOp(tx, 'purchase_returns', idempotencyKey))) return;
    const inv = await repo.lockInvoice(tx, invoiceId);
    if (!inv) throw notFoundError('Faktur pembelian');
    const byId = new Map(inv.lines.map((l) => [l.id, l]));
    const lines = input.lines.map((l) => {
      const src = byId.get(l.receiptItemId);
      if (!src) throw invalid('RETURN_LINE_INVALID', 'Barang tidak ada di faktur ini.');
      const left = dec(src.qty).minus(src.returnedQty);
      if (dec(l.qty).gt(left)) {
        throw invalid(
          'RETURN_TOO_MUCH',
          `${src.productName}: sisa yang bisa diretur ${left.toFixed().replace('.', ',')}.`,
        );
      }
      return {
        id: uuidv7(),
        src,
        qty: dec(l.qty).toFixed(),
        baseQty: toQty(dec(l.qty).times(src.conversionQty)),
        lineTotal: lineTotal({ qty: l.qty, unitPrice: src.unitPrice }),
      };
    });
    const total = toMoney(lines.reduce((s, l) => s.plus(l.lineTotal), new Decimal(0)));
    const now = clock.now();
    const wh = await defaultWarehouse(tx);
    const returnId = uuidv7();

    let payableId: string | null = null;
    if (input.settlement === 'REDUCE_PAYABLE') {
      const payable = await repo.lockPayable(tx, invoiceId);
      if (!payable || dec(payable.open).lt(total)) {
        throw invalid(
          'PAYABLE_TOO_SMALL',
          'Sisa hutang faktur ini lebih kecil dari nilai retur. Pilih "uang kembali".',
        );
      }
      payableId = payable.id;
    }
    const tracked = lines.filter((l) => l.src.trackStock);
    const applied = await stock.apply(
      tx,
      tracked.map((l) => ({
        productId: l.src.productId,
        warehouseId: wh.id,
        qty: dec(l.baseQty).neg(),
        preferLayerSourceLineId: l.src.id,
        sourceType: 'PURCHASE_RETURN' as const,
        sourceId: returnId,
        sourceLineId: l.id,
        movedAt: now,
      })),
      { createdBy: ctx.userId },
    );
    const costOf = new Map(tracked.map((l, i) => [l.id, applied[i]!.unitCost]));
    const number = await nextDocNumber(tx, 'RB', wh.code, now);
    await repo.insertReturn(tx, {
      id: returnId,
      number,
      supplierId: inv.supplierId,
      invoiceId,
      warehouseId: wh.id,
      trxAt: now,
      settlement: input.settlement,
      total,
      reason: input.reason,
      clientOpId: idempotencyKey,
      userId: ctx.userId,
    });
    for (const l of lines) {
      await repo.insertReturnItem(tx, {
        id: l.id,
        returnId,
        productId: l.src.productId,
        productUnitId: l.src.productUnitId,
        conversionQty: l.src.conversionQty,
        qty: l.qty,
        baseQty: l.baseQty,
        unitPrice: l.src.unitPrice,
        lineTotal: l.lineTotal,
        unitCost: costOf.get(l.id) ?? '0',
      });
    }
    // The deduction is an allocation row like a payment (S9-4): paid_amount = Σ allocations.
    if (payableId && dec(total).gt(0)) {
      await arAp.allocate(tx, 'AP', { id: uuidv7(), returnId, documentId: payableId, amount: total });
    }
    if (input.settlement === 'CASH_REFUND' && dec(total).gt(0)) {
      await salesRepo.insertCash(tx, {
        id: uuidv7(),
        cashAccountId: await salesRepo.cashAccountId(tx, 'KAS_TOKO'),
        categoryId: await salesRepo.cashCategoryId(tx, 'PURCHASE_REFUND'),
        trxAt: now,
        direction: 'IN',
        amount: total,
        sourceType: 'PURCHASE_RETURN',
        sourceId: returnId,
        note: `${number} · retur ${inv.number}`,
        createdBy: ctx.userId,
      });
    }
    await recordAudit(tx, ctx, {
      action: 'purchase.return',
      entity: 'purchase_return',
      entityId: returnId,
      after: { number, invoice: inv.number, total, settlement: input.settlement, reason: input.reason },
    });
  });
  return get(pool, invoiceId);
}
