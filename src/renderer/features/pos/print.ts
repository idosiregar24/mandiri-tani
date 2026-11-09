// Prints a saved sale (golden rule 1: only after the API committed it). KSR → thermal struk,
// JL → LX-310 faktur. A failure never undoes the sale; the cashier gets "Cetak ulang".
import type { PrintDocument, PrintResult } from '@shared/printing';
import { cashierReceipt, type ReceiptStore, salesInvoice } from '@shared/receipts';
import type { Sale } from '@shared/schemas/sales';
import { desktopBridge, loadPrinterSettings } from '@/lib/desktop';

/** Exactly what printSale sends — also used by the print preview. */
export async function saleDocument(
  sale: Sale,
  store: ReceiptStore,
  opts: { copy?: boolean } = {},
): Promise<PrintDocument> {
  const printers = await loadPrinterSettings();
  return sale.channel === 'KASIR'
    ? cashierReceipt(sale, store, { columns: printers.struk.columns, copy: opts.copy })
    : salesInvoice(sale, store, { linesPerPage: printers.faktur.linesPerPage, copy: opts.copy });
}

export async function printSale(sale: Sale, store: ReceiptStore, opts: { copy?: boolean } = {}): Promise<PrintResult> {
  const pos = desktopBridge();
  if (!pos) return { ok: false, code: 'UNSUPPORTED', message: 'Cetak hanya bisa dari aplikasi di komputer kasir.' };
  try {
    return await pos.printDocument(await saleDocument(sale, store, opts));
  } catch (err) {
    return { ok: false, code: 'PRINT_FAILED', message: 'Gagal mencetak.', detail: String(err) };
  }
}
