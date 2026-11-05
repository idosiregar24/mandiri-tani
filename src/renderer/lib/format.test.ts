import { describe, expect, it } from 'vitest';
import {
  formatDateTime,
  formatNumber,
  formatQty,
  formatRupiah,
  formatStockQty,
  moneyInputText,
  parseMoneyInput,
  parseQtyInput,
  qtyInputText,
  typedMoneyInput,
} from './format';

describe('format (id-ID)', () => {
  it('formats rupiah without floats', () => {
    expect(formatRupiah('1500000')).toBe('Rp 1.500.000');
    expect(formatRupiah('1500000.00')).toBe('Rp 1.500.000');
    expect(formatRupiah('1500000.50')).toBe('Rp 1.500.000,50');
    expect(formatRupiah('640000.00')).toBe('Rp 640.000');
    expect(formatRupiah('-25000')).toBe('-Rp 25.000');
    expect(formatRupiah('99999999999999.99')).toBe('Rp 99.999.999.999.999,99');
    expect(formatRupiah(null)).toBe('—');
    expect(formatRupiah('abc')).toBe('—');
  });

  it('formats numbers and quantities with a decimal comma', () => {
    expect(formatNumber('1234567.5')).toBe('1.234.567,5');
    expect(formatNumber('50.0000')).toBe('50');
    expect(formatQty('2.5', 'KG')).toBe('2,5 kg');
    expect(formatQty('0.001')).toBe('0,001');
    expect(formatQty('3', 'ZAK')).toBe('3 zak');
  });

  it('parses what people type into money fields', () => {
    expect(parseMoneyInput('1.500.000')).toBe('1500000');
    expect(parseMoneyInput('1500000')).toBe('1500000');
    expect(parseMoneyInput('Rp 15.000')).toBe('15000');
    expect(parseMoneyInput('1.500.000,5')).toBe('1500000.5');
    expect(parseMoneyInput('007')).toBe('7');
    expect(parseMoneyInput('')).toBe('');
    expect(parseMoneyInput('1,234')).toBeNull(); // 3 decimals
    expect(parseMoneyInput('12a')).toBeNull();
    expect(parseMoneyInput('-5')).toBeNull();
    expect(parseMoneyInput('1.50.000')).toBeNull();
  });

  it('regroups money while typing, ignoring its own thousands dots', () => {
    // Typing 500000 one key at a time: each keystroke lands after the field's own dot.
    const keys = '500000';
    let text = '';
    for (const k of keys) text = typedMoneyInput(text + k)?.text ?? 'INVALID';
    expect(text).toBe('500.000');
    expect(typedMoneyInput('4.50000')).toEqual({ value: '450000', text: '450.000' });
    expect(typedMoneyInput('1.00.000')).toEqual({ value: '100000', text: '100.000' }); // digit deleted
    expect(typedMoneyInput('1.500.000,')).toEqual({ value: '1500000', text: '1.500.000,' });
    expect(typedMoneyInput('15000,5')).toEqual({ value: '15000.5', text: '15.000,5' });
    expect(typedMoneyInput('')).toEqual({ value: '', text: '' });
    expect(typedMoneyInput('12a')).toBeNull();
    expect(typedMoneyInput('1,234')).toBeNull();
  });

  it('round-trips money and quantity input text', () => {
    expect(moneyInputText('1500000.00')).toBe('1.500.000');
    expect(moneyInputText('1500000.50')).toBe('1.500.000,5');
    expect(parseMoneyInput(moneyInputText('640000.00'))).toBe('640000');
    expect(qtyInputText('0.0010')).toBe('0,001');
    expect(parseQtyInput('2,5')).toBe('2.5');
    expect(parseQtyInput('50')).toBe('50');
    expect(parseQtyInput('0.001')).toBe('0.001');
    expect(parseQtyInput('2,')).toBe('2');
    expect(parseQtyInput('1.000,5')).toBeNull();
    expect(parseQtyInput('0,00001')).toBeNull();
  });

  it('shows stock in sale units plus the base remainder', () => {
    expect(formatStockQty('4020.0000', 'KG', 'ZAK', '50')).toEqual({ main: '80 zak 20 kg', detail: '4.020 kg' });
    expect(formatStockQty('4000.0000', 'KG', 'ZAK', '50')).toEqual({ main: '80 zak', detail: '4.000 kg' });
    expect(formatStockQty('20.0000', 'KG', 'ZAK', '50')).toEqual({ main: '20 kg', detail: null });
    expect(formatStockQty('-60.0000', 'KG', 'ZAK', '50')).toEqual({ main: '-1 zak 10 kg', detail: '-60 kg' });
    expect(formatStockQty('12.0000', 'BTL', 'BTL', '1')).toEqual({ main: '12 btl', detail: null });
  });

  it('formats dates in Asia/Jakarta', () => {
    expect(formatDateTime('2026-10-24T02:15:00Z')).toBe('24 Okt 2026 09.15');
  });
});
