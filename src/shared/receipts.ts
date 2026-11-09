// Document builders (desktop-runtime §5, sprint-6 B1): a sale → lines of fixed-width text.
// They know nothing about printer languages; main encodes the lines as ESC/POS (struk) or
// ESC/P (faktur). Layouts copy the iPOS documents the store prints today.
import { LOGO_COLUMNS, LOGO_LINES, type ReceiptLogo } from './logo';
import { dec, type Decimal } from './money';
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
  /** From GET /settings/receipt; absent/null = no logo. */
  logo?: ReceiptLogo | null;
}

/** Faktur logo placement: header lines 1…LOGO_LINES (line 0 is the blank top line). */
function fakturLogo(store: ReceiptStore): PrintDocument['logo'] {
  const bitmap = store.logo?.faktur;
  return bitmap ? { bitmap, line: 1, columns: LOGO_COLUMNS } : undefined;
}

/** Blank characters the encoder replaces with the logo, or '' without a logo. */
const logoGap = (logo: PrintDocument['logo']) => ' '.repeat(logo?.columns ?? 0);

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
  const returnNote = store.receiptFooter ?? 'Barang yang telah dibeli tidak dapat dikembalikan kecuali ada perjanjian';
  for (const l of wrap(returnNote, w)) lines.push(L(l));
  lines.push(L('Terimakasih'));
  if (sale.status === 'VOIDED') lines.push(L(''), L('*** NOTA DIBATALKAN ***', { align: 'center', bold: true }));
  if (opts.copy) lines.push(L(''), L('*** SALINAN ***', { align: 'center', bold: true }));
  const logo = store.logo?.struk;
  return {
    role: 'struk',
    title: `Struk ${sale.number}`,
    pages: [lines],
    ...(logo ? { logo: { bitmap: logo, line: 0, columns: 0 } } : {}),
  };
}

export interface FakturOptions {
  /** Lines per form at 6 lpi (33 = 5.5" continuous form). */
  linesPerPage: number;
  copy?: boolean;
}

export const FAKTUR_COLUMNS = 96;

/**
 * JL Faktur Penjualan (Epson LX-310, ESC/P) — the iPOS 5 faktur the store prints today,
 * column for column (owner 2026-11-09: "sama persis"). 9.5" × 5.5" form, 12 cpi = 96 columns:
 *
 *   [logo] FAKTUR PENJUALAN          No Transaksi : 0001567/JL/UTM/0926  Dept.  : UTM
 *          MANDIRI TANI              Tanggal      : 12/09/2026 14.47.12  User   : ADMIN
 *          JL. POROS RAPP km. 72     Kode Sales   :                      PPN    : Include
 *          0813-6144-1706            Pelanggan    : OP. DAUD SITUMORANG
 *          -                         Alamat       : JL. RAPP
 *   ================================================================================
 *   No. Kode Item   Nama Item                    Jml Satuan    Harga    Pot     Total
 *   ================================================================================
 *   1   NPK 13.8.27 NPK 13.8.27 MAHKOTA        13,00 ZAK  615.000,00  0,00  7.995.000,00
 *       MAHKOTA
 *   --------------------------------------------------------------------------------
 *   Keterangan :            Jml Item   :        13,00  Sub Total   :  7.995.000,00
 *     Hormat Kami  Penerima Potongan   : 0,00 %  0,00  Total Akhir :  7.995.000,00
 *                           Pajak      : 0,00 %  0,00  DP PO       :          0,00
 *                           Biaya Lain :         0,00  Deposit     :          0,00
 *     (.........)  (......) Tanggal Jt : 22/09/2026    Tunai       :          0,00
 *   Terbilang : tujuh juta sembilan ratus ...          Kredit      :  7.995.000,00
 *                                                      K. Debit / K. Kredit / Kembali
 */
