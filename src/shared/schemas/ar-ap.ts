// Receivables (piutang) & payables (hutang): payments BP/BH with allocations, due lists, aging and
// opening balances (PRD §5.5, sprint-9). Same shapes for both sides; `party` = customer or supplier.
import { dec } from '../money';
import { Money, OptionalText, RequiredText, Uuid, z } from './common';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal tidak valid.');
const PositiveMoney = Money.refine((v) => dec(v).gt(0), 'Jumlah harus lebih dari 0.');

/** "Semua · Lewat jatuh tempo · 7 hari ke depan" (FR-ARAP-04). */
export const DUE_FILTERS = ['all', 'overdue', 'week'] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];

export const AgingQuery = z.object({
  q: z.string().trim().max(60).optional(),
  due: z.enum(DUE_FILTERS).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

/** FR-ARAP-05 buckets, in days past the due date. */
export interface AgingBuckets {
  current: string;
  d1_30: string;
  d31_60: string;
  d61_90: string;
  d90plus: string;
}

export interface AgingRow extends AgingBuckets {
  partyId: string;
  code: string;
  name: string;
  phone: string | null;
  docCount: number;
  open: string;
  oldestDue: string;
}

export interface AgingTotals extends AgingBuckets {
  open: string;
  /** Σ of the late buckets. */
  overdue: string;
  parties: number;
  docs: number;
  /** Documents (not parties) for the badges. */
  overdueDocs: number;
  dueTodayDocs: number;
  dueWeekDocs: number;
}

export interface AgingPage {
  rows: AgingRow[];
  totals: AgingTotals;
}

export const OpenDocsQuery = z.object({ partyId: Uuid });

export interface OpenDoc {
  id: string;
  sourceType: 'SALE' | 'PURCHASE_INVOICE' | 'OPENING';
  docNumber: string;
  docDate: string;
  dueDate: string;
  amount: string;
  paidAmount: string;
  open: string;
  /** > 0 = late by that many days, 0 = due today, < 0 = not yet due. */
  daysOverdue: number;
}

const paymentFields = {
  paymentMethodId: Uuid,
  amount: PositiveMoney,
  /** Omitted = automatic: oldest due date first (FR-ARAP-02). */
  allocations: z
    .array(z.object({ documentId: Uuid, amount: PositiveMoney }))
    .min(1)
    .max(500)
    .nullish()
    .transform((v) => v ?? null),
  reference: OptionalText(60),
  note: OptionalText(300),
};

export const ReceivablePaymentInput = z.object({ customerId: Uuid, ...paymentFields });
export type ReceivablePaymentInput = z.input<typeof ReceivablePaymentInput>;
export const PayablePaymentInput = z.object({ supplierId: Uuid, ...paymentFields });
export type PayablePaymentInput = z.input<typeof PayablePaymentInput>;

export interface PaymentAllocation {
  documentId: string;
  docNumber: string;
  docDate: string;
  dueDate: string;
  amount: string;
  /** Left on that document after this payment. */
  remaining: string;
}

export interface PartyPayment {
  id: string;
  number: string;
  paidAt: string;
  party: { id: string; code: string; name: string };
  method: { id: string; name: string; kind: string };
  amount: string;
  reference: string | null;
  note: string | null;
  allocations: PaymentAllocation[];
  /** The party's whole open balance after this payment. */
  openAfter: string;
  createdBy: string;
}

export interface PaymentListItem {
  id: string;
  number: string;
  paidAt: string;
  methodName: string;
  amount: string;
  docCount: number;
}

const openingFields = {
  docNumber: RequiredText('Nomor nota', 50),
  docDate: IsoDate,
  dueDate: IsoDate,
  /** What is still open (sisa), not the original invoice total. */
  amount: PositiveMoney,
};
const dueAfterDoc = { message: 'Jatuh tempo tidak boleh sebelum tanggal nota.', path: ['dueDate'] };

export const OpeningReceivableInput = z
  .object({ customerId: Uuid, ...openingFields })
  .refine((v) => v.dueDate >= v.docDate, dueAfterDoc);
export type OpeningReceivableInput = z.input<typeof OpeningReceivableInput>;
export const OpeningPayableInput = z
  .object({ supplierId: Uuid, ...openingFields })
  .refine((v) => v.dueDate >= v.docDate, dueAfterDoc);
export type OpeningPayableInput = z.input<typeof OpeningPayableInput>;
