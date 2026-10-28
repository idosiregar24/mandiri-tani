import { createServer as createHttpServer, type Server } from 'node:http';
import express from 'express';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthorizationGrantResult, LoginUserCard } from '@shared/schemas/auth';
import {
  HUB_HEADERS,
  insertUser,
  startTestApi,
  TEST_USERS,
  type Data,
  type ErrBody,
  type TestApi,
} from '../../../../test/api';
import { setClock } from '../../lib/clock';
import { authenticate, requirePermission } from '../../middleware/auth';
import { errorHandler } from '../../middleware/error-handler';
import { requestContext } from '../../middleware/request-id';

let api: TestApi;
// Every test starts 2 minutes after the previous one, so the 10/minute login limit never carries over.
let now = Date.parse('2026-10-29T01:00:00Z');
const advance = (ms: number) => (now += ms);

beforeAll(async () => {
  setClock(() => new Date(now));
  api = await startTestApi();
});
beforeEach(() => advance(2 * 60_000));
afterAll(async () => {
  setClock();
  await api?.close();
});

const OWNER = TEST_USERS.OWNER;
const KASIR = TEST_USERS.KASIR;

async function auditActions(userId: string): Promise<string[]> {
  const r = await api.pool.query<{ action: string }>(
    `SELECT action FROM audit_logs WHERE actor_id = $1 OR entity_id = $1 ORDER BY seq`,
    [userId],
  );
  return r.rows.map((x) => x.action);
}

describe('POST /auth/login', () => {
  it('logs in with PIN or password from the hub window and returns a session for that user', async () => {
    const pin = await api.login(KASIR.username, 'PIN', KASIR.pin);
    expect(pin.status).toBe(201);
    expect(pin.body.data).toMatchObject({
      method: 'PIN',
      user: { id: api.users.KASIR.id, username: 'kasir', fullName: 'Kasir Uji', role: 'KASIR' },
    });
    expect(pin.body.data.token).toMatch(/^[\w-]{43}$/);
    // Usernames are case-insensitive.
    const pwd = await api.login('PEMILIK', 'PASSWORD', OWNER.password);
    expect(pwd.status).toBe(201);
    expect(pwd.body.data.user.role).toBe('OWNER');
    // Idle timeout: PIN 12 h, password 8 h (S2-3).
    expect(Date.parse(pin.body.data.expiresAt) - now).toBe(12 * 3600_000);
    expect(Date.parse(pwd.body.data.expiresAt) - now).toBe(8 * 3600_000);

    const me = await api.call<Data<{ user: { role: string } }>>('GET', '/auth/me', undefined, {
      token: pwd.body.data.token,
    });
    expect(me.body.data.user.role).toBe('OWNER');
    // The token itself is stored only as SHA-256.
    const stored = await api.pool.query(`SELECT 1 FROM sessions WHERE token_hash = $1`, [pin.body.data.token]);
    expect(stored.rowCount).toBe(0);
  });

  it('only works from the hub window (local access key header), never by IP', async () => {
    const r = await api.call<ErrBody>(
      'POST',
      '/auth/login',
      { username: KASIR.username, method: 'PIN', secret: KASIR.pin },
      { as: 'ANONYMOUS' },
    );
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('DEVICE_NOT_ALLOWED');
    const wrongKey = await api.call(
      'POST',
      '/auth/login',
      { username: KASIR.username, method: 'PIN', secret: KASIR.pin },
      { as: 'ANONYMOUS', headers: { 'x-local-access-key': 'salah' } },
    );
    expect(wrongKey.status).toBe(401);
  });

  it('answers the same generic message for a wrong PIN, an unknown user and a missing credential', async () => {
    const wrong = await api.login(KASIR.username, 'PIN', '000000');
    const unknown = await api.login('tidak-ada', 'PIN', '000000');
    const noPassword = await api.login(KASIR.username, 'PASSWORD', 'apa-saja'); // kasir has no password
    for (const r of [wrong, unknown, noPassword]) {
      expect(r.status).toBe(401);
      expect((r.body as unknown as ErrBody).error.code).toBe('INVALID_CREDENTIALS');
    }
    expect((wrong.body as unknown as ErrBody).error.message).toBe('Username atau PIN salah.');
    expect((unknown.body as unknown as ErrBody).error.message).toBe('Username atau PIN salah.');
    expect(await auditActions(api.users.KASIR.id)).toContain('auth.login_failed');
    // A successful login resets the failure counter.
    expect((await api.login(KASIR.username, 'PIN', KASIR.pin)).status).toBe(201);
    const c = await api.pool.query(`SELECT failed_attempts FROM users WHERE id = $1`, [api.users.KASIR.id]);
    expect(c.rows[0].failed_attempts).toBe(0);
  });

  it('locks the account for 5 minutes after 5 wrong secrets (S2-4), audited', async () => {
    const id = await insertUser(api.pool, {
      username: 'kunci',
      fullName: 'Uji Kunci',
      role: 'KASIR',
      password: null,
      pin: '111222',
    });
    for (let i = 1; i <= 4; i++) expect((await api.login('kunci', 'PIN', '999999')).status).toBe(401);
    const fifth = await api.login('kunci', 'PIN', '999999');
    expect(fifth.status).toBe(429);
    expect((fifth.body as unknown as ErrBody).error).toMatchObject({
      code: 'ACCOUNT_LOCKED',
      message: 'Akun dikunci sementara karena salah 5 kali. Coba lagi dalam 5 menit.',
    });
    // Even the right PIN is refused while locked.
    expect((await api.login('kunci', 'PIN', '111222')).status).toBe(429);
    advance(5 * 60_000 + 1);
    expect((await api.login('kunci', 'PIN', '111222')).status).toBe(201);
    const actions = await auditActions(id);
    expect(actions.filter((a) => a === 'auth.login_failed')).toHaveLength(6);
    expect(actions).toContain('auth.locked');
    expect(actions.at(-1)).toBe('auth.login');
  });

  it('refuses inactive users and rate-limits login to 10 per minute per IP', async () => {
    await insertUser(api.pool, {
      username: 'lama',
      fullName: 'Uji Nonaktif',
      role: 'KASIR',
      password: null,
      pin: '333444',
    });
    await api.pool.query(`UPDATE users SET is_active = false WHERE username = 'lama'`);
    expect((await api.login('lama', 'PIN', '333444')).status).toBe(401);
    for (let i = 0; i < 9; i++) await api.login('tidak-ada', 'PIN', '000000');
    const r = await api.login(KASIR.username, 'PIN', KASIR.pin);
    expect(r.status).toBe(429);
    expect((r.body as unknown as ErrBody).error.code).toBe('RATE_LIMITED');
    expect(r.headers.get('retry-after')).toBeTruthy();
  });
});

