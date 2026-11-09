// iPOS importer, RECEIVABLES & PAYABLES scope (FR-MIG-02 "Piutang", FR-MIG-03…05, sprint-9 S9-6).
// Every iPOS credit note — paid off or not — becomes a receivable worth its original credit, and
// every BP instalment becomes a receivable payment allocated to the same notes as in iPOS, so the
// app shows the whole story (credit, instalments, what is left) and what is left equals iPOS.
// Notes are linked to the sale of the history scope (total, DP) whichever scope runs last.
// Historical BP payments add no cash-book rows (like the history scope: the cash balance today
// is not rebuilt from 2 years of history). Supplier debts: only the invoices the Owner ticks.
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
import { insertMany } from './history-repo';
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

export interface ArApLookups {
  /** iPOS kodesupel → customer / supplier (master scope's legacy_refs). */
  customers: Map<string, { id: string; name: string }>;
  suppliers: Map<string, { id: string; name: string }>;
  /** Upper-case numbers of receivable payments already made in this app (dev/test documents). */
  takenPayments: Set<string>;
}

interface ReceivablePlan {
  legacyKey: string;
  customerId: string;
  docDate: string;
  dueDate: string;
  /** The original credit (jmlkredit − deduction), not what is left. */
  amount: string;
  /** Σ of the allocations below — paid_amount. */
  paid: Decimal;
}

interface PaymentPlan {
  legacyKey: string;
  customerId: string;
  paidAt: string;
  amount: string;
  note: string | null;
  allocations: { legacyKey: string; amount: string }[];
}

export interface ArApPlan {
  receivables: ReceivablePlan[];
  payments: PaymentPlan[];
  payables: (IposArApInspectResult['payables'][number] & { supplierId: string | null })[];
  issues: DataIssue[];
}

function findings() {
  const by = new Map<string, DataIssue>();
  return {
    add(code: string, title: string, action: string, example: string) {
      const i = by.get(code) ?? { code, title, action, count: 0, examples: [] };
      i.count += 1;
      if (i.examples.length < 5) i.examples.push(example);
      by.set(code, i);
    },
    list: () => [...by.values()],
  };
}

