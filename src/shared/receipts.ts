// Document builders (desktop-runtime §5, sprint-6 B1): a sale → lines of fixed-width text.
// They know nothing about printer languages; main encodes the lines as ESC/POS (struk) or
// ESC/P (faktur). Layouts copy the iPOS documents the store prints today.
import { dec } from './money';
import type { PrintDocument, PrintLine } from './printing';
import type { PartyPayment } from './schemas/ar-ap';
import type { Pickup } from './schemas/pickups';
import type { Sale } from './schemas/sales';
import type { StoreSettings } from './schemas/settings';
import { terbilang } from './terbilang';
import { fitLeft, fitRight, wrap } from './text-layout';

/** iPOS style: "22.000,00" (always two decimals). */
export function printMoney(v: string): string {
  const neg = v.startsWith('-');
  const [int, frac = '00'] = dec(v).abs().toFixed(2).split('.');
  return `${neg ? '-' : ''}${int!.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${frac}`;
}

/** "2" → "2,00"; "2.5" → "2,50". */
export function printQty(v: string): string {
  return dec(v).toFixed(2).replace('.', ',');
}

const jakarta = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jakarta',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function jakartaParts(iso: string) {
  const p = Object.fromEntries(jakarta.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return {
    date: `${p.day}-${p.month}-${p.year}`,
    slash: `${p.day}/${p.month}/${p.year}`,
    time: `${p.hour}:${p.minute}:${p.second}`,
    hm: `${p.hour}.${p.minute}`,
  };
}

const ymdToSlash = (d: string) => d.split('-').reverse().join('/');

export interface ReceiptOptions {
  /** Characters per line of the thermal paper: 32 (58 mm) … 48 (80 mm). */
  columns: number;
  /** Reprint (FR-POS-15): marked SALINAN. */
  copy?: boolean;
}

const L = (text: string, extra: Omit<PrintLine, 'text'> = {}): PrintLine => ({ text, ...extra });

/** KSR cashier receipt (thermal, ESC/POS). */
export function cashierReceipt(sale: Sale, store: StoreSettings, opts: ReceiptOptions): PrintDocument {
  const w = opts.columns;
  const sep = L('-'.repeat(w));
  const both = (left: string, right: string) => fitLeft(left, w - right.length) + right;
  const amount = (label: string, value: string) => fitLeft(label, 14) + fitRight(value, w - 14);
  const t = jakartaParts(sale.trxAt);
  const lines: PrintLine[] = [];

  lines.push(L(store.name.toUpperCase(), { align: 'center', bold: true, size: 2 }), L(''));
  for (const part of [store.address?.toUpperCase(), store.phone ? `Telp: ${store.phone}` : null]) {
    if (part) for (const l of wrap(part, w)) lines.push(L(l));
  }
  lines.push(L(''));
  lines.push(L(both(`No.  : ${sale.number}`, ` ${t.date}`)));
  lines.push(L(both(`Kasir: ${sale.cashier.fullName.toUpperCase()}`, ` ${t.time}`)));
  const pay = sale.payments.length === 1 && sale.payments[0]!.kind === 'CASH' ? 'CASH' : 'BAYAR';
  lines.push(L(fitLeft(`Pel. : ${sale.customer.name.toUpperCase()}/${pay}`, w).trimEnd()));
  lines.push(sep);
  let qty = dec(0);
  for (const l of sale.lines) {
    for (const n of wrap(l.productName, w)) lines.push(L(n));
    lines.push(
      L(both(`${printMoney(l.unitPrice)} x ${printQty(l.qty)} ${l.unitCode} =`, ` ${printMoney(l.lineTotal)}`)),
    );
    qty = qty.plus(l.qty);
  }
  lines.push(sep);
  if (dec(sale.discountAmount).gt(0)) {
    lines.push(L(amount('Sub Total', printMoney(sale.subtotal))));
    lines.push(L(amount('Potongan', printMoney(sale.discountAmount))));
  }
  lines.push(L(amount('TOTAL', printMoney(sale.total)), { bold: true }));
  lines.push(L(`BRS=${sale.lines.length} , QTY=${printQty(qty.toFixed())}`));
  for (const p of sale.payments) {
    const label = p.kind === 'CASH' ? 'Tunai' : p.methodName;
    lines.push(L(amount(`${label.slice(0, 12).padEnd(12)}=`, printMoney(p.amount))));
    if (p.reference) lines.push(L(`  Ref: ${p.reference}`));
  }
  if (dec(sale.creditAmount).gt(0)) lines.push(L(amount('Kredit      =', printMoney(sale.creditAmount))));
  lines.push(L(fitRight('-'.repeat(Math.min(18, w - 14)), w)));
  lines.push(L(amount('Kembali     =', printMoney(sale.changeAmount))), L(''));
  if (sale.fulfillmentStatus === 'PENDING') {
    lines.push(L('BARANG BELUM DIAMBIL', { bold: true, align: 'center' }));
    for (const l of wrap('Simpan struk ini. Tunjukkan saat mengambil barang.', w))
      lines.push(L(l, { align: 'center' }));
    lines.push(L(''));
  }
  for (const l of wrap('Barang yang telah dibeli tidak dapat dikembalikan kecuali ada perjanjian', w)) lines.push(L(l));
  lines.push(L('Terimakasih'));
  if (sale.status === 'VOIDED') lines.push(L(''), L('*** NOTA DIBATALKAN ***', { align: 'center', bold: true }));
  if (opts.copy) lines.push(L(''), L('*** SALINAN ***', { align: 'center', bold: true }));
  return { role: 'struk', title: `Struk ${sale.number}`, pages: [lines] };
}

