// Prints a saved receivable payment (golden rule 1: only after the API committed it) on the
// LX-310 (PRD §8.1). A failure never undoes the payment; the screen offers to print again.
import type { PrintDocument, PrintResult } from '@shared/printing';
import { paymentReceipt, type ReceiptStore } from '@shared/receipts';
import type { PartyPayment } from '@shared/schemas/ar-ap';
import { desktopBridge } from '@/lib/desktop';

/** Exactly what printPayment sends — also used by the print preview. */
export function paymentDocument(
  payment: PartyPayment,
  store: ReceiptStore,
  opts: { copy?: boolean } = {},
): PrintDocument {
  return paymentReceipt(payment, store, opts);
}

export async function printPayment(
  payment: PartyPayment,
  store: ReceiptStore,
  opts: { copy?: boolean } = {},
): Promise<PrintResult> {
  const pos = desktopBridge();
  if (!pos) return { ok: false, code: 'UNSUPPORTED', message: 'Cetak hanya bisa dari aplikasi di komputer toko.' };
  try {
    return await pos.printDocument(paymentDocument(payment, store, opts));
  } catch (err) {
    return { ok: false, code: 'PRINT_FAILED', message: 'Gagal mencetak bukti bayar.', detail: String(err) };
  }
}
