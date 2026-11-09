// Print preview layout: a PrintDocument → what lands on paper, in `ch` units of a monospace
// font (1ch = one printed character). Mirrors src/main/hardware/document.ts (same padding,
// same transliteration, same logo placement) so the preview matches the printout.
import type { MonoBitmap } from '@shared/logo';
import { FAKTUR_DOTS_PER_COLUMN, FAKTUR_DOTS_PER_LINE } from '@shared/logo';
import type { PrintDocument, PrinterSettings, PrintLine } from '@shared/printing';
import { FAKTUR_COLUMNS } from '@shared/receipts';
import { toPrinterText } from '@shared/text-layout';

/** Thermal font A: 12 dots per character, 30-dot default line spacing. */
const STRUK_DOTS_PER_CHAR = 12;
const STRUK_LINE_CH = 2.5;
/** LX-310 at 12 cpi / 6 lpi: a line (1/6") is twice as tall as a character is wide (1/12"). */
const FAKTUR_LINE_CH = 2;

export interface PreviewLine {
  /** Already padded for alignment and transliterated like the printer does. */
  text: string;
  bold: boolean;
  /** Struk: double width + height. Faktur: double width. */
  double: boolean;
}

export type PreviewLogo =
  | { kind: 'overlay'; bitmap: MonoBitmap; topCh: number; widthCh: number; heightCh: number }
  | { kind: 'block'; bitmap: MonoBitmap; beforeLine: number; widthCh: number; heightCh: number };

export interface PreviewLayout {
  role: PrintDocument['role'];
  /** Characters per line of the paper. */
  columns: number;
  /** Height of one text line, in ch. */
  lineCh: number;
  /** Faktur: lines per continuous form (page height); struk: null (roll paper). */
  formLines: number | null;
  /** Struk: the printer cuts after each page. */
  cut: boolean;
  logo: PreviewLogo | null;
  pages: PreviewLine[][];
}

function padAligned(l: PrintLine, columns: number): string {
  const width = l.size === 2 ? Math.floor(columns / 2) : columns;
  const text = toPrinterText(l.text);
  if (l.align === 'center') return text.padStart(Math.floor((width + text.length) / 2));
  if (l.align === 'right') return text.padStart(width);
  return text;
}

export function previewLayout(doc: PrintDocument, printers: PrinterSettings): PreviewLayout {
  const faktur = doc.role === 'faktur';
  const columns = faktur ? FAKTUR_COLUMNS : printers.struk.columns;
  let logo: PreviewLogo | null = null;
  if (doc.logo) {
    const { bitmap, line, columns: logoColumns } = doc.logo;
    logo = faktur
      ? logoColumns > 0
        ? {
            kind: 'overlay',
            bitmap,
            topCh: line * FAKTUR_LINE_CH,
            widthCh: bitmap.width / FAKTUR_DOTS_PER_COLUMN,
            heightCh: (bitmap.height / FAKTUR_DOTS_PER_LINE) * FAKTUR_LINE_CH,
          }
        : null
      : {
          kind: 'block',
          bitmap,
          beforeLine: line,
          widthCh: bitmap.width / STRUK_DOTS_PER_CHAR,
          heightCh: bitmap.height / STRUK_DOTS_PER_CHAR,
        };
  }
  return {
    role: doc.role,
    columns,
    lineCh: faktur ? FAKTUR_LINE_CH : STRUK_LINE_CH,
    formLines: faktur ? printers.faktur.linesPerPage : null,
    cut: !faktur && printers.struk.cut,
    logo,
    pages: doc.pages.map((page) =>
      page.map((l) => ({ text: padAligned(l, columns), bold: l.bold ?? false, double: l.size === 2 })),
    ),
  };
}
