// iPOS importer, MASTER scope (FR-MIG-01…04, 07…09; Sprint 3 E3–E7).
// The main process restores the backup into `ipos_import`; this service reads it, plans the
// mapping with a pure function, and writes everything in ONE transaction with legacy_refs and
// an import_batches row. A failed import leaves no data behind, only a FAILED batch.
import { basename } from 'node:path';
import {
  CommitIposInput,
  ResetPreparationInput,
  type ImportBatch,
  type IposInspectResult,
  type IposMasterCounts,
  type ReconciliationRow,
  type ResetResult,
} from '@shared/schemas/imports';
import type { DbConfig, Pool, Queryable } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { recordAudit } from '../../lib/audit';
import { AppError, notFoundError } from '../../lib/errors';
import type { RequestCtx } from '../../middleware/auth';
import { planMasterImport, type MasterPlan } from './ipos-plan';
import { checkFingerprint, loadMasterRows, readSourceInfo, withIposDb } from './ipos-source';
import * as repo from './repo';

export interface ImportHooks {
  /** Writes a pg_dump of the app database (main process, sprint-3 S3-4); resolves with the file path. */
  backup(label: string): Promise<string>;
}

export interface ImportDeps {
  pool: Pool;
  /** Connection to the temporary iPOS database (same cluster, database `ipos_import`). */
  iposDb: DbConfig;
  hooks?: ImportHooks;
}

/** "2026-10-24 12:01:26" from the dump header, or null when it does not look like a timestamp. */
const dumpTimestamp = (v: string | null) =>
  v && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(v) ? v.slice(0, 19) : null;

async function blocker(db: Queryable): Promise<string | null> {
  if (await repo.goLiveAt(db))
    return 'Toko sudah resmi memakai aplikasi ini (go-live). Impor dari iPOS tidak bisa dijalankan lagi.';
  const m = await repo.masterDataPresent(db);
  if (m.batch || m.products || m.customers || m.suppliers) {
    const what = [
      m.products && `${m.products} barang`,
      m.customers && `${m.customers} pelanggan`,
      m.suppliers && `${m.suppliers} supplier`,
    ]
      .filter(Boolean)
      .join(', ');
    return `Data master sudah ada${what ? ` (${what})` : ''}. Untuk mengimpor ulang, jalankan "Reset data persiapan" dulu.`;
  }
  return null;
}

async function readPlan(deps: ImportDeps) {
  return withIposDb(deps.iposDb, async (src) => {
    const source = await readSourceInfo(src);
    const fingerprint = await checkFingerprint(src);
    if (fingerprint.length) return { source, fingerprint, plan: null };
    const rows = await loadMasterRows(src);
    const plan = planMasterImport(rows, await repo.existingMasters(deps.pool));
    return { source, fingerprint, plan };
  });
}

export async function inspect(deps: ImportDeps): Promise<IposInspectResult> {
  const { source, fingerprint, plan } = await readPlan(deps);
  return {
    source,
    fingerprint,
    counts: plan?.sourceCounts ?? null,
    issues: plan?.issues ?? [],
    blocker: fingerprint.length
      ? 'Struktur backup tidak cocok dengan iPOS 5 yang dikenal aplikasi ini.'
      : await blocker(deps.pool),
  };
}

function reconcile(plan: MasterPlan, got: repo.ImportedCounts): ReconciliationRow[] {
  const s = plan.sourceCounts;
  const rows: ReconciliationRow[] = [
    { label: 'Barang', ipos: s.products, imported: got.products },
    { label: 'Barang dengan lebih dari satu satuan', ipos: s.multiUnitProducts, imported: got.multiUnitProducts },
    { label: 'Satuan turunan (mis. ZAK = 50 KG)', ipos: s.derivedUnits, imported: got.derivedUnits },
    { label: 'Harga jual per satuan', ipos: s.pricedUnits, imported: got.pricedUnits },
    { label: 'Kategori', ipos: s.categories, imported: got.categories },
    { label: 'Satuan', ipos: s.units, imported: got.units },
    { label: 'Grup pelanggan', ipos: s.customerGroups, imported: got.customerGroups },
    { label: 'Pelanggan (termasuk UMUM)', ipos: s.customers, imported: got.customers },
  ];
  const groupCodes = new Set([...Object.keys(plan.sourceCustomersPerGroup), ...Object.keys(got.customersPerGroup)]);
  for (const code of [...groupCodes].sort()) {
    rows.push({
      label: `Pelanggan grup ${code}`,
      ipos: plan.sourceCustomersPerGroup[code] ?? 0,
      imported: got.customersPerGroup[code] ?? 0,
    });
  }
  rows.push(
    { label: 'Supplier', ipos: s.suppliers, imported: got.suppliers },
    { label: 'Rekening bank', ipos: s.bankAccounts, imported: got.bankAccounts },
  );
  return rows;
}

