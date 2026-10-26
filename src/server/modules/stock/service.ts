// stockService — THE door for stock (golden rule 2, skill `stock-movement`, PRD §6.4–6.6).
// apply(): physical stock, the append-only ledger and FIFO cost layers.
// reserve()/release(): goods sold but not yet picked up (reserved_qty) — no ledger, no layers.
// Always called inside the document's own transaction, once per document (one sorted lock pass).
import { Decimal, dec, toQty } from '@shared/money';
import { uuidv7 } from '@shared/uuid';
import type { Queryable } from '../../db/pool';
import { AppError } from '../../lib/errors';
import * as repo from './repo';

export const STOCK_SOURCE_TYPES = [
  'OPENING',
  'SALE',
  'SALE_PICKUP',
  'SALE_PICKUP_CANCEL',
  'SALE_VOID',
  'SALE_RETURN',
  'PURCHASE_RECEIPT',
  'PURCHASE_RETURN',
  'OPNAME',
  'ADJUSTMENT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'ASSEMBLY_OUT',
  'ASSEMBLY_IN',
] as const;
export type StockSourceType = (typeof STOCK_SOURCE_TYPES)[number];

/** Inflows that must say what they cost (they open a layer at that price). */
const COSTED_INFLOWS: readonly StockSourceType[] = [
  'OPENING',
  'PURCHASE_RECEIPT',
  'SALE_VOID',
  'SALE_RETURN',
  'SALE_PICKUP_CANCEL',
  'TRANSFER_IN',
  'ASSEMBLY_IN',
];

export interface MovementInput {
  productId: string;
  warehouseId: string;
  /** Signed, base unit: + in, − out. Never zero. */
  qty: Decimal.Value;
  /** Required for costed inflows; adjustment/opname inflows default to last_purchase_cost. */
  unitCost?: Decimal.Value;
  /** Reversals keep the original layer date so FIFO order is preserved. */
  layerReceivedAt?: Date;
  /** Purchase return: consume this receipt line's layer first. */
  preferLayerSourceLineId?: string;
  sourceType: StockSourceType;
  sourceId: string;
  sourceLineId?: string | null;
  /** Business time of the document (not now()). */
  movedAt: Date;
  note?: string | null;
}

export interface ApplyOptions {
  /** Device documents already happened in the real world: applied even if stock goes negative (FR-INV-10). */
  source?: 'LOCAL' | 'SYNC';
  /** Owner-authorised sale below available stock (never for pickups). */
  allowNegative?: boolean;
  createdBy?: string | null;
}

export interface Consumption {
  layerId: string | null;
  qty: string;
  unitCost: string;
  isEstimated: boolean;
  layerReceivedAt: Date | null;
}

export interface AppliedMovement {
  movementId: string;
  productId: string;
  warehouseId: string;
  qty: string;
  /** Weighted FIFO cost (out) or the new layer's cost (in), per base unit, 4 dp. */
  unitCost: string;
  costEstimated: boolean;
  consumptions: Consumption[];
}

const key = (p: string, w: string) => `${p}|${w}`;

/** "3 zak" when the shortage is a whole number of sale units, otherwise "150 kg". */
function describeQty(qty: Decimal, p: repo.LockedProduct): string {
  const fmt = (d: Decimal) => d.toDecimalPlaces(4).toFixed().replace('.', ',');
  if (p.saleUnitCode && p.saleConversion && p.saleUnitCode !== p.baseUnitCode) {
    const inSale = qty.div(p.saleConversion);
    if (inSale.isInteger()) return `${fmt(inSale)} ${p.saleUnitCode.toLowerCase()}`;
  }
  return `${fmt(qty)} ${p.baseUnitCode.toLowerCase()}`;
}

function insufficient(p: repo.LockedProduct, left: Decimal, physical: boolean): AppError {
  const what = physical ? 'Stok fisik' : 'Stok tersedia';
  return new AppError(
    'STOCK_INSUFFICIENT',
    `${what} ${p.name} tinggal ${describeQty(Decimal.max(left, 0), p)}. Kurangi jumlahnya atau minta PIN Owner.`,
    409,
    { productId: p.id, remaining: toQty(left) },
  );
}

async function lockAll(tx: Queryable, keys: { productId: string; warehouseId: string }[]) {
  const unique = [...new Map(keys.map((k) => [key(k.productId, k.warehouseId), k])).values()].sort(
    (a, b) => a.productId.localeCompare(b.productId) || a.warehouseId.localeCompare(b.warehouseId),
  );
  await repo.ensureBalances(tx, unique);
  // Lock order everywhere: products (by id) → balances (by product, warehouse). Never the other way round.
  const products = await repo.lockProducts(tx, [...new Set(unique.map((k) => k.productId))]);
  for (const k of unique)
    if (!products.has(k.productId))
      throw new AppError('NOT_FOUND', 'Barang tidak ditemukan.', 404, { productId: k.productId });
  const balances = await repo.lockBalances(tx, unique);
  return { products, balances };
}

