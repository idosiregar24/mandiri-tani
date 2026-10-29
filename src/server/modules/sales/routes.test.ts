import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthorizationGrantResult } from '@shared/schemas/auth';
import type { CashAccount, Customer, PaymentMethod, Product, Unit } from '@shared/schemas/master';
import type { Sale, SaleListItem } from '@shared/schemas/sales';
import { dec } from '@shared/money';
import { uuidv7 } from '@shared/uuid';
import { startTestApi, TEST_USERS, type Data, type ErrBody, type ListBody, type TestApi } from '../../../../test/api';
import { withTransaction } from '../../db/tx';
import { setClock } from '../../lib/clock';
import * as stock from '../stock/service';

let api: TestApi;
let urea: Product;
let cash: string;
let bca: string;
let customer: Customer;
let wh: string;
const zak = () => urea.units.find((u) => u.unitCode === 'ZAK')!.id;
const kg = () => urea.units.find((u) => u.unitCode === 'KG')!.id;

beforeAll(async () => {
  api = await startTestApi();
  const units = (await api.call<Data<Unit[]>>('GET', '/units')).body.data;
  const unit = (code: string) => units.find((u) => u.code === code)!.id;
  urea = (
    await api.call<Data<Product>>('POST', '/products', {
      name: 'UREA UJI JUAL',
      units: [
        { unitId: unit('KG'), conversionQty: '1', isBase: true, prices: [{ price: '12000' }] },
        { unitId: unit('ZAK'), conversionQty: '50', isBase: false, isDefaultSale: true, prices: [{ price: '595000' }] },
      ],
    })
  ).body.data;
  wh = (await api.pool.query<{ id: string }>("SELECT id FROM warehouses WHERE code = 'UTM'")).rows[0]!.id;
  // 10 ZAK @ 7.000/kg, then 10 ZAK @ 8.000/kg (two FIFO layers).
  await withTransaction(api.pool, (tx) =>
    stock.apply(tx, [
      {
        productId: urea.id,
        warehouseId: wh,
        qty: '500',
        unitCost: '7000',
        sourceType: 'PURCHASE_RECEIPT',
        sourceId: uuidv7(),
        movedAt: new Date(Date.now() - 2000),
      },
      {
        productId: urea.id,
        warehouseId: wh,
        qty: '500',
        unitCost: '8000',
        sourceType: 'PURCHASE_RECEIPT',
        sourceId: uuidv7(),
        movedAt: new Date(Date.now() - 1000),
      },
    ]),
  );
  const methods = (await api.call<Data<PaymentMethod[]>>('GET', '/payment-methods')).body.data;
  cash = methods.find((m) => m.kind === 'CASH')!.id;
  const bank = (await api.call<Data<CashAccount>>('POST', '/cash-accounts', { code: 'BCA', name: 'BCA Toko' })).body
    .data;
  bca = (
    await api.call<Data<PaymentMethod>>('POST', '/payment-methods', {
      code: 'TRANSFER_BCA',
      name: 'Transfer BCA',
      kind: 'TRANSFER',
      cashAccountId: bank.id,
    })
  ).body.data.id;
  customer = (
    await api.call<Data<Customer>>('POST', '/customers', {
      name: 'Petani Uji Kredit',
      creditLimit: '1000000',
      paymentTermDays: 10,
    })
  ).body.data;
});
afterAll(async () => {
  setClock();
  await api?.close();
});

const sell = (body: unknown, as: 'KASIR' | 'OWNER' = 'KASIR', headers: Record<string, string> = {}) =>
  api.call<Data<Sale> & ErrBody>('POST', '/sales', body, { as, headers });

const ownerGrant = async (permission: string) =>
  (
    await api.call<Data<AuthorizationGrantResult>>(
      'POST',
      '/auth/authorize',
      { username: TEST_USERS.OWNER.username, pin: TEST_USERS.OWNER.pin, permission },
      { as: 'KASIR' },
    )
  ).body.data.grant;

