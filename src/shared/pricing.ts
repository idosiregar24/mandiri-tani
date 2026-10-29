// Price resolution (PRD FR-POS-05, §6.3; sprint-5 S5-1). The ONLY implementation: the cashier
// screen uses it to show a price, the server uses it again when the sale is saved.
import { dec } from './money';

export const PRICE_SOURCES = ['RETAIL', 'TIER', 'GROUP', 'GROUP_TIER', 'MANUAL'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

/** One row of product_prices for ONE product unit. */
export interface PriceRow {
  customerGroupId: string | null;
  /** Decimal string, in the line's unit. */
  minQty: string;
  price: string;
}

export interface ResolvedPrice {
  price: string;
  source: Exclude<PriceSource, 'MANUAL'>;
}

/**
 * (1) the customer group's price for this unit, the tier with the largest min_qty ≤ qty;
 * (2) otherwise the general price, same tier rule; (3) otherwise null — the cashier must type it.
 * Never derived from another unit's price (ZAK is not KG × 50).
 */
export function resolvePrice(
  prices: readonly PriceRow[],
  opts: { groupId: string | null; qty: string },
): ResolvedPrice | null {
  const qty = dec(opts.qty);
  const best = (group: string | null) =>
    prices
      .filter((p) => p.customerGroupId === group && dec(p.minQty).lte(qty))
      .sort((a, b) => dec(b.minQty).comparedTo(dec(a.minQty)))[0];
  if (opts.groupId) {
    const g = best(opts.groupId);
    if (g) return { price: g.price, source: dec(g.minQty).gt(1) ? 'GROUP_TIER' : 'GROUP' };
  }
  const r = best(null);
  if (r) return { price: r.price, source: dec(r.minQty).gt(1) ? 'TIER' : 'RETAIL' };
  return null;
}
