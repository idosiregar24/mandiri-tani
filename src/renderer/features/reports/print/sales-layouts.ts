// The iPOS 5 sales report templates (Report/LapPenjualan/*.repx), rebuilt band by band. Every
// x/y/w/h is the template's value in mm (repx units are 1/10 mm, Dpi 254). Fonts: Arial, detail
// 8 pt, captions 9 pt bold, title 12 pt bold. Columns iPOS has but the store cannot fill (Dept. on
// a sale, card payments) are kept and printed the way iPOS printed them (empty / 0,00).
import { dec } from '@shared/money';
import type { SalesPrintInvoice, SalesPrintReport } from '@shared/schemas/reports';
import {
  fmtDate,
  fmtN,
  fmtPrintedAt,
  sum,
  type Align,
  type Orientation,
  type PrintBand,
  type PrintReport,
  type PrintText,
} from './model';

const L: Align = 'left';
const R: Align = 'right';

/** [x, w, text, align] of a caption at the template's caption row (y 1.1, h 5.3, Arial 9 bold). */
type Col = [number, number, string, Align];

function captionBand(width: number, cols: Col[], single = false): PrintBand {
  return {
    mode: 'fixed',
    height: 8.2,
    texts: cols.map(([x, w, text, align]) => ({
      x,
      w,
      y: 1.1,
      h: 5.3,
      text,
      align,
      bold: true,
      middle: true,
      size: 9,
      nowrap: true,
    })),
    lines: single
      ? [
          { x: 2.6, w: width, y: 0.55 },
          { x: 2.6, w: width, y: 7.45 },
        ]
      : [
          { x: 2.6, w: width, y: 0.55 },
          { x: 2.6, w: width, y: 6.65 },
          { x: 2.6, w: width, y: 7.45 },
        ],
  };
}

/** One detail line (Arial 8, top aligned, grows when a text wraps). */
function row(cells: [number, number, string, Align?][], height = 4.52, size = 8): PrintBand {
  return { mode: 'flow', height, size, texts: cells.map(([x, w, text, align]) => ({ x, w, text, align: align ?? L })) };
}

interface HeaderSpec {
  title: string;
  titleW: number;
  /** x / w of the filter block at the top right. */
  infoX: number;
  infoW: number;
  infoY: number;
}

function reportHeader(r: SalesPrintReport, s: HeaderSpec): PrintBand {
  const c = r.header.company;
  const texts: PrintText[] = [
    { x: 24.9, y: 1.1, w: s.titleW, h: 5.3, text: s.title, size: 12, bold: true, middle: true, nowrap: true },
    { x: 24.9, y: 6.5, w: 52.8, h: 5.3, text: c.name, size: 10, bold: true, middle: true, nowrap: true },
    { x: 24.9, y: 11.9, w: 90, h: 5.3, text: c.address || '-', size: 9, middle: true, nowrap: true },
    { x: 24.9, y: 17.2, w: 52.8, h: 5.3, text: c.phone || '-', size: 9.75, middle: true, nowrap: true },
    { x: 24.9, y: 22.5, w: 52.8, h: 5.3, text: c.fax || '-', size: 9.75, middle: true, nowrap: true },
  ];
  r.header.filters.forEach((f, i) =>
    texts.push({ x: s.infoX, y: s.infoY + i * 4.02, w: s.infoW, h: 4, text: f, size: 9, nowrap: true }),
  );
  return {
    mode: 'fixed',
    height: Math.max(28.6, s.infoY + r.header.filters.length * 4.02 + 1),
    texts,
    images: c.logo ? [{ x: 2.6, y: 1.1, w: 21.2, h: 21.4, src: c.logo }] : [],
  };
}

function pageFooter(r: SalesPrintReport, orientation: Orientation, printedAt: Date) {
  const land = orientation === 'landscape';
  const when = fmtPrintedAt(printedAt);
  return (page: number, pages: number): PrintBand => ({
    mode: 'fixed',
    height: 8.2,
    size: 8,
    texts: [
      { x: land ? 4.0 : 2.6, y: 0, w: 27.8, h: 4.7, text: when },
      { x: land ? 31.8 : 30.4, y: 0, w: 25.4, h: 4.7, text: r.header.printedBy },
      { x: land ? 275.2 : 186.6, y: land ? 1.0 : 0, w: 11.6, h: 4.7, text: `${page}/${pages}`, nowrap: true },
    ],
  });
}