export function salesInvoice(sale: Sale, store: ReceiptStore, opts: FakturOptions): PrintDocument {
  const width = FAKTUR_COLUMNS;
  const t = jakartaParts(sale.trxAt);
  const logo = fakturLogo(store);
  const gap = logoGap(logo);

  // Header columns (start: 0 / 41 / 79), the same with or without a logo.
  const leftW = 41 - gap.length;
  const midW = 38;
  const rightW = width - 41 - midW;
  const mid = (label: string, value = '') => fitLeft(`${fitLeft(label, 13)}: ${value}`, midW);

  // Item table: No 4 · Kode 12 · Nama 30 · Jml 7 · Satuan 7 · Harga 14 · Pot 6 · Total 16 = 96.
  const row = (c: [string, string, string, string, string, string, string, string]) =>
    fitLeft(c[0], 4) +
    fitLeft(c[1], 12) +
    fitLeft(c[2], 30) +
    fitRight(c[3], 7) +
    fitLeft(` ${c[4]}`, 7) +
    fitRight(c[5], 14) +
    fitRight(c[6], 6) +
    fitRight(c[7], 16);
  // Long codes and names wrap onto the next line inside their own column, like iPOS.
  const itemRows = sale.lines.map((l) => {
    const code = wrap(l.sku, 11);
    const name = wrap(l.productName, 29);
    return Array.from({ length: Math.max(code.length, name.length) }, (_, i) =>
      i === 0
        ? row([
            String(l.lineNo),
            code[0]!,
            name[0]!,
            printQty(l.qty),
            l.unitCode,
            printMoney(l.unitPrice),
            printMoney(l.discountAmount),
            printMoney(l.lineTotal),
          ])
        : row(['', code[i] ?? '', name[i] ?? '', '', '', '', '', '']),
    );
  });

  // Blank top line + 5 header + 3 table head + separator + 9 summary rows = 19 fixed lines.
  const budget = Math.max(3, opts.linesPerPage - 19);
  const chunks: string[][] = [[]];
  for (const rows of itemRows) {
    const current = chunks[chunks.length - 1]!;
    if (current.length > 0 && current.length + rows.length > budget) chunks.push([]);
    chunks[chunks.length - 1]!.push(...rows);
  }

  const dept = sale.number?.split('/')[2] ?? 'UTM';
  const user = sale.cashier.fullName.toUpperCase().slice(0, rightW - 9);
  const mark =
    sale.status === 'VOIDED' && opts.copy
      ? 'BATAL / SALINAN'
      : sale.status === 'VOIDED'
        ? '** DIBATALKAN **'
        : opts.copy
          ? '*** SALINAN ***'
          : '';

  const pages = chunks.map((items, pageIndex) => {
    const pageTag = chunks.length > 1 ? `Hal ${pageIndex + 1}/${chunks.length}` : '';
    const header: [string, string, string][] = [
      ['FAKTUR PENJUALAN', mid('No Transaksi', sale.number ?? ''), `Dept.  : ${dept}`],
      [store.name.toUpperCase(), mid('Tanggal', `${t.slash} ${t.time.replace(/:/g, '.')}`), `User   : ${user}`],
      [store.address ?? '', mid('Kode Sales'), 'PPN    : Include'],
      [store.phone ?? '', mid('Pelanggan', sale.customer.name.toUpperCase()), pageTag],
      [store.fax || '-', mid('Alamat', (sale.customer.address ?? '').toUpperCase()), mark],
    ];
    const lines: PrintLine[] = [L('')];
    header.forEach(([left, middle, right], i) =>
      lines.push(L(`${gap}${fitLeft(left, leftW)}${middle}${fitLeft(right, rightW)}`.trimEnd(), { bold: i === 0 })),
    );
    const doubleSep = L('='.repeat(width));
    lines.push(
      doubleSep,
      L(row(['No.', 'Kode Item', 'Nama Item', 'Jml', 'Satuan', 'Harga', 'Pot', 'Total']).trimEnd()),
      doubleSep,
    );
    for (const r of items) lines.push(L(r.trimEnd()));
    lines.push(L('-'.repeat(width)));

    if (pageIndex < chunks.length - 1) {
      lines.push(L(fitRight('Bersambung ke halaman berikutnya ...', width)));
      return lines;
    }
    return [...lines, ...fakturSummary(sale)];
  });

  return { role: 'faktur', title: `Faktur ${sale.number}`, pages, ...(logo ? { logo } : {}) };
}

/** iPOS percent: "0,00 %". */
const printPercent = (part: Decimal, whole: string) =>
  `${(dec(whole).gt(0) ? part.div(whole).times(100) : dec(0)).toFixed(2).replace('.', ',')} %`;

/**
 * The nine summary rows under the item table: Keterangan + two signatures (Hormat Kami,
 * Penerima) + Terbilang on the left, Jml Item … Tanggal Jt in the middle, amounts on the right.
 * Amounts are padded, never cut: a value wider than its column pushes the line wider instead.
 */