export interface FakturOptions {
  /** Lines per form at 6 lpi (33 = 5.5" continuous form). */
  linesPerPage: number;
  copy?: boolean;
}

export const FAKTUR_COLUMNS = 96;

/** JL Faktur Penjualan (Epson LX-310, ESC/P) — long notes continue on the next form with "Hal n/m". */
export function salesInvoice(sale: Sale, store: StoreSettings, opts: FakturOptions): PrintDocument {
  const width = FAKTUR_COLUMNS;
  const sep = L('-'.repeat(width));
  const leftW = 35;
  const t = jakartaParts(sale.trxAt);
  // Header 8 + summary 11 + page note 1 → the rest is item rows.
  const perPage = Math.max(5, opts.linesPerPage - 20);
  const chunks: Sale['lines'][] = [];
  for (let i = 0; i < Math.max(1, sale.lines.length); i += perPage) chunks.push(sale.lines.slice(i, i + perPage));
  const row = (c: string[]) =>
    [
      fitRight(c[0]!, 2),
      fitLeft(c[1]!, 14),
      fitLeft(c[2]!, 30),
      fitRight(c[3]!, 6),
      fitLeft(c[4]!, 6),
      fitRight(c[5]!, 12),
      fitRight(c[6]!, 5),
      fitRight(c[7]!, 13),
    ].join(' ');

  const pages = chunks.map((items, pageIndex) => {
    const lines: PrintLine[] = [L('')];
    const header: [string, string, string][] = [
      ['FAKTUR PENJUALAN', `No Transaksi : ${sale.number}`, `Hal ${pageIndex + 1}/${chunks.length}`],
      [
        store.name.toUpperCase(),
        `Tanggal      : ${t.slash} ${t.hm}`,
        `User : ${sale.cashier.fullName.toUpperCase().slice(0, 5)}`,
      ],
      [(store.address ?? '').toUpperCase(), `Pelanggan    : ${sale.customer.name.toUpperCase()}`, ''],
      [store.phone ?? '', `Alamat       : ${(sale.customer.address ?? '').toUpperCase()}`, ''],
    ];
    header.forEach(([left, mid, right], i) =>
      lines.push(
        L(`${fitLeft(left, leftW)}${fitLeft(mid, width - leftW - 12)}${fitLeft(right, 12)}`.trimEnd(), {
          bold: i === 0,
        }),
      ),
    );
    lines.push(sep, L(row(['No', 'Kode Item', 'Nama Item', 'Jml', 'Satuan', 'Harga', 'Pot%', 'Total'])), sep);
    for (const l of items) {
      lines.push(
        L(
          row([
            String(l.lineNo),
            l.sku,
            l.productName,
            printQty(l.qty),
            l.unitCode,
            printMoney(l.unitPrice),
            '0,00',
            printMoney(l.lineTotal),
          ]),
        ),
      );
    }
    lines.push(sep);
    if (pageIndex < chunks.length - 1) {
      lines.push(L(fitRight('Bersambung ke halaman berikutnya ...', width)));
      return lines;
    }
    const sumLeftW = 33;
    const midW = 25;
    const rightW = width - sumLeftW - midW;
    const qty = sale.lines.reduce((s, l) => s.plus(l.qty), dec(0)).toFixed();
    const cash = sale.payments.filter((p) => p.kind === 'CASH').reduce((s, p) => s.plus(p.amount), dec(0));
    const other = sale.payments.filter((p) => p.kind !== 'CASH').reduce((s, p) => s.plus(p.amount), dec(0));
    const note = sale.note ?? (sale.fulfillmentStatus === 'PENDING' ? 'BARANG BELUM DIAMBIL' : '');
    const summary: [string, string, string, string][] = [
      [
        `Keterangan : ${note}`.slice(0, sumLeftW),
        `Jml Item   : ${printQty(qty)}`,
        'Sub Total   :',
        printMoney(sale.subtotal),
      ],
      ['', `Potongan   : ${printMoney(sale.discountAmount)}`, 'Biaya Lain  :', printMoney(sale.otherCharges)],
      [
        '      Penerima',
        sale.dueDate ? `Tanggal Jt : ${ymdToSlash(sale.dueDate)}` : '',
        'TOTAL AKHIR :',
        printMoney(sale.total),
      ],
      ['', '', 'Tunai       :', printMoney(cash.toFixed(2))],
      [
        '',
        '',
        other.gt(0) ? 'Transfer    :' : 'Kredit      :',
        printMoney(other.gt(0) ? other.toFixed(2) : sale.creditAmount),
      ],
      [
        '  (..............)',
        '',
        other.gt(0) ? 'Kredit      :' : 'Kembali     :',
        printMoney(other.gt(0) ? sale.creditAmount : sale.changeAmount),
      ],
    ];
    for (const [left, mid, label, value] of summary) {
      lines.push(
        L(fitLeft(left, sumLeftW) + fitLeft(mid, midW) + fitLeft(label, 14) + fitRight(value, rightW - 14), {
          bold: label.startsWith('TOTAL'),
        }),
      );
    }
    lines.push(L(''));
    for (const l of wrap(`Terbilang : ${terbilang(sale.total)}`, width)) lines.push(L(l));
    if (sale.status === 'VOIDED') lines.push(L('*** FAKTUR DIBATALKAN ***', { bold: true }));
    if (opts.copy) lines.push(L('*** SALINAN ***', { bold: true }));
    return lines;
  });
  return { role: 'faktur', title: `Faktur ${sale.number}`, pages };
}

