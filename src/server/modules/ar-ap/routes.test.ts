import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgingRow, AgingTotals, OpenDoc, PartyPayment } from '@shared/schemas/ar-ap';
import type { CashAccount, Customer, PaymentMethod, Supplier } from '@shared/schemas/master';
import { startTestApi, type Data, type ErrBody, type TestApi } from '../../../../test/api';

let api: TestApi;
let tani: Customer;
let lain: Customer;
let supplier: Supplier;
let cash: string;
let credit: string;
let transfer: string;

/** Jakarta date `days` from today, YYYY-MM-DD (aging is relative to the business date). */
const day = (days: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(Date.now() + days * 86_400_000));

beforeAll(async () => {
  api = await startTestApi();
  tani = (await api.call<Data<Customer>>('POST', '/customers', { name: 'Tani Piutang Uji' })).body.data;
  lain = (await api.call<Data<Customer>>('POST', '/customers', { name: 'Pelanggan Lain Uji' })).body.data;
  supplier = (await api.call<Data<Supplier>>('POST', '/suppliers', { name: 'CV Hutang Uji', paymentTermDays: 10 })).body
    .data;
  const methods = (await api.call<Data<PaymentMethod[]>>('GET', '/payment-methods')).body.data;
  cash = methods.find((m) => m.kind === 'CASH')!.id;
  credit = methods.find((m) => m.kind === 'CREDIT')!.id;
  const bank = (await api.call<Data<CashAccount>>('POST', '/cash-accounts', { code: 'BRI', name: 'BRI Toko' })).body
    .data;
  transfer = (
    await api.call<Data<PaymentMethod>>('POST', '/payment-methods', {
      code: 'TRF_BRI',
      name: 'Transfer BRI',
      kind: 'TRANSFER',
      cashAccountId: bank.id,
    })
  ).body.data.id;
});
afterAll(async () => {
  await api?.close();
});

const opening = (body: object, as: 'OWNER' | 'KASIR' = 'OWNER') =>
  api.call<Data<OpenDoc> & ErrBody>('POST', '/receivables/opening', body, { as });
const payAr = (body: object, headers: Record<string, string> = {}, as: 'OWNER' | 'KASIR' = 'KASIR') =>
  api.call<Data<PartyPayment> & ErrBody>('POST', '/receivable-payments', body, { as, headers });
const docs = async (customerId: string) =>
  (await api.call<Data<OpenDoc[]>>('GET', `/receivables?customerId=${customerId}`, undefined, { as: 'KASIR' })).body
    .data;

/** paid_amount must always equal the sum of its allocations (S9-4). */
async function allocationsConsistent(table: 'receivables' | 'payables') {
  const alloc = table === 'receivables' ? 'receivable_payment_allocations' : 'payable_payment_allocations';
  const col = table === 'receivables' ? 'receivable_id' : 'payable_id';
  const r = await api.pool.query(
    `SELECT d.doc_number FROM ${table} d
     WHERE d.paid_amount <> coalesce((SELECT sum(a.amount) FROM ${alloc} a WHERE a.${col} = d.id), 0)`,
  );
  return r.rows;
}

describe('opening receivables (FR-ARAP-06)', () => {
  it('Owner records old notes; KASIR 403; duplicates, walk-in and due before date are refused', async () => {
    const a = await opening({
      customerId: tani.id,
      docNumber: 'LAMA-1',
      docDate: day(-100),
      dueDate: day(-95),
      amount: '1000000',
    });
    expect(a.status).toBe(201);
    expect(a.body.data).toMatchObject({ sourceType: 'OPENING', open: '1000000.00', daysOverdue: 95 });
    await opening({ customerId: tani.id, docNumber: 'LAMA-2', docDate: day(-20), dueDate: day(-10), amount: '500000' });
    await opening({ customerId: tani.id, docNumber: 'LAMA-3', docDate: day(0), dueDate: day(5), amount: '300000' });
    await opening({ customerId: lain.id, docNumber: 'LAIN-1', docDate: day(-5), dueDate: day(20), amount: '75000' });

    const base = { customerId: tani.id, docNumber: 'X', docDate: day(0), dueDate: day(1), amount: '1' };
    expect((await opening(base, 'KASIR')).status).toBe(403);
    const dup = await opening({ ...base, docNumber: 'lama-1' });
    expect([dup.status, dup.body.error.code]).toEqual([409, 'DUPLICATE_DOC_NUMBER']);
    const walkIn = await api.pool.query(`SELECT id FROM customers WHERE is_walk_in`);
    expect((await opening({ ...base, customerId: walkIn.rows[0].id })).body.error.code).toBe('WALK_IN_NO_CREDIT');
    expect((await opening({ ...base, dueDate: day(-1) })).status).toBe(400);
  });
});

