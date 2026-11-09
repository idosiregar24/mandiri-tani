import { describe, expect, it } from 'vitest';
import { bytesToBase64, type MonoBitmap } from '@shared/logo';
import { DEFAULT_PRINTER_SETTINGS, type PrintDocument } from '@shared/printing';
import { previewLayout } from './print-preview';

const bitmap = (width: number, height: number): MonoBitmap => ({
  width,
  height,
  data: bytesToBase64(new Uint8Array(Math.ceil(width / 8) * height)),
});

describe('print preview layout', () => {
  it('struk: paper width from the printer setting, alignment padded like the printer', () => {
    const doc: PrintDocument = {
      role: 'struk',
      title: 'Struk 1',
      pages: [
        [
          { text: 'TOKO', align: 'center', bold: true, size: 2 },
          { text: 'Kopi “Tani” – café', align: 'right' },
          { text: 'kiri' },
        ],
      ],
      logo: { bitmap: bitmap(240, 120), line: 0, columns: 0 },
    };
    const settings = { ...DEFAULT_PRINTER_SETTINGS, struk: { printer: null, columns: 32, cut: true } };
    const l = previewLayout(doc, settings);
    expect(l.columns).toBe(32);
    expect(l.formLines).toBeNull();
    expect(l.cut).toBe(true);
    const [title, right, left] = l.pages[0]!;
    // Double width: centered within 16 printed characters.
    expect(title).toEqual({ text: '      TOKO', bold: true, double: true });
    // Transliterated to what the printer can print, right-aligned to 32.
    expect(right!.text).toBe('Kopi "Tani" - cafe'.padStart(32));
    expect(left!.text).toBe('kiri');
    // 240 × 120 thermal dots, 12 dots per character, centered before line 0.
    expect(l.logo).toMatchObject({ kind: 'block', beforeLine: 0, widthCh: 20, heightCh: 10 });
  });

  it('faktur: 96 columns, form length from the printer setting, logo over the header columns', () => {
    const doc: PrintDocument = {
      role: 'faktur',
      title: 'Faktur 1',
      pages: [[{ text: '' }, { text: '          FAKTUR PENJUALAN', bold: true }], [{ text: 'halaman 2' }]],
      logo: { bitmap: bitmap(100, 60), line: 1, columns: 10 },
    };
    const l = previewLayout(doc, DEFAULT_PRINTER_SETTINGS);
    expect(l.columns).toBe(96);
    expect(l.formLines).toBe(33);
    expect(l.lineCh).toBe(2);
    expect(l.pages).toHaveLength(2);
    // 10 columns wide, 5 lines (12 dots each) tall, starting at line 1.
    expect(l.logo).toMatchObject({ kind: 'overlay', topCh: 2, widthCh: 10, heightCh: 10 });
  });

  it('no logo when the document has none', () => {
    const l = previewLayout({ role: 'faktur', title: 'x', pages: [[{ text: 'a' }]] }, DEFAULT_PRINTER_SETTINGS);
    expect(l.logo).toBeNull();
  });
});
