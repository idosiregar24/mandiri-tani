import { describe, expect, it } from 'vitest';
import { pickPrinter, type PrinterInfo } from '@shared/printing';
import { buildStrukTestPages } from './struk-test-pages';

/** Strip ESC/POS control sequences and split into printed lines. */
function render(bytes: Uint8Array): string[] {
  let text = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 0x1b) {
      const cmd = bytes[i + 1];
      i += cmd === 0x40 ? 1 : 2; // ESC @ has no argument; ESC t/M/a/E/d have one
      continue;
    }
    if (b === 0x1d) {
      i += bytes[i + 1] === 0x56 ? 3 : 2; // GS V m n (cut) / GS ! n (size)
      continue;
    }
    text += String.fromCharCode(b);
  }
  return text.split('\n');
}

describe('struk test pages (thermal, ESC/POS)', () => {
  const now = new Date(2026, 9, 24, 19, 48, 57);

  it.each([32, 42, 48])('contoh struk fits %i columns', (columns) => {
    const lines = render(buildStrukTestPages('struk-contoh', { columns, cut: true, now }));
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(columns);
    const text = lines.join('\n');
    expect(text).toContain('MANDIRI TANI');
    expect(text).toContain('24-10-2026');
    expect(text).toContain('19:48:57');
    expect(text).toMatch(/TOTAL\s+89\.000,00/);
    expect(text).toMatch(/Kembali\s+=\s+11\.000,00/);
  });

  it('ends with feed + cut, or only feed when cutting is off', () => {
    const withCut = buildStrukTestPages('struk-contoh', { columns: 48, cut: true, now });
    expect(Array.from(withCut.slice(-4))).toEqual([0x1d, 0x56, 66, 3]);
    const noCut = buildStrukTestPages('struk-contoh', { columns: 48, cut: false, now });
    expect(Array.from(noCut.slice(-3))).toEqual([0x1b, 0x64, 4]);
  });

  it('pola lebar marks 32 / 42 / 48', () => {
    const text = render(buildStrukTestPages('struk-pola', { columns: 48, cut: false, now })).join('\n');
    expect(text).toMatch(/-{29}\|32/);
    expect(text).toMatch(/-{39}\|42/);
    expect(text).toMatch(/-{45}\|48/);
  });
});

describe('pickPrinter', () => {
  const base = {
    displayName: '',
    isDefault: false,
    isLx310: false,
    isReceipt: false,
    port: 'USB001',
    status: 'Normal',
    ready: true,
  };
  const list: PrinterInfo[] = [
    { ...base, name: 'Microsoft Print to PDF', port: 'PORTPROMPT:' },
    { ...base, name: 'EPSON LX-310 ESC/P', isLx310: true, port: 'LPT1:', status: 'Error', ready: false },
    { ...base, name: 'EPSON LX-310 ESC/P (Copy 1)', isLx310: true, port: 'USB003' },
    { ...base, name: 'POS-80C', isReceipt: true, port: 'USB004' },
  ];

  it('faktur → the ready USB LX-310, never the dead LPT1 queue', () => {
    expect(pickPrinter(list, 'faktur')?.name).toBe('EPSON LX-310 ESC/P (Copy 1)');
  });

  it('struk → the receipt printer', () => {
    expect(pickPrinter(list, 'struk')?.name).toBe('POS-80C');
  });

  it('struk never falls back to the LX-310 or a virtual printer', () => {
    const noReceipt = list.filter((p) => !p.isReceipt);
    expect(pickPrinter(noReceipt, 'struk')).toBeUndefined();
  });
});