describe('due list & aging (FR-ARAP-04/05)', () => {
  it('buckets per customer, totals with badge counts, filters; KASIR may read it', async () => {
    const r = await api.call<{ data: AgingRow[]; meta: { total: number; totals: AgingTotals } }>(
      'GET',
      '/receivables/summary',
      undefined,
      { as: 'KASIR' },
    );
    expect(r.status).toBe(200);
    expect(r.body.data.map((x) => x.name)).toEqual(['Tani Piutang Uji', 'Pelanggan Lain Uji']); // oldest due first
    expect(r.body.data[0]).toMatchObject({
      docCount: 3,
      open: '1800000.00',
      current: '300000.00',
      d1_30: '500000.00',
      d31_60: '0.00',
      d90plus: '1000000.00',
      oldestDue: day(-95),
    });
    expect(r.body.meta.totals).toMatchObject({
      open: '1875000.00',
      overdue: '1500000.00',
      parties: 2,
      docs: 4,
      overdueDocs: 2,
      dueTodayDocs: 0,
      dueWeekDocs: 1,
    });
    const overdue = await api.call<Data<AgingRow[]>>('GET', '/receivables/summary?due=overdue');
    expect(overdue.body.data.map((x) => x.name)).toEqual(['Tani Piutang Uji']);
    const search = await api.call<Data<AgingRow[]>>('GET', '/receivables/summary?q=lain');
    expect(search.body.data.map((x) => x.name)).toEqual(['Pelanggan Lain Uji']);
  });
});

describe('POST /receivable-payments (BP)', () => {
  it('KASIR collects cash: oldest due first, BP number, cash into LACI, idempotent', async () => {
    const key = randomUUID();
    const body = { customerId: tani.id, paymentMethodId: cash, amount: '1200000' };
    const r = await payAr(body, { 'idempotency-key': key });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({
      number: expect.stringMatching(/^0001\/BP\/UTM\/\d{4}$/),
      amount: '1200000.00',
      openAfter: '600000.00',
      allocations: [
        { docNumber: 'LAMA-1', amount: '1000000.00', remaining: '0.00' },
        { docNumber: 'LAMA-2', amount: '200000.00', remaining: '300000.00' },
      ],
    });
    const again = await payAr(body, { 'idempotency-key': key });
    expect(again.body.data.id).toBe(r.body.data.id);
    const kas = await api.pool.query(
      `SELECT ca.code, cc.code AS cat, ct.direction, ct.amount::text FROM cash_transactions ct
       JOIN cash_accounts ca ON ca.id = ct.cash_account_id JOIN cash_categories cc ON cc.id = ct.cash_category_id
       WHERE ct.source_type = 'AR_PAYMENT'`,
    );
    expect(kas.rows).toEqual([{ code: 'LACI', cat: 'AR_PAYMENT', direction: 'IN', amount: '1200000.00' }]);
    expect((await docs(tani.id)).map((d) => [d.docNumber, d.open])).toEqual([
      ['LAMA-2', '300000.00'],
      ['LAMA-3', '300000.00'],
    ]);
    const status = await api.pool.query(
      `SELECT doc_number, status FROM receivables WHERE customer_id = $1 ORDER BY doc_number`,
      [tani.id],
    );
    expect(status.rows.map((x) => x.status)).toEqual(['PAID', 'PARTIAL', 'OPEN']);
  });

  it('refuses more than open, credit as method, and bad manual allocations', async () => {
    const tooMuch = await payAr({ customerId: tani.id, paymentMethodId: cash, amount: '600001' });
    expect([tooMuch.status, tooMuch.body.error.code]).toEqual([422, 'PAYMENT_TOO_MUCH']);
    expect((await payAr({ customerId: tani.id, paymentMethodId: credit, amount: '1' })).body.error.code).toBe(
      'PAYMENT_METHOD_INVALID',
    );
    const open = await docs(tani.id);
    const other = (await docs(lain.id))[0]!;
    const mismatch = await payAr({
      customerId: tani.id,
      paymentMethodId: cash,
      amount: '100000',
      allocations: [{ documentId: open[0]!.id, amount: '50000' }],
    });
    expect(mismatch.body.error.code).toBe('ALLOCATION_MISMATCH');
    const foreign = await payAr({
      customerId: tani.id,
      paymentMethodId: cash,
      amount: '1000',
      allocations: [{ documentId: other.id, amount: '1000' }],
    });
    expect(foreign.body.error.code).toBe('ALLOCATION_INVALID');
    const over = await payAr({
      customerId: tani.id,
      paymentMethodId: cash,
      amount: '300001',
      allocations: [{ documentId: open[0]!.id, amount: '300001' }],
    });
    expect(over.body.error.code).toBe('ALLOCATION_TOO_MUCH');
    expect((await payAr({ customerId: lain.id, paymentMethodId: cash, amount: '1' }, {}, 'OWNER')).status).toBe(201);
  });

  it('manual allocation by transfer goes to the bank; a reprint shows the numbers of that moment', async () => {
    const open = await docs(tani.id);
    const newest = open.find((d) => d.docNumber === 'LAMA-3')!;
    const r = await payAr({
      customerId: tani.id,
      paymentMethodId: transfer,
      amount: '100000',
      reference: 'TRF 123',
      allocations: [{ documentId: newest.id, amount: '100000' }],
    });
    expect(r.body.data).toMatchObject({
      method: { name: 'Transfer BRI' },
      openAfter: '500000.00',
      allocations: [{ docNumber: 'LAMA-3', remaining: '200000.00' }],
    });
    const kas = await api.pool.query(
      `SELECT ca.code FROM cash_transactions ct JOIN cash_accounts ca ON ca.id = ct.cash_account_id WHERE ct.source_id = $1`,
      [r.body.data.id],
    );
    expect(kas.rows).toEqual([{ code: 'BRI' }]);

    await payAr({ customerId: tani.id, paymentMethodId: cash, amount: '500000' }); // settles everything
    const first = (await api.call<Data<{ id: string }[]>>('GET', `/receivable-payments?customerId=${tani.id}`)).body
      .data;
    expect(first).toHaveLength(3);
    const reprint = await api.call<Data<PartyPayment>>('GET', `/receivable-payments/${first[2]!.id}`);
    expect(reprint.body.data).toMatchObject({ openAfter: '600000.00', allocations: [{}, { remaining: '300000.00' }] });
    expect(await docs(tani.id)).toEqual([]);
    expect((await payAr({ customerId: tani.id, paymentMethodId: cash, amount: '1' })).body.error.code).toBe(
      'NOTHING_OPEN',
    );
    expect(await allocationsConsistent('receivables')).toEqual([]);
  });
});

