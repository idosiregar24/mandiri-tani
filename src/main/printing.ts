// Printer IPC (desktop-runtime §4–5): list Windows printers, print the test pages.
// Two roles: faktur → Epson LX-310 (ESC/P), struk → thermal receipt printer (ESC/POS).
import type { WebContents } from 'electron';
import type { Logger } from 'pino';
import { PrintTestRequest, type PrinterInfo, type PrintResult } from '@shared/printing';
import { buildStrukTestPages } from './hardware/struk-test-pages';
import { buildTestPages } from './hardware/test-pages';
import { listWindowsPrinters, RawPrintError, sendRaw } from './hardware/windows-raw';

const LX310_RE = /LX-?310/i;
const RECEIPT_RE = /POS-?\d|TM-|XP-|thermal|receipt|struk|58 ?mm|80 ?mm|Xprinter|EPPOS|Zjiang|Blueprint|RP-?\d/i;

export async function listPrinters(contents: WebContents): Promise<PrinterInfo[]> {
  const electronList = await contents.getPrintersAsync();
  const defaults = new Set(
    electronList
      .filter((p) => ((p.options ?? {}) as Record<string, string>)['is-default'] === 'true' || (p as { isDefault?: boolean }).isDefault)
      .map((p) => p.name),
  );
  let list: PrinterInfo[];
  try {
    // Windows knows port and status; Electron does not. A store PC can have several
    // queues for one printer (e.g. a dead LPT1 one and the real USB one).
    list = (await listWindowsPrinters()).map((p) => {
      const haystack = `${p.name} ${p.driver}`;
      return {
        name: p.name,
        displayName: p.name,
        isDefault: defaults.has(p.name),
        isLx310: LX310_RE.test(haystack),
        isReceipt: RECEIPT_RE.test(haystack),
        port: p.port,
        status: p.status,
        ready: /^normal$/i.test(p.status),
      };
    });
  } catch {
    list = electronList.map((p) => {
      const haystack = `${p.name} ${p.displayName} ${p.description}`;
      return {
        name: p.name,
        displayName: p.displayName || p.name,
        isDefault: defaults.has(p.name),
        isLx310: LX310_RE.test(haystack),
        isReceipt: RECEIPT_RE.test(haystack),
        port: '',
        status: '',
        ready: true,
      };
    });
  }
  return list.sort((a, b) => Number(b.ready) - Number(a.ready) || a.displayName.localeCompare(b.displayName));
}

export async function printTest(contents: WebContents, payload: unknown, helperDir: string, logger: Logger): Promise<PrintResult> {
  const parsed = PrintTestRequest.safeParse(payload);
  if (!parsed.success) return { ok: false, code: 'INVALID_REQUEST', message: 'Permintaan cetak tidak valid.' };
  const req = parsed.data;

  // Only queues Windows actually has — never an arbitrary string from the UI.
  const printers = await listPrinters(contents);
  if (!printers.some((p) => p.name === req.printer)) {
    return { ok: false, code: 'PRINTER_NOT_FOUND', message: `Printer "${req.printer}" tidak ditemukan di Windows.` };
  }

  const bytes =
    req.role === 'faktur'
      ? buildTestPages(req.page, { linesPerPage: req.linesPerPage, nlq: req.nlq })
      : buildStrukTestPages(req.page, { columns: req.columns, cut: req.cut });
  const started = Date.now();
  try {
    await sendRaw(req.printer, bytes, { helperDir, docName: `Uji cetak Mandiri Tani POS - ${req.page}` });
    const ms = Date.now() - started;
    logger.info({ ...req, bytes: bytes.length, ms }, 'test print sent');
    return { ok: true, bytes: bytes.length, ms };
  } catch (err) {
    const detail = err instanceof RawPrintError ? err.detail : String(err);
    logger.error({ printer: req.printer, page: req.page, detail }, 'test print failed');
    return {
      ok: false,
      code: 'PRINT_FAILED',
      message: err instanceof RawPrintError ? err.message : 'Gagal mencetak.',
      detail,
    };
  }
}
