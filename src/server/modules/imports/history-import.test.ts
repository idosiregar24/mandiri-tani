// 2-year history import (sprint-10 D1–D3) against the SYNTHETIC iPOS fixture — never the real backup.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ImportBatch, IposHistoryInspectResult } from '@shared/schemas/imports';
import type { CashflowReport, ProfitLossReport, PurchasesReport, SalesReport } from '@shared/schemas/reports';
import { startTestApi, type Data, type ErrBody, type TestApi } from '../../../../test/api';
import { cashCategoryFor, planHistoryImport, type HistoryLookups } from './ipos-history-plan';
import type { IposHistDoc, IposHistLine } from './ipos-source';

describe('planHistoryImport (pure)', () => {
  const look: HistoryLookups = {
    customers: new Map([['PL1', { id: 'c1', groupId: null }]]),
    walkIn: { id: 'umum', groupId: null },
    suppliers: new Map(),
    products: new Map([
      [
        'UREA',
        {
          id: 'p1',
          name: 'UREA',
          baseUnitId: 'u-kg',
          units: new Map([
            ['KG', { id: 'u-kg', conversion: '1' }],
            ['ZAK', { id: 'u-zak', conversion: '50' }],
          ]),
        },
      ],
    ]),
    taken: { sales: new Set(['TAKEN/JL']), purchases: new Set(), cash: new Set() },
  };
  const doc = (over: Partial<IposHistDoc>): IposHistDoc => ({
    notransaksi: 'N1',
    tipe: 'JL',
    tanggal: '2026-03-31T10:00:00',
    kodesupel: 'PL1',
    keterangan: null,
    subtotal: '1000000.00',
    potnomfaktur: '0.00',
    pajak: '0.00',
    biayalain: '0.00',
    totalakhir: '1000000.00',
    jmltunai: '0.00',
    jmlkredit: '0.00',
    jatuhtempo: null,
    ...over,
  });
  const line = (over: Partial<IposHistLine>): IposHistLine => ({
    notransaksi: 'N1',
    kodeitem: 'UREA',
    satuan: 'ZAK',
    jumlah: '2.000',
    harga: '500000.00',
    potongan: '0.00',
    total: '1000000.00',
    jmlkonversi: '50.000',
    cost: '700000.00',
    costUnknown: false,
    ...over,
  });

  it('change from jmltunai, credit due date default +10 days, note discount spread exactly', () => {
    const plan = planHistoryImport(
      {
        sales: [
          doc({
            subtotal: '1000000.00',
            potnomfaktur: '10000.00',
            totalakhir: '990000.00',
            jmltunai: '500000.00',
            jmlkredit: '490000.00',
          }),
          doc({ notransaksi: 'K1', tipe: 'KSR', jmltunai: '1000000.00', kodesupel: 'ENTAH', totalakhir: '1000000.00' }),
          doc({ notransaksi: 'TAKEN/JL' }),
        ],
        saleLines: [
          line({ total: '600000.00', jumlah: '1.200', harga: '500000.00' }),
          line({
            total: '400000.00',
            satuan: 'BTL',
            jmlkonversi: '1.000',
            jumlah: '1.000',
            cost: null,
            costUnknown: true,
          }),
          line({ notransaksi: 'K1' }),
          line({ notransaksi: 'TAKEN/JL' }),
        ],
        purchases: [],
        purchaseLines: [],
        cash: [],
      },
      look,
    );
    expect(plan.sales.map((s) => s.legacyKey)).toEqual(['N1', 'K1']);
    const [n1, k1] = plan.sales;
    expect(n1).toMatchObject({ channel: 'FAKTUR', change: '0.00', credit: '490000.00', dueDate: '2026-04-10' });
    expect(n1!.trxAt).toBe('2026-03-31T10:00:00+07:00');
    expect(n1!.lines.map((l) => l.allocatedDiscount)).toEqual(['6000.00', '4000.00']);
    expect(n1!.lines[0]).toMatchObject({ baseQty: '60.0000', costTotal: '700000.00', costPerBase: '11666.6667' });
    expect(n1!.lines[1]).toMatchObject({ productUnitId: 'u-kg', unitCode: 'BTL', costTotal: null, costPerBase: null });
    expect(k1).toMatchObject({ channel: 'KASIR', customerId: 'umum', credit: '0.00', dueDate: null });
    expect(Object.fromEntries(plan.issues.map((i) => [i.code, i.count]))).toEqual({
      HIST_NUMBER_TAKEN: 1,
      HIST_UNIT_GONE: 1,
      'DQ-3': 1,
      HIST_UNKNOWN_CUSTOMER: 1,
    });
  });

  it('expense categories from the iPOS description', () => {
    expect(cashCategoryFor('ONGKOS EKSPEDISI PUPUK')).toBe('OPEX_EXPEDITION');
    expect(cashCategoryFor('upah bongkar muat')).toBe('OPEX_UNLOADING');
    expect(cashCategoryFor('Beli solar mobil')).toBe('OPEX_VEHICLE');
    expect(cashCategoryFor('GAJI MINGGUAN')).toBe('OPEX_WAGES');
    expect(cashCategoryFor('BANTUAN')).toBe('OPEX_GENERAL');
    expect(cashCategoryFor(null)).toBe('OPEX_GENERAL');
  });
});

