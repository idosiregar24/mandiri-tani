// Document builders (desktop-runtime §5, sprint-6 B1): a sale → lines of fixed-width text.
// They know nothing about printer languages; main encodes the lines as ESC/POS (struk) or
// ESC/P (faktur). Layouts copy the iPOS documents the store prints today.
import { dec } from './money';
import type { PrintDocument, PrintLine } from './printing';
import type { PartyPayment } from './schemas/ar-ap';
import type { Pickup } from './schemas/pickups';
import type { Sale } from './schemas/sales';
import { terbilang } from './terbilang';
import { fitLeft, fitRight, wrap } from './text-layout';

export interface ReceiptStore {
  name: string;
  address?: string | null;
  phone?: string | null;
  fax?: string | null;
  email?: string | null;
  receiptFooter?: string | null;
}

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
export function cashierReceipt(sale: Sale, store: ReceiptStore, opts: ReceiptOptions): PrintDocument {
  const w = opts.columns;
  const sep = L('-'.repeat(w));
  const both = (left: string, right: string) => fitLeft(left, w - right.length) + right;
  const amount = (label: string, value: string) => fitLeft(label, 14) + fitRight(value, w - 14);
  const t = jakartaParts(sale.trxAt);
  const lines: PrintLine[] = [];

  lines.push(L(store.name.toUpperCase(), { align: 'center', bold: true, size: 2 }), L(''));
  if (store.address) {
    for (const l of wrap(store.address.toUpperCase(), w)) lines.push(L(l));
  }
  const contactParts: string[] = [];
  if (store.phone) contactParts.push(`Telp: ${store.phone}`);
  if (store.fax) contactParts.push(`Fax: ${store.fax}`);
  if (store.email) contactParts.push(`Email: ${store.email}`);
  if (contactParts.length > 0) {
    for (const l of wrap(contactParts.join(' '), w)) lines.push(L(l));
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
  lines.push(
    L(both(`BRS=${sale.lines.length} , QTY=${printQty(qty.toFixed())}`, ` ${printMoney(sale.total)}`), { bold: true }),
  );
  for (const p of sale.payments) {
    const label = p.kind === 'CASH' ? 'Tunai' : p.methodName;
    lines.push(L(amount(`${label.slice(0, 12).padEnd(12)}=`, printMoney(p.amount))));
    if (p.reference) lines.push(L(`  Ref: ${p.reference}`));
  }
  if (dec(sale.creditAmount).gt(0)) lines.push(L(amount('Kredit      =', printMoney(sale.creditAmount))));
  lines.push(L(fitRight('-'.repeat(Math.min(22, w - 14)), w)));
  lines.push(L(amount('Kembali     =', printMoney(sale.changeAmount))), L(''));
  if (sale.fulfillmentStatus === 'PENDING') {
    lines.push(L('BARANG BELUM DIAMBIL', { bold: true, align: 'center' }));
    for (const l of wrap('Simpan struk ini. Tunjukkan saat mengambil barang.', w))
      lines.push(L(l, { align: 'center' }));
    lines.push(L(''));
  }
  const returnNote =
    store.receiptFooter ?? 'Barang yang telah dibeli tidak dapat dikembalikan kecuali ada perjanjian';
  for (const l of wrap(returnNote, w)) lines.push(L(l));
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

/** JL Faktur Penjualan (Epson LX-310, ESC/P) — exact match with iPOS 5 9.5" x 5.5" dot matrix form. */
export function salesInvoice(sale: Sale, store: ReceiptStore, opts: FakturOptions): PrintDocument {
  const width = FAKTUR_COLUMNS;
  const sep = L('-'.repeat(width));
  const doubleSep = L('='.repeat(width));
  const t = jakartaParts(sale.trxAt);
  const timeDotted = t.time.replace(/:/g, '.');

  // Header ~8 + summary ~12 + page note 1 → the rest is item rows (12-14 items per page).
  const perPage = Math.max(5, opts.linesPerPage - 20);
  const chunks: Sale['lines'][] = [];
  for (let i = 0; i < Math.max(1, sale.lines.length); i += perPage) chunks.push(sale.lines.slice(i, i + perPage));

  const row = (c: string[]) =>
    [
      fitLeft(c[0]!, 3),
      fitLeft(c[1]!, 14),
      fitLeft(c[2]!, 31),
      fitRight(c[3]!, 7),
      fitLeft(c[4]!, 7),
      fitRight(c[5]!, 14),
      fitRight(c[6]!, 6),
      fitRight(c[7]!, 14),
    ].join('');

  const pages = chunks.map((items, pageIndex) => {
    const lines: PrintLine[] = [L('')];
    const leftW = 28;
    const midW = 46;
    const rightW = width - leftW - midW;

    const pageTag = chunks.length > 1 ? `Hal ${pageIndex + 1}/${chunks.length}` : '';
    const header: [string, string, string][] = [
      ['FAKTUR PENJUALAN', `No Transaksi : ${sale.number}`, pageTag || 'Dept. : UTM'],
      [store.name.toUpperCase(), `Tanggal      : ${t.slash} ${timeDotted}`, pageTag ? 'Dept. : UTM' : `User  : ${sale.cashier.fullName.toUpperCase().slice(0, 8)}`],
      [
        (store.address ?? '').toUpperCase().slice(0, leftW - 1),
        'Kode Sales   :',
        pageTag ? `User  : ${sale.cashier.fullName.toUpperCase().slice(0, 8)}` : 'PPN   : Include',
      ],
      [
        store.phone ?? '',
        `Pelanggan    : ${sale.customer.name.toUpperCase().slice(0, midW - 16)}`,
        pageTag ? 'PPN   : Include' : '',
      ],
      [
        '-',
        `Alamat       : ${(sale.customer.address ?? '').toUpperCase().slice(0, midW - 16)}`,
        '',
      ],
    ];

    header.forEach(([left, mid, right], i) =>
      lines.push(
        L(`${fitLeft(left, leftW)}${fitLeft(mid, midW)}${fitLeft(right, rightW)}`.trimEnd(), {
          bold: i === 0,
        }),
      ),
    );

    lines.push(doubleSep, L(row(['No.', 'Kode Item', 'Nama Item', 'Jml', 'Satuan', 'Harga', 'Pot.', 'Total'])), doubleSep);
    for (const l of items) {
      lines.push(
        L(
          row([
            String(l.lineNo),
            l.sku,
            l.productName.slice(0, 30),
            printQty(l.qty),
            ` ${l.unitCode}`,
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

    const sumLeftW = 34;
    const sumMidW = 26;
    const sumRightW = width - sumLeftW - sumMidW; // 36 cols
    const qty = sale.lines.reduce((s, l) => s.plus(l.qty), dec(0)).toFixed();
    const cash = sale.payments.filter((p) => p.kind === 'CASH').reduce((s, p) => s.plus(p.amount), dec(0));
    const other = sale.payments.filter((p) => p.kind !== 'CASH').reduce((s, p) => s.plus(p.amount), dec(0));
    const note = sale.note ?? (sale.fulfillmentStatus === 'PENDING' ? 'BARANG BELUM DIAMBIL' : '');

    const rAmount = (label: string, val: string) => fitLeft(label, 14) + fitRight(val, sumRightW - 14);

    const summaryRows: [string, string, string][] = [
      [
        fitLeft(`Keterangan : ${note}`.slice(0, sumLeftW), sumLeftW),
        fitLeft(`Jml Item   : ${printQty(qty).padStart(10)}`, sumMidW),
        rAmount('Sub Total   :', printMoney(sale.subtotal)),
      ],
      [
        fitLeft('', sumLeftW),
        fitLeft(`Potongan   :  0,00 % ${printMoney(sale.discountAmount).padStart(7)}`, sumMidW),
        rAmount('Total Akhir :', printMoney(sale.total)),
      ],
      [
        fitLeft('       Penerima', sumLeftW),
        fitLeft(`Pajak      :  0,00 % ${printMoney('0.00').padStart(7)}`, sumMidW),
        rAmount('DP PO       :', printMoney('0.00')),
      ],
      [
        fitLeft('', sumLeftW),
        fitLeft(`Biaya Lain : ${printMoney(sale.otherCharges).padStart(11)}`, sumMidW),
        rAmount('Deposit     :', printMoney('0.00')),
      ],
      [
        fitLeft('   (..............)', sumLeftW),
        fitLeft(sale.dueDate ? `Tanggal Jt : ${ymdToSlash(sale.dueDate).padStart(11)}` : '', sumMidW),
        rAmount('Tunai       :', printMoney(cash.toFixed(2))),
      ],
      [
        fitLeft('', sumLeftW),
        fitLeft('', sumMidW),
        rAmount('Kredit      :', printMoney(sale.creditAmount)),
      ],
      [
        fitLeft('', sumLeftW),
        fitLeft('', sumMidW),
        rAmount('K. Debit    :', printMoney('0.00')),
      ],
      [
        fitLeft('', sumLeftW),
        fitLeft('', sumMidW),
        rAmount('K. Kredit   :', printMoney(other.gt(0) ? other.toFixed(2) : '0.00')),
      ],
      [
        fitLeft('', sumLeftW),
        fitLeft('', sumMidW),
        rAmount('Kembali     :', printMoney(sale.changeAmount)),
      ],
    ];

    for (const [col1, col2, col3] of summaryRows) {
      lines.push(L(col1 + col2 + col3));
    }

    lines.push(L(''));
    for (const l of wrap(`Terbilang : ${terbilang(sale.total)} rupiah`, width)) lines.push(L(l));
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
export function pickupNote(p: Pickup, store: ReceiptStore, opts: FakturOptions): PrintDocument {
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
export function paymentReceipt(p: PartyPayment, store: ReceiptStore, opts: { copy?: boolean } = {}): PrintDocument {
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
