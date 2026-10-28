import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LoginResult } from '@shared/schemas/auth';
import type { SetupStatus } from '@shared/schemas/settings';
import { HUB_HEADERS, startTestApi, type Data, type ErrBody, type TestApi } from '../../../../test/api';

let api: TestApi;
beforeAll(async () => {
  api = await startTestApi({ noUsers: true });
});
afterAll(async () => {
  await api?.close();
});

const hub = { as: 'ANONYMOUS' as const, headers: HUB_HEADERS };
const valid = {
  store: { name: 'Toko Tani Contoh', address: 'Jl. Contoh No. 1', phone: '' },
  owner: { fullName: 'Budi Contoh', username: 'Budi', password: 'rahasia-budi', pin: '120034', pinConfirm: '120034' },
  warehouseName: 'Gudang Depan',
};

describe('first-run setup (FR-SYS-01)', () => {
  it('reports needsSetup and the default warehouse; hub window only', async () => {
    const r = await api.call<Data<SetupStatus>>('GET', '/setup/status', undefined, hub);
    expect(r.body.data).toEqual({ needsSetup: true, warehouse: { code: 'UTM', name: 'Gudang Utama' } });
    expect((await api.call('GET', '/setup/status', undefined, { as: 'ANONYMOUS' })).status).toBe(401);
    expect((await api.call('POST', '/setup', valid, { as: 'ANONYMOUS' })).status).toBe(401);
  });

  it('validates the form: PIN twice, password length', async () => {
    const r = await api.call<ErrBody>(
      'POST',
      '/setup',
      { ...valid, owner: { ...valid.owner, password: 'pendek', pinConfirm: '999999' } },
      hub,
    );
    expect(r.status).toBe(400);
    expect(r.body.error.details?.fieldErrors).toMatchObject({
      'owner.password': 'Password minimal 8 huruf.',
      'owner.pinConfirm': 'PIN kedua tidak sama.',
    });
  });

  it('creates store profile, Owner and warehouse name in one go and logs the Owner in', async () => {
    const r = await api.call<Data<LoginResult>>('POST', '/setup', valid, hub);
    expect(r.status).toBe(201);
    expect(r.body.data.user).toMatchObject({ username: 'budi', fullName: 'Budi Contoh', role: 'OWNER' });
    const token = r.body.data.token;
    expect((await api.call('GET', '/units', undefined, { token })).status).toBe(200);

    const store = await api.pool.query(`SELECT value FROM settings WHERE key = 'store'`);
    expect(store.rows[0].value).toEqual({ name: 'Toko Tani Contoh', address: 'Jl. Contoh No. 1', phone: null });
    const wh = await api.pool.query(`SELECT code, name FROM warehouses WHERE is_default`);
    expect(wh.rows[0]).toEqual({ code: 'UTM', name: 'Gudang Depan' });
    const audit = await api.pool.query(`SELECT action FROM audit_logs ORDER BY seq`);
    expect(audit.rows.map((x) => x.action)).toEqual(['system.setup', 'auth.login']);
    // The PIN works too (needed for Owner authorization).
    expect((await api.login('budi', 'PIN', '120034')).status).toBe(201);
  });

  it('can never run a second time', async () => {
    const s = await api.call<Data<SetupStatus>>('GET', '/setup/status', undefined, hub);
    expect(s.body.data.needsSetup).toBe(false);
    const again = await api.call<ErrBody>(
      'POST',
      '/setup',
      { ...valid, owner: { ...valid.owner, username: 'penyusup' } },
      hub,
    );
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_SET_UP');
  });
});

describe('concurrent setup', () => {
  it('two simultaneous wizards create exactly one Owner', async () => {
    const fresh = await startTestApi({ noUsers: true });
    try {
      const results = await Promise.all(
        ['satu', 'dua'].map((u) =>
          fresh.call('POST', '/setup', { ...valid, owner: { ...valid.owner, username: u } }, hub),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const n = await fresh.pool.query(`SELECT count(*)::int AS n FROM users`);
      expect(n.rows[0].n).toBe(1);
    } finally {
      await fresh.close();
    }
  });
});
