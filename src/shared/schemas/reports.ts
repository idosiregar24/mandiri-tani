// Owner reports (PRD §5.6, sprint-10). Every report takes a WIB period (from/to inclusive, at most
// two years) and can be exported with ?format=xlsx. Money and quantities are decimal strings;
// quantities are in the product's BASE unit unless a field says otherwise. HPP/profit fields only
// exist in reports guarded by reports.profit / cost.read.
import { Uuid, z } from './common';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus berformat YYYY-MM-DD.');
const MAX_DAYS = 731;

type Span = { from: string; to: string };
const ordered = (v: unknown) => (v as Span).from <= (v as Span).to;
const notTooLong = (v: unknown) =>
  (Date.parse(`${(v as Span).to}T00:00:00Z`) - Date.parse(`${(v as Span).from}T00:00:00Z`)) / 86_400_000 < MAX_DAYS;

/** Adds the period rules to any query object that has from/to. */
const withPeriod = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object({ from: IsoDate, to: IsoDate, ...shape })
    .refine(ordered, { message: 'Tanggal awal harus sebelum tanggal akhir.', path: ['to'] })
    .refine(notTooLong, { message: 'Periode laporan maksimal 2 tahun.', path: ['from'] });

export const ReportPeriod = withPeriod({});
export type ReportPeriod = z.infer<typeof ReportPeriod>;

export const REPORT_FORMATS = ['json', 'xlsx'] as const;
export const ReportFormat = z.enum(REPORT_FORMATS).default('json');

// ---------------------------------------------------------------- Penjualan (FR-FIN-07/12)

export const SALES_GROUPS = ['invoice', 'day', 'customer', 'category', 'payment_method'] as const;
export type SalesGroup = (typeof SALES_GROUPS)[number];

export const SalesReportQuery = withPeriod({
  groupBy: z.enum(SALES_GROUPS).default('invoice'),
  channel: z.enum(['KASIR', 'FAKTUR']).optional(),
  customerId: Uuid.optional(),
});
export type SalesReportQuery = z.infer<typeof SalesReportQuery>;

/** One sale, columns as iPOS "Penjualan Rekap". */
export interface SalesRecapRow {
  id: string;
  number: string;
  trxAt: string;
  channel: 'KASIR' | 'FAKTUR';
  customer: { code: string; name: string };
  /** Σ line qty (line units), like iPOS "Jml Item". */
  itemCount: string;
  subtotal: string;
  discount: string;
  tax: string;
  otherCharges: string;
  total: string;
  /** Non-credit payments minus change. */
  paidCash: string;
  paidCredit: string;
  imported: boolean;
}

export interface SalesGroupRow {
  key: string;
  label: string;
  /** Number of sales (day / customer / category: sales that contain the category). */
  count: number;
  /** day & customer: Σ total; category: Σ net line amount; payment_method: Σ paid. */
  amount: string;
  paidCash?: string;
  paidCredit?: string;
}

export interface SalesTotals {
  count: number;
  subtotal: string;
  discount: string;
  tax: string;
  otherCharges: string;
  total: string;
  paidCash: string;
  paidCredit: string;
}

export interface SalesReport {
  period: ReportPeriod;
  groupBy: SalesGroup;
  /** KASIR sees only their own sales of today. */
  ownOnly: boolean;
  invoices: SalesRecapRow[];
  groups: SalesGroupRow[];
  totals: SalesTotals;
  /** Sale returns dated inside the period. */
  returns: { count: number; amount: string };
}

// ---------------------------------------------------------------- Laba (FR-FIN-04/05/06)

export const ProfitByItemQuery = withPeriod({ categoryId: Uuid.optional() });
export type ProfitByItemQuery = z.infer<typeof ProfitByItemQuery>;

export interface ProfitItemRow {
  productId: string;
  sku: string;
  name: string;
  category: string | null;
  baseUnit: string;
  /** Sold minus returned, base unit. */
  qty: string;
  sales: string;
  returns: string;
  /** Net sales of lines whose HPP is known. */
  hpp: string;
  profit: string;
  /** Percent of (sales − returns) with known HPP, "12.5"; null when nothing to divide by. */
  marginPct: string | null;
  /** Part of the HPP is the current FIFO cost of goods not yet picked up. */
  estimated: boolean;
  /** Sales whose HPP is unknown (iPOS history, DQ-3) — not counted in profit. */
  unknownCostSales: string;
}

