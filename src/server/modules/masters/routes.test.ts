import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Brand, Category, CustomerGroup, Unit, Warehouse } from '@shared/schemas/master';
import { startTestApi, type Data, type ErrBody, type TestApi } from '../../../../test/api';

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi();
});
afterAll(async () => {
  await api?.close();
});

describe('units', () => {
  it('seeds the iPOS unit codes and lists them', async () => {
    const res = await api.call<Data<Unit[]>>('GET', '/units');
    expect(res.status).toBe(200);
    expect(res.body.data.map((u) => u.code)).toEqual(expect.arrayContaining(['KG', 'ZAK', 'PCS', 'BTL', 'LTR']));
  });

  it('creates, upper-cases the code, rejects duplicates (case-insensitive) and soft-deletes', async () => {
    const created = await api.call<Data<Unit>>('POST', '/units', { code: 'rim', name: 'Rim' });
    expect(created.status).toBe(201);
    expect(created.body.data.code).toBe('RIM');

    const dup = await api.call<ErrBody>('POST', '/units', { code: 'Rim', name: 'Rim lagi' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE');

    const del = await api.call('DELETE', `/units/${created.body.data.id}`);
    expect(del.status).toBe(204);
    const after = await api.call<Data<Unit[]>>('GET', '/units');
    expect(after.body.data.some((u) => u.code === 'RIM')).toBe(false);
    // The code is free again once the old row is a tombstone.
    expect((await api.call('POST', '/units', { code: 'RIM', name: 'Rim' })).status).toBe(201);

    const audit = await api.pool.query("SELECT 1 FROM audit_logs WHERE action = 'unit.delete' AND entity_id = $1", [
      created.body.data.id,
    ]);
    expect(audit.rowCount).toBe(1);
  });

  it('validates input with Indonesian field messages (400)', async () => {
    const res = await api.call<ErrBody>('POST', '/units', { code: '', name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details?.fieldErrors?.code).toBe('Kode satuan wajib diisi.');
  });

  it('answers 404 for an unknown or malformed id', async () => {
    expect(
      (await api.call('PUT', '/units/0190f0a0-0000-7000-8000-000000000000', { code: 'X', name: 'X' })).status,
    ).toBe(404);
    expect((await api.call('DELETE', '/units/not-a-uuid')).status).toBe(404);
  });
});

describe('categories & brands', () => {
  it('creates a category tree and refuses to delete a parent with children', async () => {
    const parent = await api.call<Data<Category>>('POST', '/categories', { name: 'Pupuk' });
    expect(parent.status).toBe(201);
    const child = await api.call<Data<Category>>('POST', '/categories', {
      name: 'Pupuk Organik',
      parentId: parent.body.data.id,
    });
    expect(child.body.data.parentId).toBe(parent.body.data.id);

    expect((await api.call<ErrBody>('POST', '/categories', { name: 'pupuk' })).status).toBe(409);
    const self = await api.call<ErrBody>('PUT', `/categories/${parent.body.data.id}`, {
      name: 'Pupuk',
      parentId: parent.body.data.id,
    });
    expect(self.body.error.code).toBe('INVALID_PARENT');

    const del = await api.call<ErrBody>('DELETE', `/categories/${parent.body.data.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('REFERENCE_IN_USE');
  });

  it('creates and renames a brand, rejects a duplicate name', async () => {
    const b = await api.call<Data<Brand>>('POST', '/brands', { name: 'Petrokimia' });
    expect(b.status).toBe(201);
    expect((await api.call('POST', '/brands', { name: 'PETROKIMIA' })).status).toBe(409);
    const renamed = await api.call<Data<Brand>>('PUT', `/brands/${b.body.data.id}`, { name: 'Petrokimia Gresik' });
    expect(renamed.body.data.name).toBe('Petrokimia Gresik');
  });
});

describe('warehouses', () => {
  it('keeps exactly one default warehouse (UTM seeded)', async () => {
    const list = await api.call<Data<Warehouse[]>>('GET', '/warehouses');
    const utm = list.body.data.find((w) => w.code === 'UTM')!;
    expect(utm.isDefault).toBe(true);

    const unset = await api.call<ErrBody>('PUT', `/warehouses/${utm.id}`, {
      code: 'UTM',
      name: 'Gudang Utama',
      isDefault: false,
    });
    expect(unset.body.error.code).toBe('DEFAULT_REQUIRED');
    expect((await api.call<ErrBody>('DELETE', `/warehouses/${utm.id}`)).status).toBe(409);

    const g2 = await api.call<Data<Warehouse>>('POST', '/warehouses', {
      code: 'gd2',
      name: 'Gudang Belakang',
      isDefault: true,
    });
    expect(g2.body.data).toMatchObject({ code: 'GD2', isDefault: true });
    const after = await api.call<Data<Warehouse[]>>('GET', '/warehouses');
    expect(after.body.data.filter((w) => w.isDefault).map((w) => w.code)).toEqual(['GD2']);
  });
});

describe('customer groups', () => {
  it('protects the built-in UMUM group', async () => {
    const list = await api.call<Data<CustomerGroup[]>>('GET', '/customer-groups');
    const umum = list.body.data.find((g) => g.code === 'UMUM')!;
    expect((await api.call<ErrBody>('DELETE', `/customer-groups/${umum.id}`)).body.error.code).toBe('BUILT_IN');
    const rename = await api.call<ErrBody>('PUT', `/customer-groups/${umum.id}`, {
      code: 'GENERAL',
      name: 'Umum',
      discountPercent: '0',
    });
    expect(rename.body.error.code).toBe('BUILT_IN');
  });

  it('validates the discount range', async () => {
    const bad = await api.call<ErrBody>('POST', '/customer-groups', {
      code: 'GOLD',
      name: 'Gold',
      discountPercent: '120',
    });
    expect(bad.status).toBe(400);
    const ok = await api.call<Data<CustomerGroup>>('POST', '/customer-groups', {
      code: 'gold',
      name: 'Gold',
      discountPercent: '2.5',
    });
    expect(ok.body.data).toMatchObject({ code: 'GOLD', discountPercent: '2.50', customerCount: 0 });
  });
});

describe('permissions', () => {
  it('needs the local access key (401 without it)', async () => {
    expect((await api.call('GET', '/units', undefined, { as: 'ANONYMOUS' })).status).toBe(401);
  });

  it('lets KASIR read masters but not change them (403)', async () => {
    expect((await api.call('GET', '/units', undefined, { as: 'KASIR' })).status).toBe(200);
    expect((await api.call('GET', '/customer-groups', undefined, { as: 'KASIR' })).status).toBe(200);
    for (const [method, path, body] of [
      ['POST', '/units', { code: 'X', name: 'X' }],
      ['POST', '/categories', { name: 'X' }],
      ['POST', '/brands', { name: 'X' }],
      ['POST', '/warehouses', { code: 'X', name: 'X' }],
      ['POST', '/customer-groups', { code: 'X', name: 'X', discountPercent: '0' }],
    ] as const) {
      const res = await api.call<ErrBody>(method, path, body, { as: 'KASIR' });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });
});
