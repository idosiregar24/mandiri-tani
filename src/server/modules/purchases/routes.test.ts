import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dec } from '@shared/money';
import type { AuthorizationGrantResult } from '@shared/schemas/auth';
import type { CashAccount, Customer, PaymentMethod, Product, Supplier, Unit } from '@shared/schemas/master';
import type { PriceHistoryRow, Purchase, SaleReturnResult } from '@shared/schemas/purchases';
import type { Sale } from '@shared/schemas/sales';
import { startTestApi, TEST_USERS, type Data, type ErrBody, type TestApi } from '../../../../test/api';

let api: TestApi;
let urea: Product;
let supplier: Supplier;
let cash: string;
let bca: string;
let budi: Customer;
const zak = () => urea.units.find((u) => u.unitCode === 'ZAK')!.id;

beforeAll(async () => {
  api = await startTestApi();
  const units = (await api.call<Data<Unit[]>>('GET', '/units')).body.data;
  const unit = (c: string) => units.find((u) => u.code === c)!.id;
  urea = (
    await api.call<Data<Product>>('POST', '/products', {
      name: 'UREA UJI BELI',
      units: [
        { unitId: unit('KG'), conversionQty: '1', isBase: true, prices: [{ price: '12000' }] },
        { unitId: unit('ZAK'), conversionQty: '50', isBase: false, isDefaultSale: true, prices: [{ price: '595000' }] },
      ],
    })
  ).body.data;
  supplier = (await api.call<Data<Supplier>>('POST', '/suppliers', { name: 'CV Pupuk Uji', paymentTermDays: 10 })).body
    .data;
  const methods = (await api.call<Data<PaymentMethod[]>>('GET', '/payment-methods')).body.data;
  cash = methods.find((m) => m.kind === 'CASH')!.id;
  const bank = (await api.call<Data<CashAccount>>('POST', '/cash-accounts', { code: 'BRI', name: 'BRI Toko' })).body
    .data;
  bca = (
    await api.call<Data<PaymentMethod>>('POST', '/payment-methods', {
      code: 'TRF_BRI',
      name: 'Transfer BRI',
      kind: 'TRANSFER',
      cashAccountId: bank.id,
    })
  ).body.data.id;
  budi = (await api.call<Data<Customer>>('POST', '/customers', { name: 'Budi Uji Retur' })).body.data;
});
afterAll(async () => {
  await api?.close();
});

const buy = (body: unknown, headers: Record<string, string> = {}, as: 'OWNER' | 'KASIR' = 'OWNER') =>
  api.call<Data<Purchase> & ErrBody>('POST', '/purchases', body, { as, headers });

async function layers() {
  const r = await api.pool.query<{ qty: string; unit_cost: string }>(
    `SELECT qty_remaining::text AS qty, unit_cost::text FROM stock_cost_layers WHERE product_id = $1 AND qty_remaining > 0 ORDER BY received_at, id`,
    [urea.id],
  );
  return r.rows.map((x) => `${x.qty}@${x.unit_cost}`);
}

