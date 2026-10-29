// Receivable payments BP & payable payments BH (FR-ARAP-02/03, sprint-9 S9-1…S9-3), due lists &
// aging (FR-ARAP-04/05) and opening balances (FR-ARAP-06). One payment = one transaction:
// number, payment, allocations (+ document paid/status), cash book row, audit.
import { allocateOldestFirst } from '@shared/ar-ap';
import { dec, Decimal, toMoney } from '@shared/money';
import {
  AgingQuery,
  OpeningPayableInput,
  OpeningReceivableInput,
  PayablePaymentInput,
  ReceivablePaymentInput,
  type AgingPage,
  type OpenDoc,
  type PartyPayment,
} from '@shared/schemas/ar-ap';
import { uuidv7 } from '@shared/uuid';
import type { Pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { recordAudit } from '../../lib/audit';
import { clock, jakartaDate } from '../../lib/clock';
import { AppError, notFoundError } from '../../lib/errors';
import { nextDocNumber } from '../../lib/numbering';
import type { RequestCtx } from '../../middleware/auth';
import * as salesRepo from '../sales/repo';
import { defaultWarehouse } from '../stock/read-repo';
import * as repo from './repo';
import type { Side } from './repo';

const invalid = (code: string, message: string, details?: unknown) => new AppError(code, message, 422, details);
/** "Rp 1.500.000" for error messages (decimal-safe). */
const rupiah = (v: Decimal.Value) =>
  `Rp ${dec(v)
    .toFixed(0)
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;

/** Jakarta business date, YYYY-MM-DD. */
export function today(): string {
  const j = jakartaDate(clock.now());
  return `${j.year}-${String(j.month).padStart(2, '0')}-${String(j.day).padStart(2, '0')}`;
}

const WORDS = {
  AR: {
    party: 'Pelanggan',
    open: 'piutang',
    docType: 'BP' as const,
    cashAccount: 'LACI',
    category: 'AR_PAYMENT',
    direction: 'IN' as const,
  },
  AP: {
    party: 'Supplier',
    open: 'hutang',
    docType: 'BH' as const,
    cashAccount: 'KAS_TOKO',
    category: 'AP_PAYMENT',
    direction: 'OUT' as const,
  },
};

export async function aging(
  pool: Pool,
  side: Side,
  raw: unknown,
): Promise<AgingPage & { total: number; page: number; pageSize: number }> {
  const query = AgingQuery.parse(raw);
  const r = await repo.aging(pool, side, today(), query);
  return { ...r, page: query.page, pageSize: query.pageSize };
}

export async function openDocs(pool: Pool, side: Side, partyId: string): Promise<OpenDoc[]> {
  if (!(await repo.party(pool, side, partyId))) throw notFoundError(WORDS[side].party);
  return repo.openDocs(pool, side, partyId, today());
}

export async function listPayments(pool: Pool, side: Side, partyId: string) {
  return repo.listPayments(pool, side, partyId);
}

export async function getPayment(pool: Pool, side: Side, id: string): Promise<PartyPayment> {
  const p = await repo.getPayment(pool, side, id);
  if (!p) throw notFoundError(side === 'AR' ? 'Pembayaran piutang' : 'Pembayaran hutang');
  return p;
}

/** Explicit allocations must hit the party's open documents, at most their balance, and add up. */
function checkedAllocations(
  side: Side,
  docs: OpenDoc[],
  amount: string,
  manual: { documentId: string; amount: string }[] | null,
): { documentId: string; amount: string }[] {
  const w = WORDS[side];
  const open = docs.reduce((s, d) => s.plus(d.open), new Decimal(0));
  if (docs.length === 0) throw invalid('NOTHING_OPEN', `${w.party} ini tidak punya ${w.open} yang belum lunas.`);
  if (dec(amount).gt(open)) {
    throw invalid('PAYMENT_TOO_MUCH', `Pembayaran ${rupiah(amount)} melebihi sisa ${w.open} ${rupiah(open)}.`, {
      open: toMoney(open),
    });
  }
  if (!manual) return allocateOldestFirst(docs, amount);
  const byId = new Map(docs.map((d) => [d.id, d]));
  const seen = new Set<string>();
  let sum = new Decimal(0);
  for (const a of manual) {
    const d = byId.get(a.documentId);
    if (!d || seen.has(a.documentId)) throw invalid('ALLOCATION_INVALID', `Nota yang dipilih bukan ${w.open} terbuka.`);
    seen.add(a.documentId);
    if (dec(a.amount).gt(d.open)) {
      throw invalid('ALLOCATION_TOO_MUCH', `Nota ${d.docNumber}: sisa hanya ${rupiah(d.open)}.`);
    }
    sum = sum.plus(a.amount);
  }
  if (!sum.eq(amount)) {
    throw invalid(
      'ALLOCATION_MISMATCH',
      `Jumlah per nota (${rupiah(sum)}) harus sama dengan pembayaran ${rupiah(amount)}.`,
    );
  }
  return manual.map((a) => ({ documentId: a.documentId, amount: toMoney(a.amount) }));
}

export async function pay(
  pool: Pool,
  ctx: RequestCtx,
  side: Side,
  raw: unknown,
  idempotencyKey: string | null,
): Promise<PartyPayment> {
  const w = WORDS[side];
  const input =
    side === 'AR'
      ? (({ customerId, ...rest }) => ({ partyId: customerId, ...rest }))(ReceivablePaymentInput.parse(raw))
      : (({ supplierId, ...rest }) => ({ partyId: supplierId, ...rest }))(PayablePaymentInput.parse(raw));

  const id = await withTransaction(pool, async (tx) => {
    if (side === 'AR' && idempotencyKey) {
      const existing = await repo.paymentIdByClientOp(tx, idempotencyKey);
      if (existing) return existing;
    }
    const p = await repo.party(tx, side, input.partyId);
    if (!p) throw notFoundError(w.party);

    const m = (await salesRepo.paymentMethods(tx, [input.paymentMethodId])).get(input.paymentMethodId);
    if (!m || !m.isActive || m.kind === 'CREDIT' || (m.kind !== 'CASH' && !m.cashAccountId)) {
      throw invalid('PAYMENT_METHOD_INVALID', 'Pilih cara bayar tunai atau rekening transfer yang aktif.');
    }

    const docs = await repo.lockOpenDocs(tx, side, input.partyId, today());
    const allocations = checkedAllocations(side, docs, input.amount, input.allocations);
    const amount = toMoney(input.amount);

    const now = clock.now();
    const wh = await defaultWarehouse(tx);
    const paymentId = uuidv7();
    const number = await nextDocNumber(tx, w.docType, wh.code, now);
    await repo.insertPayment(tx, side, {
      id: paymentId,
      number,
      partyId: input.partyId,
      paidAt: now,
      paymentMethodId: m.id,
      amount,
      reference: input.reference,
      note: input.note,
      createdBy: ctx.userId,
      clientOpId: idempotencyKey,
    });
    for (const a of allocations) await repo.allocate(tx, side, { id: uuidv7(), paymentId, ...a });

    // Cash collected at the counter goes into the drawer; the Owner pays suppliers from Kas Toko (S9-2/3).
    await salesRepo.insertCash(tx, {
      id: uuidv7(),
      cashAccountId: m.kind === 'CASH' ? await salesRepo.cashAccountId(tx, w.cashAccount) : m.cashAccountId!,
      categoryId: await salesRepo.cashCategoryId(tx, w.category),
      trxAt: now,
      direction: w.direction,
      amount,
      sourceType: side === 'AR' ? 'AR_PAYMENT' : 'AP_PAYMENT',
      sourceId: paymentId,
      note: [number, p.name, input.reference].filter(Boolean).join(' · '),
      createdBy: ctx.userId,
    });
    await recordAudit(tx, ctx, {
      action: side === 'AR' ? 'receivable.payment' : 'payable.payment',
      entity: side === 'AR' ? 'receivable_payment' : 'payable_payment',
      entityId: paymentId,
      after: { number, party: p.code, amount, method: m.name, documents: allocations.length },
    });
    return paymentId;
  });
  return getPayment(pool, side, id);
}

/** FR-ARAP-06: an opening receivable/payable per document (go-live, or debts outside iPOS). */
export async function addOpening(pool: Pool, ctx: RequestCtx, side: Side, raw: unknown): Promise<OpenDoc> {
  const w = WORDS[side];
  const input =
    side === 'AR'
      ? (({ customerId, ...rest }) => ({ partyId: customerId, ...rest }))(OpeningReceivableInput.parse(raw))
      : (({ supplierId, ...rest }) => ({ partyId: supplierId, ...rest }))(OpeningPayableInput.parse(raw));
  const id = uuidv7();
  await withTransaction(pool, async (tx) => {
    const p = await repo.party(tx, side, input.partyId);
    if (!p) throw notFoundError(w.party);
    if (p.isWalkIn)
      throw invalid('WALK_IN_NO_CREDIT', 'Pelanggan umum tidak bisa punya piutang. Pilih pelanggan terdaftar.');
    if (await repo.docNumberTaken(tx, side, input.partyId, input.docNumber)) {
      throw new AppError('DUPLICATE_DOC_NUMBER', `Nota ${input.docNumber} sudah tercatat untuk ${p.name}.`, 409);
    }
    const amount = toMoney(input.amount);
    await repo.insertOpening(tx, side, { id, ...input, amount });
    await recordAudit(tx, ctx, {
      action: side === 'AR' ? 'receivable.opening' : 'payable.opening',
      entity: side === 'AR' ? 'receivable' : 'payable',
      entityId: id,
      after: { party: p.code, docNumber: input.docNumber, docDate: input.docDate, dueDate: input.dueDate, amount },
    });
  });
  return (await repo.doc(pool, side, id, today()))!;
}
