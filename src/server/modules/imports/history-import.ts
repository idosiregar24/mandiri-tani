// iPOS importer, 2-YEAR HISTORY scope (FR-MIG-02 "Histori", D-14, sprint-10 S10-10).
// Sales notes KSR/JL become sales `source = IPOS_IMPORT` (no stock movement, no cash, no
// receivable — credit notes and their BP instalments come from the receivables scope and are
// linked to these notes by number, whichever scope runs last), BL invoices become direct purchase
// invoices (no stock, no layers, no payable), KASO cash-outs become expenses from Kas Toko. One
// transaction, legacy_refs per document, reconciliation against iPOS per type and per month.
import { basename } from 'node:path';
import { dec } from '@shared/money';
import {
  CommitIposInput,
  type ImportBatch,
  type IposHistoryInspectResult,
  type ReconciliationRow,
} from '@shared/schemas/imports';
import { uuidv7 } from '@shared/uuid';
import type { Queryable } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { recordAudit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import type { RequestCtx } from '../../middleware/auth';
import { defaultWarehouse } from '../stock/read-repo';
import { historyImportedCounts, historyLookups, insertMany } from './history-repo';
import { planHistoryImport, type HistoryPlan } from './ipos-history-plan';
import { checkFingerprint, HISTORY_FINGERPRINT, loadHistoryRows, readSourceInfo, withIposDb } from './ipos-source';
import * as repo from './repo';
import type { ImportDeps } from './service';

const MISMATCH =
  'Struktur tabel nota, pembelian atau kas di backup tidak cocok dengan iPOS 5 yang dikenal aplikasi ini.';

async function blocker(db: Queryable): Promise<string | null> {
  if (await repo.goLiveAt(db))
    return 'Toko sudah resmi memakai aplikasi ini (go-live). Impor dari iPOS tidak bisa dijalankan lagi.';
  const s = await repo.scopeState(db);
  if (!s.master) return 'Impor data master (barang, pelanggan, supplier) dulu — histori butuh daftarnya.';
  if (s.history) return 'Histori iPOS sudah diimpor. Untuk mengimpor ulang, jalankan "Reset data persiapan" dulu.';
  return null;
}

async function readRows(deps: ImportDeps) {
  return withIposDb(deps.iposDb, async (src) => {
    const source = await readSourceInfo(src);
    const fingerprint = await checkFingerprint(src, HISTORY_FINGERPRINT);
    if (fingerprint.length) return { source, fingerprint, rows: null };
    return { source, fingerprint, rows: await loadHistoryRows(src) };
  });
}

export async function inspectHistory(deps: ImportDeps): Promise<IposHistoryInspectResult> {
  const { source, fingerprint, rows } = await readRows(deps);
  const why = fingerprint.length ? MISMATCH : await blocker(deps.pool);
  // The plan (and its findings) needs the master data; without it only the iPOS counts are shown.
  const issues = rows && !why ? planHistoryImport(rows, await historyLookups(deps.pool)).issues : [];
  return { source, fingerprint, counts: rows?.source ?? null, issues, blocker: why };
}

/** Writes the plan with bulk inserts; returns the legacy_refs to record. */
async function writePlan(tx: Queryable, ctx: RequestCtx, plan: HistoryPlan) {
  const refs: { entity: string; legacyKey: string; entityId: string }[] = [];
  const wh = await defaultWarehouse(tx);
  const ids = await tx.query<{ device: string; cash_method: string; kas_toko: string }>(
    `SELECT (SELECT id FROM devices WHERE code = 'K01') AS device,
            (SELECT id FROM payment_methods WHERE kind = 'CASH' AND deleted_at IS NULL ORDER BY sort_order LIMIT 1) AS cash_method,
            (SELECT id FROM cash_accounts WHERE upper(code) = 'KAS_TOKO' AND deleted_at IS NULL) AS kas_toko`,
  );
  const { device, cash_method: cashMethod, kas_toko: kasToko } = ids.rows[0]!;
  if (!device || !cashMethod || !kasToko) throw new Error('hub device, cash method or Kas Toko missing');
  const categories = new Map(
    (
      await tx.query<{ code: string; id: string }>(
        `SELECT upper(code) AS code, id FROM cash_categories WHERE deleted_at IS NULL`,
      )
    ).rows.map((c) => [c.code, c.id]),
  );

  // ---- sales
  const saleRows: unknown[][] = [];
  const itemRows: unknown[][] = [];
  const paymentRows: unknown[][] = [];
  for (const s of plan.sales) {
    const id = uuidv7();
    refs.push({ entity: 'sale', legacyKey: s.legacyKey, entityId: id });
    // Completed, history (no stock movement), everything taken home at the time.
    saleRows.push([
      id,
      s.legacyKey,
      'COMPLETED',
      s.channel,
      'IPOS_IMPORT',
      device,
      ctx.userId,
      s.customerId,
      s.customerGroupId,
      wh.id,
      s.trxAt,
      s.subtotal,
      s.discount,
      s.tax,
      s.otherCharges,
      s.total,
      'TAKEN',
      s.paid,
      s.credit,
      s.change,
      s.dueDate,
      s.note,
    ]);
    s.lines.forEach((l, i) => {
      itemRows.push([
        uuidv7(),
        id,
        i + 1,
        l.productId,
        l.productUnitId,
        l.productName,
        l.unitCode,
        l.conversion,
        l.qty,
        l.baseQty,
        l.unitPrice,
        'MANUAL',
        l.discount,
        l.allocatedDiscount,
        l.lineTotal,
        l.netAmount,
        l.costPerBase,
        l.costTotal,
        l.qty,
      ]);
    });
    if (dec(s.paid).gt(0)) paymentRows.push([uuidv7(), id, cashMethod, s.paid]);
  }
  await insertMany(
    tx,
    'sales',
    [
      ['id', 'uuid'],
      ['number', 'text'],
      ['status', 'text'],
      ['channel', 'text'],
      ['source', 'text'],
      ['device_id', 'uuid'],
      ['cashier_id', 'uuid'],
      ['customer_id', 'uuid'],
      ['customer_group_id', 'uuid'],
      ['warehouse_id', 'uuid'],
      ['trx_at', 'timestamptz'],
      ['subtotal', 'numeric'],
      ['discount_amount', 'numeric'],
      ['tax_amount', 'numeric'],
      ['other_charges', 'numeric'],
      ['total', 'numeric'],
      ['fulfillment_status', 'text'],
      ['paid_amount', 'numeric'],
      ['credit_amount', 'numeric'],
      ['change_amount', 'numeric'],
      ['due_date', 'date'],
      ['note', 'text'],
    ],
    saleRows,
  );
  // Prices were negotiated per note in iPOS (D-2): every history line is a manual price.
  await insertMany(
    tx,
    'sale_items',
    [
      ['id', 'uuid'],
      ['sale_id', 'uuid'],
      ['line_no', 'int'],
      ['product_id', 'uuid'],
      ['product_unit_id', 'uuid'],
      ['product_name', 'text'],
      ['unit_code', 'text'],
      ['conversion_qty', 'numeric'],
      ['qty', 'numeric'],
      ['base_qty', 'numeric'],
      ['unit_price', 'numeric'],
      ['price_source', 'text'],
      ['discount_amount', 'numeric'],
      ['allocated_discount', 'numeric'],
      ['line_total', 'numeric'],
      ['net_amount', 'numeric'],
      ['cost_per_base', 'numeric'],
      ['cost_total', 'numeric'],
      ['picked_up_qty', 'numeric'],
    ],
    itemRows,
  );
  await insertMany(
    tx,
    'sale_payments',
    [
      ['id', 'uuid'],
      ['sale_id', 'uuid'],
      ['payment_method_id', 'uuid'],
      ['amount', 'numeric'],
    ],
    paymentRows,
  );

  // ---- purchases: receipt (INVOICED) + lines + direct invoice
  const receiptRows: unknown[][] = [];
  const receiptItemRows: unknown[][] = [];
  const invoiceRows: unknown[][] = [];
  const invoiceItemRows: unknown[][] = [];
  for (const p of plan.purchases) {
    const receiptId = uuidv7();
    const invoiceId = uuidv7();
    refs.push({ entity: 'purchase_invoice', legacyKey: p.legacyKey, entityId: invoiceId });
    receiptRows.push([
      receiptId,
      p.legacyKey,
      p.supplierId,
      wh.id,
      p.receivedAt,
      'INVOICED',
      p.note,
      ctx.userId,
      ctx.userId,
      p.receivedAt,
    ]);
    invoiceRows.push([
      invoiceId,
      p.legacyKey,
      p.supplierId,
      p.date,
      p.dueDate,
      p.subtotal,
      p.discount,
      p.otherCost,
      p.tax,
      p.total,
      true,
      p.note,
      ctx.userId,
    ]);
    p.lines.forEach((l, i) => {
      const itemId = uuidv7();
      receiptItemRows.push([
        itemId,
        receiptId,
        i + 1,
        l.productId,
        l.productUnitId,
        l.conversion,
        l.qty,
        l.baseQty,
        l.unitPrice,
        l.discount,
        l.lineTotal,
        l.costPerBase,
      ]);
      invoiceItemRows.push([uuidv7(), invoiceId, itemId, l.lineTotal]);
    });
  }
  await insertMany(
    tx,
    'goods_receipts',
    [
      ['id', 'uuid'],
      ['number', 'text'],
      ['supplier_id', 'uuid'],
      ['warehouse_id', 'uuid'],
      ['received_at', 'timestamptz'],
      ['status', 'text'],
      ['note', 'text'],
      ['created_by', 'uuid'],
      ['posted_by', 'uuid'],
      ['posted_at', 'timestamptz'],
    ],
    receiptRows,
  );
  await insertMany(
    tx,
    'goods_receipt_items',
    [
      ['id', 'uuid'],
      ['goods_receipt_id', 'uuid'],
      ['line_no', 'int'],
      ['product_id', 'uuid'],
      ['product_unit_id', 'uuid'],
      ['conversion_qty', 'numeric'],
      ['qty', 'numeric'],
      ['base_qty', 'numeric'],
      ['unit_price', 'numeric'],
      ['discount_amount', 'numeric'],
      ['line_total', 'numeric'],
      ['cost_per_base', 'numeric'],
    ],
    receiptItemRows,
  );
  await insertMany(
    tx,
    'purchase_invoices',
    [
      ['id', 'uuid'],
      ['number', 'text'],
      ['supplier_id', 'uuid'],
      ['invoice_date', 'date'],
      ['due_date', 'date'],
      ['subtotal', 'numeric'],
      ['discount_amount', 'numeric'],
      ['other_cost', 'numeric'],
      ['tax_amount', 'numeric'],
      ['total', 'numeric'],
      ['is_direct', 'boolean'],
      ['note', 'text'],
      ['created_by', 'uuid'],
    ],
    invoiceRows,
  );
  await insertMany(
    tx,
    'purchase_invoice_items',
    [
      ['id', 'uuid'],
      ['purchase_invoice_id', 'uuid'],
      ['goods_receipt_item_id', 'uuid'],
      ['line_total', 'numeric'],
    ],
    invoiceItemRows,
  );

  // ---- cash out from Kas Toko
  const cashRows: unknown[][] = [];
  for (const c of plan.cash) {
    const id = uuidv7();
    refs.push({ entity: 'cash_transaction', legacyKey: c.legacyKey, entityId: id });
    const category = categories.get(c.category) ?? categories.get('OPEX_GENERAL');
    if (!category) throw new Error(`cash category ${c.category} missing`);
    cashRows.push([id, c.number, kasToko, category, c.trxAt, 'OUT', c.amount, 'MANUAL', c.note, ctx.userId]);
  }
  await insertMany(
    tx,
    'cash_transactions',
    [
      ['id', 'uuid'],
      ['number', 'text'],
      ['cash_account_id', 'uuid'],
      ['cash_category_id', 'uuid'],
      ['trx_at', 'timestamptz'],
      ['direction', 'text'],
      ['amount', 'numeric'],
      ['source_type', 'text'],
      ['note', 'text'],
      ['created_by', 'uuid'],
    ],
    cashRows,
  );
  return refs;
}

export async function commitHistory(deps: ImportDeps, ctx: RequestCtx, raw: unknown): Promise<ImportBatch> {
  const input = CommitIposInput.parse(raw);
  const { source, fingerprint, rows } = await readRows(deps);
  if (fingerprint.length || !rows) throw new AppError('IPOS_STRUCTURE_MISMATCH', MISMATCH, 422, { fingerprint });
  const meta = {
    sourceFile: basename(source.fileName),
    sha256: source.sha256,
    dumpAt:
      source.dumpCreatedAt && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(source.dumpCreatedAt)
        ? source.dumpCreatedAt.slice(0, 19)
        : null,
    purpose: input.purpose,
    scope: ['history' as const],
  };
  try {
    const id = await withTransaction(deps.pool, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('mtpos.import'))");
      await tx.query("SET LOCAL statement_timeout = '300s'"); // ~40.000 rows on the store's backup
      const why = await blocker(tx);
      if (why) throw new AppError('IMPORT_NOT_ALLOWED', why, 409);
      const plan = planHistoryImport(rows, await historyLookups(tx));

      const batchId = await repo.insertBatch(tx, { ...meta, status: 'RUNNING' });
      const refs = await writePlan(tx, ctx, plan);
      await repo.insertLegacyRefs(tx, batchId, refs);
      // Credit notes imported earlier by the receivables scope now get their note (total, DP).
      await repo.linkImportedReceivables(tx);

      const got = await historyImportedCounts(tx, batchId);
      const src = rows.source;
      const count = (label: string, a: number, b: number): ReconciliationRow => ({
        label,
        kind: 'count',
        ipos: String(a),
        imported: String(b),
        ok: a === b,
      });
      const money = (label: string, a: string, b: string): ReconciliationRow => ({
        label,
        kind: 'money',
        ipos: a,
        imported: b,
        ok: dec(a).eq(b),
      });
      const key = (m: { month: string; tipe: string }) => `${m.month} ${m.tipe}`;
      const imported = new Map(got.months.map((m) => [key(m), m]));
      const badMonths = src.months.filter((m) => {
        const i = imported.get(key(m));
        return !i || i.count !== m.count || !dec(i.total).eq(m.total);
      });
      const reconciliation: ReconciliationRow[] = [
        count('Nota kasir (KSR)', src.ksr, got.ksr),
        money('Total nota kasir', src.ksrTotal, got.ksrTotal),
        count('Faktur jual (JL)', src.jl, got.jl),
        money('Total faktur jual', src.jlTotal, got.jlTotal),
        money('HPP baris yang diketahui', src.saleCost, got.saleCost),
        count('Baris tanpa HPP', src.linesWithoutCost, got.linesWithoutCost),
        count('Bulan dengan selisih penjualan', 0, badMonths.length),
        count('Faktur beli (BL)', src.purchases, got.purchases),
        money('Total pembelian', src.purchasesTotal, got.purchasesTotal),
        count('Kas keluar (KASO)', src.cashOut, got.cashOut),
        money('Total kas keluar', src.cashOutTotal, got.cashOutTotal),
      ];
      await repo.finishBatch(tx, batchId, { counts: src, reconciliation, issues: plan.issues, source });
      await recordAudit(tx, ctx, {
        action: 'import.ipos.commit',
        entity: 'import_batch',
        entityId: batchId,
        after: {
          scope: meta.scope,
          purpose: input.purpose,
          file: meta.sourceFile,
          sha256: meta.sha256,
          sales: plan.sales.length,
          purchases: plan.purchases.length,
          cashRows: plan.cash.length,
        },
      });
      return batchId;
    });
    // ~40.000 new rows: refresh planner statistics now instead of waiting for autovacuum, so the
    // first reports after the import do not get row-count-1 nested-loop plans.
    await deps.pool
      .query(
        'ANALYZE sales, sale_items, sale_payments, goods_receipts, goods_receipt_items, purchase_invoices, purchase_invoice_items, cash_transactions, legacy_refs',
      )
      .catch(() => undefined);
    return (await repo.getBatch(deps.pool, id))!;
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    await repo
      .insertBatch(deps.pool, { ...meta, status: 'FAILED', summary: { error: message } })
      .catch(() => undefined);
    throw new AppError(
      'IMPORT_FAILED',
      'Impor histori gagal dan dibatalkan seluruhnya — tidak ada data yang masuk. Lihat log aplikasi untuk rinciannya.',
      500,
      { error: message },
    );
  }
}
