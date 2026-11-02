// Cash book (FR-FIN-01/02, sprint-10 S10-7): manual cash in KSIN / cash out KASO, moving money
// between accounts TRF, and the Owner's expense categories. The ledger is append-only — a wrong
// entry is corrected with an entry the other way.
import { Money, OptionalText, RequiredText, Uuid, z } from './common';
import { dec, isDecimalString } from '../money';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal tidak valid.');
const Amount = Money.refine((v) => isDecimalString(v) && dec(v).gt(0), 'Jumlah harus lebih dari 0.');

export const CASH_DIRECTIONS = ['IN', 'OUT'] as const;
export type CashDirection = (typeof CASH_DIRECTIONS)[number];

export const CashEntryInput = z.object({
  direction: z.enum(CASH_DIRECTIONS),
  cashAccountId: Uuid,
  categoryId: Uuid,
  amount: Amount,
  /** Owner only: record a past day's entry (YYYY-MM-DD, WIB). Empty = now. */
  date: IsoDate.nullish().transform((v) => v ?? null),
  note: RequiredText('Keterangan', 200),
});
export type CashEntryInput = z.input<typeof CashEntryInput>;

export const CashTransferInput = z
  .object({
    fromAccountId: Uuid,
    toAccountId: Uuid,
    amount: Amount,
    date: IsoDate.nullish().transform((v) => v ?? null),
    note: OptionalText(200),
  })
  .refine((v) => v.fromAccountId !== v.toAccountId, {
    message: 'Akun asal dan tujuan harus berbeda.',
    path: ['toAccountId'],
  });
export type CashTransferInput = z.input<typeof CashTransferInput>;

export const CashCategoryInput = z.object({
  name: RequiredText('Nama kategori', 60),
  direction: z.enum(CASH_DIRECTIONS),
  /** Counts as an operating cost in the profit & loss report (FR-FIN-06). */
  isOperatingExpense: z.boolean().default(false),
});
export type CashCategoryInput = z.infer<typeof CashCategoryInput>;

export const CashListQuery = z.object({
  accountId: Uuid.optional(),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type CashListQuery = z.infer<typeof CashListQuery>;

export interface CashAccountBalance {
  id: string;
  code: string;
  name: string;
  kind: 'DRAWER' | 'CASH' | 'BANK';
  balance: string;
}

export interface CashCategory {
  id: string;
  code: string;
  name: string;
  direction: 'IN' | 'OUT' | 'BOTH';
  isSystem: boolean;
  isOperatingExpense: boolean;
  /** Can be picked for a manual KSIN/KASO entry (automatic categories like Penjualan cannot). */
  manual: boolean;
}

export interface CashTransaction {
  id: string;
  number: string | null;
  trxAt: string;
  direction: CashDirection;
  amount: string;
  account: { id: string; code: string; name: string };
  category: { id: string; code: string; name: string };
  sourceType: string;
  note: string | null;
  createdBy: string | null;
}
