// Minimal ESC/POS encoder for the cashier's thermal receipt printer (KSR struk) —
// PRD §8.1. Same plain-text approach as the ESC/P encoder: printer fonts, no graphics.
import { toPrinterText } from './escp';

const ESC = 0x1b;
const GS = 0x1d;

export type Align = 'left' | 'center' | 'right';

export class EscPosWriter {
  private readonly out: number[] = [];

  private raw(...bytes: number[]): this {
    this.out.push(...bytes);
    return this;
  }

  /** ESC @ reset, PC437 code page, standard font A, left aligned. */
  start(): this {
    return this.raw(ESC, 0x40).raw(ESC, 0x74, 0x00).raw(ESC, 0x4d, 0x00).align('left');
  }

  text(text: string): this {
    for (const ch of toPrinterText(text)) this.out.push(ch.charCodeAt(0));
    return this;
  }

  line(text = ''): this {
    return this.text(text).raw(0x0a);
  }

  align(align: Align): this {
    return this.raw(ESC, 0x61, align === 'left' ? 0 : align === 'center' ? 1 : 2);
  }

  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  /** GS ! — width/height multipliers 1–2 (store name, TOTAL). */
  size(width: 1 | 2, height: 1 | 2): this {
    return this.raw(GS, 0x21, ((width - 1) << 4) | (height - 1));
  }

  /** Feed n lines. */
  feed(lines: number): this {
    return this.raw(ESC, 0x64, lines);
  }

  /** Feed to the cutter and cut (partial). Printers without a cutter ignore it. */
  cut(): this {
    return this.raw(GS, 0x56, 66, 3);
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}
