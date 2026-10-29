// Direct purchase invoices BL, purchase returns RB (PRD §5.4, sprint-8) and sale returns RJ (FR-POS-17).
import { Money, OptionalText, PositiveQty, Uuid, z } from './common';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal tidak valid.');
const Reason = z.string().trim().min(3, 'Tulis alasan retur.').max(300);

export const PURCHASE_PAY_KINDS = ['CASH', 'TRANSFER', 'CREDIT'] as const;
export type PurchasePayKind = (typeof PURCHASE_PAY_KINDS)[number];

export const PurchaseInput = z
  .object({
    supplierId: Uuid,
    /** Business date of the supplier's invoice (default today). */
    invoiceDate: IsoDate.nullish().transform((v) => v ?? null),
    supplierInvoiceNo: OptionalText(60),
    lines: z
      .array(z.object({ productUnitId: Uuid, qty: PositiveQty, unitPrice: Money }))
      .min(1, 'Isi barang yang dibeli.')
      .max(100, 'Maksimal 100 baris per faktur.'),
    discountAmount: Money.default('0'),
    otherCost: Money.default('0'),
    /** FR-PUR-05: shipping into HPP (allocated by line value). Default off, like iPOS. */
    otherCostToHpp: z.boolean().default(false),
    payKind: z.enum(PURCHASE_PAY_KINDS).default('CASH'),
    /** TRANSFER: the bank method (payment_methods of kind TRANSFER/QRIS). */
    paymentMethodId: Uuid.nullish().transform((v) => v ?? null),
    /** CREDIT: default = invoice date + supplier term. */
    dueDate: IsoDate.nullish().transform((v) => v ?? null),
    note: OptionalText(300),
  })
  .refine((v) => v.payKind !== 'TRANSFER' || v.paymentMethodId, {
    message: 'Pilih rekening untuk transfer.',
    path: ['paymentMethodId'],
  });
export type PurchaseInput = z.input<typeof PurchaseInput>;

export const PurchaseListQuery = z.object({
  q: z.string().trim().max(60).optional(),
  supplierId: Uuid.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

export interface PurchaseLine {
  /** goods_receipt_items.id */
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
  lineTotal: string;
  landedCostAlloc: string;
  costPerBase: string;
  returnedQty: string;
}

export interface Purchase {
  id: string;
  number: string;
  invoiceDate: string;
  supplierInvoiceNo: string | null;
  supplier: { id: string; code: string; name: string };
  lines: PurchaseLine[];
  subtotal: string;
  discountAmount: string;
  otherCost: string;
  total: string;
  payKind: PurchasePayKind;
  payable: { amount: string; paidAmount: string; dueDate: string; status: string } | null;
  returns: { id: string; number: string; trxAt: string; total: string; settlement: ReturnSettlement['purchase'] }[];
  note: string | null;
  createdBy: string;
  createdAt: string;
}

export interface PurchaseListItem {
  id: string;
  number: string;
  invoiceDate: string;
  supplierInvoiceNo: string | null;
  supplierName: string;
  itemCount: number;
  total: string;
  payKind: PurchasePayKind;
  payableOpen: string | null;
}

export interface PriceHistoryRow {
  invoiceId: string;
  number: string;
  invoiceDate: string;
  supplierName: string;
  unitCode: string;
  qty: string;
  unitPrice: string;
}

export interface ReturnSettlement {
  purchase: 'REDUCE_PAYABLE' | 'CASH_REFUND';
  sale: 'CASH_REFUND' | 'REDUCE_RECEIVABLE';
}

export const PurchaseReturnInput = z.object({
  lines: z
    .array(z.object({ receiptItemId: Uuid, qty: PositiveQty }))
    .min(1, 'Isi barang yang diretur.')
    .max(100),
  settlement: z.enum(['REDUCE_PAYABLE', 'CASH_REFUND']),
  reason: Reason,
});
export type PurchaseReturnInput = z.input<typeof PurchaseReturnInput>;

export const SaleReturnInput = z.object({
  lines: z
    .array(z.object({ saleItemId: Uuid, qty: PositiveQty, restock: z.boolean().default(true) }))
    .min(1, 'Isi barang yang diretur.')
    .max(200),
  settlement: z.enum(['CASH_REFUND', 'REDUCE_RECEIVABLE']),
  reason: Reason,
});
export type SaleReturnInput = z.input<typeof SaleReturnInput>;

export interface SaleReturnResult {
  id: string;
  number: string;
  saleNumber: string;
  total: string;
  settlement: ReturnSettlement['sale'];
}
