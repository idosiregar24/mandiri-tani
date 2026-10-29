// Cart arithmetic shared by the cashier screen and salesService (PRD FR-POS-03/06/28). Money is
// rounded to 2 decimals only where a value is stored (database-standards §4).
import { dec, Decimal, toMoney } from './money';

export interface CartLineAmounts {
  qty: string;
  unitPrice: string;
  /** Line discount (nominal). The store never uses it (sprint-5 findings), but the model keeps it. */
  discountAmount?: string;
}

/** qty × unit_price − line discount, rounded to rupiah cents. */
export function lineTotal(l: CartLineAmounts): string {
  return toMoney(
    dec(l.qty)
      .times(l.unitPrice)
      .minus(l.discountAmount ?? '0'),
  );
}

export function subtotal(lines: readonly CartLineAmounts[]): string {
  return toMoney(lines.reduce((s, l) => s.plus(lineTotal(l)), new Decimal(0)));
}

/** Suggested "Total jadi": the subtotal rounded DOWN to a whole step (Rp 1.000 by default). */
export function suggestedTotal(sub: string, step = '1000'): string {
  return toMoney(dec(sub).div(step).floor().times(step));
}

/**
 * Note discount from the total the cashier wants to receive (FR-POS-28: 1.215.000 → 1.200.000).
 * Null when the target is not between 0 and the subtotal.
 */
export function discountForTarget(sub: string, target: string): string | null {
  const t = dec(target);
  if (t.isNeg() || t.gt(sub)) return null;
  return toMoney(dec(sub).minus(t));
}

/**
 * Spreads the note discount over the lines in proportion to their totals, largest remainder
 * method: Σ allocations = discount exactly (FR-POS-06, for per-item profit).
 */
export function allocateDiscount(lineTotals: readonly string[], discount: string): string[] {
  const cents = (v: string) => dec(v).times(100);
  const total = lineTotals.reduce((s, v) => s.plus(cents(v)), new Decimal(0));
  const want = cents(discount);
  if (total.isZero() || want.isZero()) return lineTotals.map(() => '0.00');
  const raw = lineTotals.map((v) => want.times(cents(v)).div(total));
  const floors = raw.map((r) => r.floor());
  let left = want.minus(floors.reduce((s, f) => s.plus(f), new Decimal(0))).toNumber(); // < line count
  const order = raw
    .map((r, i) => ({ i, frac: r.minus(floors[i]!) }))
    .sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] = floors[i]!.plus(1);
    left--;
  }
  return floors.map((f) => toMoney(f.div(100)));
}

/**
 * Quick quantity prefix (FR-POS-03): "5*" or "5*URE" → qty 5; "2,5*" → 2.5. Returns the rest of
 * the text after the asterisk. Null when the text has no valid prefix.
 */
export function parseQtyPrefix(text: string): { qty: string; rest: string } | null {
  const m = /^\s*(\d{1,6}(?:[.,]\d{1,4})?)\s*\*(.*)$/.exec(text);
  if (!m) return null;
  const qty = m[1]!.replace(',', '.');
  if (dec(qty).lte(0)) return null;
  return { qty: dec(qty).toFixed(), rest: m[2]!.trim() };
}
