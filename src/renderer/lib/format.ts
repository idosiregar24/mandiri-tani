// The ONLY place that formats numbers and dates for people (design-standards §6): id-ID,
// Asia/Jakarta. Money and quantities arrive as decimal strings and are formatted by string
// manipulation through decimal.js — never via JS floats.
import { dec, isDecimalString } from '@shared/money';

/** A plain decimal string with "." thousands and "," decimals, keeping its digits as given. */
function group(fixed: string): string {
  const negative = fixed.startsWith('-');
  const [int = '0', frac] = (negative ? fixed.slice(1) : fixed).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${grouped}${frac ? `,${frac}` : ''}`;
}

/** "1500000" → "1.500.000"; keeps a decimal part with a comma, trailing zeros dropped ("2.50" → "2,5"). */
export function formatNumber(value: string | null | undefined, maxDecimals = 4): string {
  if (value === null || value === undefined || value === '' || !isDecimalString(value.trim())) return '';
  return group(dec(value).toDecimalPlaces(maxDecimals).toFixed());
}

/** "1500000.00" → "Rp 1.500.000"; "1500000.50" → "Rp 1.500.000,50"; null → "—". */
export function formatRupiah(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '' || !isDecimalString(value.trim())) return '—';
  const d = dec(value);
  const text = group(d.isInteger() ? d.toFixed(0) : d.toFixed(2));
  return text.startsWith('-') ? `-Rp ${text.slice(1)}` : `Rp ${text}`;
}

/** formatQty('2.5', 'KG') → "2,5 kg" (design-standards §6). */
export function formatQty(value: string | null | undefined, unitCode?: string): string {
  const n = formatNumber(value);
  if (!n) return '';
  return unitCode ? `${n} ${unitCode.toLowerCase()}` : n;
}

/**
 * What a person typed in a money field → decimal string, or null when it is not a number.
 * Dots are thousands separators, a comma is the decimal point: "1.500.000" → "1500000",
 * "1.500.000,5" → "1500000.5", "Rp 15.000" → "15000". Empty → "".
 */
export function parseMoneyInput(text: string): string | null {
  const t = text.replace(/rp/i, '').replace(/\s/g, '');
  if (t === '') return '';
  if (!/^\d{1,3}(\.?\d{3})*(,\d{0,2})?$/.test(t) && !/^\d+(,\d{0,2})?$/.test(t)) return null;
  const [int = '', frac = ''] = t.split(',');
  const digits = int.replace(/\./g, '').replace(/^0+(?=\d)/, '');
  return frac ? `${digits}.${frac}` : digits;
}

/**
 * A quantity typed with a decimal comma → decimal string: "2,5" → "2.5", "0,001" → "0.001".
 * Thousands separators are not allowed in quantities (ambiguous with conversions like 0.001).
 */
export function parseQtyInput(text: string, maxDecimals = 4): string | null {
  const t = text.replace(/\s/g, '');
  if (t === '') return '';
  const re = new RegExp(`^\\d+([.,]\\d{0,${maxDecimals}})?$`);
  if (!re.test(t)) return null;
  return t.replace(',', '.').replace(/\.$/, '');
}

/** Decimal string → what an input field shows while editing (no "Rp", no trailing ",00"). */
export function moneyInputText(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '' || !isDecimalString(value)) return '';
  return formatNumber(dec(value).toFixed(), 2);
}

export function qtyInputText(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '' || !isDecimalString(value)) return '';
  return dec(value).toFixed().replace('.', ',');
}

const dateTime = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const dateOnly = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** "24 Okt 2026 09.15" */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return dateTime.format(new Date(value)).replace(',', '');
}

/** "24 Okt 2026" */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return dateOnly.format(new Date(value));
}