describe('payables (BH, Owner only)', () => {
  it('opening payable, payment from KAS_TOKO, BH number; KASIR 403 everywhere', async () => {
    const add = (docNumber: string, amount: string, due: number) =>
      api.call<Data<OpenDoc>>('POST', '/payables/opening', {
        supplierId: supplier.id,
        docNumber,
        docDate: day(due - 10),
        dueDate: day(due),
        amount,
      });
    expect((await add('FAK-9', '2000000', -3)).status).toBe(201);
    await add('FAK-10', '1000000', 7);
    const sum = await api.call<{ data: AgingRow[]; meta: { totals: AgingTotals } }>('GET', '/payables/summary');
    expect(sum.body.data[0]).toMatchObject({ name: 'CV Hutang Uji', open: '3000000.00', d1_30: '2000000.00' });
    expect(sum.body.meta.totals).toMatchObject({ overdueDocs: 1, dueWeekDocs: 1 });

    const r = await api.call<Data<PartyPayment>>('POST', '/payable-payments', {
      supplierId: supplier.id,
      paymentMethodId: cash,
      amount: '2500000',
    });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({
      number: expect.stringMatching(/^0001\/BH\/UTM\/\d{4}$/),
      openAfter: '500000.00',
      allocations: [
        { docNumber: 'FAK-9', remaining: '0.00' },
        { docNumber: 'FAK-10', remaining: '500000.00' },
      ],
    });
    const kas = await api.pool.query(
      `SELECT ca.code, ct.direction, ct.amount::text FROM cash_transactions ct JOIN cash_accounts ca ON ca.id = ct.cash_account_id
       WHERE ct.source_type = 'AP_PAYMENT'`,
    );
    expect(kas.rows).toEqual([{ code: 'KAS_TOKO', direction: 'OUT', amount: '2500000.00' }]);
    expect(await allocationsConsistent('payables')).toEqual([]);

    const k = { as: 'KASIR' as const };
    expect((await api.call('GET', '/payables/summary', undefined, k)).status).toBe(403);
    expect((await api.call('GET', `/payables?supplierId=${supplier.id}`, undefined, k)).status).toBe(403);
    expect(
      (await api.call('POST', '/payable-payments', { supplierId: supplier.id, paymentMethodId: cash, amount: '1' }, k))
        .status,
    ).toBe(403);
    expect((await api.call('POST', '/payables/opening', {}, k)).status).toBe(403);
  });
});
