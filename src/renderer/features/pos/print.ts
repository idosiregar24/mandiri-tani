// Prints a saved sale (golden rule 1: only after the API committed it). KSR → thermal struk,
// JL → LX-310 faktur. A failure never undoes the sale; the cashier gets "Cetak ulang".
import { DEFAULT_PRINTER_SETTINGS, type PrintResult } from '@shared/printing';
import { cashierReceipt, salesInvoice } from '@shared/receipts';
import type { Sale } from '@shared/schemas/sales';
import type { StoreSettings } from '@shared/schemas/settings';
import { desktopBridge } from '@/lib/desktop';

export async function printSale(sale: Sale, store: StoreSettings, opts: { copy?: boolean } = {}): Promise<PrintResult> {
  const pos = desktopBridge();
  if (!pos) return { ok: false, code: 'UNSUPPORTED', message: 'Cetak hanya bisa dari aplikasi di komputer kasir.' };
  try {
    const printers = (await pos.getPrinterSettings().catch(() => null)) ?? DEFAULT_PRINTER_SETTINGS;
    const doc =
      sale.channel === 'KASIR'
        ? cashierReceipt(sale, store, { columns: printers.struk.columns, copy: opts.copy })
        : salesInvoice(sale, store, { linesPerPage: printers.faktur.linesPerPage, copy: opts.copy });
    return await pos.printDocument(doc);
  } catch (err) {
    return { ok: false, code: 'PRINT_FAILED', message: 'Gagal mencetak.', detail: String(err) };
  }
}
