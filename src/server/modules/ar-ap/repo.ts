// SQL for receivables/payables, their payments (BP/BH) and allocations (schema section 6).
// Both sides share the queries; table and column names come only from the SIDES whitelist.
import type { AgingPage, AgingQuery, OpenDoc, PartyPayment, PaymentListItem } from '@shared/schemas/ar-ap';
import type { z } from '@shared/schemas/common';
import type { Queryable } from '../../db/pool';
import { likePattern } from '../../lib/http';

export const SIDES = {
  AR: {
    docs: 'receivables',
    party: 'customers',
    partyCol: 'customer_id',
    payments: 'receivable_payments',
    allocs: 'receivable_payment_allocations',
    allocPayment: 'receivable_payment_id',
    allocReturn: 'sale_return_id',
    allocDoc: 'receivable_id',
  },
  AP: {
    docs: 'payables',
    party: 'suppliers',
    partyCol: 'supplier_id',
    payments: 'payable_payments',
    allocs: 'payable_payment_allocations',
    allocPayment: 'payable_payment_id',
    allocReturn: 'purchase_return_id',
    allocDoc: 'payable_id',
  },
} as const;
export type Side = keyof typeof SIDES;

const MONEY = (expr: string) => `coalesce(${expr}, 0)::numeric(18,2)::text`;
const BUCKETS = `
  ${MONEY('sum(open) FILTER (WHERE late <= 0)')} AS current,
  ${MONEY('sum(open) FILTER (WHERE late BETWEEN 1 AND 30)')} AS d1_30,
  ${MONEY('sum(open) FILTER (WHERE late BETWEEN 31 AND 60)')} AS d31_60,
  ${MONEY('sum(open) FILTER (WHERE late BETWEEN 61 AND 90)')} AS d61_90,
  ${MONEY('sum(open) FILTER (WHERE late > 90)')} AS d90plus`;

const openDocsCte = (side: Side) => {
  const s = SIDES[side];
  return `d AS (
    SELECT r.${s.partyCol} AS party_id, r.amount - r.paid_amount AS open, ($1::date - r.due_date) AS late, r.due_date
    FROM ${s.docs} r WHERE r.status IN ('OPEN','PARTIAL'))`;
};

/** FR-ARAP-04/05: open balance per party with aging buckets; `today` = Jakarta business date. */
export async function aging(
  db: Queryable,
  side: Side,
  today: string,
  query: z.infer<typeof AgingQuery>,
): Promise<AgingPage & { total: number }> {
  const s = SIDES[side];
  const rows = await db.query<AgingPage['rows'][number] & { total: number }>(
    `WITH ${openDocsCte(side)},
     p AS (
       SELECT party_id, count(*)::int AS doc_count, ${MONEY('sum(open)')} AS open, ${BUCKETS},
              min(due_date)::text AS oldest_due, bool_or(late > 0) AS overdue, bool_or(late BETWEEN -7 AND 0) AS due_week
       FROM d GROUP BY party_id)
     SELECT p.party_id AS "partyId", c.code, c.name, c.phone, p.doc_count AS "docCount", p.open, p.current, p.d1_30,
            p.d31_60, p.d61_90, p.d90plus, p.oldest_due AS "oldestDue", count(*) OVER ()::int AS total
     FROM p JOIN ${s.party} c ON c.id = p.party_id
     WHERE ($2::text IS NULL OR c.name ILIKE $2 OR c.code ILIKE $2)
       AND ($3 = 'all' OR ($3 = 'overdue' AND p.overdue) OR ($3 = 'week' AND p.due_week))
     ORDER BY p.oldest_due, c.name, c.id
     LIMIT $4 OFFSET $5`,
    [today, query.q ? likePattern(query.q) : null, query.due, query.pageSize, (query.page - 1) * query.pageSize],
  );
  const totals = await db.query<AgingPage['totals']>(
    `WITH ${openDocsCte(side)}
     SELECT ${MONEY('sum(open)')} AS open, ${MONEY('sum(open) FILTER (WHERE late > 0)')} AS overdue, ${BUCKETS},
            count(DISTINCT party_id)::int AS parties, count(*)::int AS docs,
            (count(*) FILTER (WHERE late > 0))::int AS "overdueDocs", (count(*) FILTER (WHERE late = 0))::int AS "dueTodayDocs",
            (count(*) FILTER (WHERE late BETWEEN -7 AND 0))::int AS "dueWeekDocs"
     FROM d`,
    [today],
  );
  return {
    rows: rows.rows.map(({ total: _t, ...r }) => r),
    totals: totals.rows[0]!,
    total: rows.rows[0]?.total ?? 0,
  };
}