function fakturSummary(sale: Sale): PrintLine[] {
  const leftW = 37;
  const midW = 30;
  const rightW = FAKTUR_COLUMNS - leftW - midW; // 29
  // Middle values end one column before the right block ("13,00 Sub Total").
  const mid = (label: string, value: string) => `${fitLeft(label, 11)}: ${value.padStart(midW - 14)}`;
  const midPct = (label: string, pct: string, amount: string) =>
    amount.length > 8 ? mid(label, amount) : `${fitLeft(label, 11)}: ${fitLeft(pct, 8)}${amount.padStart(midW - 22)}`;
  const right = (label: string, value: string) => `${fitLeft(label, 12)}:${printMoney(value).padStart(rightW - 13)}`;

  const qty = sale.lines.reduce((s, l) => s.plus(l.qty), dec(0));
  const cash = sale.payments.filter((p) => p.kind === 'CASH').reduce((s, p) => s.plus(p.amount), dec(0));
  const other = sale.payments.filter((p) => p.kind !== 'CASH').reduce((s, p) => s.plus(p.amount), dec(0));
  const note = sale.note ?? (sale.fulfillmentStatus === 'PENDING' ? 'BARANG BELUM DIAMBIL' : '');
  const terbilangLines = wrap(terbilang(sale.total), leftW + midW - 13).map(
    (l, i) => `${i === 0 ? 'Terbilang : ' : ' '.repeat(12)}${l}`,
  );

  const left = [
    `Keterangan : ${note}`,
    `${fitLeft('  Hormat Kami', 22)}Penerima`,
    '',
    '',
    `${fitLeft('  (.........)', 21)}(.........)`,
  ];
  const middle = [
    mid('Jml Item', printQty(qty.toFixed())),
    midPct('Potongan', printPercent(dec(sale.discountAmount), sale.subtotal), printMoney(sale.discountAmount)),
    midPct('Pajak', '0,00 %', printMoney('0.00')),
    mid('Biaya Lain', printMoney(sale.otherCharges)),
    sale.dueDate ? `${fitLeft('Tanggal Jt', 11)}: ${ymdToSlash(sale.dueDate)}` : '',
  ];
  const rights = [
    right('Sub Total', sale.subtotal),
    right('Total Akhir', sale.total),
    right('DP PO', '0.00'),
    right('Deposit', '0.00'),
    right('Tunai', cash.toFixed(2)),
    right('Kredit', sale.creditAmount),
    right('K. Debit', '0.00'),
    right('K. Kredit', other.toFixed(2)),
    right('Kembali', sale.changeAmount),
  ];

  const out: PrintLine[] = [];
  const rows = Math.max(rights.length, 5 + terbilangLines.length);
  for (let i = 0; i < rows; i++) {
    const leftMid =
      i < 5 ? fitLeft(left[i]!, leftW) + fitLeft(middle[i]!, midW) : fitLeft(terbilangLines[i - 5] ?? '', leftW + midW);
    out.push(L(`${leftMid}${rights[i] ?? ''}`.trimEnd()));
  }
  return out;
}

/**
 * Bukti Pengambilan Barang AB (sprint-7 S7-6): Epson LX-310, two copies = two forms
 * (customer / archive), signature boxes for the receiver and the warehouse staff.
 */
export function pickupNote(p: Pickup, store: ReceiptStore, opts: FakturOptions): PrintDocument {
  const width = FAKTUR_COLUMNS;
  const sep = L('-'.repeat(width));
  const logo = fakturLogo(store);
  const gap = logoGap(logo);
  const leftW = 40 - gap.length;
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
        L(`${gap}${fitLeft(left, leftW)}${fitLeft(mid, width - 40 - 18)}${fitRight(right, 18)}`.trimEnd(), {
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
  return {
    role: 'faktur',
    title: `Pengambilan ${p.number}`,
    pages: [copy('LEMBAR PELANGGAN'), copy('LEMBAR ARSIP')],
    ...(logo ? { logo } : {}),
  };
}

/**
 * Bukti pembayaran piutang BP (FR-ARAP-03, PRD §8.1: LX-310): which notes the money paid, what is
 * left on each, and the customer's remaining balance. One form; signature of payer and cashier.
 */
export function paymentReceipt(p: PartyPayment, store: ReceiptStore, opts: { copy?: boolean } = {}): PrintDocument {
  const width = FAKTUR_COLUMNS;
  const sep = L('-'.repeat(width));
  const logo = fakturLogo(store);
  const gap = logoGap(logo);
  const leftW = 44 - gap.length;
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
  // The logo is LOGO_LINES tall: keep the separator below it.
  if (logo) while (header.length < LOGO_LINES) header.push(['', '']);
  header.forEach(([left, right], i) =>
    lines.push(L(`${gap}${fitLeft(left, leftW)}${fitLeft(right, width - 44)}`.trimEnd(), { bold: i === 0 })),
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
  return { role: 'faktur', title: `Pembayaran ${p.number}`, pages: [lines], ...(logo ? { logo } : {}) };
}
