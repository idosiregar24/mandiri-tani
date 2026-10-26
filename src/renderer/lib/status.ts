// One map of status / type labels and tones for the UI (design-standards §2 StatusChip/StatusPill).
import { dec } from '@shared/money';
import type { AdjustmentReason, OpnameStatus } from '@shared/schemas/stock';
import { ADJUSTMENT_REASON_LABELS } from '@shared/schemas/stock';
import type { StatusTone } from '@/components/shared/StatusPill';

/** stock_movements.source_type → what the store calls it. */
export const STOCK_SOURCE_LABELS: Record<string, string> = {
  OPENING: 'Saldo awal',
  SALE: 'Penjualan',
  SALE_PICKUP: 'Pengambilan barang',
  SALE_PICKUP_CANCEL: 'Batal pengambilan',
  SALE_VOID: 'Batal penjualan',
  SALE_RETURN: 'Retur penjualan',
  PURCHASE_RECEIPT: 'Pembelian',
  PURCHASE_RETURN: 'Retur pembelian',
  OPNAME: 'Stok opname',
  ADJUSTMENT: 'Penyesuaian',
  TRANSFER_OUT: 'Mutasi keluar',
  TRANSFER_IN: 'Mutasi masuk',
  ASSEMBLY_OUT: 'Rakitan (bahan)',
  ASSEMBLY_IN: 'Rakitan (hasil)',
};

export const OPNAME_STATUS: Record<OpnameStatus, { label: string; tone: StatusTone }> = {
  COUNTING: { label: 'Sedang dihitung', tone: 'warning' },
  POSTED: { label: 'Diposting', tone: 'success' },
  CANCELLED: { label: 'Dibatalkan', tone: 'neutral' },
};

export const ADJUSTMENT_REASON: Record<AdjustmentReason, { label: string; tone: StatusTone }> = {
  DAMAGED: { label: ADJUSTMENT_REASON_LABELS.DAMAGED, tone: 'error' },
  LOST: { label: ADJUSTMENT_REASON_LABELS.LOST, tone: 'error' },
  EXPIRED: { label: ADJUSTMENT_REASON_LABELS.EXPIRED, tone: 'warning' },
  SAMPLE: { label: ADJUSTMENT_REASON_LABELS.SAMPLE, tone: 'info' },
  OTHER: { label: ADJUSTMENT_REASON_LABELS.OTHER, tone: 'neutral' },
};

/** Stock health of one product row (FR-INV-07). */
export function stockHealth(qty: string, available: string, isLow: boolean): { label: string; tone: StatusTone } {
  if (dec(qty).isNegative()) return { label: 'Minus', tone: 'error' };
  if (dec(available).lte(0)) return { label: 'Habis', tone: 'error' };
  if (isLow) return { label: 'Menipis', tone: 'warning' };
  return { label: 'Aman', tone: 'success' };
}
