// iPOS import contracts (PRD §5.9 FR-MIG, Sprint 3 E). Inputs are Zod schemas; outputs are
// plain interfaces shared by the server and the "Impor iPOS" screen.
import { dec } from '../money';
import { Money, z } from './common';

export const IMPORT_PURPOSES = ['DEVELOPMENT', 'REHEARSAL', 'GO_LIVE'] as const;
export type ImportPurpose = (typeof IMPORT_PURPOSES)[number];

export const IMPORT_SCOPES = ['master', 'stock', 'receivables', 'history', 'opening_pickups'] as const;
export type ImportScope = (typeof IMPORT_SCOPES)[number];

export const CommitIposInput = z.object({
  purpose: z.enum(IMPORT_PURPOSES, { message: 'Pilih tujuan impor.' }),
});
export type CommitIposInput = z.infer<typeof CommitIposInput>;

/** FR-MIG-08: the owner types RESET to confirm wiping the preparation data. */
export const ResetPreparationInput = z.object({
  confirm: z
    .string()
    .trim()
    .refine((v) => v.toUpperCase() === 'RESET', 'Ketik RESET (huruf besar) untuk melanjutkan.'),
});
export type ResetPreparationInput = z.infer<typeof ResetPreparationInput>;

/** The restored backup, as recorded by the main process in ipos_import._mtpos_source. */
export interface IposSourceInfo {
  fileName: string;
  sha256: string;
  sizeBytes: number;
  /** Dump header "Archive created at" (iPOS PC local time). */
  dumpCreatedAt: string | null;
  sourceVersion: string | null;
  tables: number;
  restoredAt: string;
}

/** FR-MIG-09: a required iPOS table, or some of its columns, is missing. */
export interface FingerprintProblem {
  table: string;
  /** Empty = the whole table is missing. */
  missingColumns: string[];
}

/** A data-quality finding (Analisis §3 DQ-*), shown before and after import. */
export interface DataIssue {
  code: string;
  title: string;
  /** What the importer does about it / what the owner should check. */
  action: string;
  count: number;
  examples: string[];
}

export interface IposMasterCounts {
  units: number;
  categories: number;
  customerGroups: number;
  customers: number;
  suppliers: number;
  bankAccounts: number;
  products: number;
  multiUnitProducts: number;
  derivedUnits: number;
  pricedUnits: number;
}

export interface IposInspectResult {
  source: IposSourceInfo;
  fingerprint: FingerprintProblem[];
  /** null when the fingerprint does not match (nothing was read). */
  counts: IposMasterCounts | null;
  issues: DataIssue[];
  /** Why the import cannot run now (e.g. master data already filled, store already live). */
  blocker: string | null;
}

/** FR-MIG-04: one line of "iPOS vs hasil impor". Values are decimal strings (counts, qty, rupiah — no floats). */
export interface ReconciliationRow {
  label: string;
  kind: 'count' | 'qty' | 'money';
  ipos: string;
  imported: string;
  /** Equal — or, for inventory value, within the HPP rounding tolerance (sprint-4 S4-5). */
  ok: boolean;
}

/** Opening stock scope (FR-MIG-02 "Stok awal"), counted in iPOS itself. */
export interface IposStockCounts {
  /** Products with stock in iPOS (office UTM). */
  products: number;
  /** FIFO layers with sisa > 0 (tbl_item_im). */
  layers: number;
  /** Σ base-unit quantity, decimal string. */
  qty: string;
  /** Σ sisa × hargadasar in rupiah, decimal string (2 dp). */
  value: string;
  /** Products with negative stock in iPOS. */
  minusProducts: number;
}

export interface IposStockInspectResult {
  source: IposSourceInfo;
  fingerprint: FingerprintProblem[];
  counts: IposStockCounts | null;
  issues: DataIssue[];
  blocker: string | null;
}

/** Open receivables & credit purchases scope (FR-MIG-02 "Piutang", FR-MIG-05), counted in iPOS. */
export interface IposArApCounts {
  /** JL notes with credit left (jmlkredit − krd_jml_byr − krd_jml_pot > 0). */
  receivables: number;
  receivablesOpen: string;
  customers: number;
  /** BL invoices with credit left — candidates only, the Owner ticks the real ones. */
  payables: number;
  payablesOpen: string;
}

/** One iPOS credit purchase the Owner confirms (or not) as still unpaid (FR-MIG-05). */
export interface IposPayableCandidate {
  legacyKey: string;
  supplierCode: string;
  supplierName: string | null;
  docDate: string;
  dueDate: string;
  open: string;
}

export interface IposArApInspectResult {
  source: IposSourceInfo;
  fingerprint: FingerprintProblem[];
  counts: IposArApCounts | null;
  issues: DataIssue[];
  payables: IposPayableCandidate[];
  blocker: string | null;
}

export const CommitIposArApInput = CommitIposInput.extend({
  /** Ticked invoices with what is really still owed (≤ iPOS open). Empty = no supplier debt. */
  payables: z
    .array(
      z.object({
        legacyKey: z.string().trim().min(1).max(50),
        amount: Money.refine((v) => dec(v).gt(0), 'Sisa hutang harus lebih dari 0.'),
      }),
    )
    .max(1000)
    .default([]),
});
export type CommitIposArApInput = z.input<typeof CommitIposArApInput>;

export interface ImportBatch {
  id: string;
  sourceFile: string;
  sourceSha256: string;
  sourceDumpAt: string | null;
  purpose: ImportPurpose;
  scope: ImportScope[];
  status: 'RUNNING' | 'COMMITTED' | 'FAILED' | 'DISCARDED';
  startedAt: string;
  finishedAt: string | null;
  counts: IposMasterCounts | IposStockCounts | IposArApCounts | null;
  reconciliation: ReconciliationRow[];
  issues: DataIssue[];
  error: string | null;
}

export interface ResetResult {
  backupFile: string;
  discardedBatches: number;
}
