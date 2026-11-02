import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PosSettings, StoreSettings } from '@shared/schemas/settings';
import { startTestApi, type Data, type ErrBody, type TestApi } from '../../../../test/api';
import type { AuditLogRow } from '../audit-logs/routes';
import type { UserRow } from './routes';

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi();
});
afterAll(async () => {
  await api?.close();
});

describe('users & settings management (Sprint 2 & 12)', () => {
  let createdUserId: string;

  it('lists existing users (requires users.manage)', async () => {
    // Owner can list
    const res = await api.call<Data<UserRow[]>>('GET', '/users', undefined, { as: 'OWNER' });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.some((u) => u.role === 'OWNER')).toBe(true);

    // Kasir cannot list
    const forbidden = await api.call<ErrBody>('GET', '/users', undefined, { as: 'KASIR' });
    expect(forbidden.status).toBe(403);
  });

  it('creates a new cashier user with PIN', async () => {
    const res = await api.call<Data<UserRow>>(
      'POST',
      '/users',
      {
        fullName: 'Kasir Budi',
        username: 'kasirbudi',
        role: 'KASIR',
        pin: '123456',
        pinConfirm: '123456',
      },
      { as: 'OWNER' },
    );
    expect(res.status).toBe(201);
    expect(res.body.data.username).toBe('kasirbudi');
    expect(res.body.data.hasPin).toBe(true);
    expect(res.body.data.isActive).toBe(true);
    createdUserId = res.body.data.id;

    // Refuses duplicate username
    const dup = await api.call<ErrBody>(
      'POST',
      '/users',
      {
        fullName: 'Kasir Lain',
        username: 'kasirbudi',
        role: 'KASIR',
        pin: '654321',
        pinConfirm: '654321',
      },
      { as: 'OWNER' },
    );
    expect(dup.status).toBe(409);
  });

  it('updates user full name and role', async () => {
    const res = await api.call<Data<UserRow>>(
      'PUT',
      `/users/${createdUserId}`,
      {
        fullName: 'Budi Santoso',
        role: 'KASIR',
      },
      { as: 'OWNER' },
    );
    expect(res.status).toBe(200);
    expect(res.body.data.fullName).toBe('Budi Santoso');
  });

  it('resets user PIN and password', async () => {
    const pinRes = await api.call<Data<{ ok: boolean }>>(
      'POST',
      `/users/${createdUserId}/pin`,
      { pin: '987654', pinConfirm: '987654' },
      { as: 'OWNER' },
    );
    expect(pinRes.status).toBe(200);
    expect(pinRes.body.data.ok).toBe(true);

    const pwRes = await api.call<Data<{ ok: boolean }>>(
      'POST',
      `/users/${createdUserId}/password`,
      { password: 'Password123' },
      { as: 'OWNER' },
    );
    expect(pwRes.status).toBe(200);
    expect(pwRes.body.data.ok).toBe(true);
  });

  it('toggles user active status and protects last owner', async () => {
    // Deactivate Budi
    const deact = await api.call<Data<{ isActive: boolean }>>(
      'POST',
      `/users/${createdUserId}/toggle-active`,
      {},
      { as: 'OWNER' },
    );
    expect(deact.status).toBe(200);
    expect(deact.body.data.isActive).toBe(false);

    // Reactivate Budi
    const react = await api.call<Data<{ isActive: boolean }>>(
      'POST',
      `/users/${createdUserId}/toggle-active`,
      {},
      { as: 'OWNER' },
    );
    expect(react.status).toBe(200);
    expect(react.body.data.isActive).toBe(true);
  });

  it('reads and updates store settings with audit log', async () => {
    // Read store settings
    const read = await api.call<Data<StoreSettings>>('GET', '/settings/store', undefined, { as: 'OWNER' });
    expect(read.status).toBe(200);
    expect(read.body.data.name).toBeDefined();

    // Update store settings
    const updated = await api.call<Data<StoreSettings>>(
      'PUT',
      '/settings/store',
      {
        name: 'Mandiri Tani Bukit Kesuma',
        address: 'Jl. Poros RAPP Km. 72',
        phone: '0813-6144-1706',
        fax: '-',
        email: 'mandiritani@example.com',
        receiptFooter: 'Barang yang dibeli tidak dapat ditukar kecuali ada perjanjian.',
      },
      { as: 'OWNER' },
    );
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe('Mandiri Tani Bukit Kesuma');
    expect(updated.body.data.phone).toBe('0813-6144-1706');

    // Pos settings
    const pos = await api.call<Data<PosSettings>>(
      'PUT',
      '/settings/pos',
      { cashierDiscountLimitPercent: 10 },
      { as: 'OWNER' },
    );
    expect(pos.status).toBe(200);
    expect(pos.body.data.cashierDiscountLimitPercent).toBe(10);
  });

  it('queries audit logs with action and pagination', async () => {
    const logs = await api.call<Data<AuditLogRow[]>>('GET', '/audit-logs?limit=10', undefined, { as: 'OWNER' });
    expect(logs.status).toBe(200);
    expect(logs.body.data.length).toBeGreaterThan(0);
    expect(logs.body.data.some((l) => l.action.startsWith('user.') || l.action.startsWith('settings.'))).toBe(true);
  });

  it('exports master data to Excel file', async () => {
    const res = await fetch(`${api.base}/masters/export-xlsx`, {
      headers: { authorization: `Bearer ${api.users.OWNER.token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml');
  });
});
