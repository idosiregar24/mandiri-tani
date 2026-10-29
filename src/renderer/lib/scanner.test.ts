import { describe, expect, it } from 'vitest';
import { createScanDetector } from './scanner';

const feed = (d: ReturnType<typeof createScanDetector>, text: string, start: number, gap: number) => {
  let t = start;
  for (const ch of text) d.key(ch, (t += gap));
  return d.key('Enter', t + gap);
};

describe('scan detector (PRD §8.3)', () => {
  it('a fast burst ending with Enter is a scan', () => {
    expect(feed(createScanDetector(35, 4), '8990000000017', 0, 8)).toBe('8990000000017');
  });

  it('human typing is not a scan; neither is a too-short burst', () => {
    expect(feed(createScanDetector(35, 4), 'urea', 0, 120)).toBeNull();
    expect(feed(createScanDetector(35, 4), '123', 0, 5)).toBeNull();
  });

  it('a pause restarts the burst: only the fast tail counts', () => {
    const d = createScanDetector(35, 4);
    d.key('x', 0);
    expect(feed(d, '12345', 500, 5)).toBe('12345');
  });
});
