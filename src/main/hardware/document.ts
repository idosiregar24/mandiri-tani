// PrintDocument (lines from src/shared/receipts.ts) → printer bytes, per role (sprint-6 B2).
// struk → ESC/POS thermal; faktur → ESC/P Epson LX-310. Never one language to the other role.
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
    for (const l of page) {
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

function encodeFaktur(doc: PrintDocument, s: PrinterSettings['faktur']): Uint8Array {
  const w = new EscpWriter();
  for (const page of doc.pages) {
    w.start({ linesPerPage: s.linesPerPage, nlq: s.nlq, cpi: 12 });
    for (const l of page) {
      // ESC/P has no alignment command: pad to the 96-column line instead.
      const width = l.size === 2 ? FAKTUR_COLUMNS / 2 : FAKTUR_COLUMNS;
      const text =
        l.align === 'center'
          ? l.text.padStart(Math.floor((width + l.text.length) / 2))
          : l.align === 'right'
            ? l.text.padStart(width)
            : l.text;
      if (l.bold) w.bold(true);
      if (l.size === 2) w.doubleWidth(true);
      w.line(text);
      if (l.size === 2) w.doubleWidth(false);
      if (l.bold) w.bold(false);
    }
    w.formFeed(); // to the next perforation
  }
  return w.bytes();
}
