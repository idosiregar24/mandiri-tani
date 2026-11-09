import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bytesToBase64, type MonoBitmap, type ReceiptLogo } from '@shared/logo';
import type { LogoSettings } from '@shared/schemas/settings';
import { startTestApi, type Data, type ErrBody, type TestApi } from '../../../../test/api';
import type { AuditLogRow } from '../audit-logs/routes';

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi();
});
afterAll(async () => {
  await api?.close();
});

const bitmap = (width: number, height: number): MonoBitmap => ({
  width,
  height,
  data: bytesToBase64(new Uint8Array(Math.ceil(width / 8) * height).fill(0x0f)),
});
// 1×1 white PNG — the server only stores it; the renderer made the bitmaps.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const logo = {
  image: PNG,
  threshold: 140,
  printOnFaktur: true,
  printOnStruk: false,
  faktur: bitmap(100, 60),
  struk: bitmap(120, 40),
};

describe('store logo settings (FR-SYS-01)', () => {
  it('only the Owner reads or changes the logo', async () => {
    expect((await api.call<ErrBody>('GET', '/settings/logo', undefined, { as: 'KASIR' })).status).toBe(403);
    expect((await api.call<ErrBody>('PUT', '/settings/logo', logo, { as: 'KASIR' })).status).toBe(403);
    const empty = await api.call<Data<LogoSettings>>('GET', '/settings/logo', undefined, { as: 'OWNER' });
    expect(empty.status).toBe(200);
    expect(empty.body.data.image).toBeNull();
  });

  it('saves the logo; receipts get only the bitmaps switched on; audit holds no picture', async () => {
    const saved = await api.call<Data<LogoSettings>>('PUT', '/settings/logo', logo, { as: 'OWNER' });
    expect(saved.status).toBe(200);
    expect(saved.body.data.threshold).toBe(140);

    const receipt = await api.call<Data<{ store: { name: string; logo: ReceiptLogo | null } }>>(
      'GET',
      '/settings/receipt',
      undefined,
      { as: 'KASIR' },
    );
    expect(receipt.status).toBe(200);
    expect(receipt.body.data.store.logo).toEqual({ faktur: logo.faktur, struk: null });

    const logs = await api.call<Data<AuditLogRow[]>>('GET', '/audit-logs?limit=5', undefined, { as: 'OWNER' });
    const entry = logs.body.data.find((l) => l.action === 'settings.update');
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry)).not.toContain('base64');
    expect(JSON.stringify(entry)).toContain('"hasImage":true');
  });

  it('rejects broken data: picture without bitmaps, wrong bitmap size, non-PNG', async () => {
    const noBitmaps = await api.call<ErrBody>('PUT', '/settings/logo', { ...logo, struk: null }, { as: 'OWNER' });
    expect(noBitmaps.status).toBe(400);
    const badSize = await api.call<ErrBody>(
      'PUT',
      '/settings/logo',
      { ...logo, faktur: { ...logo.faktur, height: 61 } },
      { as: 'OWNER' },
    );
    expect(badSize.status).toBe(400);
    const notPng = await api.call<ErrBody>(
      'PUT',
      '/settings/logo',
      { ...logo, image: 'data:text/html;base64,PGgxPg==' },
      { as: 'OWNER' },
    );
    expect(notPng.status).toBe(400);
  });

  it('removing the logo removes it from receipts', async () => {
    const removed = await api.call<Data<LogoSettings>>(
      'PUT',
      '/settings/logo',
      { ...logo, image: null, faktur: null, struk: null },
      { as: 'OWNER' },
    );
    expect(removed.status).toBe(200);
    const receipt = await api.call<Data<{ store: { logo: ReceiptLogo | null } }>>(
      'GET',
      '/settings/receipt',
      undefined,
      { as: 'KASIR' },
    );
    expect(receipt.body.data.store.logo).toBeNull();
  });
});
