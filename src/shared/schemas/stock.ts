// Stock contracts (PRD §5.2 FR-INV, Sprint 4). Quantities are decimal strings in the product's
// BASE unit unless a field says otherwise. Cost fields (HPP, value) are only present for roles
// with `cost.read` — the server leaves them out for everyone else (security-standards §2).
import { NonNegativeQty, OptionalText, Qty, Uuid, z } from './common';
import { dec, isDecimalString } from '../money';

export const StockListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: Uuid.optional(),
  /** all = every stocked product; low = at or below its minimum (FR-INV-07); minus = negative physical stock. */
  filter: z.enum(['all', 'low', 'minus']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type StockListQuery = z.infer<typeof StockListQuery>;

export interface StockRow {
  productId: string;
  sku: string;
  name: string;
  categoryName: string | null;
  baseUnitCode: string;
  /** Usual sale unit (e.g. ZAK) and how many base units it holds — to show "80 zak". */
  saleUnitCode: string;
  saleConversion: string;
  /** FR-INV-13: Fisik · Dipesan · Tersedia (base unit). */
  qty: string;
  reservedQty: string;
  availableQty: string;
  minStock: string;
  isLow: boolean;
  /** cost.read only: FIFO value Σ layer qty × cost, and value / qty. */
  value?: string;
  avgCost?: string | null;
}

export interface StockSummary {
  products: number;
  low: number;
  minus: number;
  /** cost.read only. */
  totalValue?: string;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus berformat YYYY-MM-DD.');

export const StockCardQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type StockCardQuery = z.infer<typeof StockCardQuery>;

export interface StockCardLine {
  movedAt: string;
  sourceType: string;
  sourceId: string;
  /** Human document reference: "0001/PS/UTM/1026", "Saldo awal iPOS". */
  document: string;
  note: string | null;
  qtyIn: string;
  qtyOut: string;
  balance: string;
  unitCost?: string;
  costEstimated?: boolean;
}

export interface StockCard {
  productId: string;
  sku: string;
  name: string;
  baseUnitCode: string;
  saleUnitCode: string;
  saleConversion: string;
  from: string;
  to: string;
  opening: string;
  totalIn: string;
  totalOut: string;
  closing: string;
  lines: StockCardLine[];
  /** Current balance (not limited to the period). */
  current: { qty: string; reservedQty: string; availableQty: string };
}

export interface CostLayer {
  id: string;
  receivedAt: string;
  sourceType: string;
  qtyIn: string;
  qtyRemaining: string;
  unitCost: string;
  value: string;
}

export interface ConsistencyProblem {
  productId: string;
  sku: string;
  name: string;
  balance: string;
  ledger: string;
  layers: string;
}

// ------------------------------------------------------------------ adjustments (FR-INV-06)
export const ADJUSTMENT_REASONS = ['DAMAGED', 'LOST', 'EXPIRED', 'SAMPLE', 'OTHER'] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];
export const ADJUSTMENT_REASON_LABELS: Record<AdjustmentReason, string> = {
  DAMAGED: 'Rusak',
  LOST: 'Hilang',
  EXPIRED: 'Kedaluwarsa',
  SAMPLE: 'Sampel',
  OTHER: 'Lainnya',
};

const SignedQty = Qty.refine((v) => isDecimalString(v) && !dec(v).isZero(), 'Jumlah tidak boleh 0.');

export const AdjustmentLineInput = z.object({
  productId: Uuid,
  /** The unit the quantity is typed in (KG, ZAK, …); converted to base units by the server. */
  productUnitId: Uuid,
  /** Signed: + adds stock, − removes stock. */
  qty: SignedQty,
});

export const AdjustmentInput = z
  .object({
    reasonCode: z.enum(ADJUSTMENT_REASONS, { message: 'Pilih alasan penyesuaian.' }),
    note: OptionalText(500),
    lines: z.array(AdjustmentLineInput).min(1, 'Tambahkan minimal satu barang.').max(200),
  })
  .superRefine((v, ctx) => {
    if (v.reasonCode === 'OTHER' && !v.note)
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'Tulis catatan untuk alasan "Lainnya".' });
    const seen = new Set<string>();
    v.lines.forEach((l, i) => {
      if (seen.has(l.productId))
        ctx.addIssue({
          code: 'custom',
          path: ['lines', i, 'productId'],
          message: 'Barang ini sudah ada di baris lain.',
        });
      seen.add(l.productId);
    });
  });
export type AdjustmentInput = z.input<typeof AdjustmentInput>;

export interface AdjustmentLine {
  id: string;
  productId: string;
  sku: string;
  name: string;
  baseUnitCode: string;
  qty: string;
  unitCost?: string;
}

export interface Adjustment {
  id: string;
  number: string;
  reasonCode: AdjustmentReason;
  note: string | null;
  trxAt: string;
  warehouseCode: string;
  lineCount: number;
  lines?: AdjustmentLine[];
  /** cost.read only: Σ qty × unit_cost. */
  value?: string;
}

// ------------------------------------------------------------------ stock opname (FR-INV-05)
export const OPNAME_STATUSES = ['COUNTING', 'POSTED', 'CANCELLED'] as const;
export type OpnameStatus = (typeof OPNAME_STATUSES)[number];

export const OpnameCreateInput = z.object({ note: OptionalText(500) });
export type OpnameCreateInput = z.input<typeof OpnameCreateInput>;

export const OpnameCountInput = z.object({
  productId: Uuid,
  productUnitId: Uuid,
  countedQty: NonNegativeQty,
});
export type OpnameCountInput = z.input<typeof OpnameCountInput>;

export interface OpnameLine {
  id: string;
  productId: string;
  sku: string;
  name: string;
  baseUnitCode: string;
  saleUnitCode: string;
  saleConversion: string;
  countedQty: string;
  /** COUNTING: current physical stock (live). POSTED: the snapshot taken at posting. */
  systemQty: string;
  diffQty: string;
  countedAt: string;
  /** cost.read only. */
  unitCost?: string | null;
  diffValue?: string;
}

export interface Opname {
  id: string;
  number: string;
  status: OpnameStatus;
  note: string | null;
  warehouseCode: string;
  startedAt: string;
  postedAt: string | null;
  lineCount: number;
  lines?: OpnameLine[];
  /** cost.read only: Σ diff × cost. */
  diffValue?: string;
}
