// Sales documents (PRD §5.3, sprint-6). The client sends what the cashier chose; the server
// recomputes every amount (S6-4).
import type { PriceSource } from '../pricing';
import type { PosProduct } from './pos';
import { Money, OptionalText, PositiveQty, Uuid, z } from './common';

export const SALE_CHANNELS = ['KASIR', 'FAKTUR'] as const;
export type SaleChannel = (typeof SALE_CHANNELS)[number];
export const SALE_STATUSES = ['HELD', 'COMPLETED', 'VOIDED'] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

const PositiveMoney = Money.refine((v) => !/^0+(\.0+)?$/.test(v), 'Harus lebih dari Rp 0.');
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal tidak valid.');

export const SaleLineInput = z.object({
  productUnitId: Uuid,
  qty: PositiveQty,
  unitPrice: PositiveMoney,
});
export type SaleLineInput = z.infer<typeof SaleLineInput>;

export const SalePaymentInput = z.object({
  paymentMethodId: Uuid,
  /** Cash: what the customer handed over (change is computed). */
  amount: PositiveMoney,
  reference: OptionalText(60),
});
export type SalePaymentInput = z.infer<typeof SalePaymentInput>;

export const CompleteSaleInput = z.object({
  channel: z.enum(SALE_CHANNELS).default('KASIR'),
  /** null = UMUM (walk-in). */
  customerId: Uuid.nullable().default(null),
  lines: z.array(SaleLineInput).min(1, 'Nota belum berisi barang.').max(200, 'Maksimal 200 baris per nota.'),
  /** Note discount, nominal (FR-POS-28 "Total jadi" is converted on the client). */
  discountAmount: Money.default('0'),
  /** FAKTUR only: shipping / other charges (D-4). */
  otherCharges: Money.default('0'),
  otherChargesNote: OptionalText(100),
  payments: z.array(SalePaymentInput).max(5, 'Maksimal 5 cara bayar.').default([]),
  /** FAKTUR with credit: due date (default = today + customer's term). */
  dueDate: IsoDate.nullish().transform((v) => v ?? null),
  /** D-5: goods stay in the warehouse until a pickup note (AB). */
  pickupLater: z.boolean().default(false),
  pickupNote: OptionalText(200),
  note: OptionalText(300),
});
export type CompleteSaleInput = z.input<typeof CompleteSaleInput>;

export const VoidSaleInput = z.object({ reason: z.string().trim().min(3, 'Tulis alasan pembatalan.').max(300) });

export const SaleListQuery = z.object({
  date: IsoDate.optional(),
  q: z.string().trim().max(60).optional(),
  status: z.enum(SALE_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
export type SaleListQuery = z.infer<typeof SaleListQuery>;

export interface SaleLine {
  id: string;
  lineNo: number;
  productId: string;
  productUnitId: string;
  productName: string;
  sku: string;
  unitCode: string;
  conversionQty: string;
  qty: string;
  unitPrice: string;
  listPrice: string | null;
  priceSource: PriceSource;
  discountAmount: string;
  allocatedDiscount: string;
  lineTotal: string;
  pickedUpQty: string;
  /** Already returned (RJ), line unit. */
  returnedQty: string;
  /** Only for cost.read (Owner). */
  costPerBase?: string | null;
  costTotal?: string | null;
}

export interface SalePayment {
  paymentMethodId: string;
  methodName: string;
  kind: 'CASH' | 'QRIS' | 'TRANSFER' | 'CREDIT';
  amount: string;
  reference: string | null;
}

export interface Sale {
  id: string;
  number: string | null;
  status: SaleStatus;
  channel: SaleChannel;
  trxAt: string;
  customer: {
    id: string;
    code: string;
    name: string;
    address: string | null;
    isWalkIn: boolean;
    groupName: string | null;
  };
  cashier: { id: string; fullName: string };
  lines: SaleLine[];
  subtotal: string;
  discountAmount: string;
  otherCharges: string;
  otherChargesNote: string | null;
  total: string;
  paidAmount: string;
  creditAmount: string;
  changeAmount: string;
  dueDate: string | null;
  payments: SalePayment[];
  fulfillmentStatus: 'TAKEN' | 'PENDING' | 'PARTIAL' | 'COMPLETE' | 'CANCELLED';
  pickupNote: string | null;
  note: string | null;
  approvedBy: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  /** Only for cost.read (Owner): Σ cost of goods that left the warehouse. */
  costTotal?: string | null;
}

export interface SaleListItem {
  id: string;
  number: string | null;
  status: SaleStatus;
  channel: SaleChannel;
  trxAt: string;
  customerName: string;
  itemCount: number;
  total: string;
  creditAmount: string;
  fulfillmentStatus: Sale['fulfillmentStatus'];
}

// ------------------------------------------------------------------ held notes (FR-POS-08, sprint-7 S7-1)

export const HoldSaleInput = CompleteSaleInput.pick({
  channel: true,
  customerId: true,
  lines: true,
  discountAmount: true,
  otherCharges: true,
  otherChargesNote: true,
  note: true,
}).extend({ holdLabel: z.string().trim().min(1, 'Beri nama nota tertahan.').max(60) });
export type HoldSaleInput = z.input<typeof HoldSaleInput>;

export interface HeldSaleItem {
  id: string;
  holdLabel: string;
  channel: SaleChannel;
  customerName: string;
  itemCount: number;
  total: string;
  trxAt: string;
  cashierName: string;
}

/** What F7 puts back into the cart (the HELD row is gone afterwards). */
export interface RecalledSale {
  channel: SaleChannel;
  customer: { id: string; name: string; isWalkIn: boolean; groupId: string | null; groupName: string | null };
  discountAmount: string;
  otherCharges: string;
  otherChargesNote: string | null;
  lines: { productUnitId: string; qty: string; unitPrice: string; priceSource: PriceSource }[];
  products: PosProduct[];
}

/** FR-POS-27: the last prices this customer paid for this product unit. */
export interface LastPrice {
  saleId: string;
  number: string;
  trxAt: string;
  qty: string;
  unitPrice: string;
}