/**
 * Bukti Pengambilan Barang AB (sprint-7 S7-6): Epson LX-310, two copies = two forms
 * (customer / archive), signature boxes for the receiver and the warehouse staff.
 */
export function pickupNote(p: Pickup, store: StoreSettings, opts: FakturOptions): PrintDocument {
  const width = FAKTUR_COLUMNS;
  const sep = L('-'.repeat(width));
  const leftW = 40;
  const t = jakartaParts(p.pickedUpAt);
  const row = (c: string[]) =>
    [
      fitLeft(c[0]!, 2),
      fitLeft(c[1]!, 22),
      fitLeft(c[2]!, 14),
      fitLeft(c[3]!, 32),
      fitRight(c[4]!, 8),
      fitLeft(c[5]!, 6),
      fitRight(c[6]!, 6),
    ].join(' ');
  const copy = (label: string): PrintLine[] => {
    const lines: PrintLine[] = [L('')];
    const header: [string, string, string][] = [
      ['BUKTI PENGAMBILAN BARANG', `No        : ${p.number}`, label],
      [store.name.toUpperCase(), `Tanggal   : ${t.slash} ${t.hm}`, ''],
      [(store.address ?? '').toUpperCase(), `Pelanggan : ${p.customer.name.toUpperCase()}`, ''],
      [
        store.phone ?? '',
        `Penerima  : ${p.receiverName.toUpperCase()}${p.receiverPhone ? ` (${p.receiverPhone})` : ''}`,
        '',
      ],
      [
        p.method === 'DELIVERY' ? 'DIANTAR TOKO' : 'DIAMBIL SENDIRI',
        p.method === 'DELIVERY'
          ? `Tujuan    : ${(p.destination ?? '').toUpperCase()}`
          : `Kendaraan : ${(p.vehicle ?? '-').toUpperCase()}`,
        '',
      ],
    ];
    header.forEach(([left, mid, right], i) =>
      lines.push(
        L(`${fitLeft(left, leftW)}${fitLeft(mid, width - leftW - 18)}${fitRight(right, 18)}`.trimEnd(), {
          bold: i === 0,
        }),
      ),
    );
    lines.push(sep, L(row(['No', 'Nota Jual', 'Kode Item', 'Nama Item', 'Diambil', 'Satuan', 'Sisa'])), sep);
    p.lines.forEach((l, i) =>
      lines.push(
        L(
          row([
            String(i + 1),
            l.saleNumber,
            l.sku,
            l.productName,
            printQty(l.qty),
            l.unitCode,
            printQty(l.remainingQty),
          ]),
        ),
      ),
    );
    lines.push(sep);
    if (p.note) for (const n of wrap(`Keterangan : ${p.note}`, width)) lines.push(L(n));
    if (p.status === 'CANCELLED') lines.push(L('*** PENGAMBILAN DIBATALKAN ***', { bold: true }));
    if (opts.copy) lines.push(L('*** SALINAN ***', { bold: true }));
    lines.push(L(''), L(`${fitLeft('      Penerima', 48)}Petugas gudang`), L(''), L(''));
    lines.push(L(`${fitLeft('  (....................)', 48)}(....................)`));
    return lines;
  };
  return { role: 'faktur', title: `Pengambilan ${p.number}`, pages: [copy('LEMBAR PELANGGAN'), copy('LEMBAR ARSIP')] };
}

