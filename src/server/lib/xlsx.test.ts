import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildReportXlsx } from './xlsx';

describe('buildReportXlsx', () => {
  it('writes title, header, number cells, totals and notes', async () => {
    const buf = await buildReportXlsx({
      title: 'Laba per Barang',
      subtitle: 'Periode 1 Okt 2026 – 31 Okt 2026',
      columns: [
        { key: 'name', header: 'Barang' },
        { key: 'qty', header: 'Qty', type: 'qty' },
        { key: 'sales', header: 'Penjualan', type: 'money' },
        { key: 'margin', header: 'Margin', type: 'percent' },
        { key: 'date', header: 'Tanggal', type: 'date' },
      ],
      rows: [
        { name: 'Urea', qty: '2.5', sales: '1250000.00', margin: '12.5', date: '2026-10-24' },
        { name: 'KCL', qty: '1', sales: '700000.00', margin: null, date: null },
      ],
      totals: { name: 'Total', sales: '1950000.00' },
      notes: ['1 baris tanpa HPP'],
    });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.getCell('A1').value).toBe('Laba per Barang');
    expect(ws.getCell('A2').value).toBe('Periode 1 Okt 2026 – 31 Okt 2026');
    expect(ws.getRow(4).values).toEqual([undefined, 'Barang', 'Qty', 'Penjualan', 'Margin', 'Tanggal']);
    expect(ws.getCell('B5').value).toBe(2.5);
    expect(ws.getCell('C5').value).toBe(1250000);
    expect(ws.getCell('D5').value).toBe(0.125);
    expect((ws.getCell('E5').value as Date).toISOString()).toBe('2026-10-24T00:00:00.000Z');
    expect(ws.getCell('D6').value).toBeNull();
    expect(ws.getCell('C7').value).toBe(1950000);
    expect(ws.getCell('A7').font?.bold).toBe(true);
    expect(ws.getCell('A8').value).toBe('1 baris tanpa HPP');
  });
});
