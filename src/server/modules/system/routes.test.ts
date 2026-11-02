import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type Data, type ErrBody, type TestApi } from '../../../../test/api';

let api: TestApi;
let backedUpLabel: string | null = null;

beforeAll(async () => {
  api = await startTestApi({
    hooks: {
      backup: async (label: string) => {
        backedUpLabel = label;
        return `C:\\backups\\${label}-2026-11-02.dump`;
      },
    },
  });
});

afterAll(async () => {
  await api?.close();
});

describe('system go-live module (Sprint 14, FR-MIG-10)', () => {
  it('checks initial system status as preparation mode (not live)', async () => {
    const res = await api.call<Data<{ isLive: boolean; goLiveAt: string | null }>>('GET', '/system/status');
    expect(res.status).toBe(200);
    expect(res.body.data.isLive).toBe(false);
    expect(res.body.data.goLiveAt).toBeNull();
  });

  it('rejects go-live for cashier role (403)', async () => {
    const res = await api.call<ErrBody>('POST', '/system/go-live', { confirm: 'GO LIVE' }, { as: 'KASIR' });
    expect(res.status).toBe(403);
  });

  it('rejects go-live without exact confirmation keyword (400)', async () => {
    const res = await api.call<ErrBody>('POST', '/system/go-live', { confirm: 'ya' }, { as: 'OWNER' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CONFIRMATION_MISMATCH');
  });

  it('successfully transitions to production mode with backup and audit log', async () => {
    const res = await api.call<Data<{ isLive: boolean; goLiveAt: string; backupFile: string }>>(
      'POST',
      '/system/go-live',
      { confirm: 'GO LIVE' },
      { as: 'OWNER' },
    );

    expect(res.status).toBe(200);
    expect(res.body.data.isLive).toBe(true);
    expect(res.body.data.goLiveAt).toBeTruthy();
    expect(res.body.data.backupFile).toBe('go-live-2026-11-02.dump');
    expect(backedUpLabel).toBe('go-live');

    // Verify audit log
    const auditRes = await api.pool.query<{ count: string }>(
      "SELECT count(*) FROM audit_logs WHERE action = 'system.go_live'",
    );
    expect(Number(auditRes.rows[0]?.count)).toBe(1);

    // Verify system status is now live
    const statusRes = await api.call<Data<{ isLive: boolean; goLiveAt: string | null }>>('GET', '/system/status');
    expect(statusRes.body.data.isLive).toBe(true);
    expect(statusRes.body.data.goLiveAt).toBe(res.body.data.goLiveAt);
  });

  it('refuses to go-live again when already live (409)', async () => {
    const res = await api.call<ErrBody>(
      'POST',
      '/system/go-live',
      { confirm: 'GO LIVE' },
      { as: 'OWNER' },
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_LIVE');
  });
});

