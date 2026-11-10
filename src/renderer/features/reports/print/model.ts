// A printed A4 report the way iPOS 5 (DevExpress XtraReports) lays it out: a Report Header on the
// first page, a Page Header and Page Footer on every page, and body bands in between. Positions
// and sizes are in millimetres, copied from the iPOS .repx templates (1/10 mm units there), so a
// printout lines up with the store's old iPOS reports.
import { dec } from '@shared/money';

export type Align = 'left' | 'right' | 'center';

export interface PrintText {
  /** mm from the left edge of the printable area (inside the page margin). */
  x: number;
  w: number;
  /** Fixed bands only: mm from the top of the band. */
  y?: number;
  h?: number;
  text: string;
  align?: Align;
  /** Fixed bands: vertical placement inside h (iPOS "Middle…" vs "Top…"). */
  middle?: boolean;
  /** Font size in pt (Arial). */
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Keep on one line even when it is wider than w (titles, company name). */
  nowrap?: boolean;
}

export interface PrintLine {
  x: number;
  w: number;
  /** mm from the top of the band (centre of the line). */
  y: number;
  dotted?: boolean;
}

export interface PrintImage {
  x: number;
  y: number;
  w: number;
  h: number;
  src: string;
}

export interface PrintBand {
  /**
   * fixed: exactly `height` tall, every text placed at its x/y.
   * flow: one line of texts from the top, at least `height` tall, growing when a text wraps
   * (iPOS Detail band with CanGrow labels).
   */
  mode: 'fixed' | 'flow';
  height: number;
  texts: PrintText[];
  lines?: PrintLine[];
  images?: PrintImage[];
  /** Font size (pt) for texts that do not set one. */
  size?: number;
  /** Never end a page with this band (group headers, column captions). */
  keepWithNext?: boolean;
}

export type Orientation = 'portrait' | 'landscape';

export interface PrintReport {
  /** Orientation of the iPOS template (Rekap and Per Retur are landscape). */
  orientation: Orientation;
  reportHeader: PrintBand;
  pageHeader: PrintBand;
  body: PrintBand[];
  /** Built per page: date/time, user and "n/m". */
  pageFooter: (page: number, pages: number) => PrintBand;
}

// ------------------------------------------------------------------------------- paper

export const PAPERS = {
  A4: { label: 'A4', w: 210, h: 297 },
  F4: { label: 'F4 / Folio', w: 215, h: 330 },
  LETTER: { label: 'Letter', w: 215.9, h: 279.4 },
} as const;
export type PaperKind = keyof typeof PAPERS;

/** iPOS templates: Margins(38, 38, 38, 38) in 1/10 mm. */
export const PAGE_MARGIN_MM = 3.8;

export function pageSize(paper: PaperKind, orientation: Orientation): { w: number; h: number } {
  const p = PAPERS[paper];
  return orientation === 'landscape' ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
}

// ------------------------------------------------------------------------------ format

/**
 * .NET "{0:n}" in the Indonesian culture iPOS runs in: thousands ".", decimals ",", always two
 * decimals — "1.200.000,00", "0,79", "-5.000,00".
 */
export function fmtN(value: string | number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || value === '') return '';
  const d = dec(value);
  const fixed = d.abs().toFixed(decimals);
  const [int, frac] = fixed.split('.');
  const sign = d.isNegative() && !dec(fixed).isZero() ? '-' : '';
  return `${sign}${int!.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${frac ? `,${frac}` : ''}`;
}

/** "2026-04-01" → "01/04/2026" (iPOS {0:dd/MM/yyyy}). */
export function fmtDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** Print time in the page footer: "04/09/2026 09:45" (WIB). */
export function fmtPrintedAt(d: Date): string {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

/** Σ of decimal strings, exact. */
export function sum(values: string[]): string {
  return values.reduce((a, v) => a.plus(v), dec(0)).toFixed(2);
}

// --------------------------------------------------------------------------- paginate

export interface PageSlice {
  /** Indexes into PrintReport.body. */
  bands: number[];
}

/**
 * Fills pages like DevExpress: page 1 = report header + page header + body, the next pages =
 * page header + body; the page footer is reserved at the bottom of every page. A band never splits;
 * a keepWithNext band moves to the next page together with the band after it.
 */
export function paginate(
  bodyHeights: number[],
  keepWithNext: boolean[],
  space: { first: number; other: number },
): PageSlice[] {
  const pages: PageSlice[] = [{ bands: [] }];
  let left = space.first;
  const fits = (i: number) => {
    let need = bodyHeights[i]!;
    // a chain of keep-with-next bands plus the band that ends the chain
    for (let j = i; keepWithNext[j] && j + 1 < bodyHeights.length; j++) need += bodyHeights[j + 1]!;
    return need <= left + 0.01;
  };
  for (let i = 0; i < bodyHeights.length; i++) {
    const current = pages[pages.length - 1]!;
    const chainStart = i === 0 || !keepWithNext[i - 1];
    if (current.bands.length > 0 && chainStart && !fits(i)) {
      pages.push({ bands: [] });
      left = space.other;
    } else if (current.bands.length > 0 && bodyHeights[i]! > left + 0.01) {
      pages.push({ bands: [] });
      left = space.other;
    }
    pages[pages.length - 1]!.bands.push(i);
    left -= bodyHeights[i]!;
  }
  return pages;
}
