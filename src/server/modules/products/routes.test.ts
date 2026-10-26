import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Category, CustomerGroup, Product, ProductInput, ProductListItem, Unit } from '@shared/schemas/master';
import { startTestApi, type Data, type ErrBody, type ListBody, type TestApi } from '../../../../test/api';

let api: TestApi;
let unit: Record<string, string>;
let pupuk: Category;
let gold: CustomerGroup;

beforeAll(async () => {
  api = await startTestApi();
  const units = (await api.call<Data<Unit[]>>('GET', '/units')).body.data;
  unit = Object.fromEntries(units.map((u) => [u.code, u.id]));
  pupuk = (await api.call<Data<Category>>('POST', '/categories', { name: 'Pupuk' })).body.data;
  gold = (
    await api.call<Data<CustomerGroup>>('POST', '/customer-groups', {
      code: 'GOLD',
      name: 'Gold',
      discountPercent: '0',
    })
  ).body.data;
});
afterAll(async () => {
  await api?.close();
});

/** Synthetic fertiliser sold per KG and per ZAK (= 50 KG) — the store's real shape (D-3). */
const urea = (): ProductInput => ({
  name: 'Pupuk Urea Contoh',
  categoryId: pupuk.id,
  allowDecimalQty: true,
  units: [
    { unitId: unit.KG!, conversionQty: '1', isBase: true, barcodes: ['2000000000011'], prices: [{ price: '15000' }] },
    {
      unitId: unit.ZAK!,
      conversionQty: '50',
      isBase: false,
      isDefaultSale: true,
      prices: [{ price: '640000' }, { customerGroupId: gold.id, price: '630000' }],
    },
  ],
});