export interface ProfitTotals {
  sales: string;
  returns: string;
  hpp: string;
  profit: string;
  marginPct: string | null;
  unknownCostSales: string;
  estimated: boolean;
}

export interface ProfitByItemReport {
  period: ReportPeriod;
  rows: ProfitItemRow[];
  totals: ProfitTotals;
}

export const ProfitByInvoiceQuery = withPeriod({ channel: z.enum(['KASIR', 'FAKTUR']).optional() });
export type ProfitByInvoiceQuery = z.infer<typeof ProfitByInvoiceQuery>;

export interface ProfitInvoiceRow {
  saleId: string;
  number: string;
  trxAt: string;
  customer: { code: string; name: string };
  sales: string;
  returns: string;
  hpp: string | null;
  profit: string | null;
  marginPct: string | null;
  estimated: boolean;
  /** At least one line without HPP: profit of this sale is not shown. */
  costUnknown: boolean;
}

export interface ProfitByInvoiceReport {
  period: ReportPeriod;
  rows: ProfitInvoiceRow[];
  totals: ProfitTotals;
}

export interface ProfitLossReport {
  period: ReportPeriod;
  /** Σ net line amounts (after line & note discounts), all sales. */
  netSales: string;
  returns: string;
  /** Part of netSales with unknown HPP — excluded from gross profit. */
  unknownCostSales: string;
  hpp: string;
  /** (netSales − unknownCostSales) − returns − hpp. */
  grossProfit: string;
  /** Ongkos angkut charged to customers (S10-5). */
  otherCharges: string;
  opex: { code: string; name: string; amount: string }[];
  opexTotal: string;
  /** grossProfit + otherCharges − opexTotal (estimate — PRD FR-FIN-06). */
  operatingProfit: string;
  estimated: boolean;
}

// ---------------------------------------------------------------- Arus kas (FR-FIN-03)

export const CashflowQuery = withPeriod({ accountId: Uuid.optional() });
export type CashflowQuery = z.infer<typeof CashflowQuery>;

export interface CashflowLine {
  code: string;
  name: string;
  amount: string;
}

export interface CashflowAccount {
  id: string;
  code: string;
  name: string;
  kind: 'DRAWER' | 'CASH' | 'BANK';
  opening: string;
  in: CashflowLine[];
  out: CashflowLine[];
  totalIn: string;
  totalOut: string;
  closing: string;
}

export interface CashflowReport {
  period: ReportPeriod;
  accounts: CashflowAccount[];
  totals: { opening: string; totalIn: string; totalOut: string; closing: string };
  /** The period starts before the first sale made in this app: only iPOS expenses exist there (S10-8). */
  beforeGoLive: boolean;
}

// ---------------------------------------------------------------- Pembelian (FR-FIN-12)

export const PurchasesReportQuery = withPeriod({ supplierId: Uuid.optional() });
export type PurchasesReportQuery = z.infer<typeof PurchasesReportQuery>;

export interface PurchaseReportLine {
  sku: string;
  productName: string;
  qty: string;
  unitCode: string;
  unitPrice: string;
  discount: string;
  lineTotal: string;
}

export interface PurchaseReportRow {
  id: string;
  number: string;
  supplierInvoiceNo: string | null;
  date: string;
  supplier: { code: string; name: string };
  itemCount: string;
  subtotal: string;
  discount: string;
  tax: string;
  otherCost: string;
  total: string;
  paidCash: string;
  paidCredit: string;
  status: 'POSTED' | 'VOIDED';
  lines: PurchaseReportLine[];
}

export interface PurchasesReport {
  period: ReportPeriod;
  rows: PurchaseReportRow[];
  totals: {
    count: number;
    subtotal: string;
    discount: string;
    tax: string;
    otherCost: string;
    total: string;
    paidCash: string;
    paidCredit: string;
  };
}

// ---------------------------------------------------------------- Rekap harian pupuk (FR-FIN-11)

export const DailyFertilizerQuery = withPeriod({ categoryId: Uuid.optional() });
export type DailyFertilizerQuery = z.infer<typeof DailyFertilizerQuery>;