/** Pure mapping iPOS rows → documents, with the findings the Owner should see. */
export function planArAp(rows: IposArApRows, look: ArApLookups): ArApPlan {
  const f = findings();
  const receivables: ReceivablePlan[] = [];
  const byKey = new Map<string, ReceivablePlan>();
  /** krd_jml_byr per note: what iPOS says was paid, to compare with the instalments found. */
  const iposPaid = new Map<string, string>();
  for (const r of rows.credits) {
    const c = look.customers.get(clean(r.kodesupel));
    if (!c) {
      f.add(
        'AR_UNKNOWN_CUSTOMER',
        'Nota kredit dengan pelanggan yang tidak ada di data master',
        'Tidak diimpor. Periksa pelanggannya di iPOS, lalu catat sebagai saldo awal piutang bila masih ditagih.',
        `${r.notransaksi} (${clean(r.kodesupel) || 'tanpa pelanggan'})`,
      );
      continue;
    }
    if (dec(r.credit).lte(0)) continue; // fully deducted: nothing was ever owed
    if (!r.jatuhtempo && dec(r.open).gt(0)) {
      f.add(
        'AR_NO_DUE_DATE',
        'Piutang tanpa tanggal jatuh tempo',
        'Jatuh tempo diisi sama dengan tanggal nota.',
        r.notransaksi,
      );
    }
    const doc: ReceivablePlan = {
      legacyKey: r.notransaksi,
      customerId: c.id,
      docDate: r.tanggal,
      dueDate: r.jatuhtempo && r.jatuhtempo >= r.tanggal ? r.jatuhtempo : r.tanggal,
      amount: toMoney(r.credit),
      paid: new Decimal(0),
    };
    receivables.push(doc);
    byKey.set(r.notransaksi, doc);
    iposPaid.set(r.notransaksi, r.paid);
  }

  // Instalments in date order, so a cap (never more than the note's credit) hits the latest ones.
  const payments: PaymentPlan[] = [];
  for (const p of rows.payments) {
    if (look.takenPayments.has(p.notransaksi.toUpperCase())) {
      f.add(
        'AR_PAYMENT_NUMBER_TAKEN',
        'Nomor pelunasan iPOS sudah dipakai pembayaran di aplikasi ini',
        'Pelunasan iPOS ini dilewati. Biasanya pembayaran uji coba — jalankan "Reset data persiapan" lalu impor ulang.',
        p.notransaksi,
      );
      continue;
    }
    const c = look.customers.get(clean(p.kodesupel));
    const allocations: PaymentPlan['allocations'] = [];
    let total = new Decimal(0);
    for (const a of p.allocations) {
      const doc = byKey.get(a.note);
      if (!c || !doc || doc.customerId !== c.id) continue;
      const room = dec(doc.amount).minus(doc.paid);
      const take = Decimal.min(room, a.amount);
      if (take.lte(0)) continue;
      doc.paid = doc.paid.plus(take);
      total = total.plus(take);
      allocations.push({ legacyKey: a.note, amount: toMoney(take) });
    }
    if (!total.eq(p.total)) {
      f.add(
        'AR_PAYMENT_UNMATCHED',
        'Pelunasan iPOS yang tidak seluruhnya cocok dengan nota kredit yang diimpor',
        'Hanya bagian yang cocok yang diimpor (nota lain pelanggan, nota tidak ada, atau melebihi kreditnya).',
        p.notransaksi,
      );
    }
    if (!c || total.lte(0)) continue;
    payments.push({
      legacyKey: p.notransaksi,
      customerId: c.id,
      paidAt: `${p.tanggal}+07:00`,
      amount: toMoney(total),
      note: p.keterangan,
      allocations,
    });
  }
  for (const d of receivables) {
    if (!d.paid.eq(iposPaid.get(d.legacyKey)!)) {
      f.add(
        'AR_PAID_MISMATCH',
        'Nota kredit yang jumlah pelunasannya berbeda dari catatan iPOS',
        'Sisa piutang dihitung dari pelunasan yang terimpor. Periksa nota ini di iPOS.',
        d.legacyKey,
      );
    }
  }

  const payables = rows.payables.map((p) => {
    const s = look.suppliers.get(clean(p.kodesupel));
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
  for (const p of payables.filter((x) => !x.supplierId)) {
    f.add(
      'AP_UNKNOWN_SUPPLIER',
      'Faktur kredit dengan supplier yang tidak ada di data master',
      'Tidak bisa dicentang. Catat sebagai hutang manual bila memang belum lunas.',
      `${p.legacyKey} (${p.supplierCode})`,
    );
  }
  return { receivables, payments, payables, issues: f.list() };
}

async function lookups(db: Queryable): Promise<ArApLookups> {
  const customers = await repo.partyIdsByCode(db, 'customer');
  const suppliers = await repo.partyIdsByCode(db, 'supplier');
  const taken = await db.query<{ number: string }>(`SELECT upper(number) AS number FROM receivable_payments`);
  return { customers, suppliers, takenPayments: new Set(taken.rows.map((r) => r.number)) };
}

export async function inspectArAp(deps: ImportDeps): Promise<IposArApInspectResult> {
  const { source, fingerprint, rows } = await readRows(deps);
  const p = rows ? planArAp(rows, await lookups(deps.pool)) : null;
  return {
    source,
    fingerprint,
    counts: rows?.source ?? null,
    issues: p?.issues ?? [],
    payables: (p?.payables ?? []).map(({ supplierId: _s, ...x }) => x),
    blocker: fingerprint.length ? MISMATCH : await blocker(deps.pool),
  };
}

/** Bulk-writes the credit notes, instalments and allocations; returns the legacy_refs to record. */
async function writeReceivables(tx: Queryable, ctx: RequestCtx, plan: ArApPlan) {
  const cash = await tx.query<{ id: string }>(
    `SELECT id FROM payment_methods WHERE kind = 'CASH' AND deleted_at IS NULL ORDER BY sort_order LIMIT 1`,
  );
  const cashMethod = cash.rows[0]?.id;
  if (!cashMethod) throw new Error('cash payment method missing');
  const refs: { entity: string; legacyKey: string; entityId: string }[] = [];
  const docIds = new Map<string, string>();
  const docRows = plan.receivables.map((r) => {
    const id = uuidv7();
    docIds.set(r.legacyKey, id);
    refs.push({ entity: 'receivable', legacyKey: r.legacyKey, entityId: id });
    const status = r.paid.isZero() ? 'OPEN' : r.paid.gte(r.amount) ? 'PAID' : 'PARTIAL';
    // OPENING until linkImportedReceivables() finds the note of the history scope.
    return [id, r.customerId, 'OPENING', r.legacyKey, r.docDate, r.dueDate, r.amount, toMoney(r.paid), status];
  });
  // Allocation ids in instalment order (strictly increasing timestamps): a reprinted iPOS BP then
  // shows "sisa" as it was right after that instalment (ar-ap repo getPayment).
  const allocCount = plan.payments.reduce((n, p) => n + p.allocations.length, 0);
  let tick = Date.now() - allocCount - 1;
  const paymentRows: unknown[][] = [];
  const allocRows: unknown[][] = [];
  for (const p of plan.payments) {
    const id = uuidv7();
    refs.push({ entity: 'receivable_payment', legacyKey: p.legacyKey, entityId: id });
    paymentRows.push([id, p.legacyKey, p.customerId, p.paidAt, cashMethod, p.amount, p.note, ctx.userId]);
    for (const a of p.allocations) allocRows.push([uuidv7((tick += 1)), id, docIds.get(a.legacyKey)!, a.amount]);
  }
  await insertMany(
    tx,
    'receivables',
    [
      ['id', 'uuid'],
      ['customer_id', 'uuid'],
      ['source_type', 'text'],
      ['doc_number', 'text'],
      ['doc_date', 'date'],
      ['due_date', 'date'],
      ['amount', 'numeric'],
      ['paid_amount', 'numeric'],
      ['status', 'text'],
    ],
    docRows,
  );
  await insertMany(
    tx,
    'receivable_payments',
    [
      ['id', 'uuid'],
      ['number', 'text'],
      ['customer_id', 'uuid'],
      ['paid_at', 'timestamptz'],
      ['payment_method_id', 'uuid'],
      ['amount', 'numeric'],
      ['note', 'text'],
      ['created_by', 'uuid'],
    ],
    paymentRows,
  );
  await insertMany(
    tx,
    'receivable_payment_allocations',
    [
      ['id', 'uuid'],
      ['receivable_payment_id', 'uuid'],
      ['receivable_id', 'uuid'],
      ['amount', 'numeric'],
    ],
    allocRows,
  );
  return refs;
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
      await tx.query("SET LOCAL statement_timeout = '120s'"); // ~2.200 notes + 2.500 instalments
      const why = await blocker(tx);
      if (why) throw new AppError('IMPORT_NOT_ALLOWED', why, 409);
      const p = planArAp(rows, await lookups(tx));

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
      const refs = await writeReceivables(tx, ctx, p);
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
      await repo.linkImportedReceivables(tx);

      const got = await tx.query<{
        n: number;
        credit: string;
        open_n: number;
        open: string;
        customers: number;
        linked: number;
      }>(
        `SELECT count(*)::int AS n, coalesce(sum(r.amount), 0)::numeric(18,2)::text AS credit,
                (count(*) FILTER (WHERE r.amount > r.paid_amount))::int AS open_n,
                coalesce(sum(r.amount - r.paid_amount), 0)::numeric(18,2)::text AS open,
                (count(DISTINCT r.customer_id) FILTER (WHERE r.amount > r.paid_amount))::int AS customers,
                (count(*) FILTER (WHERE r.source_type = 'SALE'))::int AS linked
         FROM legacy_refs l JOIN receivables r ON r.id = l.entity_id WHERE l.import_batch_id = $1 AND l.entity = 'receivable'`,
        [batchId],
      );
      const pays = await tx.query<{ n: number; total: string }>(
        `SELECT count(*)::int AS n, coalesce(sum(p.amount), 0)::numeric(18,2)::text AS total
         FROM legacy_refs l JOIN receivable_payments p ON p.id = l.entity_id
         WHERE l.import_batch_id = $1 AND l.entity = 'receivable_payment'`,
        [batchId],
      );
      const g = got.rows[0]!;
      const gp = pays.rows[0]!;
      const src = rows.source;
      const count = (label: string, a: number, b: number, ok = a === b): ReconciliationRow => ({
        label,
        kind: 'count',
        ipos: String(a),
        imported: String(b),
        ok,
      });
      const money = (label: string, a: string, b: string, ok = dec(a).eq(b)): ReconciliationRow => ({
        label,
        kind: 'money',
        ipos: a,
        imported: b,
        ok,
      });
      const reconciliation: ReconciliationRow[] = [
        count('Nota kredit (lunas & belum)', src.creditNotes, g.n),
        money('Total kredit', src.creditTotal, g.credit),
        count('Pelunasan piutang (BP)', src.payments, gp.n),
        money('Total pelunasan', src.paymentsTotal, gp.total),
        count('Nota piutang terbuka', src.receivables, g.open_n),
        money('Total sisa piutang', src.receivablesOpen, g.open),
        count('Pelanggan berpiutang', src.customers, g.customers),
        // Linking needs the history scope; before it, notes stay "saldo awal" — shown, not an error.
        count('Nota kredit tertaut ke nota histori', g.n, g.linked, true),
        // Supplier debts are the Owner's choice: shown, not expected to match iPOS.
        count('Faktur hutang dicentang', src.payables, ticked.length, true),
        money('Total hutang dicentang', src.payablesOpen, sum(ticked.map((t) => ({ open: t.amount }))), true),
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