describe('POST /purchases (BL)', () => {
  it('cash purchase: number BL, FIFO layer at line cost, cash out of KAS_TOKO; KASIR is 403', async () => {
    const r = await buy({
      supplierId: supplier.id,
      supplierInvoiceNo: 'INV-001',
      lines: [{ productUnitId: zak(), qty: '10', unitPrice: '355000' }],
    });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({
      number: expect.stringMatching(/^0000001\/BL\/UTM\/\d{4}$/),
      total: '3550000.00',
      payKind: 'CASH',
      payable: null,
    });
    expect(r.body.data.lines[0]).toMatchObject({ costPerBase: '7100.0000', qty: '10', unitCode: 'ZAK' });
    expect(await layers()).toEqual(['500.0000@7100.0000']);
    const kas = await api.pool.query(
      `SELECT ca.code, ct.direction, ct.amount::text FROM cash_transactions ct JOIN cash_accounts ca ON ca.id = ct.cash_account_id WHERE ct.source_id = $1`,
      [r.body.data.id],
    );
    expect(kas.rows).toEqual([{ code: 'KAS_TOKO', direction: 'OUT', amount: '3550000.00' }]);
    const last = await api.pool.query(`SELECT last_purchase_cost::text AS c FROM products WHERE id = $1`, [urea.id]);
    expect(last.rows[0].c).toBe('7100.0000');

    expect(
      (await buy({ supplierId: supplier.id, lines: [{ productUnitId: zak(), qty: '1', unitPrice: '1' }] }, {}, 'KASIR'))
        .status,
    ).toBe(403);
  });

  it('credit purchase with shipping into HPP: payable due after the supplier term; transfer goes from the bank account', async () => {
    const r = await buy({
      supplierId: supplier.id,
      invoiceDate: '2026-10-20',
      lines: [{ productUnitId: zak(), qty: '10', unitPrice: '380000' }],
      otherCost: '50000',
      otherCostToHpp: true,
      payKind: 'CREDIT',
    });
    expect(r.body.data).toMatchObject({
      total: '3850000.00',
      payKind: 'CREDIT',
      payable: { amount: '3850000.00', dueDate: '2026-10-30', status: 'OPEN' },
    });
    expect(r.body.data.lines[0]!.costPerBase).toBe('7700.0000'); // (3.800.000 + 50.000) / 500 kg
    // Back-dated invoice: its layer is older than the cash purchase above → consumed first.
    expect(await layers()).toEqual(['500.0000@7700.0000', '500.0000@7100.0000']);

    const t = await buy({
      supplierId: supplier.id,
      lines: [{ productUnitId: zak(), qty: '1', unitPrice: '380000' }],
      payKind: 'TRANSFER',
      paymentMethodId: bca,
    });
    expect(t.body.data.payKind).toBe('TRANSFER');
  });

  it('the same supplier invoice number twice is refused; Idempotency-Key returns the same invoice', async () => {
    const dup = await buy({
      supplierId: supplier.id,
      supplierInvoiceNo: 'INV-001',
      lines: [{ productUnitId: zak(), qty: '1', unitPrice: '1' }],
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_SUPPLIER_INVOICE');
    const key = randomUUID();
    const body = { supplierId: supplier.id, lines: [{ productUnitId: zak(), qty: '1', unitPrice: '360000' }] };
    const a = await buy(body, { 'idempotency-key': key });
    const b = await buy(body, { 'idempotency-key': key });
    expect(b.body.data.id).toBe(a.body.data.id);
  });

  it('price history lists the latest purchase prices', async () => {
    const r = await api.call<Data<PriceHistoryRow[]>>('GET', `/purchases/price-history?productId=${urea.id}`);
    expect(r.body.data[0]).toMatchObject({ supplierName: 'CV Pupuk Uji', unitCode: 'ZAK' });
    expect(r.body.data.length).toBeGreaterThanOrEqual(4);
  });
});

describe('purchase return (RB)', () => {
  it('takes the receipt’s own layer first and reduces the payable; more than received is refused', async () => {
    const list = await api.call<{ data: { id: string; payKind: string }[] }>('GET', '/purchases?pageSize=50');
    const credit = list.body.data.find((p) => p.payKind === 'CREDIT')!;
    const inv = (await api.call<Data<Purchase>>('GET', `/purchases/${credit.id}`)).body.data;
    const tooMuch = await api.call<ErrBody>('POST', `/purchases/${inv.id}/returns`, {
      lines: [{ receiptItemId: inv.lines[0]!.id, qty: '11' }],
      settlement: 'REDUCE_PAYABLE',
      reason: 'Rusak',
    });
    expect(tooMuch.body.error.code).toBe('RETURN_TOO_MUCH');
    const r = await api.call<Data<Purchase>>('POST', `/purchases/${inv.id}/returns`, {
      lines: [{ receiptItemId: inv.lines[0]!.id, qty: '2' }],
      settlement: 'REDUCE_PAYABLE',
      reason: 'Sak bocor',
    });
    expect(r.status).toBe(201);
    expect(r.body.data.returns[0]).toMatchObject({ number: expect.stringMatching(/\/RB\/UTM\//), total: '760000.00' });
    expect(r.body.data.lines[0]!.returnedQty).toBe('2');
    expect(r.body.data.payable).toMatchObject({ paidAmount: '760000.00', status: 'PARTIAL' });
    // The deduction is an allocation row tied to the return (S9-4).
    const alloc = await api.pool.query(
      `SELECT a.amount::text, pr.number FROM payable_payment_allocations a JOIN purchase_returns pr ON pr.id = a.purchase_return_id`,
    );
    expect(alloc.rows).toEqual([{ amount: '760000.00', number: r.body.data.returns[0]!.number }]);
    const cost = await api.pool.query(
      `SELECT pri.unit_cost::text FROM purchase_return_items pri JOIN purchase_returns pr ON pr.id = pri.purchase_return_id WHERE pr.purchase_invoice_id = $1`,
      [inv.id],
    );
    expect(cost.rows[0].unit_cost).toBe('7700.0000');
  });
});

describe('sale return (RJ)', () => {
  const grant = async () =>
    (
      await api.call<Data<AuthorizationGrantResult>>(
        'POST',
        '/auth/authorize',
        { username: TEST_USERS.OWNER.username, pin: TEST_USERS.OWNER.pin, permission: 'sales.return' },
        { as: 'KASIR' },
      )
    ).body.data.grant;

  it('needs the Owner PIN for a cashier; taken goods go back to stock at the line HPP, cash refunded from LACI', async () => {
    const sale = (
      await api.call<Data<Sale>>(
        'POST',
        '/sales',
        {
          lines: [{ productUnitId: zak(), qty: '2', unitPrice: '595000' }],
          payments: [{ paymentMethodId: cash, amount: '1190000' }],
        },
        { as: 'KASIR' },
      )
    ).body.data;
    const body = {
      lines: [{ saleItemId: sale.lines[0]!.id, qty: '1' }],
      settlement: 'CASH_REFUND',
      reason: 'Salah beli',
    };
    expect((await api.call('POST', `/sales/${sale.id}/returns`, body, { as: 'KASIR' })).status).toBe(423);
    const before = await api.pool.query<{ qty: string }>(`SELECT qty::text FROM stock_balances WHERE product_id = $1`, [
      urea.id,
    ]);
    const r = await api.call<Data<SaleReturnResult>>('POST', `/sales/${sale.id}/returns`, body, {
      as: 'KASIR',
      headers: { 'x-authorization-grant': await grant() },
    });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ number: expect.stringMatching(/\/RJ\/UTM\//), total: '595000.00' });
    const after = await api.pool.query<{ qty: string }>(`SELECT qty::text FROM stock_balances WHERE product_id = $1`, [
      urea.id,
    ]);
    expect(dec(after.rows[0]!.qty).minus(before.rows[0]!.qty).toFixed()).toBe('50');
    const detail = (await api.call<Data<Sale>>('GET', `/sales/${sale.id}`, undefined, { as: 'OWNER' })).body.data;
    expect(detail.lines[0]!.returnedQty).toBe('1');
    const refund = await api.pool.query(`SELECT direction, amount::text FROM cash_transactions WHERE source_id = $1`, [
      r.body.data.id,
    ]);
    expect(refund.rows).toEqual([{ direction: 'OUT', amount: '595000.00' }]);
    // A sale with a return cannot be voided any more.
    expect(
      (await api.call<ErrBody>('POST', `/sales/${sale.id}/void`, { reason: 'x x' }, { as: 'OWNER' })).body.error.code,
    ).toBe('VOID_HAS_RETURNS');
  });

  it('not-yet-picked-up goods: the reservation is released, nothing moves physically; credit reduced', async () => {
    const sale = (
      await api.call<Data<Sale>>(
        'POST',
        '/sales',
        {
          channel: 'FAKTUR',
          customerId: budi.id,
          pickupLater: true,
          lines: [{ productUnitId: zak(), qty: '3', unitPrice: '595000' }],
        },
        { as: 'OWNER' },
      )
    ).body.data;
    const before = await api.pool.query<{ qty: string; reserved: string }>(
      `SELECT qty::text, reserved_qty::text AS reserved FROM stock_balances WHERE product_id = $1`,
      [urea.id],
    );
    const r = await api.call<Data<SaleReturnResult>>(
      'POST',
      `/sales/${sale.id}/returns`,
      { lines: [{ saleItemId: sale.lines[0]!.id, qty: '3' }], settlement: 'REDUCE_RECEIVABLE', reason: 'Tidak jadi' },
      { as: 'OWNER' },
    );
    expect(r.status).toBe(201);
    const after = await api.pool.query<{ qty: string; reserved: string }>(
      `SELECT qty::text, reserved_qty::text AS reserved FROM stock_balances WHERE product_id = $1`,
      [urea.id],
    );
    expect(after.rows[0]!.qty).toBe(before.rows[0]!.qty);
    expect(dec(before.rows[0]!.reserved).minus(after.rows[0]!.reserved).toFixed()).toBe('150');
    const s = await api.pool.query(`SELECT fulfillment_status FROM sales WHERE id = $1`, [sale.id]);
    expect(s.rows[0].fulfillment_status).toBe('CANCELLED');
    const rec = await api.pool.query(`SELECT status, paid_amount::text FROM receivables WHERE source_id = $1`, [
      sale.id,
    ]);
    expect(rec.rows[0]).toEqual({ status: 'PAID', paid_amount: '1785000.00' });
    const alloc = await api.pool.query(
      `SELECT a.amount::text FROM receivable_payment_allocations a WHERE a.sale_return_id = $1 AND a.receivable_payment_id IS NULL`,
      [r.body.data.id],
    );
    expect(alloc.rows).toEqual([{ amount: r.body.data.total }]);
    const again = await api.call<ErrBody>(
      'POST',
      `/sales/${sale.id}/returns`,
      { lines: [{ saleItemId: sale.lines[0]!.id, qty: '1' }], settlement: 'CASH_REFUND', reason: 'Lagi' },
      { as: 'OWNER' },
    );
    expect(again.body.error.code).toBe('RETURN_TOO_MUCH');
  });
});
