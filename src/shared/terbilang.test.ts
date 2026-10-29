import { describe, expect, it } from 'vitest';
import { terbilang } from './terbilang';

describe('terbilang (FR-POS-30)', () => {
  it.each([
    ['0', 'nol rupiah'],
    ['11', 'sebelas rupiah'],
    ['15', 'lima belas rupiah'],
    ['100', 'seratus rupiah'],
    ['1000', 'seribu rupiah'],
    ['1100', 'seribu seratus rupiah'],
    ['21000', 'dua puluh satu ribu rupiah'],
    ['375000.00', 'tiga ratus tujuh puluh lima ribu rupiah'],
    ['1000000', 'satu juta rupiah'],
    ['1835000', 'satu juta delapan ratus tiga puluh lima ribu rupiah'],
    ['2620000000', 'dua miliar enam ratus dua puluh juta rupiah'],
    ['111111', 'seratus sebelas ribu seratus sebelas rupiah'],
  ])('%s → %s', (amount, words) => {
    expect(terbilang(amount)).toBe(words);
  });
});
