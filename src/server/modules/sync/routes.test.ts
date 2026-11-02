import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Customer, PaymentMethod, Product, Unit } from '@shared/schemas/master';
import type { PairDeviceResult, PairingCodeResult } from '@shared/schemas/devices';
import type { SyncPullResult, SyncPushResult } from '@shared/schemas/sync';
import type { Opname } from '@shared/schemas/stock';
import { uuidv7 } from '@shared/uuid';
import { startTestApi, type Data, type TestApi } from '../../../../test/api';
import { withTransaction } from '../../db/tx';
import * as stock from '../stock/service';

let api: TestApi;
let urea: Product;
let cashMethodId: string;
let customer: Customer;
let whId: string;
let deviceToken: string;

const zak = () => urea.units.find((u) => u.unitCode === 'ZAK')!.id;
const kg = () => urea.units.find((u) => u.unitCode === 'KG')!.id;

beforeAll(async () => {
  api = await startTestApi();

  // 1. Create pairing code & pair a mobile device to test device push auth
  const codeRes = await api.call<{ data: PairingCodeResult }>('POST', '/devices/pairing-codes', { kind: 'MOBILE' });
  const pairRes = await api.call<{ data: PairDeviceResult }>(
    'POST',
    '/devices/pair',
    {
      code: codeRes.body.data.code,
      deviceName: 'Device Sync Tester',
      kind: 'MOBILE',
      appVersion: '1.0.0',
    },
    { as: 'ANONYMOUS' },
  );
  deviceToken = pairRes.body.data.token;

  // 2. Setup master data
  const units = (await api.call<Data<Unit[]>>('GET', '/units')).body.data;
  const unit = (code: string) => units.find((u) => u.code === code)!.id;

  urea = (
    await api.call<Data<Product>>('POST', '/products', {
      name: 'UREA SYNC TEST',
      units: [
        { unitId: unit('KG'), conversionQty: '1', isBase: true, prices: [{ price: '12000' }] },
        { unitId: unit('ZAK'), conversionQty: '50', isBase: false, isDefaultSale: true, prices: [{ price: '595000' }] },
      ],
    })
  ).body.data;

  whId = (await api.pool.query<{ id: string }>("SELECT id FROM warehouses WHERE code = 'UTM'")).rows[0]!.id;

  // Put 100 kg in stock @ 7000/kg
  await withTransaction(api.pool, (tx) =>
    stock.apply(tx, [
      {
        productId: urea.id,
        warehouseId: whId,
        qty: '100',
        unitCost: '7000',
        sourceType: 'PURCHASE_RECEIPT',
        sourceId: uuidv7(),
        movedAt: new Date(),
      },
    ]),
  );

  const methods = (await api.call<Data<PaymentMethod[]>>('GET', '/payment-methods')).body.data;
  cashMethodId = methods.find((m) => m.kind === 'CASH')!.id;

  customer = (
    await api.call<Data<Customer>>('POST', '/customers', {
      name: 'Pak Tani Sync',
      paymentTermsDays: 14,
      creditLimit: '5000000',
    })
  ).body.data;
});

afterAll(async () => {
  await api?.close();
});

describe('sync pull (FR-SRV-05)', () => {
  it('pulls units successfully', async () => {
    const res = await api.call<{ data: SyncPullResult<Unit> }>('GET', '/sync/pull?entity=units&limit=100');
    expect(res.status).toBe(200);
    expect(res.body.data.rows.length).toBeGreaterThan(0);
    expect(res.body.data.server_time).toBeDefined();
    expect(res.body.data.next_since).toBeDefined();
  });

  it('redacts last_purchase_cost for KASIR and includes it for OWNER', async () => {
    // Owner sees cost
    const resOwner = await api.call<{ data: SyncPullResult<Record<string, unknown>> }>(
      'GET',
      '/sync/pull?entity=products',
      undefined,
      { as: 'OWNER' },
    );
    expect(resOwner.status).toBe(200);
    const ureaOwner = resOwner.body.data.rows.find((r) => r.id === urea.id);
    expect(ureaOwner).toBeDefined();
    expect(ureaOwner!.last_purchase_cost).toBe('7000.0000');

    // Kasir / Device has cost redacted to null
    const resKasir = await api.call<{ data: SyncPullResult<Record<string, unknown>> }>(
      'GET',
      '/sync/pull?entity=products',
      undefined,
      { as: 'KASIR' },
    );
    expect(resKasir.status).toBe(200);
    const ureaKasir = resKasir.body.data.rows.find((r) => r.id === urea.id);
    expect(ureaKasir).toBeDefined();
    expect(ureaKasir!.last_purchase_cost).toBeNull();
  });

  it('paginates with limit, has_more, and cursor without overlap on page 2', async () => {
    const page1 = await api.call<{ data: SyncPullResult<{ id: string }> }>(
      'GET',
      '/sync/pull?entity=units&limit=2',
    );
    expect(page1.status).toBe(200);
    expect(page1.body.data.rows).toHaveLength(2);
    expect(page1.body.data.has_more).toBe(true);
    expect(page1.body.data.cursor).toBeDefined();

    const page2 = await api.call<{ data: SyncPullResult<{ id: string }> }>(
      'GET',
      `/sync/pull?entity=units&limit=2&cursor=${encodeURIComponent(page1.body.data.cursor!)}`,
    );
    expect(page2.status).toBe(200);
    expect(page2.body.data.rows.length).toBeGreaterThan(0);
    // Elements on page 2 should not intersect with page 1
    const ids1 = page1.body.data.rows.map((r) => r.id);
    for (const r of page2.body.data.rows) {
      expect(ids1).not.toContain(r.id);
    }
  });
});