/** "Label :  value" lines of the report footer, one band each so they can run onto the next page. */
function totalLines(
  lines: [string, string][],
  spec: { labelX: number; labelW: number; valueX: number; valueW: number; width: number; grandX: number },
): PrintBand[] {
  return lines.map(([label, value], i) => ({
    mode: 'fixed' as const,
    height: i === 0 ? 6.6 : 5.3,
    size: 9,
    lines: i === 0 ? [{ x: 2.6, w: spec.width, y: 0.25 }] : [],
    texts: [
      ...(i === 0
        ? [
            {
              x: spec.grandX,
              y: 1.3,
              w: 44.7,
              h: 5.3,
              text: 'TOTAL KESELURUHAN :',
              align: R,
              bold: true,
              italic: true,
              middle: true,
            },
          ]
        : []),
      {
        x: spec.labelX,
        y: i === 0 ? 1.3 : 0,
        w: spec.labelW,
        h: 5.3,
        text: label,
        align: R,
        bold: true,
        middle: true,
        nowrap: true,
      },
      {
        x: spec.valueX,
        y: i === 0 ? 1.3 : 0,
        w: spec.valueW,
        h: 5.3,
        text: value,
        align: R,
        middle: true,
        nowrap: true,
      },
    ],
  }));
}

// ------------------------------------------------------------------ Laporan Penjualan Rekap

function rekap(r: SalesPrintReport, printedAt: Date): PrintReport {
  const t = r.totals;
  return {
    orientation: 'landscape',
    reportHeader: reportHeader(r, {
      title: 'LAPORAN PENJUALAN REKAP',
      titleW: 75.8,
      infoX: 204.0,
      infoW: 82.8,
      infoY: 1.1,
    }),
    pageHeader: captionBand(284.2, [
      [2.6, 31.8, 'No Transaksi', L],
      [34.4, 23.1, 'Tanggal', L],
      [57.5, 12.6, 'Dept.', L],
      [70.0, 22.2, 'Kode Pel.', L],
      [92.3, 15.4, 'Jml Item', R],
      [107.6, 26.9, 'Sub Total', R],
      [134.6, 14.0, 'Pot. %', R],
      [148.6, 20.4, 'Pajak', R],
      [169.0, 20.4, 'Biaya Lain', R],
      [189.4, 30.6, 'Total Akhir', R],
      [220.0, 32.4, 'Bayar Tunai', R],
      [252.4, 32.4, 'Bayar Kredit', R],
    ]),
    body: [
      ...r.invoices.map((i) =>
        row([
          [2.6, 31.8, i.number],
          [34.4, 23.1, fmtDate(i.date)],
          [57.5, 12.6, ''],
          [70.0, 22.2, i.customerCode],
          [92.3, 15.4, fmtN(i.itemCount), R],
          [107.6, 26.9, fmtN(i.subtotal), R],
          [134.6, 14.0, fmtN(i.discountPct), R],
          [148.6, 20.4, fmtN(i.tax), R],
          [169.0, 20.4, fmtN(i.otherCharges), R],
          [189.4, 30.6, fmtN(i.total), R],
          [220.0, 32.4, fmtN(i.paidCash), R],
          [252.4, 32.4, fmtN(i.paidCredit), R],
        ]),
      ),
      ...totalLines(
        [
          ['Jumlah Item :', fmtN(t.itemCount)],
          ['Sub Total :', fmtN(t.subtotal)],
          ['Potongan :', fmtN(t.discount)],
          ['Pajak :', fmtN(t.tax)],
          ['Biaya Lain :', fmtN(t.otherCharges)],
          ['Total Akhir :', fmtN(t.total)],
          ['Bayar Tunai :', fmtN(t.paidCash)],
          ['Bayar Kredit :', fmtN(t.paidCredit)],
        ],
        { labelX: 218.5, labelW: 32.0, valueX: 250.4, valueW: 36.4, width: 284.2, grandX: 173.7 },
      ),
    ],
    pageFooter: pageFooter(r, 'landscape', printedAt),
  };
}

// ----------------------------------------------------------------- Laporan Penjualan Detail

