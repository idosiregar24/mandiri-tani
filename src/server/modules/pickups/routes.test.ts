import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthorizationGrantResult } from '@shared/schemas/auth';
import type { Customer, PaymentMethod, Product, Unit } from '@shared/schemas/master';
import type { OutstandingLine, Pickup } from '@shared/schemas/pickups';
import type { HeldSaleItem, LastPrice, RecalledSale, Sale } from '@shared/schemas/sales';
import { dec } from '@shared/money';
import { uuidv7 } from '@shared/uuid';
import { startTestApi, TEST_USERS, type Data, type ErrBody, type TestApi } from '../../../../test/api';
import { withTransaction } from '../../db/tx';
import * as stock from '../stock/service';

let api: TestApi;
let urea: Product;
let cash: string;
let budi: Customer;
let siti: Customer;
const zak = () => urea.units.find((u) => u.unitCode === 'ZAK')!.id;

beforeAll(async () => {
  api = await startTestApi();
  const units = (await api.call<Data<Unit[]>>('GET', '/units')).body.data;
  const unit = (c: string) => units.find((u) => u.code === c)!.id;
  urea = (
    await api.call<Data<Product>>('POST', '/products', {
      name: 'UREA UJI AMBIL',
      units: [
        { unitId: unit('KG'), conversionQty: '1', isBase: true, prices: [{ price: '12000' }] },
        { unitId: unit('ZAK'), conversionQty: '50', isBase: false, isDefaultSale: true, prices: [{ price: '595000' }] },
      ],
    })
  ).body.data;
  const wh = (await api.pool.query<{ id: string }>("SELECT id FROM warehouses WHERE code = 'UTM'")).rows[0]!.id;
  await withTransaction(api.pool, (tx) =>
    stock.apply(tx, [
      {
        productId: urea.id,
        warehouseId: wh,
        qty: '1000',
        unitCost: '7000',
        sourceType: 'PURCHASE_RECEIPT',
        sourceId: uuidv7(),
        movedAt: new Date(),
      },
    ]),
  );
  cash = (await api.call<Data<PaymentMethod[]>>('GET', '/payment-methods')).body.data.find(
    (m) => m.kind === 'CASH',
  )!.id;
  budi = (await api.call<Data<Customer>>('POST', '/customers', { name: 'Budi Uji Ambil' })).body.data;
  siti = (await api.call<Data<Customer>>('POST', '/customers', { name: 'Siti Uji Ambil' })).body.data;
});
afterAll(async () => {
  await api?.close();
});

async function balance() {
  const r = await api.pool.query<{ qty: string; reserved: string }>(
    `SELECT qty::text, reserved_qty::text AS reserved FROM stock_balances WHERE product_id = $1`,
    [urea.id],
  );
  return r.rows[0]!;
}

const sellLater = async (customerId: string, qty: string, price = '595000') =>
  (
    await api.call<Data<Sale>>(
      'POST',
      '/sales',
      {
        channel: 'FAKTUR',
        customerId,
        pickupLater: true,
        lines: [{ productUnitId: zak(), qty, unitPrice: price }],
        payments: [{ paymentMethodId: cash, amount: String(Number(qty) * Number(price)) }],
      },
      { as: 'KASIR' },
    )
  ).body.data;

const outstanding = async (customerId: string) =>
  (
    await api.call<Data<OutstandingLine[]>>('GET', `/pickups/outstanding?customerId=${customerId}`, undefined, {
      as: 'KASIR',
    })
  ).body.data;

const pickup = (body: unknown, headers: Record<string, string> = {}) =>
  api.call<Data<Pickup> & ErrBody>('POST', '/pickups', body, { as: 'KASIR', headers });

