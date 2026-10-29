// Minimal ESC/P encoder for the Epson LX-310 (9-pin dot matrix) — PRD §8.1.
// Plain text in the printer's own fonts: fast, sharp, prints through carbon copies.
// Knows nothing about documents; DocumentBuilders decide what to print.

const ESC = 0x1b;

/** PC437 has no accented letters we need: strip diacritics, replace the rest with '?'. */
export function toPrinterText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7e]/g, '?');
}

export { fitLeft, fitRight, wrap } from '@shared/text-layout';

export interface PageSetup {
  linesPerPage: number;
  nlq: boolean;
  cpi: 10 | 12;
}

export class EscpWriter {
  private readonly out: number[] = [];

  private raw(...bytes: number[]): this {
    this.out.push(...bytes);
    return this;
  }

  /** ESC @ reset, PC437 table, 1/6" line spacing, page length, quality, pitch. */
  start(setup: PageSetup): this {
    return this.raw(ESC, 0x40)
      .raw(ESC, 0x74, 0x01)
      .raw(ESC, 0x32)
      .raw(ESC, 0x43, setup.linesPerPage)
      .quality(setup.nlq)
      .pitch(setup.cpi);
  }

  text(text: string): this {
    for (const ch of toPrinterText(text)) this.out.push(ch.charCodeAt(0));
    return this;
  }

  line(text = ''): this {
    return this.text(text).raw(0x0d, 0x0a);
  }

  bold(on: boolean): this {
    return on ? this.raw(ESC, 0x45) : this.raw(ESC, 0x46);
  }

  doubleWidth(on: boolean): this {
    return this.raw(ESC, 0x57, on ? 1 : 0);
  }

  pitch(cpi: 10 | 12): this {
    return cpi === 12 ? this.raw(ESC, 0x4d) : this.raw(ESC, 0x50);
  }

  condensed(on: boolean): this {
    return this.raw(on ? 0x0f : 0x12);
  }

  quality(nlq: boolean): this {
    return this.raw(ESC, 0x78, nlq ? 1 : 0);
  }

  /** NLQ typeface: 0 = Roman, 1 = Sans Serif. */
  typeface(face: 0 | 1): this {
    return this.raw(ESC, 0x6b, face);
  }

  /** Advance to the next perforation (top of next form). */
  formFeed(): this {
    return this.raw(0x0c);
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}