function detail(r: SalesPrintReport, printedAt: Date): PrintReport {
  const t = r.totals;
  const lines = new Map<string, typeof r.items>();
  for (const it of r.items) lines.set(it.saleId, [...(lines.get(it.saleId) ?? []), it]);
  const body: PrintBand[] = [];
  for (const s of r.invoices) {
    const its = lines.get(s.id) ?? [];
    // Group header: the note, then the italic underlined item captions.
    body.push({
      ...row(
        [
          [2.6, 31.8, s.number],
          [34.4, 23.1, fmtDate(s.date)],
          [57.5, 12.6, ''],
          [70.0, 22.2, s.customerCode],
          [92.3, 42.1, s.customerName],
          [134.4, 65.6, s.customerAddress ?? ''],
        ],
        6.7,
        9,
      ),
      keepWithNext: true,
    });
    body.push({
      mode: 'fixed',
      height: 5.7,
      size: 8,
      keepWithNext: true,
      texts: (
        [
          [2.6, 9.3, 'No.', L],
          [11.9, 22.5, 'Kd. Item', L],
          [34.4, 67.6, 'Nama Item', L],
          [102.1, 16.1, 'Jml', R],
          [118.3, 16.1, 'Satuan', R],
          [134.4, 24.9, 'Harga', R],
          [159.3, 10.8, 'Pot. %', R],
          [170.1, 29.9, 'Total', R],
        ] as Col[]
      ).map(([x, w, text, align]) => ({
        x,
        w,
        y: 0,
        h: 5.3,
        text,
        align,
        italic: true,
        underline: true,
        middle: true,
      })),
    });
    for (const it of its) {
      body.push(
        row([
          [2.6, 9.3, String(it.lineNo)],
          [11.9, 22.5, it.sku],
          [34.4, 67.6, it.name],
          [102.1, 16.1, fmtN(it.qty), R],
          [118.3, 16.1, it.unit],
          [134.4, 24.9, fmtN(it.price), R],
          [159.3, 10.8, fmtN(it.discountPct), R],
          [170.1, 29.9, fmtN(it.total), R],
        ]),
      );
    }
    // Group footer: Σ qty & Σ line totals, then Pot. / Pajak / Biaya / Total Akhir of the note.
    body.push({
      mode: 'fixed',
      height: 15.1,
      size: 9,
      lines: [
        { x: 85.9, w: 113.2, y: 0.25, dotted: true },
        { x: 2.5, w: 197.4, y: 13.45, dotted: true },
      ],
      texts: [
        { x: 102.1, y: 0.8, w: 16.1, h: 4.5, size: 8, align: R, text: fmtN(sum(its.map((i) => i.qty))) },
        { x: 170.1, y: 0.8, w: 29.9, h: 4.5, size: 8, align: R, text: fmtN(sum(its.map((i) => i.total))) },
        { x: 2.6, y: 7.3, w: 20.3, h: 5.3, text: 'Pot. :', align: R, bold: true, middle: true },
        { x: 22.9, y: 7.3, w: 24.4, h: 5.3, text: fmtN(s.discount), align: R, middle: true },
        { x: 47.2, y: 7.3, w: 16.2, h: 5.3, text: 'Pajak :', align: R, bold: true, middle: true },
        { x: 63.5, y: 7.3, w: 26.3, h: 5.3, text: fmtN(s.tax), align: R, middle: true },
        { x: 89.7, y: 7.3, w: 16.2, h: 5.3, text: 'Biaya :', align: R, bold: true, middle: true },
        { x: 106.0, y: 7.3, w: 26.2, h: 5.3, text: fmtN(s.otherCharges), align: R, middle: true },
        { x: 132.2, y: 7.3, w: 31.4, h: 5.3, text: 'Total Akhir :', align: R, bold: true, middle: true },
        { x: 163.7, y: 7.3, w: 36.3, h: 5.3, text: fmtN(s.total), align: R, middle: true },
      ],
    });
  }
  body.push(
    ...totalLines(
      [
        ['Jumlah Item :', fmtN(t.itemCount)],
        ['Sub Total :', fmtN(t.subtotal)],
        ['Potongan :', fmtN(t.discount)],
        ['Pajak :', fmtN(t.tax)],
        ['Biaya Lain :', fmtN(t.otherCharges)],
        ['Total Akhir :', fmtN(t.total)],
      ],
      { labelX: 130.7, labelW: 32.0, valueX: 162.7, valueW: 36.4, width: 197.4, grandX: 85.9 },
    ),
  );
  return {
    orientation: 'portrait',
    reportHeader: reportHeader(r, {
      title: 'LAPORAN PENJUALAN DETAIL',
      titleW: 93.8,
      infoX: 120.1,
      infoW: 79.9,
      infoY: 1.1,
    }),
    pageHeader: captionBand(197.4, [
      [2.6, 31.8, 'No Transaksi', L],
      [34.4, 23.1, 'Tanggal', L],
      [57.5, 12.6, 'Dept.', L],
      [70.0, 22.2, 'Kode Pel.', L],
      [92.3, 42.2, 'Nama Pelanggan', L],
      [134.4, 65.5, 'Alamat', L],
    ]),
    body,
    pageFooter: pageFooter(r, 'portrait', printedAt),
  };
}