describe('pickups (FR-PKP)', () => {
  it('sold later → physical stays, reserved rises; picking up in two notes across two sales', async () => {
    const before = await balance();
    const s1 = await sellLater(budi.id, '4');
    const s2 = await sellLater(budi.id, '2');
    const mid = await balance();
    expect(mid.qty).toBe(before.qty);
    expect(dec(mid.reserved).minus(before.reserved).toFixed()).toBe('300');

    const open = await outstanding(budi.id);
    expect(open.map((o) => [o.saleNumber, o.remainingQty])).toEqual([
      [s1.number, '4'],
      [s2.number, '2'],
    ]);
    const first = await pickup({
      customerId: budi.id,
      receiverName: 'Anak Pak Budi',
      vehicle: 'BM 1234 XY',
      lines: [
        { saleItemId: open[0]!.saleItemId, qty: '1' },
        { saleItemId: open[1]!.saleItemId, qty: '2' },
      ],
    });
    expect(first.status).toBe(201);
    expect(first.body.data.number).toMatch(/^0001\/AB\/UTM\/\d{4}$/);
    expect(first.body.data.lines.map((l) => l.remainingQty)).toEqual(['3', '0']);
    const after = await balance();
    expect(dec(mid.qty).minus(after.qty).toFixed()).toBe('150');
    expect(dec(mid.reserved).minus(after.reserved).toFixed()).toBe('150');

    const sales = await api.pool.query<{ number: string; fulfillment_status: string }>(
      `SELECT number, fulfillment_status FROM sales WHERE id = ANY($1) ORDER BY number`,
      [[s1.id, s2.id]],
    );
    expect(sales.rows.map((r) => r.fulfillment_status)).toEqual(['PARTIAL', 'COMPLETE']);
    // The HPP of a picked-up line is the FIFO cost at pickup time.
    const cost = await api.pool.query(`SELECT cost_per_base::text FROM sale_items WHERE id = $1`, [
      open[0]!.saleItemId,
    ]);
    expect(cost.rows[0].cost_per_base).toBe('7000.0000');
  });

  it('refuses more than the remainder, another customer’s line, and a second submit with the same key', async () => {
    const open = await outstanding(budi.id);
    const tooMuch = await pickup({
      customerId: budi.id,
      receiverName: 'X',
      lines: [{ saleItemId: open[0]!.saleItemId, qty: '99' }],
    });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.error.code).toBe('PICKUP_TOO_MUCH');
    const wrong = await pickup({
      customerId: siti.id,
      receiverName: 'X',
      lines: [{ saleItemId: open[0]!.saleItemId, qty: '1' }],
    });
    expect(wrong.body.error.code).toBe('PICKUP_LINE_INVALID');

    const key = randomUUID();
    const body = {
      customerId: budi.id,
      receiverName: 'Pak Budi',
      lines: [{ saleItemId: open[0]!.saleItemId, qty: '1' }],
    };
    const a = await pickup(body, { 'idempotency-key': key });
    const b = await pickup(body, { 'idempotency-key': key });
    expect(b.body.data.id).toBe(a.body.data.id);
    expect((await outstanding(budi.id))[0]!.remainingQty).toBe('2');
  });

  it('a sale with pickups cannot be voided; cancelling the pickup (Owner PIN) restores stock and remainder', async () => {
    const open = await outstanding(budi.id);
    const saleId = open[0]!.saleId;
    const voidTry = await api.call<ErrBody>('POST', `/sales/${saleId}/void`, { reason: 'Coba' }, { as: 'OWNER' });
    expect(voidTry.body.error.code).toBe('VOID_HAS_PICKUPS');

    const p = (
      await pickup({
        customerId: budi.id,
        receiverName: 'Pak Budi',
        lines: [{ saleItemId: open[0]!.saleItemId, qty: '2' }],
      })
    ).body.data;
    const before = await balance();
    const noPin = await api.call<ErrBody>(
      'POST',
      `/pickups/${p.id}/cancel`,
      { reason: 'Salah orang' },
      { as: 'KASIR' },
    );
    expect(noPin.status).toBe(423);
    const grant = (
      await api.call<Data<AuthorizationGrantResult>>(
        'POST',
        '/auth/authorize',
        { username: TEST_USERS.OWNER.username, pin: TEST_USERS.OWNER.pin, permission: 'pickups.cancel' },
        { as: 'KASIR' },
      )
    ).body.data.grant;
    const r = await api.call<Data<Pickup>>(
      'POST',
      `/pickups/${p.id}/cancel`,
      { reason: 'Salah orang' },
      {
        as: 'KASIR',
        headers: { 'x-authorization-grant': grant },
      },
    );
    expect(r.body.data.status).toBe('CANCELLED');
    const after = await balance();
    expect(dec(after.qty).minus(before.qty).toFixed()).toBe('100');
    expect(dec(after.reserved).minus(before.reserved).toFixed()).toBe('100');
    expect((await outstanding(budi.id))[0]!.remainingQty).toBe('2');
    // Invariant: reserved = Σ unpicked remainder × conversion (only this product's open sales here).
    const sum = (await outstanding(budi.id)).reduce((s, o) => s.plus(dec(o.remainingQty).times(50)), dec(0));
    expect(dec(after.reserved).toFixed()).toBe(sum.toFixed());
  });

  it('physical stock short at pickup is refused (no negative stock through a pickup)', async () => {
    const s = await sellLater(siti.id, '1');
    const wh = (await api.pool.query<{ id: string }>("SELECT id FROM warehouses WHERE code = 'UTM'")).rows[0]!.id;
    const bal = await balance();
    // Goods lost in the warehouse: an adjustment takes every physical kg away.
    await withTransaction(api.pool, (tx) =>
      stock.apply(
        tx,
        [
          {
            productId: urea.id,
            warehouseId: wh,
            qty: dec(bal.qty).neg().toFixed(),
            sourceType: 'ADJUSTMENT',
            sourceId: uuidv7(),
            movedAt: new Date(),
          },
        ],
        { allowNegative: true },
      ),
    );
    const line = (await outstanding(siti.id)).find((o) => o.saleId === s.id)!;
    const r = await pickup({
      customerId: siti.id,
      receiverName: 'Bu Siti',
      lines: [{ saleItemId: line.saleItemId, qty: '1' }],
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('STOCK_INSUFFICIENT');
  });
});

describe('held notes (FR-POS-08) and last prices (FR-POS-27)', () => {
  it('hold → list → recall moves the note back into the cart and deletes it; nothing touches stock', async () => {
    const before = await balance();
    const h = await api.call<Data<HeldSaleItem>>(
      'POST',
      '/sales/held',
      {
        channel: 'FAKTUR',
        customerId: siti.id,
        holdLabel: 'Bu Siti — tunggu suami',
        lines: [{ productUnitId: zak(), qty: '3', unitPrice: '590000' }],
        otherCharges: '50000',
      },
      { as: 'KASIR' },
    );
    expect(h.status).toBe(201);
    expect(h.body.data).toMatchObject({ holdLabel: 'Bu Siti — tunggu suami', total: '1820000.00', itemCount: 1 });
    const list = await api.call<Data<HeldSaleItem[]>>('GET', '/sales/held', undefined, { as: 'KASIR' });
    expect(list.body.data.map((x) => x.id)).toContain(h.body.data.id);
    expect(await balance()).toEqual(before);

    const r = await api.call<Data<RecalledSale>>('POST', `/sales/held/${h.body.data.id}/recall`, undefined, {
      as: 'KASIR',
    });
    expect(r.body.data).toMatchObject({
      channel: 'FAKTUR',
      customer: { id: siti.id },
      otherCharges: '50000.00',
      lines: [{ productUnitId: zak(), qty: '3', unitPrice: '590000.00', priceSource: 'MANUAL' }],
    });
    expect(r.body.data.products.map((p) => p.id)).toEqual([urea.id]);
    const again = await api.call<ErrBody>('POST', `/sales/held/${h.body.data.id}/recall`, undefined, { as: 'KASIR' });
    expect(again.status).toBe(404);
    // Held notes never show up in the sales history.
    const history = await api.call<{ data: { id: string }[] }>('GET', '/sales?pageSize=100', undefined, {
      as: 'OWNER',
    });
    expect(history.body.data.some((s) => s.id === h.body.data.id)).toBe(false);
  });

  it('last prices: the 3 most recent completed notes of this customer for this unit', async () => {
    // The previous test emptied the warehouse: receive some stock first.
    const wh = (await api.pool.query<{ id: string }>("SELECT id FROM warehouses WHERE code = 'UTM'")).rows[0]!.id;
    await withTransaction(api.pool, (tx) =>
      stock.apply(tx, [
        {
          productId: urea.id,
          warehouseId: wh,
          qty: '500',
          unitCost: '7000',
          sourceType: 'PURCHASE_RECEIPT',
          sourceId: uuidv7(),
          movedAt: new Date(),
        },
      ]),
    );
    for (const price of ['600000', '605000', '610000', '615000']) {
      await api.call(
        'POST',
        '/sales',
        {
          customerId: siti.id,
          lines: [{ productUnitId: zak(), qty: '1', unitPrice: price }],
          payments: [{ paymentMethodId: cash, amount: price }],
        },
        { as: 'KASIR' },
      );
    }
    const r = await api.call<Data<LastPrice[]>>(
      'GET',
      `/pos/last-prices?customerId=${siti.id}&productUnitId=${zak()}`,
      undefined,
      {
        as: 'KASIR',
      },
    );
    expect(r.body.data.map((x) => x.unitPrice)).toEqual(['615000.00', '610000.00', '605000.00']);
  });
});
