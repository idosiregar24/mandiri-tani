import { describe, expect, it } from 'vitest';
import { fmtDate, fmtN, fmtPrintedAt, pageSize, paginate, sum } from './model';

describe('iPOS number & date format', () => {
  it('formats like .NET {0:n} in id-ID', () => {
    expect(fmtN('1695374000.00')).toBe('1.695.374.000,00');
    expect(fmtN('900000')).toBe('900.000,00');
    expect(fmtN('0.79')).toBe('0,79');
    expect(fmtN('2')).toBe('2,00');
    expect(fmtN('0')).toBe('0,00');
    expect(fmtN('-5000')).toBe('-5.000,00');
    expect(fmtN('-0.001')).toBe('0,00');
    expect(fmtN('999.995')).toBe('1.000,00');
    expect(fmtN(null)).toBe('');
  });

  it('dates and print time', () => {
    expect(fmtDate('2026-04-01')).toBe('01/04/2026');
    expect(fmtPrintedAt(new Date('2026-09-04T02:45:00Z'))).toBe('04/09/2026 09:45');
  });

  it('sums decimal strings exactly', () => {
    expect(sum(['0.10', '0.20', '1000000.05'])).toBe('1000000.35');
    expect(sum([])).toBe('0.00');
  });

  it('turns the paper for landscape', () => {
    expect(pageSize('A4', 'landscape')).toEqual({ w: 297, h: 210 });
    expect(pageSize('F4', 'portrait')).toEqual({ w: 215, h: 330 });
  });
});

describe('paginate', () => {
  const none = (n: number) => Array<boolean>(n).fill(false);

  it('fills the first page (smaller: report header) then the next pages', () => {
    const pages = paginate([10, 10, 10, 10, 10], none(5), { first: 25, other: 30 });
    expect(pages.map((p) => p.bands)).toEqual([
      [0, 1],
      [2, 3, 4],
    ]);
  });

  it('moves a keep-with-next chain to the next page together', () => {
    // band 2 (group header) + 3 (captions) keep with 4 (first line)
    const keep = [false, false, true, true, false, false];
    const pages = paginate([10, 10, 5, 5, 10, 10], keep, { first: 35, other: 100 });
    expect(pages.map((p) => p.bands)).toEqual([
      [0, 1],
      [2, 3, 4, 5],
    ]);
  });

  it('puts a band taller than a page on its own page instead of looping', () => {
    const pages = paginate([5, 50, 5], none(3), { first: 20, other: 20 });
    expect(pages.map((p) => p.bands)).toEqual([[0], [1], [2]]);
  });

  it('always has one page, even without rows', () => {
    expect(paginate([], [], { first: 10, other: 10 })).toEqual([{ bands: [] }]);
  });
});