// --------------------------------------------------- Harian and Jual Per Pelanggan (portrait)

const ZERO = fmtN('0');

/** The TOTAL line under Harian / Per Pelanggan: a 1.6 mm line, then the sums at y 2.9. */
function sumBand(label: { x: number; text: string }, cells: [number, number, string][], size: number): PrintBand {
  return {
    mode: 'fixed',
    height: 9.5,
    size,
    lines: [{ x: 2.6, w: 196.6, y: 0.8 }],
    texts: [
      {
        x: label.x,
        y: 2.9,
        w: 30.1,
        h: 5.3,
        text: label.text,
        size: 9,
        bold: true,
        italic: true,
        align: R,
        middle: true,
      },
      ...cells.map(([x, w, text]) => ({ x, y: 2.9, w, h: 5.3, text, align: R, middle: true, nowrap: true })),
    ],
  };
}

function harian(r: SalesPrintReport, printedAt: Date): PrintReport {
  const t = r.totals;
  return {
    orientation: 'portrait',
    reportHeader: reportHeader(r, {
      title: 'LAPORAN PENJUALAN HARIAN',
      titleW: 75.8,
      infoX: 116.4,
      infoW: 82.8,
      infoY: 0.8,
    }),
    pageHeader: captionBand(196.6, [
      [2.9, 28.9, 'Tanggal', L],
      [31.8, 20.4, 'Jml Trs', R],
      [52.1, 28.6, 'Total Transaksi', R],
      [81.1, 28.6, 'Jml Bayar Tunai', R],
      [109.7, 28.6, 'Jml Bayar Kredit', R],
      [138.3, 30.5, 'Jml Bayar K.Debit', R],
      [168.8, 30.5, 'Jml Bayar K.Kredit', R],
    ]),
    body: [
      ...r.days.map((d) =>
        row([
          [2.9, 28.9, fmtDate(d.date)],
          [31.8, 20.4, fmtN(d.count), R],
          [52.1, 28.6, fmtN(d.total), R],
          [81.1, 28.6, fmtN(d.paidCash), R],
          [109.7, 28.6, fmtN(d.paidCredit), R],
          [138.3, 30.5, ZERO, R],
          [168.8, 30.5, ZERO, R],
        ]),
      ),
      sumBand(
        { x: 1.6, text: 'TOTAL :' },
        [
          [31.8, 20.4, fmtN(t.count)],
          [52.1, 28.6, fmtN(t.total)],
          [80.7, 29.0, fmtN(t.paidCash)],
          [109.7, 28.6, fmtN(t.paidCredit)],
          [138.3, 30.5, ZERO],
          [168.8, 30.5, ZERO],
        ],
        9,
      ),
    ],
    pageFooter: pageFooter(r, 'portrait', printedAt),
  };
}

const MONEY_COLS: [number, number][] = [
  [61.4, 26.2],
  [88.3, 26.2],
  [115.3, 26.2],
  [142.3, 28.1],
  [171.1, 28.1],
];
const moneyCells = (total: string, cash: string, credit: string): [number, number, string][] =>
  [total, cash, credit, '0', '0'].map((v, i) => [MONEY_COLS[i]![0], MONEY_COLS[i]![1], fmtN(v)]);

const PELANGGAN_MONEY_CAPTIONS: Col[] = [
  [61.4, 26.2, 'Total Transaksi', R],
  [88.3, 26.2, 'Jml Bayar Tunai', R],
  [115.3, 26.2, 'Jml Bayar Kredit', R],
  [142.3, 28.1, 'Jml Bayar K.Debit', R],
  [171.1, 28.1, 'Jml Bayar K.Kredit', R],
];

