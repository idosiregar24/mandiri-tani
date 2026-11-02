import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DeviceItem, NetworkInfo, PairDeviceResult, PairingCodeResult } from '@shared/schemas/devices';
import { startTestApi, type TestApi } from '../../../../test/api';

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi();
});

afterAll(async () => {
  await api?.close();
});

describe('devices & pairing (FR-SRV-03..04)', () => {
  it('generates pairing code for Owner, rejects Kasir (403)', async () => {
    const rOwner = await api.call<{ data: PairingCodeResult }>('POST', '/devices/pairing-codes', { kind: 'MOBILE' });
    expect(rOwner.status).toBe(201);
    expect(rOwner.body.data.code).toMatch(/^\d{6}$/);
    expect(rOwner.body.data.hubUrl).toContain('http://');
    const parsedQr = JSON.parse(rOwner.body.data.qrData);
    expect(parsedQr.code).toBe(rOwner.body.data.code);
    expect(parsedQr.kind).toBe('MOBILE');

    const rKasir = await api.call('POST', '/devices/pairing-codes', { kind: 'MOBILE' }, { as: 'KASIR' });
    expect(rKasir.status).toBe(403);
  });

  it('pairs an unauthenticated device with valid code and increments code (H01, H02)', async () => {
    // 1. Generate code for MOBILE
    const code1 = await api.call<{ data: PairingCodeResult }>('POST', '/devices/pairing-codes', { kind: 'MOBILE' });
    const pin1 = code1.body.data.code;

    // 2. Unauthenticated mobile device pairs
    const pair1 = await api.call<{ data: PairDeviceResult }>(
      'POST',
      '/devices/pair',
      {
        code: pin1,
        deviceName: 'Samsung A54 Gudang',
        kind: 'MOBILE',
        appVersion: '1.0.0',
        deviceTime: new Date().toISOString(),
      },
      { as: 'ANONYMOUS' },
    );
    expect(pair1.status).toBe(201);
    expect(pair1.body.data.deviceCode).toBe('H01');
    expect(pair1.body.data.token).toHaveLength(64); // 32 bytes in hex

    // 3. Re-using the same code is rejected
    const reuse = await api.call(
      'POST',
      '/devices/pair',
      { code: pin1, deviceName: 'Ponsel Lain', kind: 'MOBILE' },
      { as: 'ANONYMOUS' },
    );
    expect(reuse.status).toBe(400);

    // 4. Pair a second mobile device -> H02
    const code2 = await api.call<{ data: PairingCodeResult }>('POST', '/devices/pairing-codes', { kind: 'MOBILE' });
    const pair2 = await api.call<{ data: PairDeviceResult }>(
      'POST',
      '/devices/pair',
      { code: code2.body.data.code, deviceName: 'Xiaomi Redmi Kasir 2', kind: 'MOBILE' },
      { as: 'ANONYMOUS' },
    );
    expect(pair2.body.data.deviceCode).toBe('H02');

    // 5. Pair a terminal device -> T01
    const code3 = await api.call<{ data: PairingCodeResult }>('POST', '/devices/pairing-codes', { kind: 'TERMINAL' });
    const pair3 = await api.call<{ data: PairDeviceResult }>(
      'POST',
      '/devices/pair',
      { code: code3.body.data.code, deviceName: 'PC Kasir 2', kind: 'TERMINAL' },
      { as: 'ANONYMOUS' },
    );
    expect(pair3.body.data.deviceCode).toBe('T01');
  });

  it('rejects an invalid or expired pairing code', async () => {
    const wrong = await api.call(
      'POST',
      '/devices/pair',
      { code: '999999', deviceName: 'HP Test', kind: 'MOBILE' },
      { as: 'ANONYMOUS' },
    );
    expect(wrong.status).toBe(400);
  });

  it('authenticates a device token, updates last_seen_at and clock skew', async () => {
    // Generate code and pair
    const codeRes = await api.call<{ data: PairingCodeResult }>('POST', '/devices/pairing-codes', { kind: 'MOBILE' });
    const pairRes = await api.call<{ data: PairDeviceResult }>(
      'POST',
      '/devices/pair',
      { code: codeRes.body.data.code, deviceName: 'HP Staf Budi', kind: 'MOBILE' },
      { as: 'ANONYMOUS' },
    );
    const token = pairRes.body.data.token;
    const deviceId = pairRes.body.data.deviceId;

    // Call API using device token (Bearer <token>) with X-Device-Time header
    const deviceNow = new Date(Date.now() + 60_000).toISOString(); // 1 minute ahead
    const apiRes = await api.call(
      'GET',
      '/products',
      undefined,
      {
        token,
        headers: { 'x-device-time': deviceNow },
      },
    );
    expect(apiRes.status).toBe(200);

    // Check device record in DB
    const devRow = (await api.pool.query<{ last_clock_skew_ms: number; last_seen_at: string }>(
      'SELECT last_clock_skew_ms, last_seen_at FROM devices WHERE id = $1',
      [deviceId],
    )).rows[0]!;
    expect(devRow.last_seen_at).toBeTruthy();
    expect(devRow.last_clock_skew_ms).toBeGreaterThanOrEqual(50_000);
    expect(devRow.last_clock_skew_ms).toBeLessThanOrEqual(70_000);
  });

  it('lists devices for Owner and supports revoking non-Hub devices', async () => {
    const listRes = await api.call<{ data: DeviceItem[] }>('GET', '/devices');
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.some((d) => d.code === 'K01')).toBe(true);

    const mobileDevice = listRes.body.data.find((d) => d.code === 'H01')!;
    expect(mobileDevice).toBeTruthy();

    // Revoking K01 (Hub) is rejected
    const hub = listRes.body.data.find((d) => d.code === 'K01')!;
    const revHub = await api.call('POST', `/devices/${hub.id}/revoke`);
    expect(revHub.status).toBe(400);

    // Revoking H01 succeeds
    const revMobile = await api.call('POST', `/devices/${mobileDevice.id}/revoke`);
    expect(revMobile.status).toBe(204);

    // After revoking, device list shows revokedAt
    const listAfter = await api.call<{ data: DeviceItem[] }>('GET', '/devices');
    const updatedMobile = listAfter.body.data.find((d) => d.id === mobileDevice.id)!;
    expect(updatedMobile.revokedAt).toBeTruthy();
  });

  it('provides network-info with LAN IPs and hub URL', async () => {
    const netRes = await api.call<{ data: NetworkInfo }>('GET', '/devices/network-info');
    expect(netRes.status).toBe(200);
    expect(netRes.body.data.port).toBe(3000);
    expect(netRes.body.data.localIps.length).toBeGreaterThan(0);
    expect(netRes.body.data.primaryHubUrl).toContain(':3000');
  });
});

