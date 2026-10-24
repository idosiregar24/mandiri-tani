import { describe, expect, it } from 'vitest';
import { EscpWriter, fitLeft, fitRight, toPrinterText } from './escp';
import { buildTestPages } from './test-pages';

/** Strip ESC/P control sequences and split into printed lines (pages separated by FF). */
function render(bytes: Uint8Array): string[][] {
  let text = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 0x1b) {
      const cmd = bytes[i + 1];
      i += [0x43, 0x74, 0x78, 0x57, 0x6b].includes(cmd ?? 0) ? 2 : 1; // commands with one argument byte
      continue;
    }
    if (b === 0x0d || b === 0x0f || b === 0x12) continue;
    text += b === 0x0c ? '\f' : String.fromCharCode(b);
  }
  return text
    .split('\f')
    .filter((p) => p.length > 0)
    .map((page) => page.replace(/\n$/, '').split('\n'));
}

describe('escp helpers', () => {
  it('transliterates to printable ASCII (PC437-safe)', () => {
    expect(toPrinterText('Pupuk “Mahkota” – café… 50 kg ✓')).toBe('Pupuk "Mahkota" - cafe... 50 kg ?');
  });

  it('pads and cuts to exact widths', () => {
    expect(fitLeft('UREA', 6)).toBe('UREA  ');
    expect(fitLeft('NPK MUTIARA', 6)).toBe('NPK MU');
    expect(fitRight('1.500,00', 10)).toBe('  1.500,00');
    expect(fitRight('1.460.000,00', 8)).toBe('0.000,00');
  });

  it('starts with ESC @ and sets page length and pitch', () => {
    const bytes = new EscpWriter().start({ linesPerPage: 33, nlq: false, cpi: 12 }).bytes();
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x1b, 0x40]);
    expect(Array.from(bytes)).toEqual(expect.arrayContaining([0x1b, 0x43, 33]));
    expect(Array.from(bytes.slice(-2))).toEqual([0x1b, 0x4d]); // ESC M = 12 cpi
  });
});

describe('test pages (sprint 0)', () => {
  const now = new Date(2026, 9, 24, 12, 5);

  it('pola prints exactly linesPerPage lines of 96 columns, then a form feed', () => {
    const bytes = buildTestPages('pola', { linesPerPage: 33, nlq: false, now });
    const [page] = render(bytes);
    expect(page).toHaveLength(33);
    expect(Math.max(...page!.map((l) => l.length))).toBe(96);
    expect(page![1]!.endsWith('6')).toBe(true);
    expect(bytes.at(-1)).toBe(0x0c);
  });

  it('faktur fits half a page and 96 columns, with the iPOS-style content', () => {
    const [page] = render(buildTestPages('faktur', { linesPerPage: 33, nlq: false, now }));
    expect(page!.length).toBeLessThanOrEqual(33);
    expect(Math.max(...page!.map((l) => l.length))).toBeLessThanOrEqual(96);
    const text = page!.join('\n');
    expect(text).toContain('FAKTUR PENJUALAN');
    expect(text).toContain('24/10/2026 12.05');
    expect(text).toMatch(/TOTAL AKHIR :\s+1\.835\.000,00/);
    expect(text).toContain('Terbilang : satu juta delapan ratus tiga puluh lima ribu rupiah');
    expect(text).not.toMatch(/03\/11\/2026TOTAL/); // columns never touch
  });

  it('semua = pola + font + faktur on three forms', () => {
    const pages = render(buildTestPages('semua', { linesPerPage: 33, nlq: true, now }));
    expect(pages).toHaveLength(3);
  });

  it('honours a different page length for paper calibration', () => {
    const [page] = render(buildTestPages('pola', { linesPerPage: 36, nlq: false, now }));
    expect(page).toHaveLength(36);
  });
});