const PELANGGAN_HEADER: HeaderSpec = {
  title: 'LAPORAN JUAL PER PELANGGAN',
  titleW: 75.8,
  infoX: 116.4,
  infoW: 82.8,
  infoY: 0.8,
};

function pelangganRekap(r: SalesPrintReport, printedAt: Date): PrintReport {
  const t = r.totals;
  return {
    orientation: 'portrait',
    reportHeader: reportHeader(r, PELANGGAN_HEADER),
    pageHeader: captionBand(196.6, [[5.6, 55.9, 'Pelanggan', L], ...PELANGGAN_MONEY_CAPTIONS]),
    body: [
      ...r.customers.map((c) =>
        row([
          [5.6, 55.9, c.name],
          ...moneyCells(c.total, c.paidCash, c.paidCredit).map(
            ([x, w, v]) => [x, w, v, R] as [number, number, string, Align],
          ),
        ]),
      ),
      sumBand({ x: 31.3, text: 'TOTAL :' }, moneyCells(t.total, t.paidCash, t.paidCredit), 8),
    ],
    pageFooter: pageFooter(r, 'portrait', printedAt),
  };
}

function pelangganDetail(r: SalesPrintReport, printedAt: Date): PrintReport {
  const t = r.totals;
  const groups: { name: string; notes: SalesPrintInvoice[] }[] = [];
  for (const s of r.invoices) {
    const last = groups[groups.length - 1];
    // iPOS groups on the customer name (GroupField namapel)
    if (last && last.name === s.customerName) last.notes.push(s);
    else groups.push({ name: s.customerName, notes: [s] });
  }
  const body: PrintBand[] = [];
  for (const g of groups) {
    body.push({
      mode: 'fixed',
      height: 6.35,
      size: 9,
      keepWithNext: true,
      texts: [
        { x: 2.9, y: 0, w: 20.9, h: 5.3, text: 'Pelanggan :', bold: true, middle: true, nowrap: true },
        { x: 23.8, y: 0, w: 175.4, h: 5.3, text: g.name, bold: true, middle: true, nowrap: true },
      ],
    });
    for (const s of g.notes) {
      body.push(
        row([
          [5.6, 34.0, s.number],
          [39.6, 21.8, fmtDate(s.date)],
          ...moneyCells(s.total, s.paidCash, s.paidCredit).map(
            ([x, w, v]) => [x, w, v, R] as [number, number, string, Align],
          ),
        ]),
      );
    }
    body.push({
      mode: 'fixed',
      height: 10.6,
      size: 8,
      lines: [{ x: 31.3, w: 168.2, y: 0.8, dotted: true }],
      texts: [
        {
          x: 31.3,
          y: 2.1,
          w: 30.1,
          h: 5.3,
          text: 'SUB TOTAL :',
          size: 9,
          bold: true,
          italic: true,
          align: R,
          middle: true,
        },
        ...moneyCells(
          sum(g.notes.map((n) => n.total)),
          sum(g.notes.map((n) => n.paidCash)),
          sum(g.notes.map((n) => n.paidCredit)),
        ).map(([x, w, text]) => ({ x, y: 2.1, w, h: 5.3, text, align: R, middle: true, nowrap: true })),
      ],
    });
  }
  body.push(sumBand({ x: 31.3, text: 'TOTAL :' }, moneyCells(t.total, t.paidCash, t.paidCredit), 8));
  return {
    orientation: 'portrait',
    reportHeader: reportHeader(r, PELANGGAN_HEADER),
    pageHeader: captionBand(196.6, [
      [5.6, 34.0, 'No Transaksi', L],
      [39.6, 21.8, 'Tanggal', L],
      ...PELANGGAN_MONEY_CAPTIONS,
    ]),
    body,
    pageFooter: pageFooter(r, 'portrait', printedAt),
  };
}

// ------------------------------------------------------------------- Laporan Jual Per Retur

