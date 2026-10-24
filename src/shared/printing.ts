// Printing contract between renderer and main (PRD §8.1, desktop-runtime §5).
// The store has TWO printers:
//  - faktur: Epson LX-310 dot matrix (ESC/P), continuous form 9.5" x 5.5" — JL faktur, bukti AB
//  - struk:  thermal receipt printer (ESC/POS), roll paper — KSR cashier receipts
import { z } from 'zod';

export const PRINTER_ROLES = ['faktur', 'struk'] as const;
export type PrinterRole = (typeof PRINTER_ROLES)[number];

export const FAKTUR_TEST_PAGES = ['pola', 'font', 'faktur', 'semua'] as const;
export const STRUK_TEST_PAGES = ['struk-pola', 'struk-contoh'] as const;
export type FakturTestPage = (typeof FAKTUR_TEST_PAGES)[number];
export type StrukTestPage = (typeof STRUK_TEST_PAGES)[number];
export type TestPage = FakturTestPage | StrukTestPage;

export const TEST_PAGE_LABELS: Record<TestPage, string> = {
  pola: 'Pola posisi kertas',
  font: 'Uji font',
  faktur: 'Contoh faktur',
  semua: 'Semua halaman uji',
  'struk-pola': 'Pola lebar struk',
  'struk-contoh': 'Contoh struk kasir',
};

export const PrintTestRequest = z.discriminatedUnion('role', [
  z.object({
    role: z.literal('faktur'),
    printer: z.string().min(1).max(256),
    page: z.enum(FAKTUR_TEST_PAGES),
    /** Lines per half page at 6 lpi: 33 for 5.5" paper (PRD §8.1). */
    linesPerPage: z.number().int().min(10).max(99),
    nlq: z.boolean(),
  }),
  z.object({
    role: z.literal('struk'),
    printer: z.string().min(1).max(256),
    page: z.enum(STRUK_TEST_PAGES),
    /** Characters per line: 32 (58 mm) … 48 (80 mm). */
    columns: z.number().int().min(24).max(64),
    cut: z.boolean(),
  }),
]);
export type PrintTestRequest = z.infer<typeof PrintTestRequest>;

/**
 * The machine's official printer configuration (PRD FR-SYS-05). Per PC — Windows queue
 * names differ between machines — stored in %APPDATA%/pos-desktop/config.json.
 */
export const PrinterSettings = z.object({
  faktur: z.object({
    printer: z.string().min(1).max(256).nullable(),
    linesPerPage: z.number().int().min(10).max(99),
    nlq: z.boolean(),
  }),
  struk: z.object({
    printer: z.string().min(1).max(256).nullable(),
    columns: z.number().int().min(24).max(64),
    cut: z.boolean(),
  }),
});
export type PrinterSettings = z.infer<typeof PrinterSettings>;

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  faktur: { printer: null, linesPerPage: 33, nlq: false },
  struk: { printer: null, columns: 48, cut: true },
};

export interface PrinterInfo {
  name: string;
  displayName: string;
  isDefault: boolean;
  /** Looks like the store's Epson LX-310 (by name or driver). */
  isLx310: boolean;
  /** Looks like a thermal receipt printer (POS-58/80, TM-, XP-, …). */
  isReceipt: boolean;
  /** Windows port, e.g. USB003, LPT1:, an IP — empty when unknown. */
  port: string;
  /** Windows printer status, e.g. Normal, Error, Offline. */
  status: string;
  /** Status Normal — a queue on a dead port (LPT1 with nothing attached) shows Error. */
  ready: boolean;
}

/** Virtual queues that can never be the store's faktur or struk printer. */
const VIRTUAL_RE = /PDF|OneNote|XPS|AnyDesk|Fax|Send To/i;

/**
 * Best queue for a role, or undefined. Faktur: the LX-310 on a ready (preferably USB) port.
 * Struk: a ready receipt printer; failing that, any ready real printer that is not the LX-310.
 */
export function pickPrinter(list: PrinterInfo[], role: PrinterRole): PrinterInfo | undefined {
  const usb = (p: PrinterInfo) => (/^USB/i.test(p.port) ? 1 : 0);
  // The LX-310 is never auto-picked for receipts (ESC/POS bytes would print garbage on it);
  // the cashier can still choose any queue by hand.
  const candidates = list.filter((p) => !VIRTUAL_RE.test(p.name) && (role === 'faktur' || !p.isLx310));
  const score =
    role === 'faktur'
      ? (p: PrinterInfo) => (p.isLx310 ? 4 : 0) + (p.ready ? 2 : 0) + usb(p)
      : (p: PrinterInfo) => (p.isReceipt ? 4 : 0) + (p.ready ? 2 : 0) + usb(p);
  return [...candidates].sort((a, b) => score(b) - score(a))[0];
}

export type PrintResult =
  | { ok: true; bytes: number; ms: number }
  | { ok: false; code: 'PRINTER_NOT_FOUND' | 'PRINT_FAILED' | 'INVALID_REQUEST'; message: string; detail?: string };
