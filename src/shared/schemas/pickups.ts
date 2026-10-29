// Pickup notes AB (PRD §5.3b FR-PKP, D-5, sprint-7): goods sold earlier leave the warehouse.
import { OptionalText, PositiveQty, RequiredText, Uuid, z } from './common';

export const PICKUP_METHODS = ['PICKUP', 'DELIVERY'] as const;
export type PickupMethod = (typeof PICKUP_METHODS)[number];

export const OutstandingQuery = z
  .object({ customerId: Uuid.optional(), q: z.string().trim().min(1).max(60).optional() })
  .refine((v) => v.customerId || v.q, 'Pilih pelanggan atau ketik nomor nota.');

/** One sale line with goods not picked up yet. Quantities in the line's unit. */
export interface OutstandingLine {
  saleItemId: string;
  saleId: string;
  saleNumber: string;
  saleDate: string;
  customerId: string;
  customerName: string;
  productName: string;
  sku: string;
  unitCode: string;
  qty: string;
  pickedUpQty: string;
  remainingQty: string;
  allowDecimalQty: boolean;
  ageDays: number;
}

export const PickupInput = z
  .object({
    customerId: Uuid,
    lines: z
      .array(z.object({ saleItemId: Uuid, qty: PositiveQty }))
      .min(1, 'Isi jumlah barang yang diambil.')
      .max(100),
    method: z.enum(PICKUP_METHODS).default('PICKUP'),
    receiverName: RequiredText('Nama penerima', 100),
    receiverPhone: OptionalText(30),
    vehicle: OptionalText(60),
    driverName: OptionalText(100),
    destination: OptionalText(200),
    note: OptionalText(300),
  })
  .refine((v) => v.method === 'PICKUP' || v.destination, {
    message: 'Isi tujuan pengantaran.',
    path: ['destination'],
  })
  .refine((v) => new Set(v.lines.map((l) => l.saleItemId)).size === v.lines.length, {
    message: 'Barang yang sama tertulis dua kali.',
    path: ['lines'],
  });
export type PickupInput = z.input<typeof PickupInput>;

export const CancelPickupInput = z.object({ reason: z.string().trim().min(3, 'Tulis alasan pembatalan.').max(300) });

export const PickupListQuery = z.object({
  customerId: Uuid.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

export interface PickupLine {
  saleItemId: string;
  saleNumber: string;
  productName: string;
  sku: string;
  unitCode: string;
  qty: string;
  /** Still to be picked up on that sale line, after this note. */
  remainingQty: string;
}

export interface Pickup {
  id: string;
  number: string;
  status: 'POSTED' | 'CANCELLED';
  method: PickupMethod;
  pickedUpAt: string;
  customer: { id: string; name: string; address: string | null };
  receiverName: string;
  receiverPhone: string | null;
  vehicle: string | null;
  driverName: string | null;
  destination: string | null;
  note: string | null;
  createdBy: { id: string; fullName: string };
  lines: PickupLine[];
  cancelledAt: string | null;
  cancelReason: string | null;
}

export interface PickupListItem {
  id: string;
  number: string;
  status: Pickup['status'];
  method: PickupMethod;
  pickedUpAt: string;
  customerName: string;
  receiverName: string;
  itemCount: number;
}