describe('sessions', () => {
  it('logout revokes the token', async () => {
    const { token } = (await api.login(KASIR.username, 'PIN', KASIR.pin)).body.data;
    expect((await api.call('GET', '/units', undefined, { token })).status).toBe(200);
    expect((await api.call('POST', '/auth/logout', undefined, { token })).status).toBe(204);
    const after = await api.call<ErrBody>('GET', '/units', undefined, { token });
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('expires after the idle timeout but slides while in use', async () => {
    const { token } = (await api.login(OWNER.username, 'PASSWORD', OWNER.password)).body.data;
    advance(7 * 3600_000);
    expect((await api.call('GET', '/units', undefined, { token })).status).toBe(200); // slides the 8 h window
    advance(7 * 3600_000);
    expect((await api.call('GET', '/units', undefined, { token })).status).toBe(200);
    advance(8 * 3600_000 + 1);
    expect((await api.call('GET', '/units', undefined, { token })).status).toBe(401);
  });

  it('a deactivated user loses access on the next request', async () => {
    const id = await insertUser(api.pool, {
      username: 'pergi',
      fullName: 'Uji Pergi',
      role: 'KASIR',
      password: null,
      pin: '555666',
    });
    const { token } = (await api.login('pergi', 'PIN', '555666')).body.data;
    expect((await api.call('GET', '/units', undefined, { token })).status).toBe(200);
    await api.pool.query(`UPDATE users SET is_active = false WHERE id = $1`, [id]);
    expect((await api.call('GET', '/units', undefined, { token })).status).toBe(401);
  });
});

describe('GET /auth/login-users', () => {
  it('lists active users for the hub login screen, without any secret', async () => {
    const r = await api.call<Data<LoginUserCard[]>>('GET', '/auth/login-users', undefined, {
      as: 'ANONYMOUS',
      headers: HUB_HEADERS,
    });
    expect(r.status).toBe(200);
    expect(r.body.data).toContainEqual({
      id: api.users.OWNER.id,
      username: 'pemilik',
      fullName: 'Pemilik Uji',
      role: 'OWNER',
      methods: ['PASSWORD', 'PIN'],
    });
    expect(r.body.data.find((u) => u.username === 'kasir')?.methods).toEqual(['PIN']);
    expect(r.body.data.some((u) => u.username === 'lama')).toBe(false);
    expect(JSON.stringify(r.body)).not.toMatch(/argon2|hash/i);
    expect((await api.call('GET', '/auth/login-users', undefined, { as: 'ANONYMOUS' })).status).toBe(401);
  });
});

describe('Owner-PIN authorization (FR-POS-20, S2-6)', () => {
  // No sprint-2 route needs an authorizable permission yet, so the guard is mounted on a probe app
  // that shares the test server's database.
  let probe: Server;
  let probeBase: string;
  beforeAll(async () => {
    // The idle-timeout test moved the clock past the default tokens' lifetime: log in again.
    api.users.OWNER.token = (await api.login(OWNER.username, 'PIN', OWNER.pin)).body.data.token;
    api.users.KASIR.token = (await api.login(KASIR.username, 'PIN', KASIR.pin)).body.data.token;
    const app = express();
    app.locals.pool = api.pool;
    app.use(requestContext(pino({ level: 'silent' })));
    app.use(authenticate({ pool: api.pool }));
    app.post('/void', requirePermission('sales.void'), (req, res) => {
      res.json({ data: { approvedBy: req.ctx.approvedBy } });
    });
    app.post('/write', requirePermission('products.write'), (_req, res) => {
      res.json({ data: {} });
    });
    app.use(errorHandler);
    probe = createHttpServer(app);
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', () => r()));
    const a = probe.address();
    probeBase = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
  });
  afterAll(() => new Promise<void>((r) => probe.close(() => r())));

  const probeCall = async (path: string, as: 'OWNER' | 'KASIR', grant?: string) => {
    const res = await fetch(`${probeBase}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${api.users[as].token}`,
        ...(grant ? { 'x-authorization-grant': grant } : {}),
      },
    });
    return { status: res.status, body: (await res.json()) as Data<{ approvedBy: string | null }> & ErrBody };
  };
  const authorize = (username: string, pin: string, permission: string, as: 'OWNER' | 'KASIR' = 'KASIR') =>
    api.call<Data<AuthorizationGrantResult> & ErrBody>(
      'POST',
      '/auth/authorize',
      { username, pin, permission },
      { as },
    );

  it('KASIR gets 423 without a grant; OWNER passes directly; never-authorizable permissions stay 403', async () => {
    const r = await probeCall('/void', 'KASIR');
    expect(r.status).toBe(423);
    expect(r.body.error).toMatchObject({ code: 'AUTHORIZATION_REQUIRED', details: { permission: 'sales.void' } });
    expect((await probeCall('/void', 'OWNER')).body.data.approvedBy).toBeNull();
    expect((await probeCall('/write', 'KASIR')).status).toBe(403);
  });

  it('a grant from the Owner PIN lets the cashier do the action once, with approved_by recorded', async () => {
    const g = await authorize(OWNER.username, OWNER.pin, 'sales.void');
    expect(g.status).toBe(201);
    expect(g.body.data).toMatchObject({
      permission: 'sales.void',
      grantedBy: { id: api.users.OWNER.id, fullName: 'Pemilik Uji' },
    });
    expect(Date.parse(g.body.data.expiresAt) - now).toBe(2 * 60_000);

    const ok = await probeCall('/void', 'KASIR', g.body.data.grant);
    expect(ok.status).toBe(200);
    expect(ok.body.data.approvedBy).toBe(api.users.OWNER.id);
    const again = await probeCall('/void', 'KASIR', g.body.data.grant);
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe('AUTHORIZATION_INVALID');

    const audit = await api.pool.query(
      `SELECT actor_id, approved_by FROM audit_logs WHERE action = 'auth.authorize' ORDER BY seq DESC LIMIT 1`,
    );
    expect(audit.rows[0]).toEqual({ actor_id: api.users.KASIR.id, approved_by: api.users.OWNER.id });
  });

  it('rejects expired grants, grants for another action, cashier PINs and wrong PINs', async () => {
    const expiring = await authorize(OWNER.username, OWNER.pin, 'sales.void');
    advance(2 * 60_000 + 1);
    expect((await probeCall('/void', 'KASIR', expiring.body.data.grant)).status).toBe(401);

    const other = await authorize(OWNER.username, OWNER.pin, 'sales.return');
    const mismatch = await probeCall('/void', 'KASIR', other.body.data.grant);
    expect(mismatch.status).toBe(403);

    const fromKasir = await authorize(KASIR.username, KASIR.pin, 'sales.void');
    expect(fromKasir.status).toBe(403);
    expect(fromKasir.body.error.message).toBe('Otorisasi harus dari Owner.');

    const wrongPin = await authorize(OWNER.username, '000000', 'sales.void');
    expect(wrongPin.status).toBe(401);
    expect(wrongPin.body.error.code).toBe('INVALID_CREDENTIALS');

    const notAuthorizable = await authorize(OWNER.username, OWNER.pin, 'products.write');
    expect(notAuthorizable.status).toBe(400);
  });
});