function retur(r: SalesPrintReport, printedAt: Date): PrintReport {
  const t = r.totals;
  const rt = r.returnTotals;
  const body: PrintBand[] = [];
  for (const s of r.invoices) {
    const its = r.returns.filter((x) => x.saleId === s.id);
    body.push({
      ...row([
        [2.6, 29.2, s.number],
        [31.8, 22.8, fmtDate(s.date)],
        [54.5, 16.4, ''],
        [70.9, 26.4, s.customerCode],
        [97.3, 16.8, fmtN(s.itemCount), R],
        [114.1, 28.8, fmtN(s.subtotal), R],
        [142.9, 20.4, fmtN(s.discountPct), R],
        [163.3, 28.1, fmtN(s.tax), R],
        [191.8, 28.1, fmtN(s.otherCharges), R],
        [219.9, 32.6, fmtN(s.paidCash), R],
        [252.5, 34.3, fmtN(s.total), R],
      ]),
      keepWithNext: its.length > 0,
    });
    // The iPOS sub-report band repeats its captions for every return of the note.
    for (const x of its) {
      body.push({
        mode: 'fixed',
        height: 21.2,
        size: 8,
        lines: [
          { x: 56.3, w: 178.5, y: 4.0 },
          { x: 56.2, w: 178.5, y: 16.5 },
        ],
        texts: [
          ...(
            [
              [56.2, 32.0, 'No Transaksi Retur', L],
              [88.2, 25.1, 'Tanggal', L],
              [113.3, 28.4, 'Dept.', L],
              [141.8, 31.0, 'Kode Pel.', L],
              [172.7, 31.5, 'Jml Item', R],
              [204.2, 30.6, 'Total', R],
            ] as Col[]
          ).map(([cx, w, text, align]) => ({
            x: cx,
            w,
            y: 5.6,
            h: 5.3,
            text,
            align,
            bold: true,
            size: 9,
            middle: true,
          })),
          { x: 56.2, y: 10.9, w: 31.8, h: 4.5, text: x.number },
          { x: 88.2, y: 10.9, w: 25.1, h: 4.5, text: fmtDate(x.date) },
          { x: 141.8, y: 10.9, w: 31.0, h: 4.5, text: x.customerCode },
          { x: 172.7, y: 10.9, w: 31.5, h: 4.5, text: fmtN(x.itemCount), align: R },
          { x: 204.4, y: 10.9, w: 30.6, h: 4.5, text: fmtN(x.total), align: R },
        ],
      });
    }
  }
  body.push(
    ...totalLines(
      [
        ['Jumlah Item Penjualan:', fmtN(t.itemCount)],
        ['Jumlah Item Retur :', fmtN(rt.itemCount)],
        ['Sub Total :', fmtN(t.subtotal)],
        ['Potongan :', fmtN(t.discount)],
        ['Pajak :', fmtN(t.tax)],
        ['Biaya Lain :', fmtN(t.otherCharges)],
        ['Bayar Tunai :', fmtN(t.paidCash)],
        ['Total Jual :', fmtN(t.total)],
        ['Total Retur :', fmtN(rt.total)],
        ['Total Akhir :', fmtN(dec(t.total).minus(rt.total).toFixed(2))],
      ],
      { labelX: 208.3, labelW: 44.3, valueX: 252.6, valueW: 36.4, width: 284.2, grandX: 165.2 },
    ),
  );
  return {
    orientation: 'landscape',
    reportHeader: reportHeader(r, {
      title: 'LAPORAN PENJUALAN Per Retur',
      titleW: 75.8,
      infoX: 204.0,
      infoW: 82.8,
      infoY: 1.1,
    }),
    pageHeader: captionBand(
      284.2,
      [
        [2.6, 29.2, 'No Transaksi', L],
        [31.8, 22.8, 'Tanggal', L],
        [54.5, 16.4, 'Dept', L],
        [70.9, 26.4, 'Kode Pel.', L],
        [97.3, 16.7, 'Jml Item', R],
        [114.0, 28.9, 'Sub Total', R],
        [142.9, 20.4, 'Pot. %', R],
        [163.3, 28.1, 'Pajak', R],
        [191.4, 28.5, 'Biaya Lain', R],
        [219.9, 32.6, 'Bayar', R],
        [252.5, 34.3, 'Total', R],
      ],
      true,
    ),
    body,
    pageFooter: pageFooter(r, 'landscape', printedAt),
  };
}

const LAYOUTS: Record<SalesPrintReport['type'], (r: SalesPrintReport, printedAt: Date) => PrintReport> = {
  rekap,
  detail,
  harian,
  'pelanggan-detail': pelangganDetail,
  'pelanggan-rekap': pelangganRekap,
  retur,
};

export function salesPrintLayout(r: SalesPrintReport, printedAt = new Date()): PrintReport {
  return LAYOUTS[r.type](r, printedAt);
}
