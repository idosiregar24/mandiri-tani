import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Supplier } from '@shared/schemas/master';
import { startTestApi, type Data, type ErrBody, type ListBody, type TestApi } from '../../../../test/api';

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi();
});
afterAll(async () => {
  await api?.close();
});

describe('suppliers', () => {
  it('generates SPxxxx codes, keeps an explicit code, rejects a duplicate', async () => {
    const a = await api.call<Data<Supplier>>('POST', '/suppliers', { name: 'CV Sumber Tani', phone: '0812 111' });
    expect(a.status).toBe(201);
    expect(a.body.data).toMatchObject({ code: 'SP0001', phone: '0812111', paymentTermDays: 0 });
    const b = await api.call<Data<Supplier>>('POST', '/suppliers', { code: 'sp0007', name: 'PT Agro' });
    expect(b.body.data.code).toBe('SP0007');
    // Next generated code continues after the highest one.
    expect((await api.call<Data<Supplier>>('POST', '/suppliers', { name: 'UD Baru' })).body.data.code).toBe('SP0008');
    const dup = await api.call<ErrBody>('POST', '/suppliers', { code: 'SP0001', name: 'Kembar' });
    expect(dup.status).toBe(409);
  });

  it('updates, searches and soft-deletes with an audit row', async () => {
    const s = (await api.call<ListBody<Supplier>>('GET', '/suppliers?q=agro')).body.data[0]!;
    const upd = await api.call<Data<Supplier>>('PUT', `/suppliers/${s.id}`, {
      name: 'PT Agro Makmur',
      paymentTermDays: 30,
    });
    expect(upd.body.data).toMatchObject({ code: 'SP0007', name: 'PT Agro Makmur', paymentTermDays: 30 });
    expect((await api.call('DELETE', `/suppliers/${s.id}`)).status).toBe(204);
    expect((await api.call<ListBody<Supplier>>('GET', '/suppliers?q=agro')).body.data).toHaveLength(0);
    const audit = await api.pool.query("SELECT 1 FROM audit_logs WHERE action = 'supplier.delete' AND entity_id = $1", [
      s.id,
    ]);
    expect(audit.rowCount).toBe(1);
  });

  it('lets KASIR read suppliers but not change them (403)', async () => {
    expect((await api.call('GET', '/suppliers', undefined, { as: 'KASIR' })).status).toBe(200);
    expect((await api.call('POST', '/suppliers', { name: 'X' }, { as: 'KASIR' })).status).toBe(403);
    expect((await api.call('GET', '/suppliers', undefined, { as: 'ANONYMOUS' })).status).toBe(401);
  });
});
