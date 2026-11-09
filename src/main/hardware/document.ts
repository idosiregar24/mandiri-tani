// PrintDocument (lines from src/shared/receipts.ts) → printer bytes, per role (sprint-6 B2).
// struk → ESC/POS thermal; faktur → ESC/P Epson LX-310. Never one language to the other role.
import { FAKTUR_DOTS_PER_COLUMN, FAKTUR_DOTS_PER_LINE, readBitmap } from '@shared/logo';
import type { PrintDocument, PrinterSettings } from '@shared/printing';
import { FAKTUR_COLUMNS } from '@shared/receipts';
import { EscpWriter } from './escp';
import { EscPosWriter } from './escpos';

export function encodeDocument(doc: PrintDocument, settings: PrinterSettings): Uint8Array {
  return doc.role === 'struk' ? encodeStruk(doc, settings.struk) : encodeFaktur(doc, settings.faktur);
}

function encodeStruk(doc: PrintDocument, s: PrinterSettings['struk']): Uint8Array {
  const w = new EscPosWriter().start();
  for (const page of doc.pages) {
    for (const [i, l] of page.entries()) {
      if (doc.logo && i === doc.logo.line) w.align('center').raster(doc.logo.bitmap);
      w.align(l.align ?? 'left');
      if (l.bold) w.bold(true);
      if (l.size === 2) w.size(2, 2);
      w.line(l.text);
      if (l.size === 2) w.size(1, 1);
      if (l.bold) w.bold(false);
    }
    w.align('left').feed(4);
    if (s.cut) w.cut();
  }
  return w.bytes();
}

/** One text line of the faktur logo: dot rows 0–7 (first pass) and 8–11 (second pass, or null if blank). */
interface LogoBand {
  top: Uint8Array;
  bottom: Uint8Array | null;
}

/** Cuts the logo into 12-dot bands, one per text line, exactly `columns` characters wide. */
function logoBands(logo: NonNullable<PrintDocument['logo']>): LogoBand[] {
  const dot = readBitmap(logo.bitmap);
  const width = logo.columns * FAKTUR_DOTS_PER_COLUMN;
  const bands: LogoBand[] = [];
  for (let y0 = 0; y0 < logo.bitmap.height; y0 += FAKTUR_DOTS_PER_LINE) {
    const top = new Uint8Array(width);
    const bottom = new Uint8Array(width);
    for (let x = 0; x < width; x++) {
      for (let r = 0; r < 8; r++) if (dot(x, y0 + r)) top[x] = top[x]! | (0x80 >> r);
      for (let r = 0; r < 4; r++) if (dot(x, y0 + 8 + r)) bottom[x] = bottom[x]! | (0x80 >> r);
    }
    bands.push({ top, bottom: bottom.some((b) => b !== 0) ? bottom : null });
  }
  return bands;
}

function encodeFaktur(doc: PrintDocument, s: PrinterSettings['faktur']): Uint8Array {
  const w = new EscpWriter();
  const logo = doc.logo && doc.logo.columns > 0 ? { ...doc.logo, bands: logoBands(doc.logo) } : null;
  for (const page of doc.pages) {
    w.start({ linesPerPage: s.linesPerPage, nlq: s.nlq, cpi: 12 });
    for (const [i, l] of page.entries()) {
      // ESC/P has no alignment command: pad to the 96-column line instead.
      const width = l.size === 2 ? FAKTUR_COLUMNS / 2 : FAKTUR_COLUMNS;
      let text =
        l.align === 'center'
          ? l.text.padStart(Math.floor((width + l.text.length) / 2))
          : l.align === 'right'
            ? l.text.padStart(width)
            : l.text;
      const band = logo ? logo.bands[i - logo.line] : undefined;
      if (logo && band) {
        // Logo + text in the first pass, the band's last 4 dot rows in a second pass;
        // 24 + 12 = 36/216" = exactly one 1/6" text line, so page length stays right.
        if (i === logo.line) w.unidirectional(true);
        w.bitImage(band.top);
        text = text.slice(logo.columns);
      }
      if (l.bold) w.bold(true);
      if (l.size === 2) w.doubleWidth(true);
      if (band) w.text(text);
      else w.line(text);
      if (l.size === 2) w.doubleWidth(false);
      if (l.bold) w.bold(false);
      if (band) {
        w.carriageReturn().feed216(24);
        if (band.bottom) w.bitImage(band.bottom).carriageReturn();
        w.feed216(12);
      }
    }
    if (logo) w.unidirectional(false);
    w.formFeed(); // to the next perforation
  }
  return w.bytes();
}