async function stockOf() {
  const r = await api.pool.query<{ qty: string; reserved: string; layers: string }>(
    `SELECT b.qty::text, b.reserved_qty::text AS reserved,
            (SELECT coalesce(sum(qty_remaining), 0)::text FROM stock_cost_layers WHERE product_id = b.product_id) AS layers
     FROM stock_balances b WHERE product_id = $1`,
    [urea.id],
  );
  return r.rows[0]!;
}

describe('POST /sales — KSR (cashier)', () => {
  it('saves the note, takes FIFO stock, books the cash net of change, and hides HPP from the cashier', async () => {
    const r = await sell({
      lines: [{ productUnitId: zak(), qty: '12', unitPrice: '595000' }],
      discountAmount: '140000',
      payments: [{ paymentMethodId: cash, amount: '7000000' }],
    });
    expect(r.status).toBe(201);
    const s = r.body.data;
    expect(s.number).toMatch(/^0000001\/KSR\/UTM\/\d{4}$/);
    expect(s).toMatchObject({
      channel: 'KASIR',
      subtotal: '7140000.00',
      discountAmount: '140000.00',
      total: '7000000.00',
      paidAmount: '7000000.00',
      changeAmount: '0.00',
      creditAmount: '0.00',
      fulfillmentStatus: 'TAKEN',
      customer: { isWalkIn: true },
    });
    expect(s.lines[0]).toMatchObject({ priceSource: 'RETAIL', listPrice: '595000.00', allocatedDiscount: '140000.00' });
    expect(JSON.stringify(s)).not.toMatch(/costPerBase|costTotal/);
    // 600 kg left = 500 @7000 + 100 @8000 consumed → 400 kg remain.
    expect(await stockOf()).toEqual({ qty: '400.0000', reserved: '0.0000', layers: '400.0000' });
    // The Owner sees the FIFO cost: (500×7000 + 100×8000) / 600.
    const owner = await api.call<Data<Sale>>('GET', `/sales/${s.id}`, undefined, { as: 'OWNER' });
    expect(owner.body.data.lines[0]!.costPerBase).toBe('7166.6667');
    const cashRows = await api.pool.query(`SELECT amount::text FROM cash_transactions WHERE source_id = $1`, [s.id]);
    expect(cashRows.rows).toEqual([{ amount: '7000000.00' }]);
  });

  it('computes change from cash; transfer cannot exceed the total; a short payment is refused', async () => {
    const ok = await sell({
      lines: [{ productUnitId: kg(), qty: '10', unitPrice: '12000' }],
      payments: [{ paymentMethodId: cash, amount: '150000' }],
    });
    expect(ok.body.data).toMatchObject({ total: '120000.00', changeAmount: '30000.00', paidAmount: '120000.00' });
    const mixed = await sell({
      lines: [{ productUnitId: kg(), qty: '5', unitPrice: '12000' }],
      payments: [
        { paymentMethodId: bca, amount: '50000', reference: 'TRF123' },
        { paymentMethodId: cash, amount: '20000' },
      ],
    });
    expect(mixed.body.data).toMatchObject({ total: '60000.00', changeAmount: '10000.00' });
    expect(mixed.body.data.payments.map((p) => p.kind)).toEqual(['TRANSFER', 'CASH']);

    const tooMuchTransfer = await sell({
      lines: [{ productUnitId: kg(), qty: '1', unitPrice: '12000' }],
      payments: [{ paymentMethodId: bca, amount: '20000' }],
    });
    expect(tooMuchTransfer.status).toBe(422);
    expect(tooMuchTransfer.body.error.code).toBe('NON_CASH_TOO_MUCH');
    const short = await sell({
      lines: [{ productUnitId: kg(), qty: '1', unitPrice: '12000' }],
      payments: [{ paymentMethodId: cash, amount: '10000' }],
    });
    expect(short.status).toBe(422);
    expect(short.body.error).toMatchObject({ code: 'PAYMENT_SHORT', message: 'Uang masih kurang Rp 2.000.' });
  });

  it('a typed price is MANUAL and audited; not enough stock is a 409 and nothing is saved', async () => {
    const r = await sell({
      lines: [{ productUnitId: kg(), qty: '1', unitPrice: '11500' }],
      payments: [{ paymentMethodId: cash, amount: '11500' }],
    });
    expect(r.body.data.lines[0]).toMatchObject({ priceSource: 'MANUAL', listPrice: '12000.00', unitPrice: '11500.00' });
    const audit = await api.pool.query(`SELECT action FROM audit_logs WHERE entity_id = $1`, [r.body.data.id]);
    expect(audit.rows).toEqual([{ action: 'sale.price_override' }]);

    const before = await stockOf();
    const tooMany = await sell({
      lines: [{ productUnitId: zak(), qty: '100', unitPrice: '595000' }],
      payments: [{ paymentMethodId: cash, amount: '59500000' }],
    });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error.code).toBe('STOCK_INSUFFICIENT');
    expect(await stockOf()).toEqual(before);
  });

  it('below cost and over the discount limit need the Owner PIN; one grant covers both, used only on commit', async () => {
    const body = {
      lines: [{ productUnitId: kg(), qty: '10', unitPrice: '5000' }], // 5.000/kg < FIFO cost 8.000
      discountAmount: '10000', // 20% > 5% cashier limit
      payments: [{ paymentMethodId: cash, amount: '40000' }],
    };
    const first = await sell(body);
    expect(first.status).toBe(423);
    expect(first.body.error).toMatchObject({
      code: 'AUTHORIZATION_REQUIRED',
      details: { permissions: ['sales.discount.unlimited', 'sales.sell_below_cost'] },
    });
    const grant = await ownerGrant('sales.sell_below_cost');
    // A failing attempt (short payment) does not spend the grant.
    const failed = await sell({ ...body, payments: [{ paymentMethodId: cash, amount: '1000' }] }, 'KASIR', {
      'x-authorization-grant': grant,
    });
    expect(failed.status).toBe(422);
    const ok = await sell(body, 'KASIR', { 'x-authorization-grant': grant });
    expect(ok.status).toBe(201);
    expect(ok.body.data.approvedBy).toBe(api.users.OWNER.id);
    expect((await sell(body, 'KASIR', { 'x-authorization-grant': grant })).status).toBe(401);
    // The Owner needs no PIN.
    expect((await sell(body, 'OWNER')).status).toBe(201);
  });

  it('Idempotency-Key returns the same note without selling twice', async () => {
    const key = randomUUID();
    const body = {
      lines: [{ productUnitId: kg(), qty: '2', unitPrice: '12000' }],
      payments: [{ paymentMethodId: cash, amount: '24000' }],
    };
    const a = await sell(body, 'KASIR', { 'idempotency-key': key });
    const before = await stockOf();
    const b = await sell(body, 'KASIR', { 'idempotency-key': key });
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(await stockOf()).toEqual(before);
  });

  it('KASIR cannot add shipping or sell on credit', async () => {
    const charges = await sell({
      lines: [{ productUnitId: kg(), qty: '1', unitPrice: '12000' }],
      otherCharges: '5000',
      payments: [{ paymentMethodId: cash, amount: '17000' }],
    });
    expect(charges.body.error.code).toBe('CHARGES_FAKTUR_ONLY');
  });
});

