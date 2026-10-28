import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertUser } from '../../test/api';
import { createTestDatabase, type TestDatabase } from '../../test/pg';
import { migrationsDir } from '../../test/paths';
import { createServer, type PosServer } from './server';

const logger = pino({ level: 'silent' });
const KEY = 'test-local-access-key';
let auth: { authorization: string };

interface HealthBody {
  data: { version: string; db: { ok: boolean; version?: string } };
}
interface ErrorBody {
  error: { code: string; message: string };
}
let tdb: TestDatabase;
let server: PosServer;
let base: string;
let staticDir: string;

beforeAll(async () => {
  tdb = await createTestDatabase();
  staticDir = mkdtempSync(join(tmpdir(), 'mtpos-static-'));
  writeFileSync(
    join(staticDir, 'index.html'),
    '<!doctype html><html><head><script src="./assets/app.js"></script></head></html>',
  );
  server = createServer({
    host: '127.0.0.1',
    port: 0,
    db: tdb.config,
    appVersion: '0.0.0-test',
    logger,
    migrationsDir,
    localAccessKey: KEY,
    staticDir,
  });
  await server.migrate();
  const { port } = await server.start();
  base = `http://127.0.0.1:${port}/api/v1`;
  await insertUser(server.pool, {
    username: 'pemilik',
    fullName: 'Pemilik',
    role: 'OWNER',
    password: null,
    pin: '135790',
  });
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-local-access-key': KEY },
    body: JSON.stringify({ username: 'pemilik', method: 'PIN', secret: '135790' }),
  });
  auth = { authorization: `Bearer ${((await res.json()) as { data: { token: string } }).data.token}` };
});

afterAll(async () => {
  await server?.stop(500);
  await tdb?.drop();
  rmSync(staticDir, { recursive: true, force: true });
});

describe('embedded API', () => {
  it('GET /health reports app version and a healthy database', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthBody;
    expect(body.data.version).toBe('0.0.0-test');
    expect(body.data.db.ok).toBe(true);
    expect(body.data.db.version).toMatch(/^18\./);
    expect(res.headers.get('x-request-id')).toBeTruthy();
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('answers unknown API routes with the JSON error contract', async () => {
    const res = await fetch(`${base}/does-not-exist`, { headers: auth });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: 'NOT_FOUND', message: expect.stringContaining('tidak ditemukan') },
    });
  });

  it('requires a session for every API route except /health (no localhost exception)', async () => {
    const none = await fetch(`${base}/units`);
    expect(none.status).toBe(401);
    expect(((await none.json()) as ErrorBody).error.code).toBe('UNAUTHENTICATED');
    const wrong = await fetch(`${base}/units`, { headers: { authorization: 'Bearer nope' } });
    expect(wrong.status).toBe(401);
    // The local access key is not a user (sprint-2 S2-1): neither as bearer nor as its own header.
    expect((await fetch(`${base}/units`, { headers: { authorization: `Bearer ${KEY}` } })).status).toBe(401);
    expect((await fetch(`${base}/units`, { headers: { 'x-local-access-key': KEY } })).status).toBe(401);
    // Unknown routes are not revealed to unauthenticated callers either.
    expect((await fetch(`${base}/does-not-exist`)).status).toBe(401);
    const ok = await fetch(`${base}/units`, { headers: auth });
    expect(ok.status).toBe(200);
  });

  it('serves the SPA shell with <base href="/"> so deep links reload with working assets', async () => {
    const origin = new URL(base).origin;
    for (const path of ['/', '/barang/123']) {
      const res = await fetch(`${origin}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(await res.text()).toContain('<head><base href="/" /><script src="./assets/app.js">');
    }
  });

  it('rejects malformed JSON with INVALID_JSON', async () => {
    const res = await fetch(`${base}/health`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{oops',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe('INVALID_JSON');
  });

  it('reports PORT_IN_USE when the port is taken', async () => {
    const port = Number(new URL(base).port);
    const second = createServer({ host: '127.0.0.1', port, db: tdb.config, appVersion: 'x', logger, migrationsDir });
    await expect(second.start()).rejects.toMatchObject({ code: 'PORT_IN_USE' });
    await second.stop(100);
  });
});