export async function apply(
  tx: Queryable,
  movements: MovementInput[],
  opts: ApplyOptions = {},
): Promise<AppliedMovement[]> {
  if (movements.length === 0) return [];
  for (const m of movements) {
    if (dec(m.qty).isZero()) throw new AppError('INVALID_QTY', 'Jumlah mutasi stok tidak boleh 0.', 422);
    if (dec(m.qty).gt(0) && COSTED_INFLOWS.includes(m.sourceType) && m.unitCost === undefined) {
      throw new Error(`stockService.apply: ${m.sourceType} inflow needs unitCost`);
    }
  }
  const { products, balances } = await lockAll(tx, movements);
  const bypass = opts.source === 'SYNC' || opts.allowNegative === true;

  // Process per balance in a stable order; remember the caller's order for the result.
  const order = movements
    .map((m, i) => ({ m, i }))
    .sort(
      (a, b) =>
        a.m.productId.localeCompare(b.m.productId) || a.m.warehouseId.localeCompare(b.m.warehouseId) || a.i - b.i,
    );
  const results: AppliedMovement[] = new Array(movements.length);
  const state = new Map<string, { qty: Decimal; reserved: Decimal }>();
  for (const [k, b] of balances) state.set(k, { qty: dec(b.qty), reserved: dec(b.reservedQty) });
  const lastCost = new Map<string, string>();

  for (const { m, i } of order) {
    const p = products.get(m.productId)!;
    const bal = state.get(key(m.productId, m.warehouseId))!;
    const q = dec(m.qty);
    const movementId = uuidv7();
    const fallbackCost = dec(lastCost.get(p.id) ?? p.lastPurchaseCost ?? 0);

    if (q.lt(0)) {
      const out = q.neg();
      // FR-INV-10: sales check AVAILABLE (physical − reserved); pickups & other outflows check PHYSICAL.
      if (!bypass && m.sourceType !== 'OPNAME') {
        if (m.sourceType === 'SALE') {
          const available = bal.qty.minus(bal.reserved);
          if (available.lt(out)) throw insufficient(p, available, false);
        } else if (bal.qty.lt(out)) {
          throw insufficient(p, bal.qty, true);
        }
      }
      if (m.sourceType === 'SALE_PICKUP' && bal.reserved.lt(out)) {
        throw new AppError('RESERVATION_INSUFFICIENT', `Barang ${p.name} yang belum diambil tidak sebanyak itu.`, 409, {
          productId: p.id,
        });
      }

      const layers = await repo.openLayers(tx, m.productId, m.warehouseId, m.preferLayerSourceLineId);
      let left = out;
      let total = dec(0);
      const consumptions: Consumption[] = [];
      const layerUpdates: { id: string; qtyRemaining: string }[] = [];
      for (const layer of layers) {
        if (left.lte(0)) break;
        const take = Decimal.min(left, layer.qtyRemaining);
        consumptions.push({
          layerId: layer.id,
          qty: toQty(take),
          unitCost: layer.unitCost,
          isEstimated: false,
          layerReceivedAt: layer.receivedAt,
        });
        layerUpdates.push({ id: layer.id, qtyRemaining: toQty(dec(layer.qtyRemaining).minus(take)) });
        total = total.plus(take.times(layer.unitCost));
        left = left.minus(take);
      }
      // Negative stock: the shortfall has no layer — cost it at the last purchase price (PRD §6.6).
      const estimated = left.gt(0);
      if (estimated) {
        consumptions.push({
          layerId: null,
          qty: toQty(left),
          unitCost: toQty(fallbackCost),
          isEstimated: true,
          layerReceivedAt: null,
        });
        total = total.plus(left.times(fallbackCost));
      }
      const unitCost = toQty(total.div(out));
      await repo.insertMovement(tx, {
        id: movementId,
        productId: m.productId,
        warehouseId: m.warehouseId,
        movedAt: m.movedAt,
        qty: toQty(q),
        unitCost,
        costEstimated: estimated,
        sourceType: m.sourceType,
        sourceId: m.sourceId,
        sourceLineId: m.sourceLineId ?? null,
        note: m.note ?? null,
        createdBy: opts.createdBy ?? null,
      });
      await repo.insertConsumptions(
        tx,
        consumptions.map((c) => ({
          id: uuidv7(),
          movementId,
          layerId: c.layerId,
          qty: c.qty,
          unitCost: c.unitCost,
          isEstimated: c.isEstimated,
        })),
      );
      await repo.setLayerRemaining(tx, layerUpdates);
      bal.qty = bal.qty.plus(q);
      if (m.sourceType === 'SALE_PICKUP') bal.reserved = bal.reserved.minus(out);
      results[i] = {
        movementId,
        productId: m.productId,
        warehouseId: m.warehouseId,
        qty: toQty(q),
        unitCost,
        costEstimated: estimated,
        consumptions,
      };
    } else {
      const unitCost = toQty(m.unitCost !== undefined ? dec(m.unitCost) : fallbackCost);
      if (dec(unitCost).lt(0)) throw new AppError('INVALID_COST', 'HPP tidak boleh minus.', 422);
      await repo.insertMovement(tx, {
        id: movementId,
        productId: m.productId,
        warehouseId: m.warehouseId,
        movedAt: m.movedAt,
        qty: toQty(q),
        unitCost,
        costEstimated: false,
        sourceType: m.sourceType,
        sourceId: m.sourceId,
        sourceLineId: m.sourceLineId ?? null,
        note: m.note ?? null,
        createdBy: opts.createdBy ?? null,
      });
      // Stock below zero is refilled first: only what is physically left over becomes a layer,
      // so Σ layers = balance holds again once stock is positive (no backward re-costing).
      const layerQty = bal.qty.lt(0) ? Decimal.max(bal.qty.plus(q), 0) : q;
      if (layerQty.gt(0)) {
        await repo.insertLayer(tx, {
          id: uuidv7(),
          productId: m.productId,
          warehouseId: m.warehouseId,
          receivedAt: m.layerReceivedAt ?? m.movedAt,
          qty: toQty(layerQty),
          unitCost,
          movementId,
          sourceType: m.sourceType,
          sourceLineId: m.sourceLineId ?? null,
        });
      }
      if (m.sourceType === 'PURCHASE_RECEIPT') {
        lastCost.set(p.id, unitCost);
        await repo.setLastPurchaseCost(tx, p.id, unitCost);
      }
      bal.qty = bal.qty.plus(q);
      if (m.sourceType === 'SALE_PICKUP_CANCEL') bal.reserved = bal.reserved.plus(q);
      results[i] = {
        movementId,
        productId: m.productId,
        warehouseId: m.warehouseId,
        qty: toQty(q),
        unitCost,
        costEstimated: false,
        consumptions: [],
      };
    }
  }

  for (const [k, b] of state) {
    const [productId, warehouseId] = k.split('|') as [string, string];
    const before = balances.get(k)!;
    if (!dec(before.qty).eq(b.qty) || !dec(before.reservedQty).eq(b.reserved)) {
      await repo.setBalance(tx, productId, warehouseId, toQty(b.qty), toQty(b.reserved));
    }
  }
  return results;
}