describe('iPOS import — 2-year history scope', () => {
  let api: TestApi;
  beforeAll(async () => {
    api = await startTestApi({ ipos: true, hooks: { backup: async (label) => `${label}.dump` } });
  });
  afterAll(async () => {
    await api?.close();
  });
  const inspect = async () =>
    (await api.call<Data<IposHistoryInspectResult>>('POST', '/imports/ipos/history/inspect')).body.data;
  const commit = () =>
    api.call<Data<ImportBatch> & ErrBody>('POST', '/imports/ipos/history/commit', { purpose: 'DEVELOPMENT' });

  it('needs the master scope first; KASIR 403', async () => {
    expect((await inspect()).blocker).toContain('Impor data master');
    expect((await commit()).status).toBe(409);
    expect((await api.call('POST', '/imports/ipos/history/inspect', undefined, { as: 'KASIR' })).status).toBe(403);
  });

  it('previews the iPOS counts and the findings', async () => {
    expect((await api.call('POST', '/imports/ipos/commit', { purpose: 'DEVELOPMENT' })).status).toBe(201);
    const r = await inspect();
    expect(r.blocker).toBeNull();
    expect(r.counts).toMatchObject({
      ksr: 1,
      ksrTotal: '45000.00',
      jl: 4,
      jlTotal: '10740000.00',
      saleCost: '6201000.00',
      linesWithoutCost: 1,
      purchases: 2,
      purchasesTotal: '55000000.00',
      cashOut: 3,
      cashOutTotal: '1000000.00',
    });
    expect(Object.fromEntries(r.issues.map((i) => [i.code, i.examples]))).toEqual({
      'DQ-3': ['0000002/JL/UTM/0126 (RACUN CONTOH A 500 ML)'],
      HIST_UNKNOWN_CUSTOMER: ['0000004/JL/UTM/0226 (PL0404)'],
      HIST_UNIT_GONE: ['0000004/JL/UTM/0226 (RACUN CONTOH B 1 LTR, BTL)'],
      HIST_CASH_GENERAL: ['0003/KASO/UTM/0226'],
    });
  });

  it('imports in one transaction, reconciles with iPOS, and moves no stock or money', async () => {
    const res = await commit();
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'COMMITTED', scope: ['history'] });
    for (const row of res.body.data.reconciliation) expect(row, row.label).toMatchObject({ ok: true });

    const side = await api.pool.query(
      `SELECT (SELECT count(*) FROM stock_movements)::int AS movements,
              (SELECT count(*) FROM receivables)::int AS receivables,
              (SELECT count(*) FROM payables)::int AS payables,
              (SELECT count(*) FROM cash_transactions WHERE source_type <> 'MANUAL')::int AS cash_auto`,
    );
    expect(side.rows[0]).toEqual({ movements: 0, receivables: 0, payables: 0, cash_auto: 0 });

    const jl = await api.pool.query(
      `SELECT s.source, s.channel, s.total::text, s.credit_amount::text AS credit, s.due_date, s.note,
              json_agg(json_build_object('net', i.net_amount::text, 'alloc', i.allocated_discount::text,
                       'cost', i.cost_total::text) ORDER BY i.line_no) AS lines
       FROM sales s JOIN sale_items i ON i.sale_id = s.id WHERE s.number = '0000002/JL/UTM/0126'
       GROUP BY s.id`,
    );
    expect(jl.rows[0]).toEqual({
      source: 'IPOS_IMPORT',
      channel: 'FAKTUR',
      total: '2690000.00',
      credit: '2690000.00',
      due_date: '2026-01-21',
      note: 'DIANTAR',
      lines: [
        { net: '2522490.84', alloc: '37509.16', cost: '1420000.00' },
        { net: '167509.16', alloc: '2490.84', cost: null },
      ],
    });
    const ksr = await api.pool.query(
      `SELECT paid_amount::text AS paid, change_amount::text AS change,
              (SELECT amount::text FROM sale_payments WHERE sale_id = s.id) AS payment
       FROM sales s WHERE number = '0000001/KSR/UTM/0126'`,
    );
    expect(ksr.rows[0]).toEqual({ paid: '50000.00', change: '5000.00', payment: '50000.00' });

    expect((await commit()).status).toBe(409);
  });

  it('feeds the reports: sales recap, profit with unknown HPP, purchases, expenses', async () => {
    const period = 'from=2026-01-01&to=2026-02-28';
    const sales = (await api.call<Data<SalesReport>>('GET', `/reports/sales?${period}`)).body.data;
    expect(sales.totals).toMatchObject({ count: 5, total: '10785000.00', paidCredit: '10740000.00' });
    expect(sales.invoices.every((i) => i.imported)).toBe(true);

    const pl = (await api.call<Data<ProfitLossReport>>('GET', `/reports/profit-loss?${period}`)).body.data;
    expect(pl).toMatchObject({
      unknownCostSales: '167509.16',
      hpp: '6201000.00',
      otherCharges: '100000.00',
      opexTotal: '1000000.00',
      estimated: false,
    });

    const buys = (await api.call<Data<PurchasesReport>>('GET', `/reports/purchases?${period}`)).body.data;
    expect(buys.totals).toMatchObject({ count: 2, total: '55000000.00' });
    expect(buys.rows[0]!.lines[0]).toMatchObject({ qty: '100', unitCode: 'ZAK', unitPrice: '520000.00' });

    const cf = (await api.call<Data<CashflowReport>>('GET', `/reports/cashflow?${period}`)).body.data;
    expect(cf.beforeGoLive).toBe(true);
    const kas = cf.accounts.find((a) => a.code === 'KAS_TOKO')!;
    expect(kas.out.map((l) => l.code).sort()).toEqual([
      'OPEX_EXPEDITION',
      'OPEX_GENERAL',
      'OPEX_UNLOADING',
      'OPEX_VEHICLE',
    ]);
  });
});
