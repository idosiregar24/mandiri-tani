// Receivables & payables import (sprint-9 A7 + full credit history) against the SYNTHETIC iPOS
// fixture — never the real backup.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DocHistoryEntry, OpenDoc, PartyPayment } from '@shared/schemas/ar-ap';
import type { ImportBatch, IposArApInspectResult } from '@shared/schemas/imports';
import { startTestApi, type Data, type ErrBody, type TestApi } from '../../../../test/api';

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi({ ipos: true, hooks: { backup: async (label) => `${label}.dump` } });
});
afterAll(async () => {
  await api?.close();
});

const inspect = async () =>
  (await api.call<Data<IposArApInspectResult>>('POST', '/imports/ipos/receivables/inspect')).body.data;
const commit = (body: object) =>
  api.call<Data<ImportBatch> & ErrBody>('POST', '/imports/ipos/receivables/commit', {
    purpose: 'DEVELOPMENT',
    ...body,
  });
const importScope = async (path: string) =>
  expect((await api.call('POST', `/imports/ipos/${path}`, { purpose: 'DEVELOPMENT' })).status).toBe(201);
const customerId = async (name: string) =>
  (await api.pool.query<{ id: string }>(`SELECT id FROM customers WHERE name = $1`, [name])).rows[0]!.id;
const receivableId = async (number: string) =>
  (await api.pool.query<{ id: string }>(`SELECT id FROM receivables WHERE doc_number = $1`, [number])).rows[0]!.id;
const card = async (customer: string) =>
  (
    await api.call<Data<OpenDoc[]>>(
      'GET',
      `/receivables?customerId=${await customerId(customer)}&status=all`,
      undefined,
      { as: 'KASIR' },
    )
  ).body.data;