describe('POST /sales — FAKTUR (JL)', () => {
  it('needs a named customer; credit becomes a receivable due after the customer term', async () => {
    const anon = await sell({ channel: 'FAKTUR', lines: [{ productUnitId: kg(), qty: '1', unitPrice: '12000' }] });
    expect(anon.body.error.code).toBe('CUSTOMER_REQUIRED');
    setClock(() => new Date('2026-10-29T03:00:00Z'));
    const r = await sell({
      channel: 'FAKTUR',
      customerId: customer.id,
      lines: [{ productUnitId: kg(), qty: '20', unitPrice: '12000' }],
      otherCharges: '50000',
      otherChargesNote: 'Ongkos angkut',
      payments: [{ paymentMethodId: cash, amount: '90000' }],
    });
    setClock();
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({
      number: expect.stringMatching(/\/JL\/UTM\/1026$/),
      total: '290000.00',
      paidAmount: '90000.00',
      creditAmount: '200000.00',
      dueDate: '2026-11-08',
    });
    const rec = await api.pool.query(`SELECT amount::text, status FROM receivables WHERE source_id = $1`, [
      r.body.data.id,
    ]);
    expect(rec.rows).toEqual([{ amount: '200000.00', status: 'OPEN' }]);
  });

  it('over the credit limit needs the Owner PIN', async () => {
    const r = await sell({
      channel: 'FAKTUR',
      customerId: customer.id,
      lines: [{ productUnitId: zak(), qty: '2', unitPrice: '595000' }],
    });
    expect(r.status).toBe(423);
    expect(r.body.error.details).toMatchObject({ permissions: ['sales.credit.over_limit'] });
  });

  it('picked up later: no stock leaves, it is reserved instead', async () => {
    const before = await stockOf();
    const r = await sell({
      channel: 'FAKTUR',
      customerId: customer.id,
      pickupLater: true,
      lines: [{ productUnitId: kg(), qty: '50', unitPrice: '12000' }],
      payments: [{ paymentMethodId: cash, amount: '600000' }],
    });
    expect(r.body.data).toMatchObject({ fulfillmentStatus: 'PENDING' });
    expect(r.body.data.lines[0]!.pickedUpQty).toBe('0');
    const after = await stockOf();
    expect(after.qty).toBe(before.qty);
    expect(after.reserved).toBe('50.0000');
  });
});

