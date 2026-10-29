// Amount in words, Bahasa Indonesia (PRD FR-POS-30): printed on the faktur and payment proofs.
import { dec } from './money';

const ONES = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];

function below1000(n: number): string {
  if (n < 12) return ONES[n]!;
  if (n < 20) return `${ONES[n - 10]} belas`;
  if (n < 100) return `${ONES[Math.floor(n / 10)]} puluh ${ONES[n % 10]}`.trim();
  if (n < 200) return `seratus ${below1000(n - 100)}`.trim();
  return `${ONES[Math.floor(n / 100)]} ratus ${below1000(n % 100)}`.trim();
}

const SCALES = ['', 'ribu', 'juta', 'miliar', 'triliun'];

/** terbilang('375000') → "tiga ratus tujuh puluh lima ribu rupiah". Cents are ignored (rupiah). */
export function terbilang(amount: string, suffix = 'rupiah'): string {
  let n = dec(amount).abs().floor();
  if (n.isZero()) return `nol ${suffix}`.trim();
  const groups: number[] = [];
  while (n.gt(0)) {
    groups.push(n.mod(1000).toNumber());
    n = n.div(1000).floor();
  }
  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!;
    if (g === 0) continue;
    // "seribu", never "satu ribu"; but "satu juta".
    words.push(i === 1 && g === 1 ? 'seribu' : `${below1000(g)} ${SCALES[i]}`.trim());
  }
  return `${dec(amount).isNeg() ? 'minus ' : ''}${words.join(' ')} ${suffix}`.trim();
}
