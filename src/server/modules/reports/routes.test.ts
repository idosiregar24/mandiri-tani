import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CashAccountBalance, CashCategory } from '@shared/schemas/cash';
import type { Customer, PaymentMethod, Product, Supplier, Unit } from '@shared/schemas/master';
import type {
  CashflowReport,
  DailyFertilizerReport,
  DashboardReport,
  PickupsReport,
  ProfitByInvoiceReport,
  ProfitByItemReport,
  ProfitLossReport,
  PurchasesReport,
  ReportFilterOptions,
  SalesPrintReport,
  SalesReport,
  StockReport,
  UndeliveredReport,
} from '@shared/schemas/reports';
import type { Sale } from '@shared/schemas/sales';
import { startTestApi, type Data, type ErrBody, type TestApi } from '../../../../test/api';

// One small synthetic day of the store: two purchases, cashier sales in ZAK and KG, an invoice
// picked up later (half collected), a return, a void, a go-live opening note, an iPOS-history
// line without HPP and a fuel expense.
let api: TestApi;
let urea: Product;
let cangkul: Product;
let tani: Customer;
let cash: string;
let s2: Sale;
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
const period = `from=${day}&to=${day}`;
const unitOf = (p: Product, code: string) => p.units.find((u) => u.unitCode === code)!.id;

