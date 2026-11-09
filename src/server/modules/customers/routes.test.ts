import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Customer, CustomerGroup, CustomerSummary } from '@shared/schemas/master';
import { startTestApi, type Data, type ErrBody, type ListBody, type TestApi } from '../../../../test/api';

let api: TestApi;
let gold: CustomerGroup;

beforeAll(async () => {
  api = await startTestApi();
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

describe('customers', () => {
  it('seeds the walk-in customer UMUM first in the list', async () => {
    const res = await api.call<ListBody<Customer>>('GET', '/customers');
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ code: 'UMUM', isWalkIn: true, creditLimit: '0.00' });
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 50 });
  });

  it('generates PLxxxx codes, normalises the phone and defaults the term to 10 days', async () => {
    const a = await api.call<Data<Customer>>('POST', '/customers', {
      name: 'Pak Tani Satu',
      phone: '0812-3456 789',
      village: 'Sukamaju',
    });
    expect(a.status).toBe(201);
    expect(a.body.data).toMatchObject({ code: 'PL0001', phone: '08123456789', paymentTermDays: 10, creditLimit: null });
    const b = await api.call<Data<Customer>>('POST', '/customers', {
      name: 'Bu Tani Dua',
      customerGroupId: gold.id,
      creditLimit: '5000000',
    });
    expect(b.body.data).toMatchObject({ code: 'PL0002', customerGroupName: 'Gold', creditLimit: '5000000.00' });

    const audit = await api.pool.query(
      "SELECT after FROM audit_logs WHERE action = 'customer.credit_limit' AND entity_id = $1",
      [b.body.data.id],
    );
    expect(audit.rows[0]?.after).toEqual({ creditLimit: '5000000' });
  });

  it('searches by name, code, phone and village; filters by group; paginates', async () => {
    const byVillage = await api.call<ListBody<Customer>>('GET', '/customers?q=sukamaju');
    expect(byVillage.body.data.map((c) => c.code)).toEqual(['PL0001']);
    const byPhone = await api.call<ListBody<Customer>>('GET', '/customers?q=3456');
    expect(byPhone.body.data.map((c) => c.code)).toEqual(['PL0001']);
    const byGroup = await api.call<ListBody<Customer>>('GET', `/customers?groupId=${gold.id}`);
    expect(byGroup.body.data.map((c) => c.code)).toEqual(['PL0002']);
    const page = await api.call<ListBody<Customer>>('GET', '/customers?pageSize=1&page=2');
    expect(page.body.data).toHaveLength(1);
    expect(page.body.meta.total).toBe(3);
  });

  it('rejects a duplicate code (409) and an unknown group (404)', async () => {
    const dup = await api.call<ErrBody>('POST', '/customers', { code: 'pl0001', name: 'Kembar' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toContain('PL0001');
    const group = await api.call<ErrBody>('POST', '/customers', {
      name: 'X',
      customerGroupId: '0190f0a0-0000-7000-8000-000000000000',
    });
    expect(group.status).toBe(404);
  });

  it('keeps UMUM active, cash-only and undeletable', async () => {
    const umum = (await api.call<ListBody<Customer>>('GET', '/customers?q=UMUM')).body.data.find((c) => c.isWalkIn)!;
    const upd = await api.call<Data<Customer>>('PUT', `/customers/${umum.id}`, {
      code: 'X1',
      name: 'Umum',
      creditLimit: '100000',
      isActive: false,
    });
    expect(upd.body.data).toMatchObject({ code: 'UMUM', isActive: true, creditLimit: '0.00' });
    expect((await api.call<ErrBody>('DELETE', `/customers/${umum.id}`)).body.error.code).toBe('BUILT_IN');
  });

  it('deactivates and soft-deletes a normal customer', async () => {
    const c = (await api.call<Data<Customer>>('POST', '/customers', { name: 'Akan Dihapus' })).body.data;
    const off = await api.call<Data<Customer>>('PUT', `/customers/${c.id}`, { name: c.name, isActive: false });
    expect(off.body.data.isActive).toBe(false);
    const visible = await api.call<ListBody<Customer>>('GET', '/customers?q=Dihapus');
    expect(visible.body.data).toHaveLength(0);
    const all = await api.call<ListBody<Customer>>('GET', '/customers?q=Dihapus&includeInactive=true');
    expect(all.body.data).toHaveLength(1);
    expect((await api.call('DELETE', `/customers/${c.id}`)).status).toBe(204);
    expect((await api.call('GET', `/customers/${c.id}`)).status).toBe(404);
    const row = await api.pool.query('SELECT deleted_at FROM customers WHERE id = $1', [c.id]);
    expect(row.rows[0]?.deleted_at).not.toBeNull(); // tombstone, never a hard delete
  });

  it('lets KASIR read customers but not change them (403)', async () => {
    expect((await api.call('GET', '/customers', undefined, { as: 'KASIR' })).status).toBe(200);
    expect((await api.call('POST', '/customers', { name: 'X' }, { as: 'KASIR' })).status).toBe(403);
    expect((await api.call('GET', '/customers', undefined, { as: 'ANONYMOUS' })).status).toBe(401);
  });

  it('lets KASIR quick-add a customer (name, HP, village) with default terms, audited', async () => {
    const res = await api.call<Data<Customer>>(
      'POST',
      '/customers/quick',
      { name: 'Pak Cepat', phone: '0813 1111 2222', village: 'Mekarsari', creditLimit: '999' },
      { as: 'KASIR' },
    );
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'Pak Cepat',
      phone: '081311112222',
      village: 'Mekarsari',
      customerGroupId: null,
      creditLimit: null, // extra fields are ignored — only the Owner sets credit
      paymentTermDays: 10,
      debtAmount: '0.00',
      lastSaleAt: null,
    });
    expect(res.body.data.code).toMatch(/^PL\d{4}$/);
    const audit = await api.pool.query(
      "SELECT after FROM audit_logs WHERE action = 'customer.quick_create' AND entity_id = $1",
      [res.body.data.id],
    );
    expect(audit.rows[0]?.after).toMatchObject({ name: 'Pak Cepat' });

    const empty = await api.call<ErrBody>('POST', '/customers/quick', { name: '  ' }, { as: 'KASIR' });
    expect(empty.status).toBe(400);
    expect((await api.call('POST', '/customers/quick', { name: 'X' }, { as: 'ANONYMOUS' })).status).toBe(401);
  });

  it('reports open receivables and the last sale; sort=recent puts last served first', async () => {
    const mk = async (name: string) =>
      (await api.call<Data<Customer>>('POST', '/customers', { name: `Urut ${name}` })).body.data;
    const [a, b, c] = [await mk('A'), await mk('B'), await mk('C')];
    const ids = await api.pool.query<{ d: string; u: string; w: string }>(
      'SELECT (SELECT id FROM devices LIMIT 1) AS d, (SELECT id FROM users LIMIT 1) AS u, (SELECT id FROM warehouses LIMIT 1) AS w',
    );
    const { d, u, w } = ids.rows[0]!;
    const sale = (customerId: string, n: string, at: string) =>
      api.pool.query(
        `INSERT INTO sales (number, status, device_id, cashier_id, customer_id, warehouse_id, trx_at)
         VALUES ($1, 'COMPLETED', $2, $3, $4, $5, $6)`,
        [n, d, u, customerId, w, at],
      );
    await sale(b.id, 'T-URUT-1', '2026-10-01T09:00:00+07:00');
    await sale(c.id, 'T-URUT-2', '2026-10-05T09:00:00+07:00');
    await api.pool.query(
      `INSERT INTO receivables (customer_id, source_type, doc_number, doc_date, due_date, amount, paid_amount, status)
       VALUES ($1, 'OPENING', 'OP-1', '2026-10-01', '2026-10-11', 500000, 125000, 'PARTIAL'),
              ($1, 'OPENING', 'OP-2', '2026-10-01', '2026-10-11', 300000, 300000, 'PAID')`,
      [c.id],
    );

    const recent = await api.call<ListBody<Customer>>('GET', '/customers?q=Urut&sort=recent', undefined, {
      as: 'KASIR',
    });
    expect(recent.body.data.map((x) => x.name)).toEqual(['Urut C', 'Urut B', 'Urut A']);
    const byName = await api.call<ListBody<Customer>>('GET', '/customers?q=Urut');
    expect(byName.body.data.map((x) => x.name)).toEqual(['Urut A', 'Urut B', 'Urut C']);
    const cRow = recent.body.data[0]!;
    expect(cRow.debtAmount).toBe('375000.00'); // PAID rows don't count
    expect(new Date(cRow.lastSaleAt!).toISOString()).toBe('2026-10-05T02:00:00.000Z');
    expect(recent.body.data.find((x) => x.id === a.id)).toMatchObject({ debtAmount: '0.00', lastSaleAt: null });
    expect((await api.call<ErrBody>('GET', '/customers?sort=random')).status).toBe(400);
  });

  it('returns customer summary with group distribution and counts', async () => {
    const res = await api.call<Data<CustomerSummary>>('GET', '/customers/summary');
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBeGreaterThanOrEqual(1);
    expect(res.body.data.groups).toBeInstanceOf(Array);
    expect(res.body.data.villages).toBeInstanceOf(Array);
    expect(res.body.data.active).toBeGreaterThanOrEqual(1);
  });
});