export interface FertilizerProduct {
  id: string;
  sku: string;
  name: string;
  baseUnit: string;
  /** The biggest sales unit (ZAK = 50 KG), null when the product has only its base unit. */
  bigUnit: { code: string; conversion: string } | null;
  /** Physical stock (base unit) at the start of `from` / end of `to`. */
  opening: string;
  closing: string;
  totals: FertilizerCell;
}

export interface FertilizerCell {
  /** Left the warehouse in the big unit (count of ZAK). */
  outBig: string;
  /** Left the warehouse in the base unit (KG ecer). */
  outBase: string;
  /** Came in from purchases (base unit). */
  in: string;
  /** Everything else, signed (returns, adjustments, opname), base unit. */
  other: string;
}

export interface FertilizerDay {
  date: string;
  cells: Record<string, FertilizerCell>;
}

export interface DailyFertilizerReport {
  period: ReportPeriod;
  category: { id: string; name: string } | null;
  products: FertilizerProduct[];
  days: FertilizerDay[];
}

// ---------------------------------------------------------------- Barang belum diambil & riwayat (FR-PKP-08/13)

export const UndeliveredQuery = z.object({
  groupBy: z.enum(['customer', 'product']).default('customer'),
  agingDays: z.coerce.number().int().min(1).max(365).default(30),
});
export type UndeliveredQuery = z.infer<typeof UndeliveredQuery>;

export interface UndeliveredRow {
  key: string;
  label: string;
  /** customer: phone; product: base unit code. */
  detail: string | null;
  sales: number;
  /** Base units (product grouping only). */
  qty: string | null;
  /** Net sale amount of what is still waiting. */
  value: string;
  oldestDate: string;
  ageDays: number;
  /** Promised pickup date already passed. */
  overdueSales: number;
}

export interface UndeliveredReport {
  groupBy: 'customer' | 'product';
  agingDays: number;
  rows: UndeliveredRow[];
  totals: { sales: number; value: string; olderThanAging: number; overdueSales: number };
}

export const PickupsReportQuery = withPeriod({ customerId: Uuid.optional(), productId: Uuid.optional() });
export type PickupsReportQuery = z.infer<typeof PickupsReportQuery>;

export interface PickupReportRow {
  id: string;
  number: string;
  pickedUpAt: string;
  customer: { code: string; name: string };
  method: 'PICKUP' | 'DELIVERY';
  receiverName: string;
  status: 'POSTED' | 'CANCELLED';
  createdBy: string | null;
  lines: { saleNumber: string; productName: string; qty: string; unitCode: string }[];
}

export interface PickupsReport {
  period: ReportPeriod;
  rows: PickupReportRow[];
}

// ---------------------------------------------------------------- Persediaan (FR-FIN-08)

export const StockReportQuery = z.object({
  idleDays: z.coerce.number().int().min(7).max(730).default(60),
});
export type StockReportQuery = z.infer<typeof StockReportQuery>;

export interface StockReport {
  idleDays: number;
  categories: { id: string | null; name: string; products: number; value: string }[];
  totals: { products: number; value: string; low: number; minus: number };
  /** In stock but not sold for `idleDays` days. */
  idle: {
    productId: string;
    sku: string;
    name: string;
    qty: string;
    baseUnit: string;
    value: string;
    lastSaleDate: string | null;
  }[];
}

// ---------------------------------------------------------------- Dashboard (FR-FIN-09, FR-PKP-12)

export interface DashboardFigure {
  sales: string;
  invoices: number;
  /** Owner only. */
  profit?: string;
}

export interface DashboardReport {
  ownOnly: boolean;
  today: DashboardFigure;
  yesterday: DashboardFigure;
  /** Month to date vs the same days of last month. */
  month: DashboardFigure;
  lastMonth: DashboardFigure;
  /** Owner only from here on. */
  topProducts?: { productId: string; name: string; qty: string; baseUnit: string; sales: string }[];
  lowStock?: number;
  receivables?: { overdueCount: number; overdueAmount: string; dueSoonCount: number };
  undelivered?: { customers: number; value: string; overduePromises: number; olderThan30: number };
}
