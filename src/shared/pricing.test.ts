import { describe, expect, it } from 'vitest';
import { resolvePrice, type PriceRow } from './pricing';

const GOLD = '01900000-0000-7000-8000-000000000001';
const SILVER = '01900000-0000-7000-8000-000000000002';
const prices: PriceRow[] = [
  { customerGroupId: null, minQty: '1', price: '640000.00' },
  { customerGroupId: null, minQty: '10', price: '630000.00' },
  { customerGroupId: GOLD, minQty: '1', price: '620000.00' },
  { customerGroupId: GOLD, minQty: '20', price: '600000.00' },
];

describe('resolvePrice (FR-POS-05)', () => {
  it('general price and the largest tier ≤ qty', () => {
    expect(resolvePrice(prices, { groupId: null, qty: '1' })).toEqual({ price: '640000.00', source: 'RETAIL' });
    expect(resolvePrice(prices, { groupId: null, qty: '9.5' })).toEqual({ price: '640000.00', source: 'RETAIL' });
    expect(resolvePrice(prices, { groupId: null, qty: '10' })).toEqual({ price: '630000.00', source: 'TIER' });
    expect(resolvePrice(prices, { groupId: null, qty: '100' })).toEqual({ price: '630000.00', source: 'TIER' });
  });

  it("the customer's group price wins over the general one, with its own tiers", () => {
    expect(resolvePrice(prices, { groupId: GOLD, qty: '1' })).toEqual({ price: '620000.00', source: 'GROUP' });
    // Group price beats the general TIER even when the general tier is lower in min_qty order.
    expect(resolvePrice(prices, { groupId: GOLD, qty: '15' })).toEqual({ price: '620000.00', source: 'GROUP' });
    expect(resolvePrice(prices, { groupId: GOLD, qty: '20' })).toEqual({ price: '600000.00', source: 'GROUP_TIER' });
  });

  it('a group without its own price falls back to the general price', () => {
    expect(resolvePrice(prices, { groupId: SILVER, qty: '12' })).toEqual({ price: '630000.00', source: 'TIER' });
  });

  it('no price → null (cashier types it); below the smallest tier → null', () => {
    expect(resolvePrice([], { groupId: null, qty: '1' })).toBeNull();
    expect(
      resolvePrice([{ customerGroupId: null, minQty: '5', price: '1.00' }], { groupId: null, qty: '1' }),
    ).toBeNull();
  });
});
