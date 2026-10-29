// iPOS importer, OPEN RECEIVABLES & PAYABLES scope (FR-MIG-02 "Piutang", FR-MIG-05, sprint-9 S9-6).
// Every open iPOS credit note becomes an OPENING receivable with its own number, date and due
// date (amount = what is still open); supplier debts only for the invoices the Owner ticks.
import { basename } from 'node:path';
import { dec, Decimal, toMoney } from '@shared/money';
import {
  CommitIposArApInput,
  type DataIssue,
  type ImportBatch,
  type IposArApInspectResult,
  type ReconciliationRow,
} from '@shared/schemas/imports';
import { uuidv7 } from '@shared/uuid';
import type { Queryable } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { recordAudit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import type { RequestCtx } from '../../middleware/auth';
import * as arAp from '../ar-ap/repo';
import {
  AR_AP_FINGERPRINT,
  checkFingerprint,
  loadArApRows,
  readSourceInfo,
  withIposDb,
  type IposArApRows,
} from './ipos-source';
import * as repo from './repo';
import type { ImportDeps } from './service';

const MISMATCH = 'Struktur tabel piutang/hutang di backup tidak cocok dengan iPOS 5 yang dikenal aplikasi ini.';
const clean = (v: string) => v.replace(/\s+/g, ' ').trim();
const sum = (xs: { open: string }[]) => toMoney(xs.reduce((s, x) => s.plus(x.open), new Decimal(0)));

async function blocker(db: Queryable): Promise<string | null> {
  if (await repo.goLiveAt(db))
    return 'Toko sudah resmi memakai aplikasi ini (go-live). Impor dari iPOS tidak bisa dijalankan lagi.';
  const s = await repo.scopeState(db);
  if (!s.master) return 'Impor data master (pelanggan, supplier) dulu — piutang & hutang butuh daftarnya.';
  if (s.receivables)
    return 'Piutang & hutang iPOS sudah diimpor. Untuk mengimpor ulang, jalankan "Reset data persiapan" dulu.';
  return null;
}

async function readRows(deps: ImportDeps) {
  return withIposDb(deps.iposDb, async (src) => {
    const source = await readSourceInfo(src);
    const fingerprint = await checkFingerprint(src, AR_AP_FINGERPRINT);
    if (fingerprint.length) return { source, fingerprint, rows: null };
    return { source, fingerprint, rows: await loadArApRows(src) };
  });
}

interface Plan {
  receivables: { legacyKey: string; customerId: string; docDate: string; dueDate: string; amount: string }[];
  payables: (IposArApInspectResult['payables'][number] & { supplierId: string | null })[];
  issues: DataIssue[];
}

/** Pure mapping iPOS rows → documents, with the findings the Owner should see. */
async function plan(db: Queryable, rows: IposArApRows): Promise<Plan> {
  const customers = await repo.partyIdsByCode(db, 'customer');
  const suppliers = await repo.partyIdsByCode(db, 'supplier');
  const unknownCustomer: string[] = [];
  const noDue: string[] = [];
  const receivables: Plan['receivables'] = [];
  for (const r of rows.receivables) {
    const c = customers.get(clean(r.kodesupel));
    if (!c) {
      unknownCustomer.push(`${r.notransaksi} (${clean(r.kodesupel) || 'tanpa pelanggan'})`);
      continue;
    }
    if (!r.jatuhtempo) noDue.push(r.notransaksi);
    const dueDate = r.jatuhtempo && r.jatuhtempo >= r.tanggal ? r.jatuhtempo : r.tanggal;
    receivables.push({ legacyKey: r.notransaksi, customerId: c.id, docDate: r.tanggal, dueDate, amount: r.open });
  }
  const payables = rows.payables.map((p) => {
    const s = suppliers.get(clean(p.kodesupel));
    return {
      legacyKey: p.notransaksi,
      supplierCode: clean(p.kodesupel),
      supplierName: s?.name ?? null,
      supplierId: s?.id ?? null,
      docDate: p.tanggal,
      dueDate: p.jatuhtempo && p.jatuhtempo >= p.tanggal ? p.jatuhtempo : p.tanggal,
      open: p.open,
    };
  });
  const issues: DataIssue[] = [];
  if (unknownCustomer.length) {
    issues.push({
      code: 'AR_UNKNOWN_CUSTOMER',
      title: 'Piutang dengan pelanggan yang tidak ada di data master',
      action: 'Tidak diimpor. Periksa pelanggannya di iPOS, lalu catat sebagai saldo awal piutang bila masih ditagih.',
      count: unknownCustomer.length,
      examples: unknownCustomer.slice(0, 5),
    });
  }
  if (noDue.length) {
    issues.push({
      code: 'AR_NO_DUE_DATE',
      title: 'Piutang tanpa tanggal jatuh tempo',
      action: 'Jatuh tempo diisi sama dengan tanggal nota.',
      count: noDue.length,
      examples: noDue.slice(0, 5),
    });
  }
  const unknownSupplier = payables.filter((p) => !p.supplierId);
  if (unknownSupplier.length) {
    issues.push({
      code: 'AP_UNKNOWN_SUPPLIER',
      title: 'Faktur kredit dengan supplier yang tidak ada di data master',
      action: 'Tidak bisa dicentang. Catat sebagai hutang manual bila memang belum lunas.',
      count: unknownSupplier.length,
      examples: unknownSupplier.slice(0, 5).map((p) => `${p.legacyKey} (${p.supplierCode})`),
    });
  }
  return { receivables, payables, issues };
}

export async function inspectArAp(deps: ImportDeps): Promise<IposArApInspectResult> {
  const { source, fingerprint, rows } = await readRows(deps);
  const p = rows ? await plan(deps.pool, rows) : null;
  return {
    source,
    fingerprint,
    counts: rows?.source ?? null,
    issues: p?.issues ?? [],
    payables: (p?.payables ?? []).map(({ supplierId: _s, ...x }) => x),
    blocker: fingerprint.length ? MISMATCH : await blocker(deps.pool),
  };
}

export async function commitArAp(deps: ImportDeps, ctx: RequestCtx, raw: unknown): Promise<ImportBatch> {
  const input = CommitIposArApInput.parse(raw);
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
    scope: ['receivables' as const],
  };
  try {
    const id = await withTransaction(deps.pool, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('mtpos.import'))");
      const why = await blocker(tx);
      if (why) throw new AppError('IMPORT_NOT_ALLOWED', why, 409);
      const p = await plan(tx, rows);

      // FR-MIG-05: only ticked invoices, never more than iPOS says is open.
      const candidates = new Map(p.payables.map((x) => [x.legacyKey, x]));
      const ticked = input.payables.map((t) => {
        const c = candidates.get(t.legacyKey);
        if (!c || !c.supplierId) {
          throw new AppError(
            'IMPORT_PAYABLE_INVALID',
            `Faktur ${t.legacyKey} bukan faktur kredit iPOS yang bisa diimpor.`,
            422,
          );
        }
        if (dec(t.amount).gt(c.open)) {
          throw new AppError(
            'IMPORT_PAYABLE_TOO_MUCH',
            `Faktur ${t.legacyKey}: sisa hutang paling banyak ${c.open}.`,
            422,
          );
        }
        return { ...c, supplierId: c.supplierId, amount: toMoney(t.amount) };
      });
      if (new Set(ticked.map((t) => t.legacyKey)).size !== ticked.length) {
        throw new AppError('IMPORT_PAYABLE_INVALID', 'Ada faktur hutang yang dicentang dua kali.', 422);
      }

      const batchId = await repo.insertBatch(tx, { ...meta, status: 'RUNNING' });
      const refs: { entity: string; legacyKey: string; entityId: string }[] = [];
      for (const r of p.receivables) {
        const docId = uuidv7();
        await arAp.insertOpening(tx, 'AR', {
          id: docId,
          partyId: r.customerId,
          docNumber: r.legacyKey,
          docDate: r.docDate,
          dueDate: r.dueDate,
          amount: r.amount,
        });
        refs.push({ entity: 'receivable', legacyKey: r.legacyKey, entityId: docId });
      }
      for (const t of ticked) {
        const docId = uuidv7();
        await arAp.insertOpening(tx, 'AP', {
          id: docId,
          partyId: t.supplierId,
          docNumber: t.legacyKey,
          docDate: t.docDate,
          dueDate: t.dueDate,
          amount: t.amount,
        });
        refs.push({ entity: 'payable', legacyKey: t.legacyKey, entityId: docId });
      }
      await repo.insertLegacyRefs(tx, batchId, refs);

      const got = await tx.query<{ n: number; open: string; customers: number }>(
        `SELECT count(*)::int AS n, coalesce(sum(r.amount), 0)::numeric(18,2)::text AS open,
                count(DISTINCT r.customer_id)::int AS customers
         FROM legacy_refs l JOIN receivables r ON r.id = l.entity_id WHERE l.import_batch_id = $1 AND l.entity = 'receivable'`,
        [batchId],
      );
      const g = got.rows[0]!;
      const src = rows.source;
      const reconciliation: ReconciliationRow[] = [
        {
          label: 'Nota piutang terbuka',
          kind: 'count',
          ipos: String(src.receivables),
          imported: String(g.n),
          ok: src.receivables === g.n,
        },
        {
          label: 'Total sisa piutang',
          kind: 'money',
          ipos: src.receivablesOpen,
          imported: g.open,
          ok: dec(src.receivablesOpen).eq(g.open),
        },
        {
          label: 'Pelanggan berpiutang',
          kind: 'count',
          ipos: String(src.customers),
          imported: String(g.customers),
          ok: src.customers === g.customers,
        },
        // Supplier debts are the Owner's choice: shown, not expected to match iPOS.
        {
          label: 'Faktur hutang dicentang',
          kind: 'count',
          ipos: String(src.payables),
          imported: String(ticked.length),
          ok: true,
        },
        {
          label: 'Total hutang dicentang',
          kind: 'money',
          ipos: src.payablesOpen,
          imported: sum(ticked.map((t) => ({ open: t.amount }))),
          ok: true,
        },
      ];
      await repo.finishBatch(tx, batchId, { counts: src, reconciliation, issues: p.issues, source });
      await recordAudit(tx, ctx, {
        action: 'import.ipos.commit',
        entity: 'import_batch',
        entityId: batchId,
        after: {
          scope: meta.scope,
          purpose: input.purpose,
          file: meta.sourceFile,
          sha256: meta.sha256,
          counts: src,
          payablesTicked: ticked.length,
        },
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
      'Impor piutang & hutang gagal dan dibatalkan seluruhnya — tidak ada data yang masuk. Lihat log aplikasi untuk rinciannya.',
      500,
      { error: message },
    );
  }
}
