// Money & quantity arithmetic (database-standards §4). Values travel as decimal strings
// ("150000.00", "2.5") — never JS floats. Round only where a value is stored.
import Decimal from 'decimal.js';

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export type DecimalInput = Decimal.Value;

const DECIMAL_RE = /^-?\d{1,14}(\.\d{1,4})?$/;

/** True for a plain decimal string the database accepts (no exponent, no thousands separators). */
export function isDecimalString(value: string): boolean {
  return DECIMAL_RE.test(value);
}

export function dec(value: DecimalInput): Decimal {
  return new Decimal(value);
}

/** Money as stored: NUMERIC(18,2). */
export function toMoney(value: DecimalInput): string {
  return dec(value).toFixed(2);
}

/** Quantity / conversion / HPP as stored: NUMERIC(18,4). */
export function toQty(value: DecimalInput): string {
  return dec(value).toFixed(4);
}

/** Trailing zeros removed for display/editing: "50.0000" → "50", "2.5000" → "2.5". */
export function trimDecimal(value: DecimalInput): string {
  return dec(value).toFixed();
}
