import { describe, expect, it } from 'vitest';
import { matchQuick, periodSlug, periodText, quickPeriod } from './period';

describe('report periods', () => {
  it('quick choices from the WIB date', () => {
    expect(quickPeriod('today', '2026-10-30')).toEqual({ from: '2026-10-30', to: '2026-10-30' });
    expect(quickPeriod('month', '2026-10-30')).toEqual({ from: '2026-10-01', to: '2026-10-30' });
    expect(quickPeriod('lastMonth', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(quickPeriod('lastMonth', '2028-03-01')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(quickPeriod('lastMonth', '2027-01-15')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(quickPeriod('year', '2026-10-30')).toEqual({ from: '2026-01-01', to: '2026-10-30' });
  });

  it('recognises a quick choice, else custom', () => {
    expect(matchQuick({ from: '2026-09-01', to: '2026-09-30' }, '2026-10-30')).toBe('lastMonth');
    expect(matchQuick({ from: '2026-09-02', to: '2026-09-30' }, '2026-10-30')).toBe('custom');
  });

  it('text and file-name forms', () => {
    expect(periodText({ from: '2026-10-24', to: '2026-10-24' })).toBe('24 Okt 2026');
    expect(periodText({ from: '2026-10-01', to: '2026-10-31' })).toBe('1 Okt 2026 – 31 Okt 2026');
    expect(periodSlug({ from: '2026-10-01', to: '2026-10-31' })).toBe('2026-10-01_2026-10-31');
  });
});