export async function commit(deps: ImportDeps, ctx: RequestCtx, raw: unknown): Promise<ImportBatch> {
  const { purpose } = CommitIposInput.parse(raw);
  const { source, fingerprint, plan } = await readPlan(deps);
  if (fingerprint.length || !plan) {
    throw new AppError(
      'IPOS_STRUCTURE_MISMATCH',
      'Struktur backup tidak cocok dengan iPOS 5 yang dikenal aplikasi ini.',
      422,
      { fingerprint },
    );
  }
  const meta = {
    sourceFile: basename(source.fileName),
    sha256: source.sha256,
    dumpAt: dumpTimestamp(source.dumpCreatedAt),
    purpose,
    scope: ['master' as const],
  };

  try {
    const id = await withTransaction(deps.pool, async (tx) => {
      // Serialise concurrent imports/resets and re-check inside the transaction (FR-MIG-03).
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('mtpos.import'))");
      const why = await blocker(tx);
      if (why) throw new AppError('IMPORT_NOT_ALLOWED', why, 409);

      const batchId = await repo.insertBatch(tx, { ...meta, status: 'RUNNING' });
      await repo.writeMasterPlan(tx, batchId, plan);
      const got = await repo.importedCounts(tx, batchId);
      const reconciliation = reconcile(plan, got);
      const counts: IposMasterCounts = plan.sourceCounts;
      await repo.finishBatch(tx, batchId, { counts, reconciliation, issues: plan.issues, source });
      await recordAudit(tx, ctx, {
        action: 'import.ipos.commit',
        entity: 'import_batch',
        entityId: batchId,
        after: { scope: meta.scope, purpose, file: meta.sourceFile, sha256: meta.sha256, counts },
      });
      return batchId;
    });
    return (await repo.getBatch(deps.pool, id))!;
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Leave a trace of the failed attempt; the data itself was rolled back.
    const message = err instanceof Error ? err.message : String(err);
    await repo
      .insertBatch(deps.pool, { ...meta, status: 'FAILED', summary: { error: message } })
      .catch(() => undefined);
    throw new AppError(
      'IMPORT_FAILED',
      'Impor gagal dan dibatalkan seluruhnya — tidak ada data yang masuk. Lihat log aplikasi untuk rinciannya.',
      500,
      { error: message },
    );
  }
}

export const listBatches = (pool: Pool) => repo.listBatches(pool);

export async function getBatch(pool: Pool, id: string): Promise<ImportBatch> {
  const b = await repo.getBatch(pool, id);
  if (!b) throw notFoundError('Riwayat impor');
  return b;
}

/** FR-MIG-08: automatic backup first, then wipe the preparation data in one transaction. */
export async function resetPreparation(deps: ImportDeps, ctx: RequestCtx, raw: unknown): Promise<ResetResult> {
  ResetPreparationInput.parse(raw);
  if (await repo.goLiveAt(deps.pool)) {
    throw new AppError(
      'ALREADY_LIVE',
      'Toko sudah go-live. Data resmi tidak bisa direset; kembali ke kondisi lama hanya lewat restore backup.',
      409,
    );
  }
  if (!deps.hooks)
    throw new AppError(
      'BACKUP_UNAVAILABLE',
      'Backup otomatis tidak tersedia di perangkat ini. Reset hanya bisa dari komputer toko.',
      503,
    );
  let backupFile: string;
  try {
    backupFile = basename(await deps.hooks.backup('pre-reset'));
  } catch (err) {
    throw new AppError(
      'BACKUP_FAILED',
      'Backup otomatis gagal, jadi data TIDAK direset. Coba lagi atau periksa ruang disk.',
      500,
      {
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }
  const discardedBatches = await withTransaction(deps.pool, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('mtpos.import'))");
    const n = await repo.wipePreparationData(tx);
    await recordAudit(tx, ctx, {
      action: 'system.reset_preparation',
      entity: 'system',
      after: { backupFile, discardedBatches: n },
    });
    return n;
  });
  return { backupFile, discardedBatches };
}