const DOC_SELECT = (side: Side) => `
  SELECT r.id, r.source_type AS "sourceType", r.doc_number AS "docNumber", r.doc_date::text AS "docDate",
         r.due_date::text AS "dueDate", r.amount::text, r.paid_amount::text AS "paidAmount",
         (r.amount - r.paid_amount)::text AS open, ($2::date - r.due_date)::int AS "daysOverdue"
  FROM ${SIDES[side].docs} r`;

export async function openDocs(db: Queryable, side: Side, partyId: string, today: string): Promise<OpenDoc[]> {
  const r = await db.query<OpenDoc>(
    `${DOC_SELECT(side)} WHERE r.${SIDES[side].partyCol} = $1 AND r.status IN ('OPEN','PARTIAL')
     ORDER BY r.due_date, r.doc_date, r.doc_number`,
    [partyId, today],
  );
  return r.rows;
}

/** Locks the party's open documents in id order (the same order every writer uses). */
export async function lockOpenDocs(db: Queryable, side: Side, partyId: string, today: string): Promise<OpenDoc[]> {
  const r = await db.query<OpenDoc>(
    `${DOC_SELECT(side)} WHERE r.${SIDES[side].partyCol} = $1 AND r.status IN ('OPEN','PARTIAL') ORDER BY r.id FOR UPDATE`,
    [partyId, today],
  );
  return r.rows;
}