const sell = async (body: object, as: 'KASIR' | 'OWNER' = 'KASIR') => {
  const r = await api.call<Data<Sale> & ErrBody>('POST', '/sales', body, { as });
  if (r.status !== 201) throw new Error(`sale failed: ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const get = <T>(path: string, as: 'KASIR' | 'OWNER' = 'OWNER') =>
  api.call<Data<T> & ErrBody>('GET', path, undefined, { as });

beforeAll(async () => {
  api = await startTestApi();
  const units = (await api.call<Data<Unit[]>>('GET', '/units')).body.data;
  const unit = (code: string) => units.find((u) => u.code === code)!.id;
  const pupuk = (await api.call<Data<{ id: string }>>('POST', '/categories', { name: 'PUPUK' })).body.data;
  const alat = (await api.call<Data<{ id: string }>>('POST', '/categories', { name: 'ALAT' })).body.data;
  urea = (
    await api.call<Data<Product>>('POST', '/products', {
      name: 'UREA UJI LAPORAN',
      categoryId: pupuk.id,
      units: [
        { unitId: unit('KG'), conversionQty: '1', isBase: true, prices: [{ price: '13000' }] },
        { unitId: unit('ZAK'), conversionQty: '50', isBase: false, isDefaultSale: true, prices: [{ price: '600000' }] },
      ],
    })
  ).body.data;
  cangkul = (
    await api.call<Data<Product>>('POST', '/products', {
      name: 'CANGKUL UJI',
      categoryId: alat.id,
      units: [{ unitId: unit('PCS'), conversionQty: '1', isBase: true, prices: [{ price: '90000' }] }],
    })
  ).body.data;
  const supplier = (await api.call<Data<Supplier>>('POST', '/suppliers', { name: 'CV Pupuk Uji', paymentTermDays: 10 }))
    .body.data;
  tani = (await api.call<Data<Customer>>('POST', '/customers', { name: 'Tani Laporan Uji' })).body.data;
  cash = (await api.call<Data<PaymentMethod[]>>('GET', '/payment-methods')).body.data.find(
    (m) => m.kind === 'CASH',
  )!.id;

  // Two FIFO layers (7.000/kg then 8.000/kg) + a hoe that never sells.
  for (const [p, u, qty, price] of [
    [urea, 'ZAK', '10', '350000'],
    [urea, 'ZAK', '10', '400000'],
    [cangkul, 'PCS', '5', '60000'],
  ] as const) {
    const r = await api.call('POST', '/purchases', {
      supplierId: supplier.id,
      lines: [{ productUnitId: unitOf(p, u), qty, unitPrice: price }],
    });
    if (r.status !== 201) throw new Error(`purchase failed: ${JSON.stringify(r.body)}`);
  }

  const zak = unitOf(urea, 'ZAK');
  const kg = unitOf(urea, 'KG');
  // S1 cashier: 2 ZAK @ 600.000 (HPP 100 kg × 7.000)
  const s1 = await sell({
    lines: [{ productUnitId: zak, qty: '2', unitPrice: '600000' }],
    payments: [{ paymentMethodId: cash, amount: '1200000' }],
  });
  // S3 cashier: 10 KG ecer @ 13.000 (HPP 10 × 7.000)
  await sell({
    lines: [{ productUnitId: kg, qty: '10', unitPrice: '13000' }],
    payments: [{ paymentMethodId: cash, amount: '130000' }],
  });
  // S2 Owner invoice: 2 ZAK @ 620.000 + ongkos 50.000, DP 300.000, rest on credit, picked up later
  s2 = await sell(
    {
      channel: 'FAKTUR',
      customerId: tani.id,
      pickupLater: true,
      otherCharges: '50000',
      lines: [{ productUnitId: zak, qty: '2', unitPrice: '620000' }],
      payments: [{ paymentMethodId: cash, amount: '300000' }],
    },
    'OWNER',
  );
  const pick = await api.call('POST', '/pickups', {
    customerId: tani.id,
    lines: [{ saleItemId: s2.lines[0]!.id, qty: '1' }],
    receiverName: 'Anak Pak Tani',
  });
  if (pick.status !== 201) throw new Error(`pickup failed: ${JSON.stringify(pick.body)}`);
  // Return 1 ZAK of S1 back to stock, cash refund 600.000
  const ret = await api.call('POST', `/sales/${s1.id}/returns`, {
    lines: [{ saleItemId: s1.lines[0]!.id, qty: '1', restock: true }],
    settlement: 'CASH_REFUND',
    reason: 'Salah beli',
  });
  if (ret.status !== 201) throw new Error(`return failed: ${JSON.stringify(ret.body)}`);
  // Voided sale — never counted
  const v = await sell({
    lines: [{ productUnitId: kg, qty: '1', unitPrice: '13000' }],
    payments: [{ paymentMethodId: cash, amount: '13000' }],
  });
  const voided = await api.call('POST', `/sales/${v.id}/void`, { reason: 'Salah input' });
  if (voided.status !== 200) throw new Error(`void failed: ${JSON.stringify(voided.body)}`);
  // Go-live opening note (turnover already in iPOS) and an iPOS history line without HPP (DQ-3)
  const s4 = await sell(
    {
      lines: [{ productUnitId: kg, qty: '1', unitPrice: '13000' }],
      payments: [{ paymentMethodId: cash, amount: '13000' }],
    },
    'OWNER',
  );
  await api.pool.query(`UPDATE sales SET source = 'OPENING_PICKUP' WHERE id = $1`, [s4.id]);
  const s5 = await sell(
    {
      lines: [{ productUnitId: kg, qty: '1', unitPrice: '12000' }],
      payments: [{ paymentMethodId: cash, amount: '12000' }],
    },
    'OWNER',
  );
  await api.pool.query(`UPDATE sales SET source = 'IPOS_IMPORT' WHERE id = $1`, [s5.id]);
  await api.pool.query(`UPDATE sale_items SET cost_total = NULL, cost_per_base = NULL WHERE sale_id = $1`, [s5.id]);

  const accounts = (await get<CashAccountBalance[]>('/cash/balances')).body.data;
  const cats = (await get<CashCategory[]>('/cash-categories')).body.data;
  await api.call('POST', '/cash-transactions', {
    direction: 'OUT',
    cashAccountId: accounts.find((a) => a.code === 'KAS_TOKO')!.id,
    categoryId: cats.find((c) => c.code === 'OPEX_VEHICLE')!.id,
    amount: '100000',
    note: 'Solar antar pupuk',
  });
});
afterAll(async () => {
  await api?.close();
});

/** HPP still to come for S2's open ZAK: 50 kg at today's FIFO average. */
async function expectedHpp(): Promise<string> {
  const r = await api.pool.query<{ hpp: string }>(
    `SELECT round(770000 + 350000 - 350000
                  + 50 * sum(qty_remaining * unit_cost) / sum(qty_remaining), 2)::text AS hpp
     FROM stock_cost_layers WHERE product_id = $1 AND qty_remaining > 0`,
    [urea.id],
  );
  return r.rows[0]!.hpp;
}

describe('sales report (FR-FIN-07/12)', () => {
  it('Owner: iPOS recap columns; voided and go-live opening notes are left out; returns listed', async () => {
    const r = await get<SalesReport>(`/reports/sales?${period}`);
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.ownOnly).toBe(false);
    expect(d.invoices).toHaveLength(4);
    expect(d.totals).toMatchObject({
      count: 4,
      total: '2632000.00',
      otherCharges: '50000.00',
      paidCredit: '990000.00',
    });
    expect(d.returns).toEqual({ count: 1, amount: '600000.00' });
    const inv = d.invoices.find((i) => i.id === s2.id)!;
    expect(inv).toMatchObject({ channel: 'FAKTUR', itemCount: '2', total: '1290000.00', paidCash: '300000.00' });
    expect(d.invoices.some((i) => i.imported)).toBe(true);
  });

  it('groups by payment method and category', async () => {
    const pm = (await get<SalesReport>(`/reports/sales?${period}&groupBy=payment_method`)).body.data.groups;
    expect(pm.map((g) => [g.label, g.amount])).toEqual([
      ['Tunai', '1642000.00'],
      ['Piutang (kredit)', '990000.00'],
    ]);
    const cat = (await get<SalesReport>(`/reports/sales?${period}&groupBy=category`)).body.data.groups;
    expect(cat).toEqual([{ key: expect.any(String), label: 'PUPUK', count: 4, amount: '2582000.00' }]);
  });

  it('KASIR: only own sales of today, never a cost field', async () => {
    const r = await get<SalesReport>(`/reports/sales?from=2020-01-01&to=${day}`, 'KASIR');
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ ownOnly: true, period: { from: day, to: day } });
    expect(r.body.data.totals).toMatchObject({ count: 2, total: '1330000.00' });
    expect(JSON.stringify(r.body)).not.toMatch(/hpp|profit|cost/i);
  });

  it('refuses a period longer than two years', async () => {
    const r = await get('/reports/sales?from=2020-01-01&to=2026-01-01');
    expect(r.status).toBe(400);
  });
});

describe('sales print in the iPOS format (Laporan > Penjualan)', () => {
  const print = (q: string, as: 'KASIR' | 'OWNER' = 'OWNER') =>
    get<SalesPrintReport>(`/reports/sales/print?${period}&${q}`, as);

  it('Rekap: iPOS columns, header block and totals over the counted notes', async () => {
    const r = await print('type=rekap');
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.title).toBe('Laporan Penjualan Rekap');
    expect(d.invoices).toHaveLength(4);
    expect(d.totals).toMatchObject({ count: 4, itemCount: '15', total: '2632000.00', paidCredit: '990000.00' });
    const inv = d.invoices.find((i) => i.id === s2.id)!;
    expect(inv).toMatchObject({
      customerCode: tani.code,
      itemCount: '2',
      subtotal: '1240000.00',
      discountPct: '0.00',
      otherCharges: '50000.00',
      total: '1290000.00',
      paidCash: '300000.00',
      paidCredit: '990000.00',
    });
    expect(d.header.filters).toEqual([`PERIODE : ${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(2, 4)} - ${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(2, 4)}`]);
    expect(d.header.printedBy).toBe(d.header.printedBy.toUpperCase());
    expect(d.header.company.name).toBeTruthy();
  });

  it('Detail lists every line; Harian one row per day; Per Pelanggan sums per customer', async () => {
    const detail = (await print('type=detail')).body.data;
    expect(detail.items).toHaveLength(4);
    expect(detail.items.find((i) => i.saleId === s2.id)).toMatchObject({ qty: '2', unit: 'ZAK', price: '620000.00', total: '1240000.00' });
    const harian = (await print('type=harian')).body.data;
    expect(harian.days).toEqual([{ date: day, count: 4, total: '2632000.00', paidCash: '1642000.00', paidCredit: '990000.00' }]);
    const pel = (await print('type=pelanggan-rekap')).body.data;
    expect(pel.customers.find((c) => c.code === tani.code)).toMatchObject({ count: 1, total: '1290000.00' });
    const pelDetail = (await print('type=pelanggan-detail')).body.data;
    expect(pelDetail.invoices).toHaveLength(4);
  });

  it('Jual Per Retur: only notes with a return, with the return lines and totals', async () => {
    const d = (await print('type=retur')).body.data;
    expect(d.invoices).toHaveLength(1);
    expect(d.returns).toHaveLength(1);
    expect(d.returns[0]).toMatchObject({ saleId: d.invoices[0]!.id, itemCount: '1', total: '600000.00' });
    expect(d.returnTotals).toEqual({ itemCount: '1', total: '600000.00' });
    expect(d.totals).toMatchObject({ count: 1, total: '1200000.00' });
  });

  it('filters like the iPOS form: modul, pelanggan, no transaksi, user', async () => {
    const faktur = (await print('type=rekap&channel=FAKTUR')).body.data;
    expect(faktur.invoices.map((i) => i.id)).toEqual([s2.id]);
    expect(faktur.header.filters).toContain('MODUL : PENJUALAN');
    const cust = (await print(`type=rekap&customerFrom=${tani.code}&customerTo=${tani.code}`)).body.data;
    expect(cust.invoices.map((i) => i.id)).toEqual([s2.id]);
    expect(cust.header.filters).toContain(`PELANGGAN : ${tani.code} - ${tani.code}`);
    const num = (await print(`type=rekap&numberFrom=${encodeURIComponent(s2.number!)}&numberTo=${encodeURIComponent(s2.number!)}`))
      .body.data;
    expect(num.invoices.map((i) => i.id)).toEqual([s2.id]);
    const kasir = await api.pool.query<{ cashier_id: string }>(
      `SELECT cashier_id FROM sales WHERE channel = 'KASIR' AND total = 130000 LIMIT 1`,
    );
    const byUser = (await print(`type=rekap&userId=${kasir.rows[0]!.cashier_id}`)).body.data;
    expect(byUser.totals.count).toBe(2);
    expect(byUser.header.filters.some((f) => f.startsWith('USER : '))).toBe(true);
    const empty = (await print('type=rekap&numberFrom=&customerTo=&channel=')).body.data;
    expect(empty.totals.count).toBe(4);
  });

  it('KASIR: own sales of today only, no cost fields; filter options are Owner only', async () => {
    const r = await get<SalesPrintReport>(`/reports/sales/print?from=2020-01-01&to=${day}&type=detail`, 'KASIR');
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ ownOnly: true, period: { from: day, to: day } });
    expect(r.body.data.totals.count).toBe(2);
    expect(JSON.stringify(r.body)).not.toMatch(/hpp|profit|cost/i);
    expect((await get('/reports/filter-options', 'KASIR')).status).toBe(403);
    const opts = await get<ReportFilterOptions>('/reports/filter-options');
    expect(opts.status).toBe(200);
    expect(opts.body.data.warehouses.length).toBeGreaterThan(0);
    expect(JSON.stringify(opts.body)).not.toMatch(/hash/i);
  });

  it('every type also comes as Excel', async () => {
    for (const type of ['rekap', 'detail', 'harian', 'pelanggan-detail', 'pelanggan-rekap', 'retur']) {
      const res = await fetch(`${api.base}/reports/sales/print?${period}&type=${type}&format=xlsx`, {
        headers: { authorization: `Bearer ${api.users.OWNER.token}` },
      });
      expect(res.status, type).toBe(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await res.arrayBuffer());
      expect(wb.worksheets[0]!.rowCount, type).toBeGreaterThan(3);
    }
  });
});

describe('profit (FR-FIN-04/05/06)', () => {
  it('per product: returns and unknown HPP handled, open pickups estimated', async () => {
    const r = await get<ProfitByItemReport>(`/reports/profit-by-item?${period}`);
    expect(r.status).toBe(200);
    const u = r.body.data.rows.find((x) => x.productId === urea.id)!;
    // sold 100+10+100+1 kg, returned 50
    expect(u).toMatchObject({
      qty: '161',
      sales: '2582000.00',
      returns: '600000.00',
      unknownCostSales: '12000.00',
      estimated: true,
      hpp: await expectedHpp(),
    });
    const profit = (2582000 - 12000 - 600000) * 100 - Math.round(Number(u.hpp) * 100);
    expect(Math.round(Number(u.profit) * 100)).toBe(profit);
    expect(r.body.data.totals.unknownCostSales).toBe('12000.00');
  });

  it('per invoice: a sale without HPP shows no profit', async () => {
    const rows = (await get<ProfitByInvoiceReport>(`/reports/profit-by-invoice?${period}`)).body.data.rows;
    expect(rows).toHaveLength(4);
    const unknown = rows.find((x) => x.costUnknown)!;
    expect(unknown).toMatchObject({ sales: '12000.00', hpp: null, profit: null });
    const withReturn = rows.find((x) => x.returns === '600000.00')!;
    expect(withReturn).toMatchObject({ sales: '1200000.00', hpp: '350000.00', profit: '250000.00' });
  });

  it('profit & loss: gross profit + ongkos angkut − operating costs', async () => {
    const d = (await get<ProfitLossReport>(`/reports/profit-loss?${period}`)).body.data;
    expect(d).toMatchObject({
      netSales: '2582000.00',
      returns: '600000.00',
      unknownCostSales: '12000.00',
      otherCharges: '50000.00',
      opex: [{ code: 'OPEX_VEHICLE', name: 'BBM & Perbaikan Kendaraan', amount: '100000.00' }],
      opexTotal: '100000.00',
      hpp: await expectedHpp(),
    });
    const gross = Math.round(Number(d.grossProfit) * 100);
    expect(Math.round(Number(d.operatingProfit) * 100)).toBe(gross + 5000000 - 10000000);
  });

  it('KASIR is refused every profit, cash, purchase and stock report', async () => {
    for (const path of [
      `/reports/profit-by-item?${period}`,
      `/reports/profit-by-invoice?${period}`,
      `/reports/profit-loss?${period}`,
      `/reports/cashflow?${period}`,
      `/reports/purchases?${period}`,
      `/reports/daily-fertilizer?${period}`,
      `/reports/pickups?${period}`,
      '/reports/undelivered',
      '/reports/stock',
    ]) {
      expect([path, (await get(path, 'KASIR')).status]).toEqual([path, 403]);
    }
  });
});

describe('cash flow, purchases, pickups, stock', () => {
  it('cash flow balances per account match the cash book', async () => {
    const d = (await get<CashflowReport>(`/reports/cashflow?${period}`)).body.data;
    const balances = (await get<CashAccountBalance[]>('/cash/balances')).body.data;
    for (const a of d.accounts) {
      expect(a.closing).toBe(balances.find((b) => b.id === a.id)!.balance);
    }
    const kas = d.accounts.find((a) => a.code === 'KAS_TOKO')!;
    expect(kas.out.map((l) => [l.code, l.amount])).toEqual([
      ['PURCHASE', '7800000.00'],
      ['OPEX_VEHICLE', '100000.00'],
    ]);
    expect(d.beforeGoLive).toBe(false);
  });

  it('purchases detail like iPOS', async () => {
    const d = (await get<PurchasesReport>(`/reports/purchases?${period}`)).body.data;
    expect(d.totals).toMatchObject({ count: 3, total: '7800000.00', paidCash: '7800000.00', paidCredit: '0.00' });
    expect(d.rows[0]!.lines[0]).toMatchObject({ qty: '10', unitCode: 'ZAK', unitPrice: '350000.00' });
  });

  it('daily fertilizer recap splits ZAK and KG ecer; closing = physical stock', async () => {
    const d = (await get<DailyFertilizerReport>(`/reports/daily-fertilizer?${period}`)).body.data;
    expect(d.category?.name).toBe('PUPUK');
    const p = d.products.find((x) => x.id === urea.id)!;
    expect(p.bigUnit).toEqual({ code: 'ZAK', conversion: '50' });
    // out: S1 2 ZAK + pickup 1 ZAK; KG: S3 10 + S4 1 + S5 1 (+1 −1 voided); in 1.000 kg; other: return +50
    expect(p.totals).toEqual({ outBig: '3', outBase: '12', in: '1000', other: '50' });
    const bal = await api.pool.query<{ q: string }>(
      `SELECT trim_scale(qty)::text AS q FROM stock_balances WHERE product_id = $1`,
      [urea.id],
    );
    expect(p.closing).toBe(bal.rows[0]!.q);
    expect(d.days).toHaveLength(1);
  });

  it('undelivered goods and pickup history', async () => {
    const u = (await get<UndeliveredReport>('/reports/undelivered?groupBy=product')).body.data;
    expect(u.rows).toEqual([
      expect.objectContaining({ key: urea.id, qty: '50', value: '620000.00', sales: 1, ageDays: 0 }),
    ]);
    expect(u.totals).toMatchObject({ sales: 1, value: '620000.00' });
    const c = (await get<UndeliveredReport>('/reports/undelivered')).body.data;
    expect(c.rows[0]).toMatchObject({ label: 'Tani Laporan Uji', sales: 1 });
    const h = (await get<PickupsReport>(`/reports/pickups?${period}&customerId=${tani.id}`)).body.data;
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({ receiverName: 'Anak Pak Tani', status: 'POSTED' });
    expect(h.rows[0]!.lines).toEqual([
      { saleNumber: s2.number, productName: 'UREA UJI LAPORAN', qty: '1', unitCode: 'ZAK' },
    ]);
  });

  it('stock value per category and products that never sold', async () => {
    const d = (await get<StockReport>('/reports/stock?idleDays=30')).body.data;
    const value = await api.pool.query<{ v: string }>(
      `SELECT sum(qty_remaining * unit_cost)::numeric(18,2)::text AS v FROM stock_cost_layers WHERE qty_remaining > 0`,
    );
    expect(d.totals.value).toBe(value.rows[0]!.v);
    expect(d.categories.map((c) => c.name).sort()).toEqual(['ALAT', 'PUPUK']);
    expect(d.idle.map((i) => i.productId)).toEqual([cangkul.id]);
    expect(d.idle[0]).toMatchObject({ qty: '5', value: '300000.00', lastSaleDate: null });
  });
});

describe('dashboard & export', () => {
  it('Owner sees turnover and profit; KASIR only own turnover', async () => {
    const o = (await get<DashboardReport>('/reports/dashboard')).body.data;
    const pl = (await get<ProfitLossReport>(`/reports/profit-loss?${period}`)).body.data;
    expect(o.today).toEqual({ sales: '2632000.00', invoices: 4, profit: pl.grossProfit });
    expect(o.topProducts?.[0]).toMatchObject({ productId: urea.id });
    expect(o.undelivered).toMatchObject({ customers: 1, value: '620000.00' });
    expect(o.lowStock).toEqual(expect.any(Number));

    const k = (await get<DashboardReport>('/reports/dashboard', 'KASIR')).body.data;
    expect(k).toMatchObject({ ownOnly: true, today: { sales: '1330000.00', invoices: 2 } });
    expect(JSON.stringify(k)).not.toMatch(/profit|topProducts|receivables/);
  });

  it('?format=xlsx downloads the same report as Excel', async () => {
    const r = await fetch(`${api.base}/reports/profit-by-item?${period}&format=xlsx`, {
      headers: { authorization: `Bearer ${api.users.OWNER.token}` },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('spreadsheetml');
    expect(r.headers.get('content-disposition')).toContain('laba-per-barang.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await r.arrayBuffer());
    const ws = wb.worksheets[0]!;
    expect(ws.getCell('A1').value).toBe('Laba Kotor per Barang');
    expect(ws.getCell('B5').value).toBe('UREA UJI LAPORAN');
  });
});