describe('void (FR-POS-16, S6-2)', () => {
  it('needs the Owner PIN for a cashier; stock comes back on the original layers and cash goes out', async () => {
    const sale = (
      await sell({
        lines: [{ productUnitId: kg(), qty: '10', unitPrice: '12000' }],
        payments: [{ paymentMethodId: cash, amount: '120000' }],
      })
    ).body.data;
    const before = await stockOf();
    const noPin = await api.call<ErrBody>('POST', `/sales/${sale.id}/void`, { reason: 'Salah input' }, { as: 'KASIR' });
    expect(noPin.status).toBe(423);
    const grant = await ownerGrant('sales.void');
    const r = await api.call<Data<Sale>>(
      'POST',
      `/sales/${sale.id}/void`,
      { reason: 'Salah input' },
      {
        as: 'KASIR',
        headers: { 'x-authorization-grant': grant },
      },
    );
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ status: 'VOIDED', voidReason: 'Salah input' });
    const after = await stockOf();
    expect(dec(after.qty).minus(before.qty).toFixed()).toBe('10');
    expect(after.layers).toBe(after.qty);
    const net = await api.pool.query<{ net: string }>(
      `SELECT sum(CASE direction WHEN 'IN' THEN amount ELSE -amount END)::text AS net FROM cash_transactions WHERE source_id = $1`,
      [sale.id],
    );
    expect(net.rows[0]!.net).toBe('0.00');
    const again = await api.call<ErrBody>('POST', `/sales/${sale.id}/void`, { reason: 'Lagi' }, { as: 'OWNER' });
    expect(again.body.error.code).toBe('ALREADY_VOIDED');
  });

  it('a note from yesterday cannot be voided', async () => {
    setClock(() => new Date(Date.now() - 26 * 3600_000));
    const sale = (
      await sell({
        lines: [{ productUnitId: kg(), qty: '1', unitPrice: '12000' }],
        payments: [{ paymentMethodId: cash, amount: '12000' }],
      })
    ).body.data;
    setClock();
    const r = await api.call<ErrBody>('POST', `/sales/${sale.id}/void`, { reason: 'Telat' }, { as: 'OWNER' });
    expect(r.body.error.code).toBe('VOID_NOT_TODAY');
  });
});

describe('GET /sales', () => {
  it('a cashier lists only their own notes; the Owner sees all', async () => {
    await sell(
      {
        lines: [{ productUnitId: kg(), qty: '1', unitPrice: '12000' }],
        payments: [{ paymentMethodId: cash, amount: '12000' }],
      },
      'OWNER',
    );
    const mine = await api.call<ListBody<SaleListItem>>('GET', '/sales?pageSize=100', undefined, { as: 'KASIR' });
    const all = await api.call<ListBody<SaleListItem>>('GET', '/sales?pageSize=100', undefined, { as: 'OWNER' });
    expect(all.body.meta.total).toBeGreaterThan(mine.body.meta.total);
    expect(mine.body.data.every((s) => s.number)).toBe(true);
  });
});
