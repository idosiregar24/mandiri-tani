import { describe, expect, it } from 'vitest';
import { allocateDiscount, discountForTarget, lineTotal, parseQtyPrefix, subtotal, suggestedTotal } from './pos';

describe('cart arithmetic', () => {
  it('line total and subtotal in exact decimals', () => {
    expect(lineTotal({ qty: '3', unitPrice: '640000.00' })).toBe('1920000.00');
    expect(lineTotal({ qty: '2.5', unitPrice: '15000', discountAmount: '500' })).toBe('37000.00');
    expect(
      subtotal([
        { qty: '0.1', unitPrice: '0.1' },
        { qty: '0.2', unitPrice: '0.1' },
      ]),
    ).toBe('0.03');
  });

  it('"Total jadi" → note discount (FR-POS-28)', () => {
    expect(suggestedTotal('1215000.00')).toBe('1215000.00');
    expect(suggestedTotal('1215500.00')).toBe('1215000.00');
    expect(discountForTarget('1215000.00', '1200000')).toBe('15000.00');
    expect(discountForTarget('1215000.00', '1215000')).toBe('0.00');
    expect(discountForTarget('1215000.00', '1300000')).toBeNull();
    expect(discountForTarget('1215000.00', '-1')).toBeNull();
  });

  it('allocates the note discount proportionally; the sum is exact', () => {
    expect(allocateDiscount(['640000.00', '575000.00'], '15000.00')).toEqual(['7901.23', '7098.77']);
    const odd = allocateDiscount(['1.00', '1.00', '1.00'], '0.10');
    expect(odd).toEqual(['0.04', '0.03', '0.03']);
    expect(allocateDiscount(['100.00', '0.00'], '0.00')).toEqual(['0.00', '0.00']);
    expect(allocateDiscount(['0.00'], '5.00')).toEqual(['0.00']);
  });

  it('quick qty prefix (FR-POS-03)', () => {
    expect(parseQtyPrefix('5*')).toEqual({ qty: '5', rest: '' });
    expect(parseQtyPrefix('5*urea')).toEqual({ qty: '5', rest: 'urea' });
    expect(parseQtyPrefix(' 2,5 * 899123')).toEqual({ qty: '2.5', rest: '899123' });
    expect(parseQtyPrefix('urea')).toBeNull();
    expect(parseQtyPrefix('0*')).toBeNull();
  });
});