describe('sync push (FR-SRV-06..08)', () => {
  it('applies sale.create, marks source = SYNC, and deduplicates retry with DUPLICATE', async () => {
    const opId = randomUUID();
    const pushRes = await api.call<{ data: SyncPushResult }>(
      'POST',
      '/sync/push',
      {
        ops: [
          {
            op_id: opId,
            type: 'sale.create',
            device_time: new Date().toISOString(),
            payload: {
              channel: 'KASIR',
              customerId: null,
              lines: [{ productUnitId: kg(), qty: '5', unitPrice: '12000' }],
              discountAmount: '0',
              otherCharges: '0',
              payments: [{ paymentMethodId: cashMethodId, amount: '60000' }],
              pickupLater: false,
            },
          },
        ],
      },
      {
        headers: {
          authorization: `Bearer ${deviceToken}`,
          'x-device-time': new Date().toISOString(),
        },
      },
    );

    expect(pushRes.status).toBe(200);
    expect(pushRes.body.data.results).toHaveLength(1);
    const res1 = pushRes.body.data.results[0]!;
    expect(res1.op_id).toBe(opId);
    expect(res1.status).toBe('APPLIED');
    expect((res1.result as { number: string }).number).toMatch(/\/KSR\//);

    // Verify source = 'SYNC' in DB
    const saleRow = (
      await api.pool.query<{ source: string }>('SELECT source FROM sales WHERE client_op_id = $1', [opId])
    ).rows[0];
    expect(saleRow?.source).toBe('SYNC');

    // Retry the exact same op_id -> DUPLICATE
    const retryRes = await api.call<{ data: SyncPushResult }>(
      'POST',
      '/sync/push',
      {
        ops: [
          {
            op_id: opId,
            type: 'sale.create',
            device_time: new Date().toISOString(),
            payload: {
              channel: 'KASIR',
              customerId: null,
              lines: [{ productUnitId: kg(), qty: '5', unitPrice: '12000' }],
              discountAmount: '0',
              otherCharges: '0',
              payments: [{ paymentMethodId: cashMethodId, amount: '60000' }],
              pickupLater: false,
            },
          },
        ],
      },
      {
        headers: {
          authorization: `Bearer ${deviceToken}`,
        },
      },
    );

    expect(retryRes.status).toBe(200);
    const res2 = retryRes.body.data.results[0]!;
    expect(res2.op_id).toBe(opId);
    expect(res2.status).toBe('DUPLICATE');
  });

  it('permits negative stock on offline sale (source = SYNC)', async () => {
    // Current stock is < 100 kg. Sell 5000 kg.
    const opId = randomUUID();
    const pushRes = await api.call<{ data: SyncPushResult }>(
      'POST',
      '/sync/push',
      {
        ops: [
          {
            op_id: opId,
            type: 'sale.create',
            device_time: new Date().toISOString(),
            payload: {
              channel: 'KASIR',
              customerId: null,
              lines: [{ productUnitId: kg(), qty: '5000', unitPrice: '12000' }],
              discountAmount: '0',
              otherCharges: '0',
              payments: [{ paymentMethodId: cashMethodId, amount: '60000000' }],
              pickupLater: false,
            },
          },
        ],
      },
      {
        headers: {
          authorization: `Bearer ${deviceToken}`,
        },
      },
    );

    expect(pushRes.status).toBe(200);
    const res = pushRes.body.data.results[0]!;
    expect(res.status).toBe('APPLIED');

    // Verify stock balance is now negative
    const balRes = (
      await api.pool.query<{ qty: string }>(
        'SELECT qty::text AS qty FROM stock_balances WHERE product_id = $1 AND warehouse_id = $2',
        [urea.id, whId],
      )
    ).rows[0];
    expect(Number(balRes?.qty)).toBeLessThan(0);
  });

  it('applies opname.count successfully', async () => {
    // Create an opname session
    const opnameRes = await api.call<Data<Opname>>('POST', '/stock/opnames', { note: 'Opname Sync Test' });
    const opnameId = opnameRes.body.data.id;

    const opId = randomUUID();
    const pushRes = await api.call<{ data: SyncPushResult }>(
      'POST',
      '/sync/push',
      {
        ops: [
          {
            op_id: opId,
            type: 'opname.count',
            device_time: new Date().toISOString(),
            payload: {
              opnameId,
              productId: urea.id,
              productUnitId: zak(),
              countedQty: '25',
            },
          },
        ],
      },
      {
        headers: {
          authorization: `Bearer ${deviceToken}`,
        },
      },
    );

    expect(pushRes.status).toBe(200);
    expect(pushRes.body.data.results[0]!.status).toBe('APPLIED');

    // Check opname line in DB: 25 ZAK * 50 = 1250 KG base
    const line = (
      await api.pool.query<{ counted_qty: string }>(
        'SELECT counted_qty::text FROM stock_opname_lines WHERE opname_id = $1 AND product_id = $2',
        [opnameId, urea.id],
      )
    ).rows[0];
    expect(Number(line?.counted_qty)).toBe(1250);
  });

  it('handles receivable_payment.create successfully', async () => {
    // 1. Create a credit sale first
    const creditSaleOpId = randomUUID();
    await api.call(
      'POST',
      '/sync/push',
      {
        ops: [
          {
            op_id: creditSaleOpId,
            type: 'sale.create',
            device_time: new Date().toISOString(),
            payload: {
              channel: 'FAKTUR',
              customerId: customer.id,
              lines: [{ productUnitId: kg(), qty: '10', unitPrice: '12000' }],
              discountAmount: '0',
              otherCharges: '0',
              payments: [], // unpaid = 120,000 credit
              dueDate: '2026-11-20',
              pickupLater: false,
            },
          },
        ],
      },
      {
        headers: { authorization: `Bearer ${deviceToken}` },
      },
    );

    // 2. Pay 50,000 toward customer's receivable
    const payOpId = randomUUID();
    const pushPay = await api.call<{ data: SyncPushResult }>(
      'POST',
      '/sync/push',
      {
        ops: [
          {
            op_id: payOpId,
            type: 'receivable_payment.create',
            device_time: new Date().toISOString(),
            payload: {
              customerId: customer.id,
              amount: '50000',
              paymentMethodId: cashMethodId,
              reference: 'Cicil HP Staf',
              allocations: null, // oldest first
            },
          },
        ],
      },
      {
        headers: { authorization: `Bearer ${deviceToken}` },
      },
    );

    expect(pushPay.status).toBe(200);
    expect(pushPay.body.data.results[0]!.status).toBe('APPLIED');
  });

  it('rejects invalid payload permanently with REJECTED', async () => {
    const opId = randomUUID();
    const badPush = await api.call<{ data: SyncPushResult }>(
      'POST',
      '/sync/push',
      {
        ops: [
          {
            op_id: opId,
            type: 'sale.create',
            device_time: new Date().toISOString(),
            payload: {
              channel: 'KASIR',
              customerId: '00000000-0000-0000-0000-000000000000', // non-existent customer
              lines: [{ productUnitId: kg(), qty: '1', unitPrice: '12000' }],
              payments: [{ paymentMethodId: cashMethodId, amount: '12000' }],
            },
          },
        ],
      },
      {
        headers: { authorization: `Bearer ${deviceToken}` },
      },
    );

    expect(badPush.status).toBe(200);
    const res1 = badPush.body.data.results[0]!;
    expect(res1.status).toBe('REJECTED');
    expect(res1.error?.code).toBe('CUSTOMER_NOT_FOUND');

    // Repeated submission of rejected op returns REJECTED from sync_ops
    const retryBad = await api.call<{ data: SyncPushResult }>(
      'POST',
      '/sync/push',
      {
        ops: [
          {
            op_id: opId,
            type: 'sale.create',
            device_time: new Date().toISOString(),
            payload: {},
          },
        ],
      },
      {
        headers: { authorization: `Bearer ${deviceToken}` },
      },
    );
    expect(retryBad.status).toBe(200);
    const res2 = retryBad.body.data.results[0]!;
    expect(res2.status).toBe('REJECTED');
    expect(res2.error?.code).toBe('CUSTOMER_NOT_FOUND');
  });
});
