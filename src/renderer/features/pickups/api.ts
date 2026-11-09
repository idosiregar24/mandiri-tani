import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PrintDocument, PrintResult } from '@shared/printing';
import { pickupNote, type ReceiptStore } from '@shared/receipts';
import type { Pickup, PickupInput, PickupListItem } from '@shared/schemas/pickups';
import { apiGet, apiGetPage, apiPost, toQuery } from '@/lib/api-client';
import { desktopBridge, loadPrinterSettings } from '@/lib/desktop';

export const createPickup = (input: PickupInput, idempotencyKey: string) =>
  apiPost<Pickup>('/pickups', input, { headers: { 'Idempotency-Key': idempotencyKey } });

export const fetchPickup = (id: string) => apiGet<Pickup>(`/pickups/${id}`);

export const cancelPickup = (id: string, reason: string, grant?: string) =>
  apiPost<Pickup>(
    `/pickups/${id}/cancel`,
    { reason },
    grant ? { headers: { 'X-Authorization-Grant': grant } } : undefined,
  );

export function usePickups(customerId: string | null) {
  return useQuery({
    queryKey: ['pickups', 'list', customerId],
    queryFn: () =>
      apiGetPage<PickupListItem>(`/pickups${toQuery({ customerId: customerId ?? undefined, pageSize: 50 })}`),
    placeholderData: keepPreviousData,
  });
}

/** Exactly what printPickup sends — also used by the print preview. */
export async function pickupDocument(p: Pickup, store: ReceiptStore, copy = false): Promise<PrintDocument> {
  const printers = await loadPrinterSettings();
  return pickupNote(p, store, { linesPerPage: printers.faktur.linesPerPage, copy });
}

/** Bukti AB on the faktur printer (LX-310), two copies — after the API saved it (golden rule 1). */
export async function printPickup(p: Pickup, store: ReceiptStore, copy = false): Promise<PrintResult> {
  const pos = desktopBridge();
  if (!pos) return { ok: false, code: 'UNSUPPORTED', message: 'Cetak hanya bisa dari aplikasi di komputer kasir.' };
  try {
    return await pos.printDocument(await pickupDocument(p, store, copy));
  } catch (err) {
    return { ok: false, code: 'PRINT_FAILED', message: 'Gagal mencetak.', detail: String(err) };
  }
}