/**
 * Bukti pembayaran piutang BP (FR-ARAP-03, PRD §8.1: LX-310): which notes the money paid, what is
 * left on each, and the customer's remaining balance. One form; signature of payer and cashier.
 */
export function paymentReceipt(p: PartyPayment, store: StoreSettings, opts: { copy?: boolean } = {}): PrintDocument {
  const width = FAKTUR_COLUMNS;
  const sep = L('-'.repeat(width));
  const leftW = 44;
  const t = jakartaParts(p.paidAt);
  const row = (c: string[]) =>
    [
      fitLeft(c[0]!, 3),
      fitLeft(c[1]!, 26),
      fitLeft(c[2]!, 12),
      fitLeft(c[3]!, 12),
      fitRight(c[4]!, 19),
      fitRight(c[5]!, 19),
    ].join(' ');
  const lines: PrintLine[] = [L('')];
  const header: [string, string][] = [
    ['BUKTI PEMBAYARAN PIUTANG', `No         : ${p.number}`],
    [store.name.toUpperCase(), `Tanggal    : ${t.slash} ${t.hm}`],
    [(store.address ?? '').toUpperCase(), `Pelanggan  : ${p.party.name.toUpperCase()}`],
    [store.phone ?? '', `Cara bayar : ${p.method.name.toUpperCase()}${p.reference ? ` (${p.reference})` : ''}`],
  ];
  header.forEach(([left, right], i) =>
    lines.push(L(`${fitLeft(left, leftW)}${fitLeft(right, width - leftW)}`.trimEnd(), { bold: i === 0 })),
  );
  lines.push(sep, L(row(['No', 'No. Nota', 'Tgl Nota', 'Jatuh Tempo', 'Dibayar', 'Sisa Nota'])), sep);
  p.allocations.forEach((a, i) =>
    lines.push(
      L(
        row([
          String(i + 1),
          a.docNumber,
          ymdToSlash(a.docDate),
          ymdToSlash(a.dueDate),
          printMoney(a.amount),
          printMoney(a.remaining),
        ]),
      ),
    ),
  );
  lines.push(sep);
  const sumLabelW = 20;
  const sumValueW = 19;
  const pad = width - sumLabelW - sumValueW;
  lines.push(
    L(`${fitLeft('', pad)}${fitLeft('JUMLAH DIBAYAR :', sumLabelW)}${fitRight(printMoney(p.amount), sumValueW)}`, {
      bold: true,
    }),
    L(`${fitLeft('', pad)}${fitLeft('Sisa piutang   :', sumLabelW)}${fitRight(printMoney(p.openAfter), sumValueW)}`),
    L(''),
  );
  for (const l of wrap(`Terbilang : ${terbilang(p.amount)}`, width)) lines.push(L(l));
  if (p.note) for (const n of wrap(`Keterangan : ${p.note}`, width)) lines.push(L(n));
  if (opts.copy) lines.push(L('*** SALINAN ***', { bold: true }));
  lines.push(L(''), L(`${fitLeft('      Pembayar', 48)}Penerima (${p.createdBy})`), L(''), L(''));
  lines.push(L(`${fitLeft('  (....................)', 48)}(....................)`));
  return { role: 'faktur', title: `Pembayaran ${p.number}`, pages: [lines] };
}