/**
 * Stock opname posting: lock the counted products in the standard order and return their
 * physical qty, so "system qty" is read under the same locks apply() takes right after.
 */
export async function lockForCount(
  tx: Queryable,
  keys: { productId: string; warehouseId: string }[],
): Promise<Map<string, string>> {
  if (keys.length === 0) return new Map();
  const { balances } = await lockAll(tx, keys);
  return new Map([...balances].map(([k, b]) => [k, b.qty]));
}

export interface ReservationLine {
  productId: string;
  warehouseId: string;
  /** Base units, > 0. */
  qty: Decimal.Value;
}

/** Sold but not picked up yet: lowers AVAILABLE stock, physical stock unchanged (sprint-7). */
export async function reserve(
  tx: Queryable,
  lines: ReservationLine[],
  opts: Pick<ApplyOptions, 'source' | 'allowNegative'> = {},
): Promise<void> {
  await changeReservation(tx, lines, 1, opts.source === 'SYNC' || opts.allowNegative === true);
}

/** Reservation no longer needed (remainder returned / sale voided before pickup). */
export async function release(tx: Queryable, lines: ReservationLine[]): Promise<void> {
  await changeReservation(tx, lines, -1, false);
}

async function changeReservation(
  tx: Queryable,
  lines: ReservationLine[],
  sign: 1 | -1,
  bypass: boolean,
): Promise<void> {
  if (lines.length === 0) return;
  const { products, balances } = await lockAll(tx, lines);
  const totals = new Map<string, Decimal>();
  for (const l of lines) {
    if (!dec(l.qty).gt(0)) throw new AppError('INVALID_QTY', 'Jumlah harus lebih dari 0.', 422);
    const k = key(l.productId, l.warehouseId);
    totals.set(k, (totals.get(k) ?? dec(0)).plus(l.qty));
  }
  for (const [k, qty] of [...totals].sort(([a], [b]) => a.localeCompare(b))) {
    const b = balances.get(k)!;
    const p = products.get(b.productId)!;
    const reserved = dec(b.reservedQty).plus(qty.times(sign));
    if (sign > 0 && !bypass) {
      const available = dec(b.qty).minus(b.reservedQty);
      if (available.lt(qty)) throw insufficient(p, available, false);
    }
    if (reserved.lt(0))
      throw new AppError('RESERVATION_INSUFFICIENT', `Barang ${p.name} yang belum diambil tidak sebanyak itu.`, 409, {
        productId: p.id,
      });
    await repo.setBalance(tx, b.productId, b.warehouseId, b.qty, toQty(reserved));
  }
}