export async function party(db: Queryable, side: Side, id: string) {
  const r = await db.query<{ id: string; code: string; name: string; isWalkIn: boolean }>(
    `SELECT id, code, name, ${side === 'AR' ? 'is_walk_in' : 'false'} AS "isWalkIn"
     FROM ${SIDES[side].party} WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return r.rows[0] ?? null;
}

/**
 * One allocation = one row + the document's paid_amount/status, so paid_amount is always the
 * sum of its allocations (payments and return deductions alike, S9-4).
 */
export async function allocate(
  db: Queryable,
  side: Side,
  a: { id: string; documentId: string; amount: string } & ({ paymentId: string } | { returnId: string }),
): Promise<void> {
  const s = SIDES[side];
  const byPayment = 'paymentId' in a;
  await db.query(
    `INSERT INTO ${s.allocs} (id, ${byPayment ? s.allocPayment : s.allocReturn}, ${s.allocDoc}, amount) VALUES ($1,$2,$3,$4)`,
    [a.id, byPayment ? a.paymentId : a.returnId, a.documentId, a.amount],
  );
  await db.query(
    `UPDATE ${s.docs} SET paid_amount = paid_amount + $2::numeric,
       status = CASE WHEN paid_amount + $2::numeric >= amount THEN 'PAID' ELSE 'PARTIAL' END
     WHERE id = $1`,
    [a.documentId, a.amount],
  );
}

export async function paymentIdByClientOp(db: Queryable, clientOpId: string): Promise<string | null> {
  const r = await db.query<{ id: string }>(`SELECT id FROM receivable_payments WHERE client_op_id = $1`, [clientOpId]);
  return r.rows[0]?.id ?? null;
}

export async function insertPayment(
  db: Queryable,
  side: Side,
  p: {
    id: string;
    number: string;
    partyId: string;
    paidAt: Date;
    paymentMethodId: string;
    amount: string;
    reference: string | null;
    note: string | null;
    createdBy: string;
    clientOpId: string | null;
  },
): Promise<void> {
  const s = SIDES[side];
  // payable_payments has no client_op_id in the schema (S9-3).
  const cols = side === 'AR' ? ', client_op_id' : '';
  const vals = side === 'AR' ? ', $10' : '';
  await db.query(
    `INSERT INTO ${s.payments} (id, number, ${s.partyCol}, paid_at, payment_method_id, amount, reference, note, created_by${cols})
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9${vals})`,
    [
      p.id,
      p.number,
      p.partyId,
      p.paidAt,
      p.paymentMethodId,
      p.amount,
      p.reference,
      p.note,
      p.createdBy,
      ...(side === 'AR' ? [p.clientOpId] : []),
    ],
  );
}

export async function getPayment(db: Queryable, side: Side, id: string): Promise<PartyPayment | null> {
  const s = SIDES[side];
  const head = await db.query<Omit<PartyPayment, 'allocations' | 'openAfter'> & { createdAt: Date }>(
    `SELECT p.id, p.number, p.paid_at AS "paidAt", json_build_object('id', c.id, 'code', c.code, 'name', c.name) AS party,
            json_build_object('id', m.id, 'name', m.name, 'kind', m.kind) AS method, p.amount::text, p.reference, p.note,
            u.full_name AS "createdBy", p.created_at AS "createdAt"
     FROM ${s.payments} p JOIN ${s.party} c ON c.id = p.${s.partyCol}
     JOIN payment_methods m ON m.id = p.payment_method_id JOIN users u ON u.id = p.created_by
     WHERE p.id = $1`,
    [id],
  );
  const h = head.rows[0];
  if (!h) return null;
  // "Remaining" as it was right after this payment (UUIDv7 ids are time-ordered), so a reprint
  // later shows the same numbers as the first print.
  const allocs = await db.query<PartyPayment['allocations'][number]>(
    `SELECT r.id AS "documentId", r.doc_number AS "docNumber", r.doc_date::text AS "docDate", r.due_date::text AS "dueDate",
            a.amount::text,
            (r.amount - (SELECT sum(x.amount) FROM ${s.allocs} x WHERE x.${s.allocDoc} = r.id AND x.id <= a.id))::text AS remaining
     FROM ${s.allocs} a JOIN ${s.docs} r ON r.id = a.${s.allocDoc}
     WHERE a.${s.allocPayment} = $1 ORDER BY r.due_date, r.doc_date, r.doc_number`,
    [id],
  );
  const after = await db.query<{ open: string }>(
    `SELECT (coalesce((SELECT sum(r.amount) FROM ${s.docs} r
                       WHERE r.${s.partyCol} = $1 AND r.status <> 'VOIDED' AND r.created_at <= $2), 0)
           - coalesce((SELECT sum(x.amount) FROM ${s.allocs} x JOIN ${s.docs} r ON r.id = x.${s.allocDoc}
                       WHERE r.${s.partyCol} = $1 AND r.status <> 'VOIDED' AND r.created_at <= $2
                         AND x.id <= (SELECT id FROM ${s.allocs} WHERE ${s.allocPayment} = $3 ORDER BY id DESC LIMIT 1)), 0)
           )::numeric(18,2)::text AS open`,
    [h.party.id, h.createdAt, id],
  );
  const { createdAt: _c, ...rest } = h;
  return {
    ...rest,
    paidAt: new Date(h.paidAt).toISOString(),
    allocations: allocs.rows,
    openAfter: after.rows[0]!.open,
  };
}

export async function listPayments(db: Queryable, side: Side, partyId: string): Promise<PaymentListItem[]> {
  const s = SIDES[side];
  const r = await db.query<PaymentListItem>(
    `SELECT p.id, p.number, p.paid_at AS "paidAt", m.name AS "methodName", p.amount::text,
            (SELECT count(*) FROM ${s.allocs} a WHERE a.${s.allocPayment} = p.id)::int AS "docCount"
     FROM ${s.payments} p JOIN payment_methods m ON m.id = p.payment_method_id
     WHERE p.${s.partyCol} = $1 ORDER BY p.paid_at DESC, p.id DESC LIMIT 50`,
    [partyId],
  );
  return r.rows.map((x) => ({ ...x, paidAt: new Date(x.paidAt).toISOString() }));
}

export async function docNumberTaken(db: Queryable, side: Side, partyId: string, docNumber: string): Promise<boolean> {
  const s = SIDES[side];
  const r = await db.query(
    `SELECT 1 FROM ${s.docs} WHERE ${s.partyCol} = $1 AND upper(doc_number) = upper($2) AND status <> 'VOIDED'`,
    [partyId, docNumber],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function insertOpening(
  db: Queryable,
  side: Side,
  d: { id: string; partyId: string; docNumber: string; docDate: string; dueDate: string; amount: string },
): Promise<void> {
  const s = SIDES[side];
  await db.query(
    `INSERT INTO ${s.docs} (id, ${s.partyCol}, source_type, doc_number, doc_date, due_date, amount)
     VALUES ($1,$2,'OPENING',$3,$4,$5,$6)`,
    [d.id, d.partyId, d.docNumber, d.docDate, d.dueDate, d.amount],
  );
}

export async function doc(db: Queryable, side: Side, id: string, today: string): Promise<OpenDoc | null> {
  const r = await db.query<OpenDoc>(`${DOC_SELECT(side)} WHERE r.id = $1`, [id, today]);
  return r.rows[0] ?? null;
}
