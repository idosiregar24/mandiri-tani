// Prints a saved receivable payment (golden rule 1: only after the API committed it) on the
// LX-310 (PRD §8.1). A failure never undoes the payment; the screen offers to print again.
import { type PrintResult } from '@shared/printing';
import { paymentReceipt } from '@shared/receipts';
import type { PartyPayment } from '@shared/schemas/ar-ap';
import type { StoreSettings } from '@shared/schemas/settings';
import { desktopBridge } from '@/lib/desktop';

export async function printPayment(
  payment: PartyPayment,
  store: StoreSettings,
  opts: { copy?: boolean } = {},
): Promise<PrintResult> {
  const pos = desktopBridge();
  if (!pos) return { ok: false, code: 'UNSUPPORTED', message: 'Cetak hanya bisa dari aplikasi di komputer toko.' };
  try {
    return await pos.printDocument(paymentReceipt(payment, store, opts));
  } catch (err) {
    return { ok: false, code: 'PRINT_FAILED', message: 'Gagal mencetak bukti bayar.', detail: String(err) };
  }
}
