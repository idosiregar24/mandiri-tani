import { describe, expect, it } from 'vitest';
import type { Product } from '@shared/schemas/master';
import { fromProduct, newProductValues, splitBarcodes, toPayload, validate } from './form';

const KG = '0190f0a0-0000-7000-8000-000000000001';
const ZAK = '0190f0a0-0000-7000-8000-000000000002';
const GOLD = '0190f0a0-0000-7000-8000-0000000000aa';

const product: Product = {
  id: '0190f0a0-0000-7000-8000-00000000000f',
  sku: 'BRG00001',
  name: 'Pupuk Contoh',
  categoryId: null,
  categoryName: null,
  brandId: null,
  brandName: null,
  itemType: 'STANDARD',
  trackStock: true,
  allowDecimalQty: true,
  minStock: '0',
  maxStock: null,
  isActive: true,
  updatedAt: '2026-10-26T00:00:00Z',
  units: [
    {
      id: '0190f0a0-0000-7000-8000-0000000000b2',
      unitId: ZAK,
      unitCode: 'ZAK',
      unitName: 'Zak',
      conversionQty: '50',
      isBase: false,
      isDefaultSale: true,
      isDefaultPurchase: false,
      isSellable: true,
      barcodes: [],
      prices: [
        { id: 'p1', customerGroupId: null, minQty: '1', price: '640000.00' },
        { id: 'p2', customerGroupId: GOLD, minQty: '1', price: '630000.00' },
      ],
    },
    {
      id: '0190f0a0-0000-7000-8000-0000000000b1',
      unitId: KG,
      unitCode: 'KG',
      unitName: 'Kilogram',
      conversionQty: '1',
      isBase: true,
      isDefaultSale: false,
      isDefaultPurchase: true,
      isSellable: true,
      barcodes: ['2000000000011'],
      prices: [{ id: 'p3', customerGroupId: null, minQty: '1', price: '15000.00' }],
    },
  ],
};

describe('product form mapping', () => {
  it('puts the base unit first and splits general vs. special prices', () => {
    const v = fromProduct(product);
    expect(v.units.map((u) => u.unitId)).toEqual([KG, ZAK]);
    expect(v.units[0]).toMatchObject({ price: '15000', barcodes: '2000000000011', extra: [] });
    expect(v.units[1]).toMatchObject({
      price: '640000',
      extra: [{ customerGroupId: GOLD, minQty: '1', price: '630000' }],
    });
  });

  it('round-trips into the API payload without losing prices or ids', () => {
    const payload = toPayload(fromProduct(product));
    expect(payload.units[0]).toMatchObject({
      id: '0190f0a0-0000-7000-8000-0000000000b1',
      isBase: true,
      conversionQty: '1',
      barcodes: ['2000000000011'],
    });
    expect(payload.units[1]!.prices).toEqual([
      { customerGroupId: null, minQty: '1', price: '640000' },
      { customerGroupId: GOLD, minQty: '1', price: '630000' },
    ]);
    expect(validate(fromProduct(product))).toEqual([]);
  });

  it('maps shared-schema issues onto form fields', () => {
    const v = newProductValues(KG);
    v.units.push({ ...v.units[0]!, id: undefined, unitId: ZAK, conversionQty: '0', price: 'abc' });
    const issues = validate(v);
    expect(issues).toContainEqual({ field: 'name', message: 'Nama barang wajib diisi.' });
    expect(issues).toContainEqual({ field: 'units.1.conversionQty', message: 'Harus lebih dari 0.' });
    expect(issues.find((i) => i.field === 'units.1.price')?.message).toMatch(/rupiah/);
  });

  it('cleans up typed barcodes', () => {
    expect(splitBarcodes(' 899100, 899200 899100;\n')).toEqual(['899100', '899200']);
  });
});
