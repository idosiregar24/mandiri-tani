// Minimal ESC/P encoder for the Epson LX-310 (9-pin dot matrix) — PRD §8.1.
// Plain text in the printer's own fonts: fast, sharp, prints through carbon copies.
// Knows nothing about documents; DocumentBuilders decide what to print.

import { toPrinterText } from '@shared/text-layout';

const ESC = 0x1b;

export { fitLeft, fitRight, toPrinterText, wrap } from '@shared/text-layout';

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

  /**
   * ESC * 1 — one 8-dot band of bit image at 120 dpi (double density; 9-pin printers all have
   * it). One byte per dot column, MSB = top pin. The print head moves right by the image width,
   * so text sent next on the same line prints after it.
   */
  bitImage(columns: ArrayLike<number>): this {
    const n = columns.length;
    this.raw(ESC, 0x2a, 1, n & 0xff, n >> 8);
    for (let i = 0; i < n; i++) this.out.push(columns[i]! & 0xff);
    return this;
  }

  /** CR: back to the left margin without feeding paper. */
  carriageReturn(): this {
    return this.raw(0x0d);
  }

  /** ESC J n — feed paper n/216 inch now (no line-spacing change). */
  feed216(n: number): this {
    return this.raw(ESC, 0x4a, n);
  }

  /** ESC U — one-direction printing so bit-image bands line up exactly. */
  unidirectional(on: boolean): this {
    return this.raw(ESC, 0x55, on ? 1 : 0);
  }

  /** Advance to the next perforation (top of next form). */
  formFeed(): this {
    return this.raw(0x0c);
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}
