import { describe, expect, it } from 'vitest';
import { DEFAULT_PRINTER_SETTINGS } from '@shared/printing';
import { cashierReceipt, paymentReceipt, printMoney, salesInvoice } from '@shared/receipts';
import type { Sale } from '@shared/schemas/sales';
import { encodeDocument } from './document';

const store = { name: 'Toko Uji Tani', address: 'Jl. Contoh No. 1', phone: '0800-0000-0000' };
const sale: Sale = {
  id: 's1',
  number: '0000123/KSR/UTM/1026',
  status: 'COMPLETED',
  channel: 'KASIR',
  trxAt: '2026-10-29T02:15:30.000Z', // 09.15.30 WIB
  customer: { id: 'c', code: 'UMUM', name: 'Umum', address: null, isWalkIn: true, groupName: null },
  cashier: { id: 'u', fullName: 'Kasir Uji' },
  lines: [
    {
      id: 'l1',
      lineNo: 1,
      productId: 'p',
      productUnitId: 'u1',
      productName: 'UREA PUPUK UJI 50 KG',
      sku: 'BRG00001',
      unitCode: 'ZAK',
      conversionQty: '50',
      qty: '2',
      unitPrice: '595000.00',
      listPrice: '595000.00',
      priceSource: 'RETAIL',
      discountAmount: '0.00',
      allocatedDiscount: '0.00',
      lineTotal: '1190000.00',
      pickedUpQty: '2',
      returnedQty: '0',
    },
  ],
  subtotal: '1190000.00',
  discountAmount: '0.00',
  otherCharges: '0.00',
  otherChargesNote: null,
  total: '1190000.00',
  paidAmount: '1190000.00',
  creditAmount: '0.00',
  changeAmount: '10000.00',
  dueDate: null,
  payments: [{ paymentMethodId: 'm', methodName: 'Tunai', kind: 'CASH', amount: '1200000.00', reference: null }],
  fulfillmentStatus: 'TAKEN',
  pickupNote: null,
  note: null,
  approvedBy: null,
  voidedAt: null,
  voidReason: null,
};

const text = (bytes: Uint8Array) => String.fromCharCode(...bytes);

describe('receipt documents', () => {
  it('KSR receipt in the iPOS layout, Jakarta time, fits the paper width', () => {
    const doc = cashierReceipt(sale, store, { columns: 48 });
    const lines = doc.pages[0]!.map((l) => l.text);
    expect(lines).toContain('No.  : 0000123/KSR/UTM/1026           29-10-2026');
    expect(lines).toContain('Telp: 0800-0000-0000');
    expect(lines).toContain('Kasir: KASIR UJI                        09:15:30');
    expect(lines).toContain('595.000,00 x 2,00 ZAK =             1.190.000,00');
    expect(lines.find((l) => l.startsWith('Kembali'))).toBe('Kembali     =                          10.000,00');
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(48);
    expect(cashierReceipt(sale, store, { columns: 32, copy: true }).pages[0]!.at(-1)!.text).toBe('*** SALINAN ***');
    expect(printMoney('-1500.5')).toBe('-1.500,50');
  });

  it('JL faktur: 96 columns, terbilang, long notes continue on the next form', () => {
    const many: Sale = {
      ...sale,
      channel: 'FAKTUR',
      number: '0001789/JL/UTM/1026',
      lines: Array.from({ length: 20 }, (_, i) => ({ ...sale.lines[0]!, id: `l${i}`, lineNo: i + 1 })),
    };
    const doc = salesInvoice(many, store, { linesPerPage: 33 });
    expect(doc.pages).toHaveLength(2);
    expect(doc.pages[0]![1]!.text).toContain('Hal 1/2');
    expect(doc.pages.every((p) => p.length <= 33)).toBe(true);
    expect(doc.pages.flat().every((l) => l.text.length <= 96)).toBe(true);
    expect(doc.pages[1]!.map((l) => l.text).join('\n')).toContain(
      'Terbilang : satu juta seratus sembilan puluh ribu rupiah',
    );
  });

  it('BP payment receipt: notes paid, what is left, 96 columns', () => {
    const doc = paymentReceipt(
      {
        id: 'p1',
        number: '0007/BP/UTM/1026',
        paidAt: '2026-10-29T07:10:00.000Z', // 14.10 WIB
        party: { id: 'c', code: 'PL0001', name: 'Tani Uji' },
        method: { id: 'm', name: 'Tunai', kind: 'CASH' },
        amount: '1200000.00',
        reference: null,
        note: null,
        allocations: [
          {
            documentId: 'r1',
            docNumber: '0000001/JL/UTM/0126',
            docDate: '2026-01-06',
            dueDate: '2026-01-16',
            amount: '1000000.00',
            remaining: '0.00',
          },
          {
            documentId: 'r2',
            docNumber: '0000003/JL/UTM/0226',
            docDate: '2026-02-03',
            dueDate: '2026-02-13',
            amount: '200000.00',
            remaining: '300000.00',
          },
        ],
        openAfter: '600000.00',
        createdBy: 'Kasir Uji',
      },
      store,
    );
    expect(doc.role).toBe('faktur');
    const lines = doc.pages[0]!.map((l) => l.text);
    expect(lines.some((l) => l.includes('No         : 0007/BP/UTM/1026'))).toBe(true);
    expect(lines.some((l) => l.includes('Tanggal    : 29/10/2026 14.10'))).toBe(true);
    expect(lines).toContain(
      '2   0000003/JL/UTM/0226        03/02/2026   13/02/2026            200.000,00          300.000,00',
    );
    expect(lines.find((l) => l.includes('JUMLAH DIBAYAR'))!.trim()).toBe('JUMLAH DIBAYAR :           1.200.000,00');
    expect(lines.join(' ')).toContain('Terbilang : satu juta dua ratus ribu rupiah');
    expect(lines.every((l) => l.length <= 96)).toBe(true);
  });

  it('encodes struk as ESC/POS (cut) and faktur as ESC/P (form feed per page)', () => {
    const struk = encodeDocument(cashierReceipt(sale, store, { columns: 48 }), DEFAULT_PRINTER_SETTINGS);
    expect(text(struk.slice(0, 2))).toBe('\x1b@');
    expect(text(struk.slice(-4))).toBe('\x1dVB\x03'); // GS V 66 3 = cut
    const faktur = encodeDocument(
      salesInvoice({ ...sale, channel: 'FAKTUR' }, store, { linesPerPage: 33 }),
      DEFAULT_PRINTER_SETTINGS,
    );
    expect(text(faktur).split('\x0c')).toHaveLength(2);
    expect(text(faktur)).toContain('\x1bC\x21'); // ESC C 33 = page length
  });
});