describe('iPOS import — receivables (full credit history) & payables scope', () => {
  it('needs the master scope first', async () => {
    expect((await inspect()).blocker).toContain('Impor data master');
    expect((await commit({})).status).toBe(409);
  });

  it('previews iPOS credit notes, instalments, findings, and the credit purchases to tick', async () => {
    await importScope('commit');
    const r = await inspect();
    expect(r.blocker).toBeNull();
    expect(r.counts).toEqual({
      receivables: 3,
      receivablesOpen: '4150000.00',
      customers: 3,
      creditNotes: 4,
      creditTotal: '8440000.00', // 4,3 jt − 0,3 jt deduction + 2,69 jt + 1,5 jt + 0,25 jt
      payments: 4,
      paymentsTotal: '4290000.00',
      payables: 2,
      payablesOpen: '55000000.00',
    });
    expect(Object.fromEntries(r.issues.map((i) => [i.code, i.examples]))).toEqual({
      AR_UNKNOWN_CUSTOMER: ['0000004/JL/UTM/0226 (PL0404)'],
      AR_NO_DUE_DATE: ['0000003/JL/UTM/0226'],
      AR_PAYMENT_UNMATCHED: ['0004/BP/UTM/0226'], // the unknown customer's instalment
    });
    expect(r.payables).toEqual([
      {
        legacyKey: '0000001/BL/UTM/0126',
        supplierCode: 'SP0001',
        supplierName: 'CV Contoh Agro',
        docDate: '2026-01-02',
        dueDate: '2026-01-12',
        open: '52000000.00',
      },
      expect.objectContaining({ legacyKey: '0000002/BL/UTM/0226', supplierName: 'CV Kode Nama', open: '3000000.00' }),
    ]);
  });

  it('refuses ticks that are not iPOS credit purchases or above what iPOS says is open', async () => {
    expect((await commit({ payables: [{ legacyKey: 'BUKAN', amount: '1' }] })).body.error.code).toBe(
      'IMPORT_PAYABLE_INVALID',
    );
    expect(
      (await commit({ payables: [{ legacyKey: '0000002/BL/UTM/0226', amount: '3000001' }] })).body.error.code,
    ).toBe('IMPORT_PAYABLE_TOO_MUCH');
  });

  it('imports every credit note at its original credit with its instalments, ticked debts only, and reconciles', async () => {
    const r = await commit({ payables: [{ legacyKey: '0000002/BL/UTM/0226', amount: '1000000' }] });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ status: 'COMMITTED', scope: ['receivables'] });
    expect(Object.fromEntries(r.body.data.reconciliation.map((x) => [x.label, [x.ipos, x.imported, x.ok]]))).toEqual({
      // the unknown customer's note and instalment are shown, not hidden
      'Nota kredit (lunas & belum)': ['4', '3', false],
      'Total kredit': ['8440000.00', '8190000.00', false],
      'Pelunasan piutang (BP)': ['4', '3', false],
      'Total pelunasan': ['4290000.00', '4190000.00', false],
      'Nota piutang terbuka': ['3', '2', false],
      'Total sisa piutang': ['4150000.00', '4000000.00', false],
      'Pelanggan berpiutang': ['3', '2', false],
      'Nota kredit tertaut ke nota histori': ['3', '0', true], // history not imported yet
      'Faktur hutang dicentang': ['2', '1', true],
      'Total hutang dicentang': ['55000000.00', '1000000.00', true],
    });
    const rec = await api.pool.query(
      `SELECT r.doc_number, r.doc_date::text, r.due_date::text, r.amount::text, r.paid_amount::text, r.status,
              r.source_type, c.name,
              (SELECT coalesce(sum(a.amount), 0)::text FROM receivable_payment_allocations a WHERE a.receivable_id = r.id) AS allocated
       FROM receivables r JOIN customers c ON c.id = r.customer_id ORDER BY r.doc_number`,
    );
    expect(rec.rows).toEqual([
      {
        doc_number: '0000001/JL/UTM/0126',
        doc_date: '2026-01-06',
        due_date: '2026-01-16',
        amount: '4000000.00',
        paid_amount: '1000000.00',
        status: 'PARTIAL',
        source_type: 'OPENING',
        name: 'Tani Contoh Satu',
        allocated: '1000000.00',
      },
      {
        doc_number: '0000002/JL/UTM/0126',
        doc_date: '2026-01-07',
        due_date: '2026-01-21',
        amount: '2690000.00',
        paid_amount: '2690000.00',
        status: 'PAID', // paid off in iPOS — still imported, for the customer's history
        source_type: 'OPENING',
        name: 'Kebun Contoh',
        allocated: '2690000.00',
      },
      {
        doc_number: '0000003/JL/UTM/0226',
        doc_date: '2026-02-03',
        due_date: '2026-02-03', // no due date in iPOS → the note date
        amount: '1500000.00',
        paid_amount: '500000.00',
        status: 'PARTIAL',
        source_type: 'OPENING',
        name: 'Kebun Contoh',
        allocated: '500000.00',
      },
    ]);
    const pays = await api.pool.query(
      `SELECT p.number, p.paid_at, p.amount::text, p.note, m.kind,
              (SELECT count(*) FROM cash_transactions WHERE source_id = p.id)::int AS cash_rows
       FROM receivable_payments p JOIN payment_methods m ON m.id = p.payment_method_id ORDER BY p.number`,
    );
    expect(pays.rows).toEqual([
      expect.objectContaining({
        number: '0001/BP/UTM/0126',
        amount: '1000000.00',
        note: 'CICILAN 1',
        kind: 'CASH',
        cash_rows: 0,
      }),
      expect.objectContaining({ number: '0002/BP/UTM/0126', amount: '1000000.00', cash_rows: 0 }),
      expect.objectContaining({ number: '0003/BP/UTM/0226', amount: '2190000.00', cash_rows: 0 }),
    ]);
    expect(pays.rows[0].paid_at.toISOString()).toBe('2026-01-10T04:00:00.000Z'); // 11.00 WIB
    const pay = await api.pool.query(`SELECT doc_number, amount::text FROM payables`);
    expect(pay.rows).toEqual([{ doc_number: '0000002/BL/UTM/0226', amount: '1000000.00' }]);
    const refs = await api.pool.query(
      `SELECT entity, count(*)::int AS n FROM legacy_refs WHERE entity IN ('receivable','receivable_payment','payable')
       GROUP BY 1 ORDER BY 1`,
    );
    expect(refs.rows).toEqual([
      { entity: 'payable', n: 1 },
      { entity: 'receivable', n: 3 },
      { entity: 'receivable_payment', n: 3 },
    ]);
  });

  it("shows a customer's credit card: paid-off notes too, each note's instalments, reprints as they were", async () => {
    const docs = await card('Kebun Contoh');
    expect(docs.map((d) => [d.docNumber, d.status, d.open, d.saleTotal])).toEqual([
      ['0000003/JL/UTM/0226', 'PARTIAL', '1000000.00', null], // newest first; no note before the history scope
      ['0000002/JL/UTM/0126', 'PAID', '0.00', null],
    ]);
    // The default (open only) still lists what can be paid.
    const open = (await api.call<Data<OpenDoc[]>>('GET', `/receivables?customerId=${await customerId('Kebun Contoh')}`))
      .body.data;
    expect(open.map((d) => d.docNumber)).toEqual(['0000003/JL/UTM/0226']);
    expect(
      (await api.call<ErrBody>('GET', `/receivables?customerId=${await customerId('Kebun Contoh')}&status=semua`))
        .status,
    ).toBe(400);

    const history = (
      await api.call<Data<DocHistoryEntry[]>>(
        'GET',
        `/receivables/${await receivableId('0000002/JL/UTM/0126')}/history`,
        undefined,
        { as: 'KASIR' },
      )
    ).body.data;
    expect(history.map((h) => [h.kind, h.number, h.amount, h.remaining, h.methodName])).toEqual([
      ['PAYMENT', '0002/BP/UTM/0126', '1000000.00', '1690000.00', 'Tunai'],
      ['PAYMENT', '0003/BP/UTM/0226', '1690000.00', '0.00', 'Tunai'],
    ]);
    expect(
      (await api.call('GET', `/receivables/${'0'.repeat(8)}-0000-7000-8000-${'0'.repeat(12)}/history`)).status,
    ).toBe(404);

    // BP reprint: the customer's balance right after it, counting only notes that existed then.
    const bp = async (number: string) => {
      const id = (
        await api.pool.query<{ id: string }>(`SELECT id FROM receivable_payments WHERE number = $1`, [number])
      ).rows[0]!.id;
      return (await api.call<Data<PartyPayment>>('GET', `/receivable-payments/${id}`)).body.data;
    };
    expect((await bp('0002/BP/UTM/0126')).openAfter).toBe('1690000.00'); // only note 2 existed on 15-01
    const both = await bp('0003/BP/UTM/0226');
    expect(both.allocations.map((a) => [a.docNumber, a.amount, a.remaining])).toEqual([
      ['0000002/JL/UTM/0126', '1690000.00', '0.00'],
      ['0000003/JL/UTM/0226', '500000.00', '1000000.00'],
    ]);
    expect(both.openAfter).toBe('1000000.00');
  });

  it('links the credit notes to their sale when the history scope comes afterwards (total, DP)', async () => {
    await importScope('history/commit');
    const [n1] = await card('Tani Contoh Satu');
    expect(n1).toMatchObject({
      docNumber: '0000001/JL/UTM/0126',
      sourceType: 'SALE',
      saleTotal: '6300000.00',
      downPayment: '2000000.00', // the DP paid at the counter
      amount: '4000000.00',
      paidAmount: '1000000.00',
      open: '3000000.00',
    });
    expect(n1!.saleId).not.toBeNull();
  });

  it('refuses a second import; a reset allows a fresh one in the other order, still linked; Owner-only', async () => {
    expect((await inspect()).blocker).toContain('sudah diimpor');
    expect((await commit({})).status).toBe(409);
    expect((await api.call('POST', '/imports/ipos/receivables/inspect', undefined, { as: 'KASIR' })).status).toBe(403);
    expect((await api.call('POST', '/imports/reset', { confirm: 'RESET' })).status).toBe(200);
    expect((await api.pool.query(`SELECT 1 FROM receivables`)).rowCount).toBe(0);
    expect((await api.pool.query(`SELECT 1 FROM receivable_payments`)).rowCount).toBe(0);

    await importScope('commit');
    await importScope('history/commit');
    const r = await commit({});
    expect(r.status).toBe(201);
    const linked = r.body.data.reconciliation.find((x) => x.label === 'Nota kredit tertaut ke nota histori')!;
    expect([linked.ipos, linked.imported]).toEqual(['3', '3']);
    expect((await card('Kebun Contoh')).every((d) => d.sourceType === 'SALE' && d.saleTotal !== null)).toBe(true);
  });
});