describe('products', () => {
  let saved: Product;

  it('saves product + units + barcodes + prices as one package (201)', async () => {
    const res = await api.call<Data<Product>>('POST', '/products', urea());
    expect(res.status).toBe(201);
    saved = res.body.data;
    expect(saved).toMatchObject({
      sku: 'BRG00001',
      categoryName: 'Pupuk',
      trackStock: true,
      allowDecimalQty: true,
      minStock: '0',
    });
    const [kg, zak] = saved.units;
    expect(kg).toMatchObject({
      unitCode: 'KG',
      conversionQty: '1',
      isBase: true,
      isDefaultSale: false,
      isDefaultPurchase: true,
    });
    expect(kg!.barcodes).toEqual(['2000000000011']);
    expect(kg!.prices).toEqual([{ id: expect.any(String), customerGroupId: null, minQty: '1', price: '15000.00' }]);
    expect(zak).toMatchObject({ unitCode: 'ZAK', conversionQty: '50', isDefaultSale: true });
    expect(zak!.prices.map((p) => [p.customerGroupId, p.price])).toEqual([
      [null, '640000.00'],
      [gold.id, '630000.00'],
    ]);
    const audit = await api.pool.query(
      "SELECT after FROM audit_logs WHERE action = 'price.create' AND entity_id = $1",
      [saved.id],
    );
    expect(audit.rows[0]?.after).toMatchObject({ 'ZAK|umum|1': '640000.00', 'KG|umum|1': '15000.00' });
  });

  it('lists with the general price of every unit and finds by name, code or exact barcode', async () => {
    const list = await api.call<ListBody<ProductListItem>>('GET', '/products?q=urea');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({
      sku: 'BRG00001',
      baseUnitCode: 'KG',
      units: [
        { unitCode: 'KG', conversionQty: '1', price: '15000.00' },
        { unitCode: 'ZAK', conversionQty: '50', price: '640000.00' },
      ],
    });
    expect((await api.call<ListBody<ProductListItem>>('GET', '/products?q=brg00001')).body.data).toHaveLength(1);
    expect((await api.call<ListBody<ProductListItem>>('GET', '/products?q=2000000000011')).body.data).toHaveLength(1);
    expect((await api.call<ListBody<ProductListItem>>('GET', `/products?categoryId=${pupuk.id}`)).body.meta.total).toBe(
      1,
    );
  });

  it('validates the unit table: exactly one base unit, base = 1, no unit twice (400)', async () => {
    const noBase = { ...urea(), units: urea().units.map((u) => ({ ...u, isBase: false })) };
    const r1 = await api.call<ErrBody>('POST', '/products', noBase);
    expect(r1.status).toBe(400);
    expect(r1.body.error.details?.fieldErrors?.units).toBe('Pilih tepat satu satuan dasar.');

    const baseNotOne = urea();
    baseNotOne.units[0]!.conversionQty = '2';
    expect(
      (await api.call<ErrBody>('POST', '/products', baseNotOne)).body.error.details?.fieldErrors?.[
        'units.0.conversionQty'
      ],
    ).toBe('Isi satuan dasar selalu 1.');

    const twice = urea();
    twice.units[1]!.unitId = unit.KG!;
    expect(
      (await api.call<ErrBody>('POST', '/products', twice)).body.error.details?.fieldErrors?.['units.1.unitId'],
    ).toBeDefined();

    const zeroConv = urea();
    zeroConv.units[1]!.conversionQty = '0';
    expect((await api.call<ErrBody>('POST', '/products', zeroConv)).status).toBe(400);
  });

  it('refuses a barcode used by another product (409) and a duplicate SKU (409)', async () => {
    const other = { ...urea(), name: 'Pupuk Lain', units: [{ ...urea().units[0]!, barcodes: ['2000000000011'] }] };
    const r = await api.call<ErrBody>('POST', '/products', other);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DUPLICATE_BARCODE');
    expect(r.body.error.message).toContain('Pupuk Urea Contoh');

    const sku = await api.call<ErrBody>('POST', '/products', {
      ...urea(),
      sku: 'brg00001',
      units: [{ ...urea().units[0]!, barcodes: [] }],
    });
    expect(sku.status).toBe(409);
    expect(sku.body.error.message).toContain('BRG00001');
  });

  it('updates prices in place, adds/removes units and audits only what changed', async () => {
    const [kg, zak] = saved.units;
    const res = await api.call<Data<Product>>('PUT', `/products/${saved.id}`, {
      ...urea(),
      sku: saved.sku,
      units: [
        {
          id: kg!.id,
          unitId: unit.KG!,
          conversionQty: '1',
          isBase: true,
          barcodes: ['2000000000011'],
          prices: [{ price: '15500' }],
        },
        {
          id: zak!.id,
          unitId: unit.ZAK!,
          conversionQty: '50',
          isBase: false,
          isDefaultSale: true,
          prices: [{ price: '640000' }],
        },
        { unitId: unit.GRAM!, conversionQty: '0.001', isBase: false, isSellable: false },
      ],
    });
    expect(res.status).toBe(200);
    const after = res.body.data;
    expect(after.units.map((u) => u.unitCode)).toEqual(['GRAM', 'KG', 'ZAK']);
    const kgAfter = after.units.find((u) => u.unitCode === 'KG')!;
    // Same price row updated, not replaced (stable id for sync).
    expect(kgAfter.prices[0]).toMatchObject({ id: kg!.prices[0]!.id, price: '15500.00' });
    expect(after.units.find((u) => u.unitCode === 'ZAK')!.prices).toHaveLength(1);

    const audit = await api.pool.query(
      "SELECT before, after FROM audit_logs WHERE action = 'price.update' AND entity_id = $1",
      [saved.id],
    );
    expect(audit.rows[0]).toEqual({
      before: { 'KG|umum|1': '15000.00', [`ZAK|${gold.id}|1`]: '630000.00' },
      after: { 'KG|umum|1': '15500.00', [`ZAK|${gold.id}|1`]: null },
    });
    saved = after;
  });

  it('moves the base unit and default flags without tripping the one-base index', async () => {
    const byCode = Object.fromEntries(saved.units.map((u) => [u.unitCode, u]));
    const res = await api.call<Data<Product>>('PUT', `/products/${saved.id}`, {
      ...urea(),
      sku: saved.sku,
      units: [
        {
          id: byCode.KG!.id,
          unitId: unit.KG!,
          conversionQty: '1',
          isBase: true,
          isDefaultPurchase: true,
          prices: [{ price: '15500' }],
        },
        {
          id: byCode.ZAK!.id,
          unitId: unit.ZAK!,
          conversionQty: '50',
          isBase: false,
          isDefaultSale: true,
          prices: [{ price: '640000' }],
        },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.units.map((u) => u.unitCode)).toEqual(['KG', 'ZAK']);
    // The KG barcode was not sent again → released, so another product may now use it.
    expect(res.body.data.units[0]!.barcodes).toEqual([]);
    const reuse = await api.call<Data<Product>>('POST', '/products', {
      ...urea(),
      name: 'Pakai Barcode Lama',
      units: [urea().units[0]!],
    });
    expect(reuse.status).toBe(201);
  });

  it('deactivates (audited) and soft-deletes', async () => {
    const off = await api.call<Data<Product>>('PUT', `/products/${saved.id}`, {
      ...urea(),
      sku: saved.sku,
      isActive: false,
      units: saved.units
        .filter((u) => u.unitCode !== 'GRAM')
        .map((u) => ({
          id: u.id,
          unitId: u.unitId,
          conversionQty: u.conversionQty,
          isBase: u.isBase,
          prices: u.prices.map((p) => ({ price: p.price })),
        })),
    });
    expect(off.body.data.isActive).toBe(false);
    expect((await api.call<ListBody<ProductListItem>>('GET', '/products?q=urea')).body.data).toHaveLength(0);
    expect(
      (await api.call<ListBody<ProductListItem>>('GET', '/products?q=urea&includeInactive=true')).body.data,
    ).toHaveLength(1);
    const actions = await api.pool.query('SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY seq', [saved.id]);
    expect(actions.rows.map((r) => r.action)).toContain('product.deactivate');

    expect((await api.call('DELETE', `/products/${saved.id}`)).status).toBe(204);
    expect((await api.call('GET', `/products/${saved.id}`)).status).toBe(404);
  });

  it('lets KASIR look products up but not change them (403)', async () => {
    expect((await api.call('GET', '/products', undefined, { as: 'KASIR' })).status).toBe(200);
    expect((await api.call('POST', '/products', urea(), { as: 'KASIR' })).status).toBe(403);
    expect((await api.call('GET', '/products', undefined, { as: 'ANONYMOUS' })).status).toBe(401);
  });
});
