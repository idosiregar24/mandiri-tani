// salesService — one sale = one transaction (golden rule 1, PRD §5.3, sprint-6):
// number + header + lines + payments + stock (SALE or reservation) + cash + receivable + audit
// commit together. Printing happens in the renderer AFTER this returns.
import { hasPermission, type Permission } from '@shared/permissions';
import { dec, Decimal, toMoney, toQty } from '@shared/money';
import { allocateDiscount, lineTotal } from '@shared/pos';
import { resolvePrice, type PriceSource } from '@shared/pricing';
import { CompleteSaleInput, SaleListQuery, VoidSaleInput, type Sale, type SaleListItem } from '@shared/schemas/sales';
import { PosSettings } from '@shared/schemas/settings';
import { uuidv7 } from '@shared/uuid';
import type { Pool, Queryable } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { recordAudit } from '../../lib/audit';
import { clock, jakartaDate } from '../../lib/clock';
import { AppError, notFoundError } from '../../lib/errors';
import { nextDocNumber } from '../../lib/numbering';
import type { RequestCtx } from '../../middleware/auth';
import { approveInTx } from '../auth/service';
import * as stock from '../stock/service';
import { defaultWarehouse } from '../stock/read-repo';
import * as repo from './repo';

const invalid = (code: string, message: string, details?: unknown) => new AppError(code, message, 422, details);

