// iPOS importer, OPENING STOCK scope (FR-MIG-02, sprint-4 C1–C4). Needs the master scope first.
// Everything goes through stockService.apply in one transaction, so the opening stock obeys the
// same ledger / FIFO / lock rules as every later document.
import { basename } from 'node:path';
import { dec } from '@shared/money';
import {
  CommitIposInput,
  type ImportBatch,
  type IposStockInspectResult,
  type ReconciliationRow,
} from '@shared/schemas/imports';
import type { Queryable } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { recordAudit } from '../../lib/audit';
import { clock } from '../../lib/clock';
import { AppError } from '../../lib/errors';
import type { RequestCtx } from '../../middleware/auth';
import { defaultWarehouse } from '../stock/read-repo';
import * as stock from '../stock/service';
import { checkFingerprint, loadStockRows, readSourceInfo, STOCK_FINGERPRINT, withIposDb } from './ipos-source';
import { planStockImport } from './ipos-stock-plan';
import * as repo from './repo';
import type { ImportDeps } from './service';

const dumpTimestamp = (v: string | null) =>
  v && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(v) ? v.slice(0, 19) : null;

async function blocker(db: Queryable): Promise<string | null> {
  if (await repo.goLiveAt(db))
    return 'Toko sudah resmi memakai aplikasi ini (go-live). Impor dari iPOS tidak bisa dijalankan lagi.';
  const s = await repo.scopeState(db);
  if (!s.master) return 'Impor data master (barang, satuan, harga) dulu — stok awal butuh daftar barangnya.';
  if (s.stock || s.movements > 0)
    return 'Stok sudah terisi. Untuk mengimpor ulang stok awal, jalankan "Reset data persiapan" dulu.';
  return null;
}

async function readPlan(deps: ImportDeps) {
  return withIposDb(deps.iposDb, async (src) => {
    const source = await readSourceInfo(src);
    const fingerprint = await checkFingerprint(src, STOCK_FINGERPRINT);
    if (fingerprint.length) return { source, fingerprint, rows: null };
    return { source, fingerprint, rows: await loadStockRows(src) };
  });
}

export async function inspectStock(deps: ImportDeps): Promise<IposStockInspectResult> {
  const { source, fingerprint, rows } = await readPlan(deps);
  const plan = rows ? planStockImport(rows, await repo.productIdsByCode(deps.pool)) : null;
  return {
    source,
    fingerprint,
    counts: rows?.source ?? null,
    issues: plan?.issues ?? [],
    blocker: fingerprint.length
      ? 'Struktur tabel stok di backup tidak cocok dengan iPOS 5 yang dikenal aplikasi ini.'
      : await blocker(deps.pool),
  };
}

function reconcile(
  src: NonNullable<Awaited<ReturnType<typeof readPlan>>['rows']>['source'],
  got: Awaited<ReturnType<typeof repo.stockImportedCounts>>,
): ReconciliationRow[] {
  // HPP is stored with 4 decimals; iPOS keeps 20. Allow that rounding on the value: ½ × 0,0001 per base unit.
  const tolerance = dec(src.qty).abs().times('0.00005').plus('0.01');
  const valueOk = dec(src.value).minus(got.value).abs().lte(tolerance);
  return [
    {
      label: 'Barang berstok',
      kind: 'count',
      ipos: String(src.products),
      imported: String(got.products),
      ok: src.products === got.products,
    },
    {
      label: 'Lapisan HPP FIFO',
      kind: 'count',
      ipos: String(src.layers),
      imported: String(got.layers),
      ok: src.layers === got.layers,
    },
    { label: 'Total stok (satuan dasar)', kind: 'qty', ipos: src.qty, imported: got.qty, ok: dec(src.qty).eq(got.qty) },
    { label: 'Nilai persediaan (HPP FIFO)', kind: 'money', ipos: src.value, imported: got.value, ok: valueOk },
    {
      label: 'Barang dengan stok minus',
      kind: 'count',
      ipos: String(src.minusProducts),
      imported: String(got.minusProducts),
      ok: src.minusProducts === got.minusProducts,
    },
  ];
}

export async function commitStock(deps: ImportDeps, ctx: RequestCtx, raw: unknown): Promise<ImportBatch> {
  const { purpose } = CommitIposInput.parse(raw);
  const { source, fingerprint, rows } = await readPlan(deps);
  if (fingerprint.length || !rows) {
    throw new AppError(
      'IPOS_STRUCTURE_MISMATCH',
      'Struktur tabel stok di backup tidak cocok dengan iPOS 5 yang dikenal aplikasi ini.',
      422,
      { fingerprint },
    );
  }
  const dumpAt = dumpTimestamp(source.dumpCreatedAt);
  const meta = {
    sourceFile: basename(source.fileName),
    sha256: source.sha256,
    dumpAt,
    purpose,
    scope: ['stock' as const],
  };
  try {
    const id = await withTransaction(deps.pool, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('mtpos.import'))");
      const why = await blocker(tx);
      if (why) throw new AppError('IMPORT_NOT_ALLOWED', why, 409);

      const plan = planStockImport(rows, await repo.productIdsByCode(tx));
      const wh = await defaultWarehouse(tx);
      const batchId = await repo.insertBatch(tx, { ...meta, status: 'RUNNING' });
      // Opening stock is "as of the backup": the backup time (WIB) is the movements' business time.
      const movedAt = dumpAt ? new Date(`${dumpAt.replace(' ', 'T')}+07:00`) : clock.now();
      const applied = await stock.apply(
        tx,
        plan.movements.map((m) => ({
          productId: m.productId,
          warehouseId: wh.id,
          qty: m.qty,
          unitCost: m.unitCost,
          layerReceivedAt: m.layerReceivedAt,
          sourceType: 'OPENING' as const,
          sourceId: batchId,
          movedAt,
          note: m.legacyKey ? 'Saldo awal iPOS' : 'Saldo awal iPOS (selisih stok vs lapisan)',
        })),
        // iPOS may hold negative stock (JUAL_STOK_HABIS = 1): take it over as it is.
        { allowNegative: true, createdBy: ctx.userId },
      );
      await repo.setLastPurchaseCosts(tx, plan.lastCost);
      await repo.insertLegacyRefs(
        tx,
        batchId,
        plan.movements.flatMap((m, i) =>
          m.legacyKey ? [{ entity: 'stock_layer', legacyKey: m.legacyKey, entityId: applied[i]!.movementId }] : [],
        ),
      );
      const got = await repo.stockImportedCounts(tx, batchId);
      const reconciliation = reconcile(rows.source, got);
      await repo.finishBatch(tx, batchId, { counts: rows.source, reconciliation, issues: plan.issues, source });
      await recordAudit(tx, ctx, {
        action: 'import.ipos.commit',
        entity: 'import_batch',
        entityId: batchId,
        after: { scope: meta.scope, purpose, file: meta.sourceFile, sha256: meta.sha256, counts: rows.source },
      });
      return batchId;
    });
    return (await repo.getBatch(deps.pool, id))!;
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    await repo
      .insertBatch(deps.pool, { ...meta, status: 'FAILED', summary: { error: message } })
      .catch(() => undefined);
    throw new AppError(
      'IMPORT_FAILED',
      'Impor stok gagal dan dibatalkan seluruhnya — tidak ada data yang masuk. Lihat log aplikasi untuk rinciannya.',
      500,
      {
        error: message,
      },
    );
  }
}
