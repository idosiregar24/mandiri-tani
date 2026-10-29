import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CustomerGroup, Product, Unit } from '@shared/schemas/master';
import type { PosLookupResult, PosProduct } from '@shared/schemas/pos';
import { uuidv7 } from '@shared/uuid';
import { startTestApi, type Data, type ErrBody, type TestApi } from '../../../../test/api';
import { withTransaction } from '../../db/tx';
import * as stock from '../stock/service';

let api: TestApi;
let urea: Product;
let gold: string;

beforeAll(async () => {
  api = await startTestApi();
  const units = (await api.call<Data<Unit[]>>('GET', '/units')).body.data;
  const unit = (code: string) => units.find((u) => u.code === code)!.id;
  gold = (
    await api.call<Data<CustomerGroup>>('POST', '/customer-groups', {
      code: 'GOLDUJI',
      name: 'Gold Uji',
      discountPercent: '10',
    })
  ).body.data.id;
  urea = (
    await api.call<Data<Product>>('POST', '/products', {
      name: 'UREA PUPUK UJI',
      units: [
        { unitId: unit('KG'), conversionQty: '1', isBase: true, prices: [{ price: '15000' }] },
        {
          unitId: unit('ZAK'),
          conversionQty: '50',
          isBase: false,
          isDefaultSale: true,
          barcodes: ['8990000000017'],
          prices: [{ price: '640000' }, { price: '620000', customerGroupId: gold }],
        },
      ],
    })
  ).body.data;
  await api.call('POST', '/products', {
    name: 'NPK MUTIARA 16-16-16 UJI',
    units: [{ unitId: unit('KG'), conversionQty: '1', isBase: true, prices: [{ price: '20000' }] }],
  });
  const inactive = await api.call<Data<Product>>('POST', '/products', {
    name: 'UREA LAMA NONAKTIF',
    isActive: false,
    units: [{ unitId: unit('KG'), conversionQty: '1', isBase: true }],
  });
  expect(inactive.status).toBe(201);
  const wh = (await api.pool.query<{ id: string }>("SELECT id FROM warehouses WHERE code = 'UTM'")).rows[0]!.id;
  await withTransaction(api.pool, async (tx) => {
    await stock.apply(tx, [
      {
        productId: urea.id,
        warehouseId: wh,
        qty: '500',
        unitCost: '7100',
        sourceType: 'PURCHASE_RECEIPT',
        sourceId: uuidv7(),
        movedAt: new Date(),
      },
    ]);
    await stock.reserve(tx, [{ productId: urea.id, warehouseId: wh, qty: '100' }]);
  });
});
afterAll(async () => {
  await api?.close();
});

describe('GET /pos/products', () => {
  it('finds by words of the name, with sellable units, all price rows and available stock — no cost', async () => {
    for (const as of ['KASIR', 'OWNER'] as const) {
      const r = await api.call<Data<PosProduct[]>>('GET', '/pos/products?q=urea%20uji', undefined, { as });
      expect(r.status).toBe(200);
      expect(r.body.data.map((p) => p.name)).toEqual(['UREA PUPUK UJI']);
      const p = r.body.data[0]!;
      expect(p).toMatchObject({ baseUnitCode: 'KG', trackStock: true, allowDecimalQty: false, availableQty: '400' });
      const zak = p.units.find((u) => u.unitCode === 'ZAK')!;
      expect(zak).toMatchObject({ conversionQty: '50', isDefaultSale: true, barcodes: ['8990000000017'] });
      expect(zak.prices).toEqual([
        { customerGroupId: null, minQty: '1', price: '640000.00' },
        { customerGroupId: gold, minQty: '1', price: '620000.00' },
      ]);
      expect(JSON.stringify(r.body)).not.toMatch(/cost|hpp/i);
    }
  });

  it('puts an exact barcode or SKU first and never lists inactive products', async () => {
    const byBarcode = await api.call<Data<PosProduct[]>>('GET', '/pos/products?q=8990000000017', undefined, {
      as: 'KASIR',
    });
    expect(byBarcode.body.data[0]!.id).toBe(urea.id);
    const bySku = await api.call<Data<PosProduct[]>>('GET', `/pos/products?q=${urea.sku.toLowerCase()}`, undefined, {
      as: 'KASIR',
    });
    expect(bySku.body.data[0]!.id).toBe(urea.id);
    const all = await api.call<Data<PosProduct[]>>('GET', '/pos/products?q=urea', undefined, { as: 'KASIR' });
    expect(all.body.data.map((p) => p.name)).toEqual(['UREA PUPUK UJI']);
    const npk = await api.call<Data<PosProduct[]>>('GET', '/pos/products?q=mutiara%2016', undefined, { as: 'KASIR' });
    expect(npk.body.data.map((p) => p.name)).toEqual(['NPK MUTIARA 16-16-16 UJI']);
  });

  it('needs a session and a search text', async () => {
    expect((await api.call('GET', '/pos/products?q=urea', undefined, { as: 'ANONYMOUS' })).status).toBe(401);
    expect((await api.call('GET', '/pos/products?q=', undefined, { as: 'KASIR' })).status).toBe(400);
  });
});

describe('GET /pos/lookup', () => {
  it('a barcode selects its own unit; a SKU selects the default sale unit', async () => {
    const zakId = urea.units.find((u) => u.unitCode === 'ZAK')!.id;
    const byBarcode = await api.call<Data<PosLookupResult>>('GET', '/pos/lookup?code=8990000000017', undefined, {
      as: 'KASIR',
    });
    expect(byBarcode.status).toBe(200);
    expect(byBarcode.body.data).toMatchObject({ unitId: zakId, product: { id: urea.id } });
    const bySku = await api.call<Data<PosLookupResult>>('GET', `/pos/lookup?code=${urea.sku}`, undefined, {
      as: 'KASIR',
    });
    expect(bySku.body.data.unitId).toBe(zakId);
  });

  it('an unknown code is a 404 the cashier can act on', async () => {
    const r = await api.call<ErrBody>('GET', '/pos/lookup?code=0000', undefined, { as: 'KASIR' });
    expect(r.status).toBe(404);
    expect(r.body.error).toMatchObject({
      code: 'PRODUCT_NOT_FOUND',
      message: expect.stringContaining('Cari dengan nama'),
    });
  });
});