const isoDate = (d: { year: number; month: number; day: number }) =>
  `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

/** Jakarta calendar date of `d` plus `days`, as YYYY-MM-DD. */
export function addDays(d: Date, days: number): string {
  const j = jakartaDate(d);
  const t = new Date(Date.UTC(j.year, j.month - 1, j.day + days));
  return isoDate({ year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() });
}

async function posSettings(db: Queryable): Promise<PosSettings> {
  const r = await db.query<{ value: unknown }>(`SELECT value FROM settings WHERE key = 'pos'`);
  return PosSettings.parse(r.rows[0]?.value ?? {});
}

/** HPP never leaves the server for roles without cost.read (security-standards §2). */
function serialize(s: Sale, ctx: Pick<RequestCtx, 'role'>): Sale {
  if (hasPermission(ctx.role, 'cost.read')) return s;
  const { costTotal: _c, ...rest } = s;
  return { ...rest, lines: s.lines.map(({ costPerBase: _p, costTotal: _t, ...l }) => l) };
}

export async function get(pool: Pool, ctx: RequestCtx, id: string): Promise<Sale> {
  const s = await repo.get(pool, id);
  if (!s || s.status === 'HELD') throw notFoundError('Nota');
  // A cashier sees only their own notes (security-standards §2, scope).
  if (!hasPermission(ctx.role, 'reports.all') && s.cashier.id !== ctx.userId) throw notFoundError('Nota');
  return serialize(s, ctx);
}

export async function list(
  pool: Pool,
  ctx: RequestCtx,
  raw: unknown,
): Promise<{ rows: SaleListItem[]; total: number; page: number; pageSize: number }> {
  const q = SaleListQuery.parse(raw);
  const r = await repo.list(pool, {
    date: q.date,
    q: q.q,
    status: q.status,
    cashierId: hasPermission(ctx.role, 'reports.all') ? undefined : ctx.userId,
    limit: q.pageSize,
    offset: (q.page - 1) * q.pageSize,
  });
  return { ...r, page: q.page, pageSize: q.pageSize };
}

export async function complete(
  pool: Pool,
  ctx: RequestCtx,
  raw: unknown,
  opts: { idempotencyKey: string | null; grant: string | null },
): Promise<Sale> {
  const input = CompleteSaleInput.parse(raw);
  const id = await withTransaction(pool, async (tx) => {
    // Idempotency-Key (S6-8): a retried request returns the note that was already saved.
    if (opts.idempotencyKey) {
      const existing = await repo.saleIdByClientOp(tx, opts.idempotencyKey);
      if (existing) return existing;
    }
    const now = clock.now();
    const needs: Permission[] = [];
    const wh = await defaultWarehouse(tx);

    // ---- customer
    const customer = input.customerId ? await repo.customer(tx, input.customerId) : await repo.walkInCustomer(tx);
    if (!customer || !customer.isActive)
      throw invalid('CUSTOMER_NOT_FOUND', 'Pelanggan tidak ditemukan atau nonaktif.');
    if (input.channel === 'FAKTUR' && customer.isWalkIn) {
      throw invalid('CUSTOMER_REQUIRED', 'Faktur penjualan harus atas nama pelanggan. Pilih pelanggan dengan F8.');
    }
    if (input.pickupLater && customer.isWalkIn) {
      throw invalid(
        'CUSTOMER_REQUIRED',
        'Barang yang diambil nanti harus atas nama pelanggan. Pilih pelanggan dengan F8.',
      );
    }

    // ---- lines: list price resolved again on the server (S6-4)
    const units = await repo.saleUnits(
      tx,
      input.lines.map((l) => l.productUnitId),
    );
    const saleId = uuidv7();
    const lines = input.lines.map((l, i) => {
      const u = units.get(l.productUnitId);
      if (!u || !u.usable)
        throw invalid('PRODUCT_NOT_FOUND', `Barang di baris ${i + 1} tidak ditemukan atau tidak dijual lagi.`);
      if (!u.allowDecimalQty && !dec(l.qty).isInteger()) {
        throw invalid('QTY_NOT_WHOLE', `${u.productName} dijual dalam bilangan bulat.`);
      }
      const list = resolvePrice(u.prices, { groupId: customer.groupId, qty: l.qty });
      const source: PriceSource = list && dec(list.price).eq(l.unitPrice) ? list.source : 'MANUAL';
      return {
        id: uuidv7(),
        unit: u,
        qty: dec(l.qty).toFixed(),
        baseQty: toQty(dec(l.qty).times(u.conversionQty)),
        unitPrice: toMoney(l.unitPrice),
        listPrice: list?.price ?? null,
        priceSource: source,
        lineTotal: lineTotal({ qty: l.qty, unitPrice: l.unitPrice }),
      };
    });

    // ---- amounts
    const subtotal = toMoney(lines.reduce((s, l) => s.plus(l.lineTotal), new Decimal(0)));
    const discount = toMoney(input.discountAmount);
    if (dec(discount).gt(subtotal)) throw invalid('DISCOUNT_TOO_LARGE', 'Potongan tidak boleh lebih dari subtotal.');
    const settings = await posSettings(tx);
    if (dec(discount).gt(dec(subtotal).times(settings.cashierDiscountLimitPercent).div(100))) {
      needs.push('sales.discount.unlimited');
    }
    const otherCharges = toMoney(input.otherCharges);
    if (input.channel === 'KASIR' && dec(otherCharges).gt(0)) {
      throw invalid('CHARGES_FAKTUR_ONLY', 'Ongkos angkut hanya untuk Faktur Penjualan.');
    }
    const total = toMoney(dec(subtotal).minus(discount).plus(otherCharges));
    const allocations = allocateDiscount(
      lines.map((l) => l.lineTotal),
      discount,
    );

    // ---- payments (S6-3): non-cash can never give change
    const methods = await repo.paymentMethods(
      tx,
      input.payments.map((p) => p.paymentMethodId),
    );
    let cash = new Decimal(0);
    let nonCash = new Decimal(0);
    for (const p of input.payments) {
      const m = methods.get(p.paymentMethodId);
      if (!m || !m.isActive) throw invalid('PAYMENT_METHOD_NOT_FOUND', 'Cara bayar tidak ditemukan atau nonaktif.');
      if (m.kind === 'CREDIT')
        throw invalid('PAYMENT_METHOD_NOT_FOUND', 'Piutang dihitung otomatis dari sisa yang belum dibayar.');
      if (m.kind === 'CASH') cash = cash.plus(p.amount);
      else nonCash = nonCash.plus(p.amount);
    }
    if (nonCash.gt(total)) {
      throw invalid('NON_CASH_TOO_MUCH', 'Transfer/QRIS melebihi total belanja. Kembalian hanya bisa dari uang tunai.');
    }
    const change = Decimal.max(0, cash.plus(nonCash).minus(total));
    const paid = cash.plus(nonCash).minus(change);
    const credit = dec(total).minus(paid);
    let dueDate: string | null = null;
    if (credit.gt(0)) {
      if (input.channel === 'KASIR') {
        throw invalid('PAYMENT_SHORT', `Uang masih kurang ${formatRp(credit)}.`, { short: toMoney(credit) });
      }
      if (customer.isWalkIn) throw invalid('CUSTOMER_REQUIRED', 'Piutang harus atas nama pelanggan.');
      if (customer.creditLimit !== null) {
        const open = await repo.openReceivables(tx, customer.id);
        if (dec(open).plus(credit).gt(customer.creditLimit)) needs.push('sales.credit.over_limit');
      }
      dueDate = input.dueDate ?? addDays(now, customer.termDays);
      if (dueDate < isoDate(jakartaDate(now)))
        throw invalid('DUE_DATE_PAST', 'Jatuh tempo tidak boleh sebelum hari ini.');
    }

    // ---- stock: taken now → SALE (FIFO cost); picked up later → reservation only (D-5)
    const stocked = lines.filter((l) => l.unit.trackStock);
    const costs = new Map<string, string>();
    if (input.pickupLater) {
      await stock.reserve(
        tx,
        stocked.map((l) => ({ productId: l.unit.productId, warehouseId: wh.id, qty: l.baseQty })),
      );
    } else if (stocked.length) {
      const applied = await stock.apply(
        tx,
        stocked.map((l) => ({
          productId: l.unit.productId,
          warehouseId: wh.id,
          qty: dec(l.baseQty).neg(),
          sourceType: 'SALE' as const,
          sourceId: saleId,
          sourceLineId: l.id,
          movedAt: now,
        })),
        { createdBy: ctx.userId },
      );
      stocked.forEach((l, i) => costs.set(l.id, applied[i]!.unitCost));
      // S6-5: below cost is judged on the FIFO cost actually consumed.
      if (stocked.some((l) => dec(l.unitPrice).div(l.unit.conversionQty).lt(costs.get(l.id)!))) {
        needs.push('sales.sell_below_cost');
      }
    }

    const approvedBy = await approveInTx(tx, ctx, needs, opts.grant);
    const number = await nextDocNumber(tx, input.channel === 'KASIR' ? 'KSR' : 'JL', wh.code, now);

    await repo.insertSale(tx, {
      id: saleId,
      number,
      channel: input.channel,
      deviceId: ctx.deviceId,
      cashierId: ctx.userId,
      customerId: customer.id,
      customerGroupId: customer.groupId,
      warehouseId: wh.id,
      trxAt: now,
      subtotal,
      discountAmount: discount,
      otherCharges,
      otherChargesNote: input.otherChargesNote,
      total,
      fulfillmentStatus: input.pickupLater ? 'PENDING' : 'TAKEN',
      pickupNote: input.pickupNote,
      paidAmount: toMoney(paid),
      creditAmount: toMoney(credit),
      changeAmount: toMoney(change),
      dueDate,
      note: input.note,
      approvedBy,
      clientOpId: opts.idempotencyKey,
    });
    await repo.insertItems(
      tx,
      lines.map((l, i) => {
        const cost = costs.get(l.id) ?? null;
        return {
          id: l.id,
          saleId,
          lineNo: i + 1,
          productId: l.unit.productId,
          productUnitId: l.unit.productUnitId,
          productName: l.unit.productName,
          unitCode: l.unit.unitCode,
          conversionQty: l.unit.conversionQty,
          qty: l.qty,
          baseQty: l.baseQty,
          unitPrice: l.unitPrice,
          listPrice: l.listPrice,
          priceSource: l.priceSource,
          allocatedDiscount: allocations[i]!,
          lineTotal: l.lineTotal,
          netAmount: toMoney(dec(l.lineTotal).minus(allocations[i]!)),
          costPerBase: cost,
          costTotal: cost === null ? null : toMoney(dec(cost).times(l.baseQty)),
          pickedUpQty: input.pickupLater ? '0' : l.qty,
        };
      }),
    );

    // ---- payments + cash book (S6-3)
    const salesCategory = await repo.cashCategoryId(tx, 'SALES');
    const drawer = await repo.cashAccountId(tx, 'LACI');
    for (const p of input.payments) {
      await repo.insertPayment(tx, {
        id: uuidv7(),
        saleId,
        paymentMethodId: p.paymentMethodId,
        amount: toMoney(p.amount),
        reference: p.reference,
      });
      const m = methods.get(p.paymentMethodId)!;
      if (m.kind !== 'CASH') {
        await repo.insertCash(tx, {
          id: uuidv7(),
          cashAccountId: m.cashAccountId!,
          categoryId: salesCategory,
          trxAt: now,
          direction: 'IN',
          amount: toMoney(p.amount),
          sourceType: 'SALE',
          sourceId: saleId,
          note: [number, p.reference].filter(Boolean).join(' · '),
          createdBy: ctx.userId,
        });
      }
    }
    const cashKept = cash.minus(change);
    if (cashKept.gt(0)) {
      await repo.insertCash(tx, {
        id: uuidv7(),
        cashAccountId: drawer,
        categoryId: salesCategory,
        trxAt: now,
        direction: 'IN',
        amount: toMoney(cashKept),
        sourceType: 'SALE',
        sourceId: saleId,
        note: number,
        createdBy: ctx.userId,
      });
    }
    if (credit.gt(0)) {
      await repo.insertReceivable(tx, {
        id: uuidv7(),
        customerId: customer.id,
        saleId,
        number,
        docDate: isoDate(jakartaDate(now)),
        dueDate: dueDate!,
        amount: toMoney(credit),
      });
    }

    // ---- audit (security-standards §7): manual prices, and anything the Owner approved
    const manual = lines.filter((l) => l.priceSource === 'MANUAL');
    if (manual.length || approvedBy) {
      await recordAudit(
        tx,
        { ...ctx, approvedBy },
        {
          action: approvedBy ? 'sale.approved' : 'sale.price_override',
          entity: 'sale',
          entityId: saleId,
          after: {
            number,
            approvals: needs,
            manualPrices: manual.map((l) => ({
              product: l.unit.productName,
              unit: l.unit.unitCode,
              listPrice: l.listPrice,
              unitPrice: l.unitPrice,
            })),
          },
        },
      );
    }
    return saleId;
  });
  return get(pool, ctx, id);
}

/** FR-POS-16 without shifts (S6-2): only today's notes; stock, cash and credit are reversed. */
export async function voidSale(pool: Pool, ctx: RequestCtx, id: string, raw: unknown): Promise<Sale> {
  const { reason } = VoidSaleInput.parse(raw);
  await withTransaction(pool, async (tx) => {
    const s = await repo.lockSale(tx, id);
    if (!s || s.status === 'HELD') throw notFoundError('Nota');
    if (s.status === 'VOIDED') throw new AppError('ALREADY_VOIDED', `Nota ${s.number} sudah dibatalkan.`, 409);
    const now = clock.now();
    if (isoDate(jakartaDate(s.trxAt)) !== isoDate(jakartaDate(now))) {
      throw new AppError(
        'VOID_NOT_TODAY',
        'Hanya nota hari ini yang bisa dibatalkan. Nota lama dikoreksi dengan retur.',
        409,
      );
    }
    if (s.fulfillmentStatus === 'PARTIAL' || s.fulfillmentStatus === 'COMPLETE') {
      throw new AppError('VOID_HAS_PICKUPS', 'Sebagian barang sudah diambil. Batalkan pengambilannya dulu.', 409);
    }
    const returned = await tx.query(`SELECT 1 FROM sale_returns WHERE sale_id = $1 LIMIT 1`, [id]);
    if (returned.rowCount) {
      throw new AppError('VOID_HAS_RETURNS', 'Nota ini sudah ada returnya. Koreksi berikutnya juga lewat retur.', 409);
    }
    const rec = await repo.voidReceivable(tx, id);
    if (rec === 'has_payments') {
      throw new AppError('VOID_HAS_PAYMENTS', 'Piutang nota ini sudah ada pembayarannya. Gunakan retur.', 409);
    }

    // Stock back exactly as it left: one inflow per consumed layer, same cost & date.
    if (s.fulfillmentStatus === 'TAKEN') {
      const used = await repo.saleConsumptions(tx, id);
      if (used.length) {
        await stock.apply(
          tx,
          used.map((c) => ({
            productId: c.productId,
            warehouseId: c.warehouseId,
            qty: c.qty,
            unitCost: c.unitCost,
            layerReceivedAt: c.receivedAt ?? s.trxAt,
            sourceType: 'SALE_VOID' as const,
            sourceId: id,
            sourceLineId: c.lineId,
            movedAt: now,
          })),
          { createdBy: ctx.userId },
        );
      }
    } else if (s.fulfillmentStatus === 'PENDING') {
      const full = await repo.get(tx, id);
      const reserved = new Map<string, Decimal>();
      for (const l of full!.lines) {
        const base = dec(l.qty).times(l.conversionQty);
        reserved.set(l.productId, (reserved.get(l.productId) ?? new Decimal(0)).plus(base));
      }
      const wh = await defaultWarehouse(tx);
      const tracked = await tx.query<{ id: string }>(
        `SELECT id FROM products WHERE id = ANY($1::uuid[]) AND track_stock`,
        [[...reserved.keys()]],
      );
      await stock.release(
        tx,
        tracked.rows.map((p) => ({ productId: p.id, warehouseId: wh.id, qty: reserved.get(p.id)! })),
      );
    }

    // Cash out of the same accounts it went into.
    const voidCategory = await repo.cashCategoryId(tx, 'SALE_REFUND');
    for (const c of await repo.cashOfSale(tx, id)) {
      await repo.insertCash(tx, {
        id: uuidv7(),
        cashAccountId: c.cashAccountId,
        categoryId: voidCategory,
        trxAt: now,
        direction: c.direction === 'IN' ? 'OUT' : 'IN',
        amount: c.amount,
        sourceType: 'SALE_VOID',
        sourceId: id,
        note: `Batal ${s.number}`,
        createdBy: ctx.userId,
      });
    }
    await repo.markVoided(tx, id, ctx.userId, now, reason);
    await recordAudit(tx, ctx, {
      action: 'sale.void',
      entity: 'sale',
      entityId: id,
      after: { number: s.number, reason },
    });
  });
  return get(pool, ctx, id);
}

function formatRp(d: Decimal): string {
  const [int, frac] = d.toFixed(2).split('.');
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `Rp ${grouped}${frac === '00' ? '' : `,${frac}`}`;
}
